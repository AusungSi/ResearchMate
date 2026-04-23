import { useState } from "react";
import type { TaskProgressViewModel } from "../progress";
import { Badge } from "./shared";

type Props = {
  progress: TaskProgressViewModel;
};

const stageStateClass: Record<string, string> = {
  done: "border-emerald-200 bg-emerald-50 text-emerald-800",
  current: "border-slate-900 bg-slate-900 text-white shadow-sm",
  pending: "border-slate-200 bg-white text-slate-700",
};

const glassCardClass = "border border-slate-200 bg-white/96 shadow-lg backdrop-blur";

export function TaskProgress(props: Props) {
  const [hidden, setHidden] = useState(true);

  if (hidden) {
    return (
      <button
        type="button"
        className={`inline-flex w-fit items-center justify-start rounded-full px-4 py-2.5 text-left transition hover:border-slate-300 hover:bg-white ${glassCardClass}`}
        aria-label="展开 Task Progress"
        onClick={() => setHidden(false)}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Task Progress</span>
      </button>
    );
  }

  return (
    <div className={`w-full rounded-2xl p-4 ${glassCardClass}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Task Progress</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <div className="text-base font-semibold text-slate-900">{props.progress.headline}</div>
            <Badge tone={props.progress.badgeTone}>{props.progress.badgeLabel}</Badge>
          </div>
          <div className="mt-1 text-sm leading-6 text-slate-500">{props.progress.summary}</div>
        </div>
        <div className="flex shrink-0 items-start gap-2">
          <div className="text-right">
            <div className="text-2xl font-semibold tracking-tight text-slate-900">{props.progress.percent}%</div>
            <div className="mt-1 text-xs text-slate-400">
              已完成 {props.progress.completedCount}/{props.progress.totalCount}
            </div>
          </div>
          <button
            type="button"
            className="rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-[11px] font-medium text-slate-600 transition hover:border-slate-300 hover:bg-white"
            aria-label="隐藏 Task Progress"
            onClick={() => setHidden(true)}
          >
            隐藏
          </button>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-slate-900 transition-[width] duration-300" style={{ width: `${props.progress.percent}%` }} />
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {props.progress.stages.map((stage, index) => (
          <div key={stage.key} className={`rounded-2xl border p-3 transition ${stageStateClass[stage.state]}`}>
            <div className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${
                  stage.state === "current" ? "bg-white/15 text-white" : stage.state === "done" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                }`}
              >
                {index + 1}
              </div>
              <div className="text-sm font-medium">{stage.label}</div>
            </div>
            <div className={`mt-2 text-[11px] leading-5 ${stage.state === "current" ? "text-slate-200" : stage.state === "done" ? "text-emerald-700/90" : "text-slate-500"}`}>
              {stage.hint}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
