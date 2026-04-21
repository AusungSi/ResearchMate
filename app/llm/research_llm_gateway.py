from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter
import json
import re

import httpx

from app.core.config import Settings, get_settings
from app.llm.openclaw_client import LLMTaskType, OpenClawClient


@dataclass
class ResearchLLMResponse:
    text: str
    provider: str
    model: str
    latency_ms: int


class ResearchLLMGateway:
    def __init__(
        self,
        *,
        settings: Settings | None = None,
        openclaw_client: OpenClawClient | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.openclaw_client = openclaw_client or OpenClawClient(settings=self.settings)

    def chat_text(
        self,
        *,
        backend: str,
        prompt: str,
        system_prompt: str | None = None,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 1200,
    ) -> ResearchLLMResponse:
        backend_norm = (backend or "gpt").strip().lower()
        if backend_norm == "openclaw":
            return self._chat_openclaw(
                prompt=prompt,
                system_prompt=system_prompt,
                model=model,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        return self._chat_gpt(
            prompt=prompt,
            system_prompt=system_prompt,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    def _chat_openclaw(
        self,
        *,
        prompt: str,
        system_prompt: str | None,
        model: str | None,
        temperature: float,
        max_tokens: int,
    ) -> ResearchLLMResponse:
        if self.settings.openclaw_cli_fallback_enabled:
            try:
                result = self.openclaw_client.chat_completion_cli_fallback(
                    task_type=LLMTaskType.RESEARCH_PLAN,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    user=None,
                    max_tokens=max_tokens,
                )
            except Exception:
                result = self.openclaw_client.chat_completion(
                    task_type=LLMTaskType.RESEARCH_PLAN,
                    prompt=prompt,
                    system_prompt=system_prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
        else:
            result = self.openclaw_client.chat_completion(
                task_type=LLMTaskType.RESEARCH_PLAN,
                prompt=prompt,
                system_prompt=system_prompt,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        return ResearchLLMResponse(
            text=result.text,
            provider=result.provider,
            model=model or result.model,
            latency_ms=result.latency_ms,
        )

    def _chat_gpt(
        self,
        *,
        prompt: str,
        system_prompt: str | None,
        model: str | None,
        temperature: float,
        max_tokens: int,
    ) -> ResearchLLMResponse:
        api_key = self.settings.research_gpt_api_key.strip()
        chosen_model = (model or self.settings.research_gpt_model).strip()
        if not api_key:
            text = self._fallback_response(prompt)
            return ResearchLLMResponse(text=text, provider="template", model=chosen_model, latency_ms=0)

        base_url = self.settings.research_gpt_base_url.rstrip("/")
        if not base_url.endswith("/chat/completions"):
            if base_url.endswith("/v1"):
                base_url = f"{base_url}/chat/completions"
            else:
                base_url = f"{base_url}/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        messages: list[dict[str, str]] = []
        if system_prompt and system_prompt.strip():
            messages.append({"role": "system", "content": system_prompt.strip()})
        messages.append({"role": "user", "content": prompt.strip()})
        payload = {
            "model": chosen_model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        started = perf_counter()
        try:
            with httpx.Client(timeout=max(5, int(self.settings.research_gpt_timeout_seconds))) as client:
                resp = client.post(base_url, headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
        except Exception:
            text = self._fallback_response(prompt)
            return ResearchLLMResponse(text=text, provider="template_fallback", model=chosen_model, latency_ms=0)

        content = ""
        choices = data.get("choices") or []
        if choices:
            message = choices[0].get("message") or {}
            content = str(message.get("content") or "").strip()
        if not content:
            content = self._fallback_response(prompt)
        return ResearchLLMResponse(
            text=content,
            provider="gpt_api",
            model=chosen_model,
            latency_ms=int((perf_counter() - started) * 1000),
        )

    @staticmethod
    def _fallback_response(prompt: str) -> str:
        node_answer = ResearchLLMGateway._fallback_node_answer(prompt)
        if node_answer:
            return node_answer
        clipped = " ".join((prompt or "").split())[:260]
        if not clipped:
            return "当前上下文为空，建议先选择一个节点或补充更具体的问题。"
        return f"当前模型服务暂时不可用，我先基于已有上下文给出保守回答：{clipped}"

    @staticmethod
    def _fallback_node_answer(prompt: str) -> str:
        if "Node context JSON:" not in (prompt or ""):
            return ""
        context_text = _extract_between(prompt, "Node context JSON:", "\nExisting chat:")
        question = _extract_between(prompt, "User question:", "\nTags:").strip() or "这个节点的核心价值是什么？"
        try:
            context = json.loads(context_text)
        except Exception:
            context = {}
        node_type = str(context.get("type") or "unknown")
        label = str(context.get("label") or context.get("title") or context.get("name") or context.get("id") or "当前节点")
        summary = str(
            context.get("card_summary")
            or context.get("summary")
            or context.get("method_summary")
            or context.get("abstract")
            or context.get("userNote")
            or ""
        )
        summary = " ".join(summary.split())[:360]
        if node_type == "paper":
            return (
                "这篇论文节点的核心价值在于为当前研究提供论文证据。\n\n"
                f"- 论文：{label}\n"
                f"- 可用信息：{summary or '目前只有基础元数据，建议先处理全文或打开 PDF 后再深入分析。'}\n"
                f"- 针对你的问题：{question}\n\n"
                "建议继续检查它的研究问题、核心方法、实验结论和局限，并和当前任务主题建立明确连接。"
            )
        if node_type in {"question", "note", "reference", "group", "report"}:
            return (
                f"这是一个手工{node_type}节点，适合沉淀你的问题、判断和阶段性结论。\n\n"
                f"- 节点：{label}\n"
                f"- 已记录内容：{summary or '暂无具体内容。'}\n"
                f"- 针对你的问题：{question}\n\n"
                "建议把答案继续写回这个节点，或把它连接到相关 paper/direction 节点，形成可展示的研究路径。"
            )
        return (
            f"这个节点“{label}”的核心价值取决于它在当前图谱中的连接关系。\n\n"
            f"- 节点类型：{node_type}\n"
            f"- 可用信息：{summary or '当前上下文较少。'}\n"
            f"- 针对你的问题：{question}\n\n"
            "建议选择更具体的 paper/direction 节点，或先给这个节点补充备注后再提问。"
        )


def _extract_between(text: str, start: str, end: str) -> str:
    match = re.search(re.escape(start) + r"(.*?)" + re.escape(end), text or "", flags=re.S)
    return match.group(1).strip() if match else ""
