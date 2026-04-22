import type { CompareReport } from "../types";
import { formatDateTime } from "../utils";
import { MarkdownText, SectionTitle, SmallButton } from "./shared";

type Props = {
  report: CompareReport | null;
  onSaveAsNote: () => void;
  onSaveAsReport: () => void;
  onClose: () => void;
};

export function ComparePanel(props: Props) {
  if (!props.report) return null;

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Compare" title={props.report.title} description={`${props.report.scope} · ${formatDateTime(props.report.created_at)}`} />
        <div className="flex flex-wrap gap-2">
          <SmallButton onClick={props.onSaveAsNote}>保存为笔记节点</SmallButton>
          <SmallButton onClick={props.onSaveAsReport}>保存为报告节点</SmallButton>
          <SmallButton onClick={props.onClose}>关闭</SmallButton>
        </div>
      </div>

      <MarkdownText
        className="prose prose-sm mt-3 max-w-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700 prose-p:my-2 prose-li:my-1"
        text={props.report.overview}
      />

      <CompareList title="共同点" items={props.report.common_points} />
      <CompareList title="差异点" items={props.report.differences} />
      <CompareList title="建议下一步" items={props.report.recommended_next_steps} />
    </div>
  );
}

function CompareList(props: { title: string; items: string[] }) {
  if (!props.items.length) return null;
  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{props.title}</div>
      <div className="mt-2 space-y-2">
        {props.items.map((item, index) => (
          <div key={`${props.title}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
