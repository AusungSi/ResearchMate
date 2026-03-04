from __future__ import annotations

from collections.abc import Callable
import re

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.logging import get_logger
from app.infra.repos import ResearchSessionRepo
from app.infra.wecom_client import WeComClient
from app.services.research_service import ResearchService


logger = get_logger("research_command")


class ResearchCommandService:
    def __init__(self, *, research_service: ResearchService, wecom_client: WeComClient) -> None:
        self.settings = get_settings()
        self.research_service = research_service
        self.wecom_client = wecom_client

    @staticmethod
    def is_research_command(text: str) -> bool:
        normalized = (text or "").strip().lower()
        return normalized.startswith("调研") or normalized.startswith("research")

    def handle(
        self,
        *,
        db: Session,
        user_id: int,
        wecom_user_id: str,
        text: str,
        reply_sink: Callable[[str], None] | None = None,
    ) -> bool:
        if not self.is_research_command(text):
            return False
        if not self.settings.research_enabled:
            self._send("调研功能尚未启用。请联系管理员打开 RESEARCH_ENABLED。", wecom_user_id, reply_sink)
            return True

        normalized = (text or "").strip()
        if normalized in {"调研", "调研 帮助", "research", "research help"}:
            self._send(self._help_text(), wecom_user_id, reply_sink)
            return True

        m_topic = re.match(r"^调研\s*主题[:：]\s*(.+)$", normalized)
        if m_topic:
            topic = m_topic.group(1).strip()
            if not topic:
                self._send("请补充调研主题，例如：调研 主题：ultrasound report generation", wecom_user_id, reply_sink)
                return True
            task = self.research_service.create_task(db, user_id=user_id, topic=topic, constraints={})
            self._send(
                f"已创建调研任务 {task.task_id}，正在生成方向。你可以稍后发送“调研 状态”查看进度。",
                wecom_user_id,
                reply_sink,
            )
            return True

        if normalized == "调研 状态":
            snapshot = self.research_service.get_active_task_snapshot(db, user_id=user_id)
            if not snapshot:
                self._send("你还没有调研任务。先发：调研 主题：xxx", wecom_user_id, reply_sink)
                return True
            lines = [
                f"任务ID：{snapshot['task_id']}",
                f"主题：{snapshot['topic']}",
                f"状态：{snapshot['status']}",
                f"方向数：{len(snapshot['directions'])}",
                f"论文数：{snapshot['papers_total']}",
            ]
            self._send("\n".join(lines), wecom_user_id, reply_sink)
            return True

        if normalized == "调研 任务 列表":
            items = self.research_service.list_tasks(db, user_id=user_id, limit=8)
            if not items:
                self._send("暂无调研任务。", wecom_user_id, reply_sink)
                return True
            lines = ["最近调研任务："]
            for item in items:
                lines.append(f"- {item['task_id']} | {item['status']} | {item['topic']}")
            self._send("\n".join(lines), wecom_user_id, reply_sink)
            return True

        m_switch = re.match(r"^调研\s*任务\s*切换\s+(\S+)$", normalized)
        if m_switch:
            task_id = m_switch.group(1).strip()
            try:
                item = self.research_service.switch_task(db, user_id=user_id, task_id=task_id)
                self._send(f"已切换到任务 {item.task_id}。", wecom_user_id, reply_sink)
            except ValueError as exc:
                self._send(f"切换失败：{exc}", wecom_user_id, reply_sink)
            return True

        m_select = re.match(r"^调研\s*(选择|继续)\s+(\d+)$", normalized)
        if m_select:
            action = m_select.group(1)
            idx = int(m_select.group(2))
            session_repo = ResearchSessionRepo(db)
            session = session_repo.get_or_create(user_id, page_size=self.settings.research_page_size)
            session_repo.set_pagination(session, direction_index=idx, page=1)
            if action == "选择":
                try:
                    page = self.research_service.page_direction_papers(
                        db,
                        user_id=user_id,
                        direction_index=idx,
                        page=1,
                    )
                except ValueError as exc:
                    self._send(f"提交失败：{exc}", wecom_user_id, reply_sink)
                    return True
                if page["total"] > 0:
                    self._send(self._render_paper_page(page), wecom_user_id, reply_sink)
                    return True
            try:
                task = self.research_service.enqueue_search(db, user_id=user_id, direction_index=idx)
                label = "扩展检索" if action == "继续" else "检索"
                self._send(
                    f"已提交任务 {task.task_id} 的方向 {idx} {label}请求，稍后会推送完成通知。",
                    wecom_user_id,
                    reply_sink,
                )
            except ValueError as exc:
                self._send(f"提交失败：{exc}", wecom_user_id, reply_sink)
            return True

        m_search = re.match(r"^调研\s*检索\s+(\d+)(?:\s+数量[:：]?\s*(\d+))?$", normalized)
        if m_search:
            idx = int(m_search.group(1))
            top_n = int(m_search.group(2)) if m_search.group(2) else None
            session_repo = ResearchSessionRepo(db)
            session = session_repo.get_or_create(user_id, page_size=self.settings.research_page_size)
            session_repo.set_pagination(session, direction_index=idx, page=1)
            try:
                task = self.research_service.enqueue_search(db, user_id=user_id, direction_index=idx, top_n=top_n)
                self._send(
                    f"已提交任务 {task.task_id} 的方向 {idx} 检索（topN={top_n or self.settings.research_topn_default}）。",
                    wecom_user_id,
                    reply_sink,
                )
            except ValueError as exc:
                self._send(f"提交失败：{exc}", wecom_user_id, reply_sink)
            return True

        if normalized in {"调研 下一页", "调研 上一页"}:
            session = ResearchSessionRepo(db).get_or_create(user_id, page_size=self.settings.research_page_size)
            if not session.active_direction_index:
                self._send("请先发送“调研 选择 2”或“调研 检索 2”。", wecom_user_id, reply_sink)
                return True
            next_page = session.page + (1 if normalized.endswith("下一页") else -1)
            next_page = max(1, next_page)
            try:
                page = self.research_service.page_direction_papers(
                    db,
                    user_id=user_id,
                    direction_index=session.active_direction_index,
                    page=next_page,
                )
            except ValueError as exc:
                self._send(f"分页失败：{exc}", wecom_user_id, reply_sink)
                return True
            self._send(self._render_paper_page(page), wecom_user_id, reply_sink)
            return True

        m_export = re.match(r"^调研\s*导出(?:\s+格式[:：]?\s*(\w+))?$", normalized)
        if m_export:
            fmt = (m_export.group(1) or "md").strip().lower()
            try:
                path = self.research_service.export_task(db, user_id=user_id, fmt=fmt)
                self._send(f"导出成功（{fmt}）：{path}", wecom_user_id, reply_sink)
            except ValueError as exc:
                self._send(f"导出失败：{exc}", wecom_user_id, reply_sink)
            return True

        m_paper = re.match(r"^调研\s*论文\s+(\d+)$", normalized)
        if m_paper:
            idx = int(m_paper.group(1))
            try:
                paper = self.research_service.get_paper_by_index(db, user_id=user_id, index=idx)
                self._send(self._render_paper_detail(paper), wecom_user_id, reply_sink)
            except ValueError as exc:
                self._send(f"查看失败：{exc}", wecom_user_id, reply_sink)
            return True

        m_doi = re.match(r"^调研\s*doi\s+(.+)$", normalized)
        if m_doi:
            doi = m_doi.group(1).strip()
            try:
                paper = self.research_service.get_paper_by_doi(db, user_id=user_id, doi=doi)
                self._send(self._render_paper_detail(paper), wecom_user_id, reply_sink)
            except ValueError as exc:
                self._send(f"查看失败：{exc}", wecom_user_id, reply_sink)
            return True

        self._send("未识别的调研命令。发送“调研 帮助”查看支持的指令。", wecom_user_id, reply_sink)
        return True

    @staticmethod
    def _help_text() -> str:
        return (
            "调研命令：\n"
            "1) 调研 主题：{topic}\n"
            "2) 调研 状态\n"
            "3) 调研 任务 列表\n"
            "4) 调研 任务 切换 {task_id}\n"
            "5) 调研 选择 {k}\n"
            "6) 调研 检索 {k} 数量：30\n"
            "7) 调研 下一页 / 调研 上一页\n"
            "8) 调研 论文 {index} / 调研 doi {doi}\n"
            "9) 调研 导出 / 调研 导出 格式：bib|md|json"
        )

    @staticmethod
    def _render_paper_page(page: dict) -> str:
        lines = [
            f"任务 {page['task_id']} | 方向 {page['direction_index']} | 第 {page['page']} 页",
            f"总计 {page['total']} 篇",
        ]
        for item in page["items"]:
            head = f"[{item['index']}] {item['title']}"
            meta = " | ".join([x for x in [str(item.get("year") or ""), item.get("venue") or "", item.get("source") or ""] if x])
            lines.append(head if not meta else f"{head}\n{meta}")
            if item.get("doi"):
                lines.append(f"DOI: {item['doi']}")
            if item.get("url"):
                lines.append(f"URL: {item['url']}")
            if item.get("method_summary"):
                lines.append(item["method_summary"])
            lines.append("")
        return "\n".join(lines).strip()

    @staticmethod
    def _render_paper_detail(paper: dict) -> str:
        lines = [paper.get("title") or "Untitled"]
        authors = paper.get("authors") or []
        if authors:
            lines.append(f"Authors: {', '.join(authors[:8])}")
        if paper.get("year") or paper.get("venue"):
            lines.append(f"Year/Venue: {paper.get('year') or '-'} / {paper.get('venue') or '-'}")
        if paper.get("doi"):
            lines.append(f"DOI: {paper['doi']}")
        if paper.get("url"):
            lines.append(f"URL: {paper['url']}")
        if paper.get("abstract"):
            abstract = str(paper["abstract"]).strip()
            lines.append(f"Abstract: {abstract[:700]}{'...' if len(abstract) > 700 else ''}")
        if paper.get("method_summary"):
            lines.append(str(paper["method_summary"]))
        return "\n".join(lines)

    def _send(self, text: str, wecom_user_id: str, reply_sink: Callable[[str], None] | None) -> None:
        if reply_sink:
            reply_sink(text)
            return
        ok, error = self.wecom_client.send_text(wecom_user_id, text)
        if not ok:
            logger.warning("research_reply_send_failed user=%s error=%s", wecom_user_id, error)
