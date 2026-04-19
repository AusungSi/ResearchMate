import { SmallButton } from "./shared";

export function QuickActionBar(props: {
  selectedPaperCount: number;
  onAddNote: () => void;
  onAddQuestion: () => void;
  onAddReference: () => void;
  onAddGroup: () => void;
  onSaveCanvas: () => void;
  onAddToCollection: () => void;
  onCreateStudyFromSelection: () => void;
}) {
  return (
    <div className="absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white/96 px-4 py-3 shadow-lg backdrop-blur">
      <div className="text-sm text-slate-500">快捷操作</div>
      <SmallButton tone="solid" onClick={props.onAddNote}>
        添加笔记
      </SmallButton>
      <SmallButton onClick={props.onAddQuestion}>添加问题</SmallButton>
      <SmallButton onClick={props.onAddReference}>添加参考</SmallButton>
      <SmallButton onClick={props.onAddGroup}>添加分组</SmallButton>
      <SmallButton disabled={!props.selectedPaperCount} onClick={props.onAddToCollection}>
        加入 Collection
      </SmallButton>
      <SmallButton disabled={!props.selectedPaperCount} onClick={props.onCreateStudyFromSelection}>
        选中文献派生调研
      </SmallButton>
      <SmallButton onClick={props.onSaveCanvas}>保存画布</SmallButton>
    </div>
  );
}
