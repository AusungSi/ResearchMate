import type { ReactNode } from "react";

export function Badge(props: { children: ReactNode; tone: "slate" | "blue" | "green" | "violet" | "amber" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-100 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
  };

  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${tones[props.tone]}`}>{props.children}</span>;
}

export function SectionTitle(props: { eyebrow: string; title: string; description?: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{props.eyebrow}</div>
      <div className="mt-2 text-lg font-semibold leading-7 text-slate-900">{props.title}</div>
      {props.description ? <div className="mt-1 text-sm leading-6 text-slate-500">{props.description}</div> : null}
    </div>
  );
}

export function SmallButton(props: {
  children: ReactNode;
  tone?: "solid" | "ghost";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const tone = props.tone || "ghost";
  const className =
    tone === "solid"
      ? "rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
      : "rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50";

  return (
    <button className={className} disabled={props.disabled} onClick={props.onClick}>
      {props.children}
    </button>
  );
}
