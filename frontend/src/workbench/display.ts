import type { Edge, Node } from "@xyflow/react";
import type { Backend, FlowNodeData, RunSummary, TaskMode } from "./types";
import { isManualNode } from "./utils";

export function nodeTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    topic: "主题",
    direction: "方向",
    round: "轮次",
    paper: "论文",
    checkpoint: "Checkpoint",
    report: "阶段报告",
    note: "笔记",
    group: "分组",
    reference: "参考",
    question: "问题",
  };
  return labels[type || ""] || type || "节点";
}

export function stepLabel(step?: string) {
  const labels: Record<string, string> = {
    task_created: "任务创建",
    plan_queued: "方向规划已排队",
    plan_completed: "方向规划完成",
    search_queued: "论文检索已排队",
    search_completed: "论文检索完成",
    exploration_started: "开始探索",
    candidates_generated: "候选方向已生成",
    candidate_selected: "候选方向已选择",
    next_round_created: "继续下一轮",
    graph_queued: "图谱构建已排队",
    tree_graph_completed: "树状图谱完成",
    citation_graph_completed: "引用图谱完成",
    fulltext_queued: "全文处理已排队",
    fulltext_completed: "全文处理完成",
    paper_saved: "论文已保存",
    paper_summary_queued: "论文总结已排队",
    paper_summary_completed: "论文总结完成",
    export_requested: "导出已排队",
    export_completed: "导出完成",
  };
  return labels[step || ""] || step || "步骤";
}

export function modeLabel(mode: TaskMode) {
  return mode === "openclaw_auto" ? "OpenClaw Auto" : "GPT Step";
}

export function backendLabel(backend: Backend) {
  return backend === "openclaw" ? "OpenClaw" : "GPT API";
}

export function autoStatusLabel(status: string) {
  const labels: Record<string, string> = {
    idle: "待命",
    running: "运行中",
    awaiting_guidance: "等待你的引导",
    completed: "已完成",
    failed: "运行失败",
    canceled: "已取消",
  };
  return labels[status] || status || "未知";
}

export function eventTypeLabel(eventType: string, payload?: Record<string, unknown>) {
  if (payload?.kind === "gpt_step") {
    return stepLabel(String(payload.step || ""));
  }
  const labels: Record<string, string> = {
    progress: "进度",
    node_upsert: "节点更新",
    edge_upsert: "连线更新",
    paper_upsert: "论文更新",
    checkpoint: "Checkpoint",
    report_chunk: "阶段报告",
    artifact: "产物",
    error: "错误",
  };
  return labels[eventType] || eventType;
}

export function summarySourceLabel(source?: string | null) {
  const labels: Record<string, string> = {
    fulltext: "基于全文",
    abstract: "基于摘要",
    method_fallback: "摘要回退",
    none: "暂无来源",
  };
  return labels[source || ""] || source || "未知来源";
}

export function summaryStatusLabel(status?: string | null) {
  const labels: Record<string, string> = {
    done: "已生成",
    running: "生成中",
    queued: "已排队",
    fallback: "回退摘要",
    none: "暂无摘要",
    failed: "生成失败",
  };
  return labels[status || ""] || status || "未知状态";
}

export function assetKindLabel(kind?: string | null) {
  const labels: Record<string, string> = {
    pdf: "PDF",
    txt: "TXT",
    md: "Markdown",
    bib: "BibTeX",
    figure: "Main Figure",
    visual: "Paper Visual",
  };
  return labels[kind || ""] || kind || "资产";
}

export function summarizeForNode(data?: Partial<FlowNodeData> | null) {
  return firstText(data?.card_summary, data?.summary, data?.method_summary, data?.abstract, data?.feedback_text) || "这个节点暂时还没有可展示的摘要。";
}

export function directionSubtitle(data?: Partial<FlowNodeData> | null) {
  const parts = [];
  if (typeof data?.direction_index === "number") parts.push(`方向 ${data.direction_index}`);
  if (typeof data?.papers_count === "number") parts.push(`${data.papers_count} 篇论文`);
  return parts.join(" · ");
}

export function formatRunState(mode: TaskMode, runId: string, autoStatus: string, summary?: RunSummary | null) {
  if (mode === "openclaw_auto") {
    return `运行 ${runId || "未启动"} · ${autoStatusLabel(autoStatus)} · ${summary?.total || 0} 条事件`;
  }
  return `GPT Step · ${summary?.step_cards?.length || summary?.total || 0} 条步骤记录`;
}

export function hasOverlappingSystemNodes(nodes: Array<Node<FlowNodeData>>) {
  const systemNodes = nodes.filter((node) => !isManualNode(node));
  for (let index = 0; index < systemNodes.length; index += 1) {
    const current = systemNodes[index];
    for (let inner = index + 1; inner < systemNodes.length; inner += 1) {
      const next = systemNodes[inner];
      const overlapX = Math.abs(current.position.x - next.position.x) < 380;
      const overlapY = Math.abs(current.position.y - next.position.y) < 320;
      if (overlapX && overlapY) {
        return true;
      }
    }
  }
  return false;
}

export function edgeCountLabel(edges: Array<Edge>) {
  return `${edges.length} 条连线`;
}

function firstText(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}
