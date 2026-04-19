import { useMemo, useState } from "react";
import type { RunEvent, RunSummary, TaskMode } from "../types";
import { autoStatusLabel, eventTypeLabel, formatRunState, stepLabel } from "../utils";
import { SectionTitle, SmallButton } from "./shared";

export function RunTimeline(props: {
  mode: TaskMode;
  autoStatus: string;
  runId: string;
  events: RunEvent[];
  summary: RunSummary | null;
  error?: string;
  onGuidance: (text: string) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [guidance, setGuidance] = useState("");
  const groups = useMemo(() => groupEvents(props.events), [props.events]);

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle
          eyebrow="Run Log"
          title={props.mode === "openclaw_auto" ? "自动研究时间线" : "GPT Step 时间线"}
          description={formatRunState(props.mode, props.runId, props.autoStatus, props.summary)}
        />
        <div className="flex gap-2">
          {props.mode === "openclaw_auto" && props.autoStatus === "awaiting_guidance" ? (
            <SmallButton tone="solid" onClick={props.onContinue}>
              继续自动研究
            </SmallButton>
          ) : null}
          {props.mode === "openclaw_auto" && props.runId ? <SmallButton onClick={props.onCancel}>停止在此</SmallButton> : null}
        </div>
      </div>

      {props.mode === "openclaw_auto" && props.autoStatus === "awaiting_guidance" ? (
        <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">当前已经进入 Checkpoint，系统正在等待你的下一步引导。</div>
      ) : null}
      {props.error ? <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{props.error}</div> : null}

      {props.mode === "openclaw_auto" && props.runId ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            className="h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
            placeholder="在这里输入 Checkpoint 引导，例如：更关注 citation graph 与高质量全文。"
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
              提交引导
            </SmallButton>
          </div>
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
                    <span>#{event.seq}</span>
                  </div>
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{describeEvent(event)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {!groups.length ? (
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            {props.mode === "openclaw_auto" ? "启动自动研究后，这里会看到阶段进度、Checkpoint 和阶段报告。" : "执行 GPT Step 动作后，这里会持续沉淀步骤日志。"}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function groupEvents(events: RunEvent[]) {
  const groups: Array<{ key: string; label: string; items: RunEvent[] }> = [];
  const current = new Map<string, { key: string; label: string; items: RunEvent[] }>();

  for (const event of events) {
    const payload = event.payload || {};
    const key = String(payload.step || payload.phase || (event.event_type === "checkpoint" ? "checkpoint" : event.event_type));
    const label =
      payload.kind === "gpt_step"
        ? stepLabel(String(payload.step || ""))
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
    const details = payload.details && typeof payload.details === "object" ? JSON.stringify(payload.details) : "";
    return [stepLabel(String(payload.step || "")), details].filter(Boolean).join(" · ");
  }
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  if (typeof payload.summary === "string" && payload.summary.trim()) return payload.summary;
  if (typeof payload.content === "string" && payload.content.trim()) return payload.content;
  if (typeof payload.report_excerpt === "string" && payload.report_excerpt.trim()) return payload.report_excerpt;
  if (typeof payload.title === "string" && payload.title.trim()) return payload.title;
  if (event.event_type === "artifact") {
    return `产出物：${String(payload.path || payload.kind || "artifact")}`;
  }
  return JSON.stringify(payload, null, 2);
}
