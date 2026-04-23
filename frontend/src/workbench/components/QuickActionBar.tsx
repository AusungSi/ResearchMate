import { SmallButton } from "./shared";

type Props = {
  selectedPaperCount: number;
  onAddNote: () => void;
  onAddQuestion: () => void;
  onAddReference: () => void;
  onAddGroup: () => void;
  onSaveCanvas: () => void;
  onAddToCollection: () => void;
  onCreateStudyFromSelection: () => void;
  onCompareSelection: () => void;
};

export function QuickActionBar(props: Props) {
  return (
    <div className="absolute bottom-5 left-1/2 z-10 flex max-w-[calc(100%-48px)] -translate-x-1/2 flex-wrap items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white/96 px-4 py-3 shadow-lg backdrop-blur">
      <div className="px-1 text-sm font-medium text-slate-700">快捷动作</div>
      <div className="text-xs text-slate-500">左键可拖动画布；按住 Shift 可框选，按住 Ctrl/Shift 点击可多选论文节点，然后可加入 Collection、Compare 或派生研究任务。</div>
      <SmallButton tone="solid" onClick={props.onAddNote}>
        添加笔记
      </SmallButton>
      <SmallButton onClick={props.onAddQuestion}>添加问题</SmallButton>
      <SmallButton onClick={props.onAddReference}>添加参考</SmallButton>
      <SmallButton onClick={props.onAddGroup}>添加分组</SmallButton>
      <SmallButton disabled={!props.selectedPaperCount} onClick={props.onAddToCollection}>
        加入 Collection
      </SmallButton>
      <SmallButton disabled={props.selectedPaperCount < 2} onClick={props.onCompareSelection}>
        对比选中文献
      </SmallButton>
      <SmallButton disabled={!props.selectedPaperCount} onClick={props.onCreateStudyFromSelection}>
        派生研究任务
      </SmallButton>
      <SmallButton onClick={props.onSaveCanvas}>保存画布</SmallButton>
    </div>
  );
}
