import { useMemo } from "react";
import type { CollectionSummary, ExportRecord } from "../types";
import { formatDateTime } from "../utils";
import { Badge, SectionTitle, SmallButton } from "./shared";

type Props = {
  collection: CollectionSummary | null;
  exportHistory: ExportRecord[];
  searchText: string;
  selectedItemIds: number[];
  onSearchTextChange: (value: string) => void;
  onToggleItem: (itemId: number) => void;
  onToggleAllVisible: (itemIds: number[]) => void;
  onSummarize: () => void;
  onCreateStudy: () => void;
  onBuildGraph: () => void;
  onCompare: () => void;
  onRemoveSelected: () => void;
  onExportBib: () => void;
  onExportCslJson: () => void;
  onLoadMore: () => void;
};

export function CollectionDetailPanel(props: Props) {
  const visibleItems = useMemo(() => {
    const keyword = props.searchText.trim().toLowerCase();
    if (!keyword || !props.collection) return props.collection?.items || [];
    return props.collection.items.filter((item) => {
      const haystack = [item.title, item.venue || "", item.source, item.doi || "", ...(item.authors || [])].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
  }, [props.collection, props.searchText]);

  if (!props.collection) return null;

  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => props.selectedItemIds.includes(item.item_id));

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle eyebrow="Collection" title={props.collection.name} description={`${props.collection.item_count} 条条目 · 来源 ${props.collection.source_type}`} />

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
        {props.collection.summary_text || "这个 Collection 还没有摘要。你可以先生成摘要、做 compare、构建集合图谱，或直接从这个集合派生新的 study task。"}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <SmallButton tone="solid" onClick={props.onSummarize}>
          生成摘要
        </SmallButton>
        <SmallButton onClick={props.onCreateStudy}>派生 Study Task</SmallButton>
        <SmallButton onClick={props.onBuildGraph}>构建集合图谱</SmallButton>
        <SmallButton disabled={props.collection.item_count < 2} onClick={props.onCompare}>
          Compare
        </SmallButton>
        <SmallButton onClick={props.onExportBib}>导出 BibTeX</SmallButton>
        <SmallButton onClick={props.onExportCslJson}>导出 CSL JSON</SmallButton>
      </div>

      <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
        <summary className="cursor-pointer list-none text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Export History</summary>
        {props.exportHistory.length ? (
          <div className="mt-3 space-y-2">
            {props.exportHistory.slice(0, 6).map((item) => (
              <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-slate-900">{item.filename || item.format.toUpperCase()}</div>
                  <Badge tone={item.status === "success" ? "green" : "amber"}>{item.status === "success" ? "成功" : item.status}</Badge>
                </div>
                <div className="mt-1 text-slate-500">{formatDateTime(item.created_at)}</div>
                {item.output_path ? <div className="mt-2 break-all">{item.output_path}</div> : null}
                {item.download_url ? (
                  <a className="mt-2 inline-flex rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700" href={item.download_url} rel="noreferrer" target="_blank">
                    打开 / 下载
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">这个 Collection 还没有导出记录。</div>
        )}
      </details>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
            value={props.searchText}
            onChange={(event) => props.onSearchTextChange(event.target.value)}
            placeholder="搜索标题、作者、venue、DOI 或来源"
          />
          <SmallButton onClick={() => props.onToggleAllVisible(visibleItems.map((item) => item.item_id))}>{allVisibleSelected ? "取消本页全选" : "全选本页"}</SmallButton>
          <SmallButton disabled={!props.selectedItemIds.length} onClick={props.onRemoveSelected}>
            移除选中
          </SmallButton>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
          <Badge tone="slate">当前页 {props.collection.items.length}</Badge>
          <Badge tone="blue">总条目 {props.collection.item_count}</Badge>
          <Badge tone="green">已选择 {props.selectedItemIds.length}</Badge>
        </div>

        <div className="mt-3 space-y-2">
          {visibleItems.map((item) => {
            const checked = props.selectedItemIds.includes(item.item_id);
            return (
              <label key={item.item_id} className="flex cursor-pointer gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <input type="checkbox" checked={checked} onChange={() => props.onToggleItem(item.item_id)} className="mt-1 h-4 w-4 rounded border-slate-300" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-slate-900">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {item.year || "年份未知"} · {item.venue || "venue 未知"} · {item.source}
                  </div>
                  {item.authors?.length ? <div className="mt-1 text-xs text-slate-500">{item.authors.slice(0, 4).join(", ")}</div> : null}
                </div>
              </label>
            );
          })}
          {!visibleItems.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">当前搜索条件下没有匹配条目。</div> : null}
        </div>

        {props.collection.has_more ? (
          <div className="mt-3">
            <SmallButton onClick={props.onLoadMore}>加载更多</SmallButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}
