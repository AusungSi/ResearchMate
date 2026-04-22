import { autoStatusLabel } from "./display";
import type { RunEvent, RunSummary, TaskMode, TaskSummary } from "./types";

export type TaskProgressTone = "slate" | "blue" | "green" | "violet" | "amber" | "rose";
export type TaskProgressStageState = "done" | "current" | "pending";

export type TaskProgressStage = {
  key: string;
  label: string;
  state: TaskProgressStageState;
  hint: string;
};

export type TaskProgressViewModel = {
  mode: TaskMode;
  headline: string;
  currentLabel: string;
  summary: string;
  percent: number;
  completedCount: number;
  totalCount: number;
  badgeLabel: string;
  badgeTone: TaskProgressTone;
  stages: TaskProgressStage[];
};

export function deriveTaskProgress(task?: TaskSummary | null, summary?: RunSummary | null, events: RunEvent[] = []): TaskProgressViewModel | null {
  if (!task) return null;
  if (task.mode === "openclaw_auto") {
    return deriveOpenClawProgress(task, summary);
  }
  return deriveGptStepProgress(task, summary, events);
}

function deriveGptStepProgress(task: TaskSummary, summary?: RunSummary | null, events: RunEvent[] = []): TaskProgressViewModel {
  const directionCount = task.directions.length;
  const paperCount = numberFromRecord(task as unknown as Record<string, unknown>, "papers_total");
  const roundCount = numberFromRecord(task as unknown as Record<string, unknown>, "rounds_total");
  const graphNodeCount = numberFromRecord(task.graph_stats, "node_count");
  const graphEdgeCount = numberFromRecord(task.graph_stats, "edge_count");
  const fulltextParsed = numberFromRecord(task.fulltext_stats, "parsed");
  const fulltextNeedUpload = numberFromRecord(task.fulltext_stats, "need_upload");
  const latestEvent = latestGptStepEvent(events);
  const latestStep = stringFromRecord(latestEvent?.payload, "step");
  const latestMessage = firstNonEmpty(stringFromRecord(latestEvent?.payload, "message"), stringFromRecord(latestEvent?.payload, "title"));

  const planDone = hasStep(summary, "plan_completed") || directionCount > 0;
  const searchDone = hasStep(summary, "search_completed") || paperCount > 0;
  const graphDone = hasAnyStep(summary, ["tree_graph_completed", "citation_graph_completed"]) || graphNodeCount > 0 || stringFromRecord(task.graph_stats, "status") === "done";
  const fulltextDone = hasStep(summary, "fulltext_completed") || fulltextParsed > 0 || fulltextNeedUpload > 0;

  const currentKey =
    gptCurrentKeyFromStep(latestStep) ||
    (task.status === "planning" && !planDone ? "plan" : "") ||
    (task.status === "searching" && !planDone ? "plan" : "") ||
    (task.status === "searching" && !searchDone ? "search" : "") ||
    (task.status === "searching" && !graphDone ? "graph" : "") ||
    (task.status === "searching" && !fulltextDone ? "fulltext" : "") ||
    firstPendingKey([
      ["plan", planDone],
      ["search", searchDone],
      ["graph", graphDone],
      ["fulltext", fulltextDone],
    ]);

  const stages: TaskProgressStage[] = [
    {
      key: "create",
      label: "任务创建",
      state: "done",
      hint: task.llm_model ? `${task.llm_backend.toUpperCase()} / ${task.llm_model}` : "研究任务已初始化。",
    },
    {
      key: "plan",
      label: "方向规划",
      state: planDone ? "done" : currentKey === "plan" ? "current" : "pending",
      hint: planDone ? `已生成 ${directionCount} 个研究方向。` : latestMessage || "先把研究方向规划清楚。",
    },
    {
      key: "search",
      label: "检索与探索",
      state: searchDone ? "done" : currentKey === "search" ? "current" : "pending",
      hint: searchDone
        ? `已收录 ${paperCount} 篇论文${roundCount > 0 ? `，累计 ${roundCount} 轮探索。` : "。"}`
        : latestMessage || (roundCount > 0 ? `已创建 ${roundCount} 轮探索，正在等待检索结果。` : "完成首轮检索后才能继续推进。"),
    },
    {
      key: "graph",
      label: "图谱构建",
      state: graphDone ? "done" : currentKey === "graph" ? "current" : "pending",
      hint: graphDone
        ? `当前图谱包含 ${graphNodeCount} 个节点${graphEdgeCount > 0 ? `、${graphEdgeCount} 条连线` : ""}。`
        : latestMessage || "把已收集论文组织成可浏览图谱。",
    },
    {
      key: "fulltext",
      label: "全文处理",
      state: fulltextDone ? "done" : currentKey === "fulltext" ? "current" : "pending",
      hint: fulltextDone
        ? `已解析 ${fulltextParsed} 篇全文${fulltextNeedUpload > 0 ? `，另有 ${fulltextNeedUpload} 篇待补传` : ""}。`
        : latestMessage || "可继续补全文、摘要和资产。",
    },
  ];

  const completedCount = stages.filter((stage) => stage.state === "done").length;
  const currentStage = stages.find((stage) => stage.state === "current") || null;
  const percent = buildPercent(stages);
  const badge = resolveGptBadge(task, currentStage);

  return {
    mode: task.mode,
    headline: currentStage ? `当前阶段：${currentStage.label}` : "主流程已完成",
    currentLabel: currentStage?.label || "主流程已完成",
    summary: resolveGptSummary(task, stages, currentStage),
    percent,
    completedCount,
    totalCount: stages.length,
    badgeLabel: badge.label,
    badgeTone: badge.tone,
    stages,
  };
}

function deriveOpenClawProgress(task: TaskSummary, summary?: RunSummary | null): TaskProgressViewModel {
  const checkpoint = summary?.latest_checkpoint || null;
  const guidanceHistory = summary?.guidance_history || [];
  const checkpointSummary = clipText(firstNonEmpty(stringFromRecord(checkpoint, "summary"), stringFromRecord(checkpoint, "title")), 96);
  const latestGuidance = clipText(guidanceHistory[guidanceHistory.length - 1]?.text || "", 96);
  const latestReport = clipText(String(summary?.latest_report_excerpt || "").trim(), 110);
  const artifactCount = summary?.artifacts?.length || 0;

  const runStarted = Boolean(task.latest_run_id) || task.auto_status !== "idle" || Boolean(summary?.total);
  const checkpointDone = Boolean(checkpoint || task.last_checkpoint_id);
  const guidanceDone = guidanceHistory.length > 0;
  const reportDone = Boolean(latestReport) || artifactCount > 0 || task.auto_status === "completed";

  let currentKey = "";
  if (task.auto_status === "idle" && !runStarted) {
    currentKey = "start";
  } else if (!checkpointDone) {
    currentKey = "checkpoint";
  } else if (task.auto_status === "awaiting_guidance" && !guidanceDone) {
    currentKey = "guidance";
  } else if (!reportDone) {
    currentKey = "report";
  }

  const stages: TaskProgressStage[] = [
    {
      key: "create",
      label: "任务创建",
      state: "done",
      hint: "自动研究任务已初始化。",
    },
    {
      key: "start",
      label: "启动自治研究",
      state: runStarted ? "done" : currentKey === "start" ? "current" : "pending",
      hint: runStarted ? `当前运行：${task.latest_run_id || "已启动"}` : "启动后系统会先自行生成初版研究图谱。",
    },
    {
      key: "checkpoint",
      label: "初版 Checkpoint",
      state: checkpointDone ? "done" : currentKey === "checkpoint" ? "current" : "pending",
      hint: checkpointDone ? checkpointSummary || "系统已经给出第一版研究图谱。" : "系统正在生成第一个 checkpoint。",
    },
    {
      key: "guidance",
      label: "提交 Guidance",
      state: guidanceDone ? "done" : currentKey === "guidance" ? "current" : "pending",
      hint: guidanceDone ? `最近 guidance：${latestGuidance}` : task.auto_status === "awaiting_guidance" ? "系统正在等待你的 guidance。" : "checkpoint 后可以补充新的引导。",
    },
    {
      key: "report",
      label: "阶段报告",
      state: reportDone ? "done" : currentKey === "report" ? "current" : "pending",
      hint: reportDone ? latestReport || `本轮已生成 ${artifactCount} 个产物。` : "系统会基于 guidance 继续输出阶段报告。",
    },
  ];

  const completedCount = stages.filter((stage) => stage.state === "done").length;
  const currentStage = stages.find((stage) => stage.state === "current") || null;
  const percent = buildPercent(stages);
  const badge = resolveOpenClawBadge(task.auto_status);

  return {
    mode: task.mode,
    headline: currentStage ? `当前阶段：${currentStage.label}` : "自动研究已完成",
    currentLabel: currentStage?.label || "自动研究已完成",
    summary: resolveOpenClawSummary(task.auto_status, stages, currentStage),
    percent,
    completedCount,
    totalCount: stages.length,
    badgeLabel: badge.label,
    badgeTone: badge.tone,
    stages,
  };
}

function buildPercent(stages: TaskProgressStage[]) {
  const doneCount = stages.filter((stage) => stage.state === "done").length;
  if (doneCount === stages.length) return 100;
  const hasCurrent = stages.some((stage) => stage.state === "current");
  return Math.round(((doneCount + (hasCurrent ? 0.5 : 0)) / stages.length) * 100);
}

function resolveGptSummary(task: TaskSummary, stages: TaskProgressStage[], currentStage: TaskProgressStage | null) {
  if (task.status === "failed") {
    return "任务执行失败，请先查看运行日志，再决定是否重试上一步。";
  }
  if (!currentStage) {
    return "主流程已经走完，后续可以继续补全文、保存论文或导出结果。";
  }
  if (currentStage.state === "current" && (task.status === "planning" || task.status === "searching")) {
    return currentStage.hint;
  }
  const completedCount = stages.filter((stage) => stage.state === "done").length;
  return `已完成 ${completedCount}/${stages.length} 个阶段。下一步建议：${currentStage.label}。${currentStage.hint}`;
}

function resolveOpenClawSummary(autoStatus: string, stages: TaskProgressStage[], currentStage: TaskProgressStage | null) {
  if (autoStatus === "failed") {
    return "自动研究运行失败，请检查运行日志与 OpenClaw 可用性。";
  }
  if (autoStatus === "canceled") {
    return "本轮自动研究已停止，后续可以重新启动新的 run。";
  }
  if (!currentStage) {
    return "本轮自动研究已经完成，checkpoint、guidance 和阶段报告都已沉淀。";
  }
  if (autoStatus === "awaiting_guidance") {
    return currentStage.hint;
  }
  const completedCount = stages.filter((stage) => stage.state === "done").length;
  return `已完成 ${completedCount}/${stages.length} 个阶段。${currentStage.hint}`;
}

function resolveGptBadge(task: TaskSummary, currentStage: TaskProgressStage | null) {
  if (task.status === "failed") {
    return { label: "任务失败", tone: "rose" as const };
  }
  if (!currentStage) {
    return { label: "主流程完成", tone: "green" as const };
  }
  if (task.status === "planning" || task.status === "searching") {
    return { label: "进行中", tone: "blue" as const };
  }
  return { label: "待继续", tone: "amber" as const };
}

function resolveOpenClawBadge(autoStatus: string) {
  const toneMap: Record<string, TaskProgressTone> = {
    idle: "amber",
    running: "blue",
    awaiting_guidance: "amber",
    completed: "green",
    failed: "rose",
    canceled: "slate",
  };
  return {
    label: autoStatusLabel(autoStatus),
    tone: toneMap[autoStatus] || "slate",
  };
}

function latestGptStepEvent(events: RunEvent[]) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.payload?.kind === "gpt_step") {
      return event;
    }
  }
  return null;
}

function gptCurrentKeyFromStep(step: string) {
  if (step === "plan_queued") return "plan";
  if (["search_queued", "exploration_started", "candidates_generated", "candidate_selected", "next_round_created"].includes(step)) return "search";
  if (step === "graph_queued") return "graph";
  if (step === "fulltext_queued") return "fulltext";
  return "";
}

function hasStep(summary: RunSummary | null | undefined, step: string) {
  return summary?.step_cards?.some((card) => card.key === step) || false;
}

function hasAnyStep(summary: RunSummary | null | undefined, steps: string[]) {
  return steps.some((step) => hasStep(summary, step));
}

function firstPendingKey(entries: Array<[string, boolean]>) {
  const item = entries.find((entry) => !entry[1]);
  return item?.[0] || "";
}

function numberFromRecord(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function stringFromRecord(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function firstNonEmpty(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function clipText(text: string, max = 88) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}
