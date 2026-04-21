import { useMemo, useState } from "react";
import { autoStatusLabel, eventTypeLabel, formatRunState, stepLabel } from "../display";
import type { RunEvent, RunSummary, TaskMode } from "../types";
import { formatDateTime } from "../utils";
import { Badge, SectionTitle, SmallButton } from "./shared";

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
        <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">系统已经到达 checkpoint，正在等待你的 guidance 继续推进。</div>
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
              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{props.summary.latest_report_excerpt}</div>
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
              {Object.keys(card.details || {}).length ? <pre className="mt-3 overflow-auto rounded-2xl bg-white p-3 text-xs text-slate-600">{JSON.stringify(card.details, null, 2)}</pre> : null}
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
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{describeEvent(event)}</div>
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
  if (payload.kind === "gpt_step") {
    const details = payload.details && typeof payload.details === "object" ? JSON.stringify(payload.details, null, 2) : "";
    return [String(payload.title || payload.step || "GPT Step"), details].filter(Boolean).join("\n");
  }
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  if (typeof payload.summary === "string" && payload.summary.trim()) return payload.summary;
  if (typeof payload.content === "string" && payload.content.trim()) return payload.content;
  if (typeof payload.report_excerpt === "string" && payload.report_excerpt.trim()) return payload.report_excerpt;
  if (typeof payload.title === "string" && payload.title.trim()) return payload.title;
  if (event.event_type === "artifact") {
    return `产物：${String(payload.path || payload.kind || "artifact")}`;
  }
  return JSON.stringify(payload, null, 2);
}
