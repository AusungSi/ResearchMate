import { useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import type { FlowNodeData, PaperAssetItem, PaperAssetResponse, PaperDetail, RoundCandidate, TaskMode } from "../types";
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

const ACTION_OPTIONS = [
  { value: "expand", label: "扩展邻近方向" },
  { value: "deepen", label: "深入当前方向" },
  { value: "pivot", label: "切换研究视角" },
  { value: "converge", label: "收敛核心问题" },
];

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
  fallback: "回退摘要",
  none: "暂无摘要",
  failed: "生成失败",
};

const ASSET_KIND_LABELS: Record<string, string> = {
  overall: "Overall 图",
  pdf: "PDF",
  txt: "TXT",
  md: "Markdown",
  bib: "BibTeX",
  figure: "主图",
  visual: "展示图",
};

function assetByKind(assets: PaperAssetResponse | null, kind: string) {
  return assets?.items.find((item) => item.kind === kind) || null;
}

function previewKindLabel(kind?: string | null) {
  if (kind === "overall") return "Overall 图预览";
  if (kind === "figure") return "主图预览";
  return "展示图预览";
}

function PreviewBox(props: { title: string; url?: string | null; emptyText: string }) {
  if (!props.url) {
    return <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">{props.emptyText}</div>;
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
      <img src={props.url} alt={props.title} className="h-48 w-full object-contain bg-white" />
    </div>
  );
}

function AssetActionButtons(props: {
  item: PaperAssetItem;
  onOpenAsset?: (url: string) => void;
  onDownloadAsset?: (url: string, filename?: string | null) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {props.item.open_url ? (
        <SmallButton onClick={() => props.onOpenAsset?.(props.item.open_url || "")} disabled={!props.onOpenAsset}>
          打开
        </SmallButton>
      ) : null}
      {props.item.download_url ? (
        <SmallButton onClick={() => props.onDownloadAsset?.(props.item.download_url || "", props.item.filename)} disabled={!props.onDownloadAsset}>
          下载
        </SmallButton>
      ) : null}
    </div>
  );
}

export function DetailPanel(props: Props) {
  const [feedback, setFeedback] = useState("");
  const [nextIntent, setNextIntent] = useState("");
  const [candidateAction, setCandidateAction] = useState("expand");
  const node = props.node;
  const nodeData = node?.data || null;
  const directionIndex = typeof nodeData?.direction_index === "number" ? nodeData.direction_index : null;
  const roundId = inferRoundId(node?.id || "", nodeData || undefined);
  const isPaper = isPaperNode(node?.id, nodeData || undefined);
  const pdfAsset = useMemo(() => assetByKind(props.paperAssets, "pdf"), [props.paperAssets]);
  const overallAsset = useMemo(() => assetByKind(props.paperAssets, "overall"), [props.paperAssets]);
  const figureAsset = useMemo(() => assetByKind(props.paperAssets, "figure"), [props.paperAssets]);
  const visualAsset = useMemo(() => assetByKind(props.paperAssets, "visual"), [props.paperAssets]);
  const txtAsset = useMemo(() => assetByKind(props.paperAssets, "txt"), [props.paperAssets]);
  const mdAsset = useMemo(() => assetByKind(props.paperAssets, "md"), [props.paperAssets]);
  const bibAsset = useMemo(() => assetByKind(props.paperAssets, "bib"), [props.paperAssets]);
  const preferredPreviewUrl =
    overallAsset?.open_url ||
    overallAsset?.download_url ||
    figureAsset?.open_url ||
    figureAsset?.download_url ||
    visualAsset?.open_url ||
    visualAsset?.download_url ||
    props.paperDetail?.preview_url ||
    null;
  const summarySource = props.paperDetail?.summary_source || nodeData?.summary_source || null;
  const summaryStatus = props.paperDetail?.summary_status || nodeData?.summary_status || null;
  const displaySummary =
    props.paperDetail?.card_summary || nodeData?.card_summary || nodeData?.summary || nodeData?.method_summary || nodeData?.abstract || nodeData?.feedback_text || "当前还没有可展示的摘要。";

  useEffect(() => {
    setFeedback("");
    setNextIntent("");
    setCandidateAction("expand");
  }, [node?.id]);

  if (!node) {
    return (
      <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <SectionTitle
          eyebrow="节点信息"
          title="请选择一个节点"
          description="选中主题、方向、轮次、论文或手工节点后，这里会显示对应的摘要、动作、资产和整理入口。"
        />
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle
        eyebrow="节点信息"
        title={nodeData?.label || "未命名节点"}
        description="这里聚合当前节点的解读、动作、论文资产和手工整理入口。"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone={tone(String(nodeData?.type || ""))}>{NODE_TYPE_LABELS[String(nodeData?.type || "")] || String(nodeData?.type || "节点")}</Badge>
        {nodeData?.status ? <Badge tone="slate">{String(nodeData.status)}</Badge> : null}
        {directionIndex ? <Badge tone="green">{`方向 ${directionIndex}`}</Badge> : null}
        {isPaper && props.paperDetail?.year ? <Badge tone="amber">{String(props.paperDetail.year)}</Badge> : null}
        {props.paperDetail?.venue ? <Badge tone="blue">{props.paperDetail.venue}</Badge> : null}
        {summarySource ? <Badge tone="slate">{SUMMARY_SOURCE_LABELS[summarySource] || summarySource}</Badge> : null}
        {summaryStatus ? <Badge tone="violet">{SUMMARY_STATUS_LABELS[summaryStatus] || summaryStatus}</Badge> : null}
        {props.paperDetail?.preview_kind ? <Badge tone="amber">{previewKindLabel(props.paperDetail.preview_kind)}</Badge> : null}
        {nodeData?.isManual ? <Badge tone="amber">手工节点</Badge> : null}
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Card Summary</div>
        <div className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{displaySummary}</div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">整理与备注</div>
        <textarea
          className="mt-2 h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          value={String(nodeData?.userNote || "")}
          onChange={(event) => props.onUpdateNote(event.target.value)}
          placeholder="补充你的判断、标签、下一步计划，或者记录这个节点为什么值得保留。"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <SmallButton tone="solid" onClick={() => props.onAskPreset(buildPresetQuestion(nodeData?.type))}>
            去聊天里提问
          </SmallButton>
          <SmallButton onClick={props.onToggleHidden}>{node?.hidden ? "恢复显示" : "隐藏节点"}</SmallButton>
          <SmallButton onClick={props.onDeleteNode}>删除节点</SmallButton>
        </div>
        <div className="mt-2 text-xs leading-5 text-slate-500">
          {nodeData?.isManual
            ? "手工节点会被真实删除，相关手工连线也会一起移除。"
            : "系统节点会从画布中隐藏，不会删除研究主数据；与它相连的展示连线也会一起隐藏。"}
        </div>
      </div>

      {directionIndex ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">方向动作</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <SmallButton tone="solid" onClick={() => props.onSearchDirection(directionIndex)}>
              检索方向
            </SmallButton>
            <SmallButton onClick={() => props.onStartExplore(directionIndex)}>继续探索</SmallButton>
            <SmallButton onClick={() => props.onBuildGraph(directionIndex, undefined)}>构建图谱</SmallButton>
          </div>
        </div>
      ) : null}

      {roundId ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">轮次动作</div>
          <select
            className="mt-3 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            value={candidateAction}
            onChange={(event) => setCandidateAction(event.target.value)}
          >
            {ACTION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <textarea
            className="mt-2 h-20 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="补充这一轮的目标、限制条件，或者你希望扩展的分支。"
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <SmallButton tone="solid" onClick={() => props.onProposeCandidates(roundId, candidateAction, feedback)}>
              生成候选方向
            </SmallButton>
            <SmallButton onClick={() => props.onBuildGraph(undefined, roundId)}>构建图谱</SmallButton>
          </div>

          {props.roundCandidates.length ? (
            <div className="mt-3 space-y-2">
              {props.roundCandidates.map((candidate) => (
                <div key={candidate.candidate_id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-medium text-slate-900">{candidate.name}</div>
                  {candidate.reason ? <div className="mt-1 text-xs leading-5 text-slate-500">{candidate.reason}</div> : null}
                  {candidate.queries?.length ? <div className="mt-2 text-xs text-slate-500">{candidate.queries.join(" | ")}</div> : null}
                  <div className="mt-3">
                    <SmallButton tone="solid" onClick={() => props.onSelectCandidate(roundId, candidate.candidate_id)}>
                      选择这个候选
                    </SmallButton>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <textarea
            className="mt-3 h-20 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
            value={nextIntent}
            onChange={(event) => setNextIntent(event.target.value)}
            placeholder="或者直接输入下一轮探索意图，例如：更聚焦 citation graph 与高质量全文证据。"
          />
          <div className="mt-3">
            <SmallButton tone="solid" disabled={!nextIntent.trim()} onClick={() => props.onNextRound(roundId, nextIntent)}>
              继续下一轮
            </SmallButton>
          </div>
        </div>
      ) : null}

      {isPaper ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">论文动作</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <SmallButton tone="solid" disabled={pdfAsset?.status !== "available"} onClick={props.onOpenPdf}>
              打开 PDF
            </SmallButton>
            <SmallButton disabled={pdfAsset?.status !== "available" || !props.onDownloadPdf} onClick={props.onDownloadPdf}>
              下载 PDF
            </SmallButton>
            <SmallButton onClick={() => props.onAskPreset("这篇论文解决什么问题？核心方法、关键证据和局限分别是什么？")}>去聊天里分析</SmallButton>
            <SmallButton onClick={props.onSavePaper}>保存论文</SmallButton>
            <SmallButton onClick={props.onSummarizePaper}>生成结构化摘要</SmallButton>
            <SmallButton onClick={props.onRebuildVisual}>重建展示图</SmallButton>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Paper Visual</div>
            <div className="mt-3 space-y-3">
              <PreviewBox
                title={props.paperDetail?.title || "paper preview"}
                url={preferredPreviewUrl}
                emptyText="当前还没有可展示图片。若论文已有 PDF，可以点击“重建展示图”尝试生成 overall 图、主图或模板图。"
              />
              <div className="grid gap-3 md:grid-cols-3">
                <AssetStatusCard title="Overall Figure" item={overallAsset} />
                <AssetStatusCard title="Main Figure" item={figureAsset} />
                <AssetStatusCard title="Paper Visual" item={visualAsset} />
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2 text-sm text-slate-600">
            {props.paperDetail?.doi ? <div>DOI: {props.paperDetail.doi}</div> : null}
            {props.paperDetail?.url ? (
              <a className="text-blue-600 underline underline-offset-2" href={props.paperDetail.url} rel="noreferrer" target="_blank">
                打开论文原始链接
              </a>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">完整结构化摘要</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {summarySource ? <Badge tone="slate">{SUMMARY_SOURCE_LABELS[summarySource] || summarySource}</Badge> : null}
              {summaryStatus ? <Badge tone="violet">{SUMMARY_STATUS_LABELS[summaryStatus] || summaryStatus}</Badge> : null}
            </div>
            <MarkdownText
              className="prose prose-sm mt-3 max-w-none text-sm leading-6 text-slate-700 prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-slate-900 prose-p:my-2 prose-li:my-1 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5"
              text={props.paperDetail?.key_points || "当前还没有完整结构化摘要。可以先点击“生成结构化摘要”，系统会优先基于全文，不足时回退到摘要。"}
            />
          </div>

          {props.paperAssets?.items?.length ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">资产</div>
              <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                {props.paperAssets.items.map((item) => (
                  <div key={item.kind} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="font-medium text-slate-900">{ASSET_KIND_LABELS[item.kind] || item.kind}</div>
                    <div className="mt-1">{item.status === "available" ? "可访问" : "缺失"}</div>
                    <AssetActionButtons item={item} onOpenAsset={props.onOpenAsset} onDownloadAsset={props.onDownloadAsset} />
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {[txtAsset, mdAsset, bibAsset].some(Boolean) ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">文本与引用</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {[txtAsset, mdAsset, bibAsset].filter(Boolean).map((item) => (
                  <SmallButton
                    key={item?.kind}
                    onClick={() => {
                      if (!item?.open_url && !item?.download_url) return;
                      if (item?.open_url && props.onOpenAsset) {
                        props.onOpenAsset(item.open_url);
                        return;
                      }
                      if (item?.download_url && props.onDownloadAsset) {
                        props.onDownloadAsset(item.download_url, item.filename);
                      }
                    }}
                  >
                    {ASSET_KIND_LABELS[item?.kind || ""] || item?.kind}
                  </SmallButton>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {node && props.mode === "openclaw_auto" ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          OpenClaw Auto 模式下，节点信息面板只负责解释当前节点；完整的自动研究推进和 checkpoint 引导仍在运行日志区域处理。
        </div>
      ) : null}
    </div>
  );
}

function AssetStatusCard(props: { title: string; item: { status: string } | null }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-sm font-medium text-slate-900">{props.title}</div>
      <div className="mt-1 text-xs text-slate-500">{props.item?.status === "available" ? "可用" : "暂无"}</div>
    </div>
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
