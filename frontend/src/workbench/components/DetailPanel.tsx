import { useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import { assetKindLabel, nodeTypeLabel, summarizeForNode, summarySourceLabel, summaryStatusLabel } from "../display";
import type { FlowNodeData, PaperAssetResponse, PaperDetail, RoundCandidate, TaskMode } from "../types";
import { inferRoundId, isPaperNode, tone } from "../utils";
import { Badge, SectionTitle, SmallButton } from "./shared";

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

function assetByKind(assets: PaperAssetResponse | null, kind: string) {
  return assets?.items.find((item) => item.kind === kind && item.status === "available") || null;
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

export function DetailPanel(props: Props) {
  const [feedback, setFeedback] = useState("");
  const [nextIntent, setNextIntent] = useState("");
  const [candidateAction, setCandidateAction] = useState("expand");
  const node = props.node;
  const nodeData = node?.data || null;
  const directionIndex = typeof nodeData?.direction_index === "number" ? nodeData.direction_index : null;
  const roundId = inferRoundId(node?.id || "", nodeData || undefined);
  const isPaper = isPaperNode(node?.id);
  const pdfAsset = useMemo(() => assetByKind(props.paperAssets, "pdf"), [props.paperAssets]);
  const figureAsset = useMemo(() => assetByKind(props.paperAssets, "figure"), [props.paperAssets]);
  const visualAsset = useMemo(() => assetByKind(props.paperAssets, "visual"), [props.paperAssets]);
  const preferredPreviewUrl = figureAsset?.open_url || figureAsset?.download_url || visualAsset?.open_url || visualAsset?.download_url || props.paperDetail?.preview_url || null;
  const summarySource = props.paperDetail?.summary_source || nodeData?.summary_source || null;
  const summaryStatus = props.paperDetail?.summary_status || nodeData?.summary_status || null;
  const displaySummary = props.paperDetail?.card_summary || summarizeForNode(nodeData);
  const canDeleteNode = Boolean(node);

  useEffect(() => {
    setFeedback("");
    setNextIntent("");
    setCandidateAction("expand");
  }, [node?.id]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle
        eyebrow="Selected Node"
        title={nodeData?.label || "请选择一个节点"}
        description={
          node
            ? "右侧会根据节点类型切换动作、结构化摘要、资产和局部问答。"
            : "选中主题、方向、轮次、论文或手工节点后，这里会显示对应的信息。"
        }
      />

      {node ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={tone(String(nodeData?.type || ""))}>{nodeTypeLabel(String(nodeData?.type || ""))}</Badge>
          {nodeData?.status ? <Badge tone="slate">{String(nodeData.status)}</Badge> : null}
          {directionIndex ? <Badge tone="green">{`方向 ${directionIndex}`}</Badge> : null}
          {isPaper && props.paperDetail?.year ? <Badge tone="amber">{String(props.paperDetail.year)}</Badge> : null}
          {props.paperDetail?.venue ? <Badge tone="blue">{props.paperDetail.venue}</Badge> : null}
          {summarySource ? <Badge tone="slate">{summarySourceLabel(summarySource)}</Badge> : null}
          {summaryStatus ? <Badge tone="violet">{summaryStatusLabel(summaryStatus)}</Badge> : null}
          {props.paperDetail?.preview_kind ? <Badge tone="amber">{props.paperDetail.preview_kind === "figure" ? "主图预览" : "展示图预览"}</Badge> : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Why It Matters</div>
        <div className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-700">{displaySummary}</div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Organize</div>
        <textarea
          className="mt-2 h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          value={String(nodeData?.userNote || "")}
          onChange={(event) => props.onUpdateNote(event.target.value)}
          disabled={!node}
          placeholder="添加你的判断、标签、下一步计划，或记录为什么这个节点值得保留..."
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <SmallButton tone="solid" disabled={!node} onClick={() => props.onAskPreset("请总结这个节点的核心价值。")}>
            Ask Model
          </SmallButton>
          <SmallButton disabled={!node} onClick={props.onToggleHidden}>
            {node?.hidden ? "恢复显示" : "隐藏节点"}
          </SmallButton>
          <SmallButton disabled={!canDeleteNode} onClick={props.onDeleteNode}>
            删除节点
          </SmallButton>
        </div>
        {node ? (
          <div className="mt-2 text-xs leading-5 text-slate-500">
            {canDeleteNode ? "手工节点可以直接删除，相关手工连线会一起移除。" : "系统节点属于研究主图谱，当前支持隐藏，不支持直接删除。"}
          </div>
        ) : null}
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
            placeholder="补充这一轮的目标、限制条件，或者你希望扩展的分支..."
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
                  {candidate.queries?.length ? <div className="mt-2 text-xs text-slate-500">{candidate.queries.join(" · ")}</div> : null}
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
            <SmallButton tone="solid" disabled={!pdfAsset} onClick={props.onOpenPdf}>
              Open PDF
            </SmallButton>
            <SmallButton onClick={() => props.onAskPreset("这篇论文解决什么问题，核心方法是什么？")}>Ask Model</SmallButton>
            <SmallButton onClick={props.onSavePaper}>Save</SmallButton>
            <SmallButton onClick={props.onSummarizePaper}>生成结构化摘要</SmallButton>
            <SmallButton onClick={props.onRebuildVisual}>重建展示图</SmallButton>
          </div>

          <div className="mt-4">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Paper Visual</div>
            <div className="mt-3 space-y-3">
              <div>
                <div className="mb-2 text-sm font-medium text-slate-900">主图 / 展示图预览</div>
                <PreviewBox title={props.paperDetail?.title || "paper preview"} url={preferredPreviewUrl} emptyText="当前还没有可展示图片。若论文已有 PDF，可以点击“重建展示图”尝试生成。" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-medium text-slate-900">Main Figure</div>
                  <div className="mt-1 text-xs text-slate-500">{figureAsset ? "已提取主图" : "暂未提取到主图"}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-sm font-medium text-slate-900">Paper Visual</div>
                  <div className="mt-1 text-xs text-slate-500">{visualAsset ? "已生成模板展示图" : props.paperDetail?.visual_status || "尚未生成"}</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 space-y-2 text-sm text-slate-600">
            {props.paperDetail?.doi ? <div>DOI: {props.paperDetail.doi}</div> : null}
            {props.paperDetail?.url ? (
              <a className="text-blue-600 underline underline-offset-2" href={props.paperDetail.url} rel="noreferrer" target="_blank">
                打开论文链接
              </a>
            ) : null}
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">完整结构化摘要</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {summarySource ? <Badge tone="slate">{summarySourceLabel(summarySource)}</Badge> : null}
              {summaryStatus ? <Badge tone="violet">{summaryStatusLabel(summaryStatus)}</Badge> : null}
            </div>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">
              {props.paperDetail?.key_points || "当前还没有完整结构化摘要。可以先尝试“生成结构化摘要”，系统会优先基于全文，不足时回退到摘要。"}
            </div>
          </div>

          {props.paperAssets?.items?.length ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Assets</div>
              <div className="mt-2 grid gap-2 text-xs text-slate-600 md:grid-cols-2">
                {props.paperAssets.items.map((item) => (
                  <div key={item.kind} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="font-medium text-slate-900">{assetKindLabel(item.kind)}</div>
                    <div>{item.status === "available" ? "可访问" : "缺失"}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {node && props.mode === "openclaw_auto" ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          OpenClaw Auto 模式下，节点问答只围绕当前节点上下文，不会接管整条自动研究流程。
        </div>
      ) : null}
    </div>
  );
}
