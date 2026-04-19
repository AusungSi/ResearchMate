import { useEffect, useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import type { FlowNodeData, PaperAssetResponse, PaperDetail, RoundCandidate, TaskMode } from "../types";
import { inferRoundId, isPaperNode, nodeTypeLabel, summarizeForNode, tone } from "../utils";
import { Badge, SectionTitle, SmallButton } from "./shared";

type Props = {
  mode: TaskMode;
  node: Node<FlowNodeData> | null;
  paperDetail: PaperDetail | null;
  paperAssets: PaperAssetResponse | null;
  roundCandidates: RoundCandidate[];
  onUpdateNote: (note: string) => void;
  onToggleHidden: () => void;
  onOpenPdf: () => void;
  onSavePaper: () => void;
  onSummarizePaper: () => void;
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
  { value: "pivot", label: "转向新角度" },
  { value: "converge", label: "收敛到核心问题" },
];

export function DetailPanel(props: Props) {
  const [feedback, setFeedback] = useState("");
  const [nextIntent, setNextIntent] = useState("");
  const [candidateAction, setCandidateAction] = useState("expand");
  const node = props.node;
  const nodeData = node?.data || null;
  const directionIndex = typeof nodeData?.direction_index === "number" ? nodeData.direction_index : null;
  const roundId = inferRoundId(node?.id || "", nodeData || undefined);
  const isPaper = isPaperNode(node?.id);
  const primaryPdf = useMemo(() => props.paperAssets?.items.find((item) => item.kind === "pdf" && item.status === "available"), [props.paperAssets]);

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
            ? "右侧会根据节点类型切换动作面板、局部问答、PDF / 全文和运行日志。"
            : "选中主题、方向、轮次或论文节点后，这里会显示对应信息。"
        }
      />

      {node ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Badge tone={tone(String(nodeData?.type || ""))}>{nodeTypeLabel(String(nodeData?.type || ""))}</Badge>
          {nodeData?.status ? <Badge tone="slate">{String(nodeData.status)}</Badge> : null}
          {directionIndex ? <Badge tone="green">{`方向 ${directionIndex}`}</Badge> : null}
          {isPaper && props.paperDetail?.year ? <Badge tone="amber">{String(props.paperDetail.year)}</Badge> : null}
          {props.paperDetail?.venue ? <Badge tone="blue">{props.paperDetail.venue}</Badge> : null}
        </div>
      ) : null}

      <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Why it matters</div>
        <div className="mt-2 text-sm leading-6 text-slate-700">{summarizeForNode(nodeData)}</div>
      </div>

      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Organize</div>
        <textarea
          className="mt-2 h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          value={String(nodeData?.userNote || "")}
          onChange={(event) => props.onUpdateNote(event.target.value)}
          disabled={!node}
          placeholder="添加你的判断、标签、下一步计划或引用理由..."
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <SmallButton tone="solid" disabled={!node} onClick={() => props.onAskPreset("请总结这个节点的核心价值。")}>
            Ask Model
          </SmallButton>
          <SmallButton disabled={!node} onClick={props.onToggleHidden}>
            {node?.hidden ? "恢复显示" : "隐藏节点"}
          </SmallButton>
        </div>
      </div>

      {directionIndex ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Direction Actions</div>
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
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Round Actions</div>
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
            placeholder="补充这一轮的目标、限制条件，或希望扩展的分支..."
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <SmallButton tone="solid" onClick={() => props.onProposeCandidates(roundId, candidateAction, feedback)}>
              生成候选
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
            placeholder="或者直接输入下一轮探索意图，例如：更聚焦 citation graph 与高质量全文。"
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
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Paper Actions</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <SmallButton tone="solid" disabled={!primaryPdf} onClick={props.onOpenPdf}>
              Open PDF
            </SmallButton>
            <SmallButton onClick={() => props.onAskPreset("请总结这篇论文的方法、贡献和局限。")}>Ask Model</SmallButton>
            <SmallButton onClick={props.onSavePaper}>Save</SmallButton>
            <SmallButton onClick={props.onSummarizePaper}>生成要点</SmallButton>
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-600">
            {props.paperDetail?.doi ? <div>DOI: {props.paperDetail.doi}</div> : null}
            {props.paperDetail?.url ? (
              <a className="text-blue-600 underline underline-offset-2" href={props.paperDetail.url} rel="noreferrer" target="_blank">
                打开论文链接
              </a>
            ) : null}
            {props.paperDetail?.key_points ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">{props.paperDetail.key_points}</div>
            ) : null}
            {props.paperAssets?.items?.length ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Assets</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                  {props.paperAssets.items.map((item) => (
                    <div key={item.kind} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="font-medium">{item.kind.toUpperCase()}</div>
                      <div>{item.status === "available" ? "可访问" : "缺失"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
