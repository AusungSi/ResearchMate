import { useMemo } from "react";
import type { Node } from "@xyflow/react";
import type { FlowNodeData, PaperAssetItem, PaperAssetResponse, PaperDetail, RoundCandidate, TaskMode, VenueMetrics } from "../types";
import { inferRoundId, isPaperNode, tone } from "../utils";
import { Badge, MarkdownText, SectionTitle, SmallButton } from "./shared";

type Props = {
  mode: TaskMode;
  node: Node<FlowNodeData> | null;
  paperDetail: PaperDetail | null;
  paperAssets: PaperAssetResponse | null;
  roundCandidates: RoundCandidate[];
  onUpdateNote: (note: string) => void;
  onToggleHidden: () => void;
  onDeleteNode: () => void;
  onOpenPdf: () => void;
  onDownloadPdf?: () => void;
  onOpenAsset?: (url: string) => void;
  onDownloadAsset?: (url: string, filename?: string | null) => void;
  onPreviewTextAsset?: (item: PaperAssetItem) => void;
  onSavePaper: () => void;
  onSummarizePaper: () => void;
  onRebuildVisual: () => void;
  onSearchDirection: (directionIndex: number) => void;
  onStartExplore: (directionIndex: number) => void;
  onBuildGraph: (directionIndex?: number, roundId?: number) => void;
  onProposeCandidates: (roundId: number, action: string, feedbackText: string) => void;
  onSelectCandidate: (roundId: number, candidateId: number) => void;
  onNextRound: (roundId: number, intentText: string) => void;
  onAskPreset: (question: string) => void;
};

const NODE_TYPE_LABELS: Record<string, string> = {
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

const SUMMARY_SOURCE_LABELS: Record<string, string> = {
  fulltext: "基于全文",
  abstract: "基于摘要",
  method_fallback: "摘要回退",
  none: "暂无来源",
};

const SUMMARY_STATUS_LABELS: Record<string, string> = {
  done: "已生成",
  running: "生成中",
  queued: "已排队",
  fallback: "摘要回退",
  none: "暂无摘要",
  failed: "生成失败",
};

const ASSET_KIND_LABELS: Record<string, string> = {
  txt: "TXT",
  md: "Markdown",
  bib: "BibTeX",
};

function assetByKind(assets: PaperAssetResponse | null, kind: string) {
  return assets?.items.find((item) => item.kind === kind) || null;
}

function firstText(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function previewLabel(kind?: string | null) {
  if (kind === "overall") return "概览图预览";
  if (kind === "figure") return "主图预览";
  if (kind === "visual") return "展示图预览";
  return kind || "";
}

function textAssetLabel(kind: string) {
  return ASSET_KIND_LABELS[kind] || kind.toUpperCase();
}

function textAssetTitle(item: PaperAssetItem) {
  if (item.kind === "txt") return "论文文本";
  if (item.kind === "md") return "Markdown 摘要";
  if (item.kind === "bib") return "BibTeX 引用";
  return textAssetLabel(item.kind);
}

export function DetailPanel(props: Props) {
  const node = props.node;
  const nodeData = node?.data || null;
  const directionIndex = typeof nodeData?.direction_index === "number" ? nodeData.direction_index : null;
  const roundId = inferRoundId(node?.id || "", nodeData || undefined);
  const isPaper = isPaperNode(node?.id);

  const txtAsset = useMemo(() => assetByKind(props.paperAssets, "txt"), [props.paperAssets]);
  const mdAsset = useMemo(() => assetByKind(props.paperAssets, "md"), [props.paperAssets]);
  const bibAsset = useMemo(() => assetByKind(props.paperAssets, "bib"), [props.paperAssets]);
  const overallAsset = useMemo(() => assetByKind(props.paperAssets, "overall"), [props.paperAssets]);
  const figureAsset = useMemo(() => assetByKind(props.paperAssets, "figure"), [props.paperAssets]);
  const visualAsset = useMemo(() => assetByKind(props.paperAssets, "visual"), [props.paperAssets]);

  const preferredPreview =
    overallAsset?.open_url
      ? { url: overallAsset.open_url, kind: "overall" }
      : figureAsset?.open_url
        ? { url: figureAsset.open_url, kind: "figure" }
        : visualAsset?.open_url
          ? { url: visualAsset.open_url, kind: "visual" }
          : props.paperDetail?.preview_url
            ? { url: props.paperDetail.preview_url, kind: props.paperDetail.preview_kind || "visual" }
            : null;

  const summarySource = props.paperDetail?.summary_source || nodeData?.summary_source || null;
  const summaryStatus = props.paperDetail?.summary_status || nodeData?.summary_status || null;
  const baseSummary =
    firstText(props.paperDetail?.card_summary, nodeData?.card_summary, nodeData?.summary, nodeData?.method_summary, nodeData?.abstract, nodeData?.feedback_text) ||
    "当前还没有可展示的摘要。";
  const mergedSummary = [baseSummary, props.paperDetail?.key_points ? `补充要点\n\n${props.paperDetail.key_points}` : ""].filter(Boolean).join("\n\n");
  const textAssets = [txtAsset, mdAsset, bibAsset].filter((item): item is PaperAssetItem => Boolean(item && item.status === "available"));

  if (!node) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <SectionTitle
          eyebrow="节点信息"
          title="请选择一个节点"
          description="右侧只展示当前节点的解释、摘要和必要元数据；主要操作已收口到画布中间快捷栏。"
        />
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle
        eyebrow="节点信息"
        title={nodeData?.label || "未命名节点"}
        description="这里保留说明性内容和结果展示，打开 PDF、删除/隐藏、构建图谱等操作请使用画布快捷栏。"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={tone(String(nodeData?.type || ""))}>{NODE_TYPE_LABELS[String(nodeData?.type || "")] || String(nodeData?.type || "节点")}</Badge>
        {nodeData?.status ? <Badge tone="slate">{String(nodeData.status)}</Badge> : null}
        {directionIndex ? <Badge tone="green">{`方向 ${directionIndex}`}</Badge> : null}
        {isPaper && props.paperDetail?.year ? <Badge tone="amber">{String(props.paperDetail.year)}</Badge> : null}
        {props.paperDetail?.venue ? <Badge tone="blue">{props.paperDetail.venue}</Badge> : null}
        {props.paperDetail?.source ? <Badge tone="slate">{props.paperDetail.source}</Badge> : null}
        {summarySource ? <Badge tone="slate">{SUMMARY_SOURCE_LABELS[summarySource] || summarySource}</Badge> : null}
        {summaryStatus ? <Badge tone="violet">{SUMMARY_STATUS_LABELS[summaryStatus] || summaryStatus}</Badge> : null}
        {preferredPreview?.kind ? <Badge tone="amber">{previewLabel(preferredPreview.kind)}</Badge> : null}
        {nodeData?.isManual ? <Badge tone="amber">手工节点</Badge> : null}
        {props.paperDetail?.venue_metrics ? <VenueMetricBadges metrics={props.paperDetail.venue_metrics} /> : null}
      </div>

      {isPaper && preferredPreview?.url ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <img src={preferredPreview.url} alt={props.paperDetail?.title || "paper preview"} className="h-44 w-full object-contain bg-white" />
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Card Summary</div>
        <MarkdownText
          className="prose prose-sm mt-2 max-w-none text-sm leading-6 text-slate-700 prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-slate-900 prose-p:my-2 prose-li:my-1"
          text={mergedSummary}
        />
      </div>

      {props.paperDetail?.doi || textAssets.length ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">文本与引用</div>
          {props.paperDetail?.doi ? <div className="mt-2 break-all text-xs text-slate-500">DOI: {props.paperDetail.doi}</div> : null}
          {textAssets.length ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {textAssets.map((item) => (
                <SmallButton
                  key={item.kind}
                  className="rounded-full"
                  onClick={() => props.onPreviewTextAsset?.({ ...item, filename: item.filename || textAssetTitle(item) })}
                  disabled={!props.onPreviewTextAsset}
                >
                  {textAssetLabel(item.kind)}
                </SmallButton>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">整理与备注</div>
        <textarea
          className="mt-2 h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          value={String(nodeData?.userNote || "")}
          onChange={(event) => props.onUpdateNote(event.target.value)}
          placeholder="补充你的判断、标签、下一步计划，或记录这个节点为什么值得保留。"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <SmallButton tone="solid" onClick={() => props.onAskPreset(buildPresetQuestion(nodeData?.type))}>
            去聊天里提问
          </SmallButton>
        </div>
      </div>

      {directionIndex ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-600">
          当前节点代表一个研究方向。检索方向、继续探索和构建图谱已放到画布快捷栏；这里仅保留方向解释与沉淀内容。
        </div>
      ) : null}

      {roundId ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">轮次摘要</div>
          <div className="mt-2 text-sm leading-6 text-slate-600">这一轮的候选方向和阶段结果会显示在这里；继续推进轮次的动作已放到画布快捷栏。</div>

          {props.roundCandidates.length ? (
            <div className="mt-3 space-y-2">
              {props.roundCandidates.map((candidate) => (
                <div key={candidate.candidate_id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="text-sm font-medium text-slate-900">{candidate.name}</div>
                  {candidate.reason ? <div className="mt-1 text-xs leading-5 text-slate-500">{candidate.reason}</div> : null}
                  {candidate.queries?.length ? <div className="mt-2 text-xs text-slate-500">{candidate.queries.join(" | ")}</div> : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function VenueMetricBadges(props: { metrics: VenueMetrics }) {
  const metrics = props.metrics;
  const badges: Array<{ label: string; tone: "slate" | "blue" | "green" | "violet" | "amber" }> = [];
  if (metrics.source_type) badges.push({ label: metrics.source_type, tone: "blue" });
  if (metrics.ccf?.rank) badges.push({ label: `CCF ${metrics.ccf.rank}`, tone: "violet" });
  if (metrics.jcr?.quartile) badges.push({ label: `JCR ${metrics.jcr.quartile}`, tone: "green" });
  if (metrics.cas?.quartile) badges.push({ label: `中科院 ${metrics.cas.quartile}`, tone: "amber" });
  if (metrics.sci?.indexed) badges.push({ label: "SCI", tone: "slate" });
  if (metrics.ei?.indexed) badges.push({ label: "EI", tone: "slate" });
  if (typeof metrics.impact_factor?.value === "number") badges.push({ label: `IF ${metrics.impact_factor.value}`, tone: "amber" });
  if (typeof metrics.paper_citation_count === "number") badges.push({ label: `引用 ${metrics.paper_citation_count}`, tone: "slate" });
  if (typeof metrics.h_index === "number") badges.push({ label: `H-index ${metrics.h_index}`, tone: "slate" });

  return (
    <>
      {badges.map((badge) => (
        <Badge key={badge.label} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </>
  );
}

function buildPresetQuestion(nodeType?: string | null) {
  if (nodeType === "paper") return "这篇论文解决什么问题？核心方法、关键证据和局限分别是什么？";
  if (nodeType === "direction") return "这个方向的核心价值是什么？下一步最值得补哪些论文或证据？";
  if (nodeType === "round") return "这一轮探索的重点发现是什么？下一轮应该怎么推进？";
  if (nodeType === "checkpoint") return "这个 checkpoint 已经确认了什么？现在最值得给什么 guidance？";
  if (nodeType === "report") return "这份阶段报告最重要的结论是什么？还缺哪些证据？";
  return "请总结这个节点的核心价值，以及下一步最值得做什么。";
}
