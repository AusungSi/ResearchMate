import { SmallButton } from "./shared";

type Props = {
  selectionLabel: string;
  multiPaper: boolean;
  singleNodeType?: string | null;
  canDeleteOrHide?: boolean;
  deleteOrHideLabel?: string;
  onDeleteOrHide?: () => void;
  onReferenceToChat?: () => void;
  onOpenPdf?: () => void;
  onDownloadPdf?: () => void;
  onSummarizePaper?: () => void;
  onRebuildVisual?: () => void;
  onSearchDirection?: () => void;
  onStartExplore?: () => void;
  onBuildGraph?: () => void;
  onProposeCandidates?: () => void;
  onNextRound?: () => void;
  onAddToCollection?: () => void;
  onCompareSelection?: () => void;
};

export function CanvasActionBar(props: Props) {
  const hasSingleNode = Boolean(props.singleNodeType);
  if (!props.multiPaper && !hasSingleNode) return null;

  return (
    <div className="absolute bottom-5 left-1/2 z-10 flex max-w-[calc(100%-56px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[24px] border border-slate-200 bg-white/96 px-4 py-3 shadow-[0_16px_40px_rgba(15,23,42,0.12)] backdrop-blur">
      <div className="mr-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{props.selectionLabel}</div>

      {props.multiPaper ? (
        <>
          <SmallButton tone="solid" onClick={props.onAddToCollection}>
            加入 Collection
          </SmallButton>
          <SmallButton onClick={props.onCompareSelection}>对比文献</SmallButton>
        </>
      ) : null}

      {props.singleNodeType === "paper" ? (
        <>
          <SmallButton tone="solid" onClick={props.onOpenPdf}>
            打开 PDF
          </SmallButton>
          <SmallButton onClick={props.onDownloadPdf}>下载 PDF</SmallButton>
          <SmallButton onClick={props.onAddToCollection}>加入 Collection</SmallButton>
          <SmallButton onClick={props.onSummarizePaper}>结构化摘要</SmallButton>
          <SmallButton onClick={props.onRebuildVisual}>重建展示图</SmallButton>
          <SmallButton onClick={props.onReferenceToChat}>加入聊天上下文</SmallButton>
        </>
      ) : null}

      {props.singleNodeType === "direction" ? (
        <>
          <SmallButton tone="solid" onClick={props.onSearchDirection}>
            检索方向
          </SmallButton>
          <SmallButton onClick={props.onStartExplore}>继续探索</SmallButton>
          <SmallButton onClick={props.onBuildGraph}>构建图谱</SmallButton>
          <SmallButton onClick={props.onReferenceToChat}>加入聊天上下文</SmallButton>
        </>
      ) : null}

      {props.singleNodeType === "round" ? (
        <>
          <SmallButton tone="solid" onClick={props.onProposeCandidates}>
            生成候选
          </SmallButton>
          <SmallButton onClick={props.onNextRound}>继续下一轮</SmallButton>
          <SmallButton onClick={props.onBuildGraph}>构建图谱</SmallButton>
          <SmallButton onClick={props.onReferenceToChat}>加入聊天上下文</SmallButton>
        </>
      ) : null}

      {hasSingleNode && props.singleNodeType !== "paper" && props.singleNodeType !== "direction" && props.singleNodeType !== "round" ? (
        <SmallButton onClick={props.onReferenceToChat}>加入聊天上下文</SmallButton>
      ) : null}

      {props.canDeleteOrHide ? (
        <SmallButton tone="rose" onClick={props.onDeleteOrHide}>
          {props.deleteOrHideLabel || "删除节点"}
        </SmallButton>
      ) : null}
    </div>
  );
}
