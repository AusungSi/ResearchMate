import { useMemo, useState } from "react";
import { autoStatusLabel, eventTypeLabel, formatRunState, stepLabel } from "../display";
import type { RunEvent, RunStepCard, RunSummary, TaskMode } from "../types";
import { formatDateTime } from "../utils";
import { Badge, MarkdownText, SectionTitle, SmallButton } from "./shared";

type Props = {
  mode: TaskMode;
  autoStatus: string;
  runId: string;
  events: RunEvent[];
  summary: RunSummary | null;
  error?: string;
  onGuidance: (text: string) => void;
  onContinue: () => void;
  onCancel: () => void;
};

export function RunTimeline(props: Props) {
  const [guidance, setGuidance] = useState("");
  const groups = useMemo(() => groupEvents(props.events), [props.events]);

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle
          eyebrow="Run Log"
          title={props.mode === "openclaw_auto" ? "自动研究时间线" : "GPT Step 步骤记录"}
          description={formatRunState(props.mode, props.runId, props.autoStatus, props.summary)}
        />
        <div className="flex gap-2">
          {props.mode === "openclaw_auto" && props.autoStatus === "awaiting_guidance" ? (
            <SmallButton tone="solid" onClick={props.onContinue}>
              继续自动研究
            </SmallButton>
          ) : null}
          {props.mode === "openclaw_auto" && props.runId ? <SmallButton onClick={props.onCancel}>停止本次运行</SmallButton> : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {props.summary?.phase_groups?.map((phase) => (
          <Badge key={phase.key} tone="slate">
            {formatPhaseLabel(phase.key, phase.label)} · {phase.event_count}
          </Badge>
        ))}
      </div>

      {props.mode === "openclaw_auto" && props.autoStatus === "awaiting_guidance" ? (
        <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">系统已经到达 checkpoint，正在等待你的 guidance 后继续。</div>
      ) : null}
      {props.error ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{props.error}</div> : null}

      {props.mode === "openclaw_auto" && props.runId ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            className="h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
            placeholder="在这里输入 checkpoint guidance，例如：优先扩展 citation graph，并补充高质量全文证据。"
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
          />
          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
            <span>{autoStatusLabel(props.autoStatus)}</span>
            <SmallButton
              tone="solid"
              disabled={!guidance.trim()}
              onClick={() => {
                props.onGuidance(guidance);
                setGuidance("");
              }}
            >
              提交 guidance
            </SmallButton>
          </div>
        </div>
      ) : null}

      {props.mode === "openclaw_auto" ? (
        <div className="mt-4 space-y-4">
          {props.summary?.latest_checkpoint ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-500">Checkpoint</div>
              <div className="mt-2 text-base font-semibold text-slate-900">{String(props.summary.latest_checkpoint.title || "阶段检查点")}</div>
              <div className="mt-2 text-sm leading-6 text-slate-700">{String(props.summary.latest_checkpoint.summary || "暂无摘要")}</div>
            </div>
          ) : null}

          {props.summary?.latest_report_excerpt ? (
            <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-500">阶段报告</div>
              <MarkdownText className="prose prose-sm mt-2 max-w-none text-sm leading-6 text-slate-700 prose-p:my-2 prose-li:my-1" text={props.summary.latest_report_excerpt} />
            </div>
          ) : null}

          {props.summary?.artifacts?.length ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Artifacts</div>
              <div className="mt-3 space-y-2">
                {props.summary.artifacts.map((artifact, index) => (
                  <div key={`${artifact.path || artifact.kind || index}`} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm text-slate-700">
                    <div className="font-medium text-slate-900">{String(artifact.kind || "artifact")}</div>
                    <div className="mt-1 break-all text-xs text-slate-500">{String(artifact.path || artifact.title || "未提供路径")}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {props.summary?.guidance_history?.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Guidance 历史</div>
              <div className="mt-3 space-y-2">
                {props.summary.guidance_history.map((item) => (
                  <div key={item.seq} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                    <div className="text-xs text-slate-500">{formatDateTime(item.created_at)}</div>
                    <div className="mt-1 text-sm text-slate-700">{item.text}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {props.mode === "gpt_step" && props.summary?.step_cards?.length ? (
        <div className="mt-4 space-y-3">
          {props.summary.step_cards.map((card) => (
            <div key={`${card.key}-${card.seq}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-slate-900">{formatStepCardTitle(card.key, card.title)}</div>
                <div className="text-xs text-slate-500">#{card.seq}</div>
              </div>
              {card.status ? <div className="mt-2 text-xs text-slate-500">状态：{card.status}</div> : null}
              <NaturalLanguageDetails lines={describeStepCard(card)} />
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {groups.map((group) => (
          <div key={group.key} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-slate-900">{group.label}</div>
              <div className="text-xs text-slate-400">
                {group.items.length} 条 · #{group.items[0]?.seq} - #{group.items[group.items.length - 1]?.seq}
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {group.items.map((event) => (
                <div key={event.seq} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>{eventTypeLabel(event.event_type, event.payload)}</span>
                    <span>{formatDateTime(event.created_at)}</span>
                  </div>
                  <MarkdownText className="prose prose-sm mt-2 max-w-none text-sm leading-6 text-slate-700 prose-p:my-2 prose-li:my-1" text={describeEvent(event)} />
                </div>
              ))}
            </div>
          </div>
        ))}
        {!groups.length ? (
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            {props.mode === "openclaw_auto" ? "启动自动研究后，这里会按阶段展示进度、checkpoint 和报告。" : "执行 GPT Step 动作后，这里会持续沉淀步骤记录。"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function formatPhaseLabel(key: string, label: string) {
  const phaseLabels: Record<string, string> = {
    report: "阶段报告",
    artifact: "产物",
    graph_sync: "图谱同步",
    checkpoint: "Checkpoint",
  };
  return phaseLabels[key] || stepLabel(key) || label || key;
}

function formatStepCardTitle(key: string, title: string) {
  const next = stepLabel(key);
  if (next && next !== key) return next;
  return title || key;
}

function groupEvents(events: RunEvent[]) {
  const groups: Array<{ key: string; label: string; items: RunEvent[] }> = [];
  const current = new Map<string, { key: string; label: string; items: RunEvent[] }>();

  for (const event of events) {
    const payload = event.payload || {};
    const key = String(payload.step || payload.phase || (event.event_type === "checkpoint" ? "checkpoint" : event.event_type));
    const label =
      payload.kind === "gpt_step"
        ? String(payload.title || payload.step || "GPT Step")
        : String(payload.title || payload.phase || eventTypeLabel(event.event_type, payload));
    const existing = current.get(key);
    if (existing) {
      existing.items.push(event);
      continue;
    }
    const group = { key, label, items: [event] };
    current.set(key, group);
    groups.push(group);
  }

  return groups;
}

function describeEvent(event: RunEvent) {
  const payload = event.payload || {};
  const details = filterDetailRecord(payload.details);
  if (payload.kind === "gpt_step") {
    return [String(payload.message || payload.title || payload.step || "GPT Step"), ...describeRecord(details)].filter(Boolean).join("\n");
  }
  const headline = firstMeaningfulText(payload.message, payload.summary, payload.content, payload.report_excerpt, payload.title);
  const extraLines = describeRecord(omitKeys(payload, ["message", "summary", "content", "report_excerpt", "title", "kind", "run_id", "task_id", "event_type", "details"]));
  const detailLines = describeRecord(details);
  if (headline) return [headline, ...extraLines, ...detailLines].filter(Boolean).join("\n");
  if (event.event_type === "artifact") {
    return `产物：${String(payload.path || payload.kind || "artifact")}`;
  }
  const lines = [...extraLines, ...detailLines];
  return lines.length ? lines.join("\n") : `${eventTypeLabel(event.event_type, payload)}已记录。`;
}

function describeStepCard(card: RunStepCard) {
  return describeRecord(card.details);
}

function NaturalLanguageDetails(props: { lines: string[] }) {
  if (!props.lines.length) return null;
  return (
    <div className="mt-3 space-y-2 rounded-2xl bg-white p-3 text-xs text-slate-600">
      {props.lines.map((line, index) => (
        <div key={`${line}-${index}`}>{line}</div>
      ))}
    </div>
  );
}

function describeRecord(input: unknown, prefix = ""): string[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const lines: string[] = [];
  for (const [rawKey, rawValue] of Object.entries(input)) {
    if (!isMeaningfulValue(rawValue)) continue;
    const key = String(rawKey);
    const special = describeSpecialField(key, rawValue, prefix);
    if (special) {
      lines.push(...special);
      continue;
    }
    if (Array.isArray(rawValue)) {
      const arrayText = formatArrayValue(rawValue, key);
      if (arrayText) {
        lines.push(`${composeFieldLabel(key, prefix)}：${arrayText}`);
      }
      continue;
    }
    if (typeof rawValue === "object") {
      lines.push(...describeRecord(rawValue, composeFieldLabel(key, prefix)));
      continue;
    }
    const scalar = formatScalarValue(rawValue, key);
    if (!scalar) continue;
    lines.push(`${composeFieldLabel(key, prefix)}：${scalar}`);
  }
  return lines;
}

function describeSpecialField(key: string, value: unknown, prefix = ""): string[] | null {
  if (key === "source_coverage" && value && typeof value === "object" && !Array.isArray(value)) {
    const parts = Object.entries(value)
      .filter(([, item]) => isMeaningfulValue(item))
      .map(([name, count]) => `${formatSourceName(name)} ${String(count)}`);
    return parts.length ? [`${composeFieldLabel(key, prefix)}：${parts.join("，")}`] : [];
  }
  if (key === "provider_errors" && value && typeof value === "object" && !Array.isArray(value)) {
    const parts = Object.entries(value)
      .filter(([, item]) => isMeaningfulValue(item))
      .map(([name, message]) => `${formatSourceName(name)}（${String(message).trim()}）`);
    return parts.length ? [`${composeFieldLabel(key, prefix)}：${parts.join("；")}`] : [];
  }
  if (key === "scores") {
    return [];
  }
  if ((key === "force" || key === "force_refresh" || key === "fallback_used") && value === false) {
    return [];
  }
  if (key === "result_refs") {
    return [];
  }
  return null;
}

function formatArrayValue(items: unknown[], key: string) {
  const normalized = items.filter((item) => isMeaningfulValue(item));
  if (!normalized.length) return "";
  if (normalized.every((item) => typeof item !== "object")) {
    return normalized.map((item) => formatScalarValue(item, key)).filter(Boolean).join("；");
  }
  const segments = normalized
    .map((item) => describeRecord(item).join("，"))
    .filter((item) => item.trim());
  return segments.join("；");
}

function formatScalarValue(value: unknown, key: string) {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "number") {
    if (isCountField(key)) return value.toLocaleString("zh-CN");
    return String(value);
  }
  const text = String(value).trim();
  if (!text) return "";
  if (key === "view") return viewLabel(text);
  if (key === "mode") return modeValueLabel(text);
  if (key === "llm_backend") return backendValueLabel(text);
  if (key === "source") return sourceValueLabel(text);
  if (key === "year_from" || key === "year_to") return text;
  return text;
}

function composeFieldLabel(key: string, prefix = "") {
  const base = fieldLabel(key);
  if (!prefix) return base;
  return `${prefix}${base}`;
}

function fieldLabel(key: string) {
  const labels: Record<string, string> = {
    mode: "模式",
    llm_backend: "后端",
    llm_model: "模型",
    project_id: "项目 ID",
    direction_index: "方向",
    round_id: "轮次",
    parent_round_id: "来源轮次",
    child_round_id: "新轮次",
    candidate_id: "候选 ID",
    action: "操作",
    candidate_count: "候选数量",
    paper_count: "论文数量",
    direction_count: "方向数量",
    node_count: "节点数",
    edge_count: "连线数",
    paper_id: "论文 ID",
    source: "来源",
    view: "视图",
    top_n: "检索上限",
    force: "强制执行",
    force_refresh: "强制刷新",
    explicit_queries: "检索词",
    year_from: "起始年份",
    year_to: "结束年份",
    sources: "数据源",
    citation_sources: "引用来源",
    constraints_override: "约束",
    parsed: "已解析全文",
    need_upload: "待补传全文",
    fetched: "已下载 PDF",
    failed: "失败项",
    source_coverage: "来源覆盖",
    provider_errors: "来源异常",
    task_id: "任务 ID",
    run_id: "运行 ID",
    path: "路径",
    kind: "类型",
    summary: "摘要",
    content: "内容",
    checkpoint_id: "Checkpoint ID",
    title: "标题",
    status: "状态",
    quality_score: "文本质量分",
    text_chars: "文本字符数",
    expand_limit_per_paper: "单篇扩展上限",
    seed_top_n: "种子论文数",
    weight: "权重",
    source_name: "来源名称",
  };
  return labels[key] || key.replace(/_/g, " ");
}

function isCountField(key: string) {
  return /(?:_count|_total|_chars|_seq)$/.test(key) || ["parsed", "need_upload", "fetched", "failed", "node_count", "edge_count", "direction_index", "round_id", "parent_round_id", "child_round_id", "candidate_id", "quality_score", "top_n", "seed_top_n", "expand_limit_per_paper", "year_from", "year_to"].includes(key);
}

function filterDetailRecord(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return omitKeys(input as Record<string, unknown>, ["message", "summary", "content", "report_excerpt", "title", "status"]);
}

function omitKeys(record: Record<string, unknown>, keys: string[]) {
  const hidden = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => !hidden.has(key) && isMeaningfulValue(value)));
}

function isMeaningfulValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((item) => isMeaningfulValue(item));
  if (typeof value === "object") return Object.values(value).some((item) => isMeaningfulValue(item));
  return true;
}

function firstMeaningfulText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function viewLabel(value: string) {
  const labels: Record<string, string> = {
    tree: "树状图",
    citation: "引用图谱",
  };
  return labels[value] || value;
}

function modeValueLabel(value: string) {
  const labels: Record<string, string> = {
    gpt_step: "GPT Step",
    openclaw_auto: "OpenClaw Auto",
  };
  return labels[value] || value;
}

function backendValueLabel(value: string) {
  const labels: Record<string, string> = {
    gpt: "GPT API",
    openclaw: "OpenClaw",
  };
  return labels[value] || value;
}

function sourceValueLabel(value: string) {
  const labels: Record<string, string> = {
    fulltext: "全文",
    abstract: "摘要",
    semantic_scholar: "Semantic Scholar",
    openalex: "OpenAlex",
    arxiv: "arXiv",
  };
  return labels[value] || value;
}

function formatSourceName(value: string) {
  return sourceValueLabel(value);
}
