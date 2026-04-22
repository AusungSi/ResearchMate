import { useEffect } from "react";
import type { ReactNode } from "react";

type ResizeTarget = "left" | "right" | null;

type Props = {
  sidebar: ReactNode;
  canvas: ReactNode;
  detail: ReactNode;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  leftWidth: number;
  rightWidth: number;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  onResizeLeft: (width: number) => void;
  onResizeRight: (width: number) => void;
};

export function AppShell(props: Props) {
  useEffect(() => {
    let resizeTarget: ResizeTarget = null;

    function onMouseMove(event: MouseEvent) {
      if (!resizeTarget) return;
      if (resizeTarget === "left") {
        props.onResizeLeft(Math.min(460, Math.max(260, event.clientX - 16)));
        return;
      }
      props.onResizeRight(Math.min(540, Math.max(340, window.innerWidth - event.clientX - 16)));
    }

    function onMouseUp() {
      resizeTarget = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    function startResize(target: ResizeTarget) {
      resizeTarget = target;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    const left = document.getElementById("resize-left-handle");
    const right = document.getElementById("resize-right-handle");
    const onLeftMouseDown = () => startResize("left");
    const onRightMouseDown = () => startResize("right");

    left?.addEventListener("mousedown", onLeftMouseDown);
    right?.addEventListener("mousedown", onRightMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);

    return () => {
      left?.removeEventListener("mousedown", onLeftMouseDown);
      right?.removeEventListener("mousedown", onRightMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [props]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.08),transparent_24%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.07),transparent_20%),linear-gradient(180deg,#f8fafc_0%,#eef2f7_100%)] p-4 text-slate-900">
      <div className="relative flex h-full w-full overflow-hidden rounded-[32px] border border-white/70 bg-white/90 shadow-[0_24px_80px_rgba(15,23,42,0.12)] backdrop-blur">
        <button
          className="absolute left-4 top-4 z-20 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm"
          onClick={props.onToggleLeft}
        >
          {props.leftCollapsed ? "展开左栏" : "收起左栏"}
        </button>
        <button
          className="absolute right-4 top-4 z-20 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm"
          onClick={props.onToggleRight}
        >
          {props.rightCollapsed ? "展开右栏" : "收起右栏"}
        </button>

        {!props.leftCollapsed ? (
          <>
            <div style={{ width: props.leftWidth }} className="h-full shrink-0 overflow-hidden border-r border-slate-200/90">
              {props.sidebar}
            </div>
            <div id="resize-left-handle" className="h-full w-2 shrink-0 cursor-col-resize bg-transparent transition hover:bg-slate-100" />
          </>
        ) : null}

        <div className="min-w-0 flex-1 overflow-hidden">{props.canvas}</div>

        {!props.rightCollapsed ? (
          <>
            <div id="resize-right-handle" className="h-full w-2 shrink-0 cursor-col-resize bg-transparent transition hover:bg-slate-100" />
            <div style={{ width: props.rightWidth }} className="h-full shrink-0 overflow-hidden border-l border-slate-200/90">
              {props.detail}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
