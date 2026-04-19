import type { CollectionSummary } from "../types";
import { SectionTitle, SmallButton } from "./shared";

export function CollectionDetailPanel(props: {
  collection: CollectionSummary | null;
  onSummarize: () => void;
  onCreateStudy: () => void;
  onBuildGraph: () => void;
}) {
  if (!props.collection) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <SectionTitle eyebrow="Collection Detail" title="未选择 Collection" description="选中一个 collection 后，这里会显示集合摘要、来源论文和集合级动作。" />
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle
        eyebrow="Collection Detail"
        title={props.collection.name}
        description={`${props.collection.item_count} 篇论文 · 来源 ${props.collection.source_type}`}
      />

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
        {props.collection.summary_text || "这个 collection 还没有生成摘要。可以先做集合总结，或者直接基于它创建派生 study task。"}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <SmallButton tone="solid" onClick={props.onSummarize}>
          总结集合
        </SmallButton>
        <SmallButton onClick={props.onCreateStudy}>基于集合继续调研</SmallButton>
        <SmallButton onClick={props.onBuildGraph}>构建集合图谱</SmallButton>
      </div>

      <div className="mt-4 space-y-2">
        {props.collection.items.slice(0, 8).map((item) => (
          <div key={item.item_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-sm font-medium text-slate-900">{item.title}</div>
            <div className="mt-1 text-xs text-slate-500">
              {item.year || "年份未知"} · {item.venue || "来源未标注"} · {item.source}
            </div>
          </div>
        ))}
        {props.collection.items.length > 8 ? (
          <div className="rounded-2xl bg-slate-50 p-3 text-xs text-slate-500">其余 {props.collection.items.length - 8} 篇论文可在后续列表视图中继续展开。</div>
        ) : null}
      </div>
    </div>
  );
}
