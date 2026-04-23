import { SmallButton } from "./shared";

type Props = {
  selectedPaperCount: number;
  hiddenNodeCount: number;
  onAddNote: () => void;
  onAddQuestion: () => void;
  onAddReference: () => void;
  onAddGroup: () => void;
  onSaveCanvas: () => void;
  onAddToCollection: () => void;
  onCreateStudyFromSelection: () => void;
  onCompareSelection: () => void;
  onRestoreHiddenNodes: () => void;
};

export function QuickActionBar(props: Props) {
  const actionButtonClass = "flex-none whitespace-nowrap";

  return (
    <div className="absolute bottom-5 left-20 right-6 z-10">
      <div className="flex w-full flex-wrap items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white/96 px-3 py-3 shadow-lg backdrop-blur">
        <SmallButton className={actionButtonClass} tone="solid" onClick={props.onAddNote}>
          添加笔记
        </SmallButton>
        <SmallButton className={actionButtonClass} onClick={props.onAddQuestion}>
          添加问题
        </SmallButton>
        <SmallButton className={actionButtonClass} onClick={props.onAddReference}>
          添加参考
        </SmallButton>
        <SmallButton className={actionButtonClass} onClick={props.onAddGroup}>
          添加分组
        </SmallButton>
        <SmallButton className={actionButtonClass} disabled={!props.selectedPaperCount} onClick={props.onAddToCollection}>
          加入 Collection
        </SmallButton>
        <SmallButton className={actionButtonClass} disabled={props.selectedPaperCount < 2} onClick={props.onCompareSelection}>
          对比选中文献
        </SmallButton>
        <SmallButton className={actionButtonClass} disabled={!props.selectedPaperCount} onClick={props.onCreateStudyFromSelection}>
          派生研究任务
        </SmallButton>
        <SmallButton className={actionButtonClass} disabled={!props.hiddenNodeCount} onClick={props.onRestoreHiddenNodes}>
          恢复隐藏节点
        </SmallButton>
        <SmallButton className={actionButtonClass} onClick={props.onSaveCanvas}>
          保存画布
        </SmallButton>
      </div>
    </div>
  );
}
