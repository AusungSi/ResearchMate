import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { directionSubtitle, nodeTypeLabel, summarizeForNode, summarySourceLabel } from "../display";
import type { FlowNodeData } from "../types";
import { tone } from "../utils";
import { Badge } from "./shared";

export function NodeCard({ data }: NodeProps) {
  const node = data as FlowNodeData;
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewUrl = node.type === "paper" && typeof node.preview_url === "string" ? node.preview_url : "";
  const showPreview = Boolean(previewUrl && !previewFailed);
  const isDirection = node.type === "direction";
  const isActive = Boolean(node.isActive);
  const previewBadgeLabel =
    node.preview_kind === "overall" ? "概览图" : node.preview_kind === "figure" ? "主图" : node.preview_kind ? "展示图" : null;

  useEffect(() => {
    setPreviewFailed(false);
  }, [previewUrl]);

  return (
    <div
      className={`relative w-[380px] overflow-hidden rounded-[28px] border bg-white/95 backdrop-blur ${
        isActive
          ? "border-emerald-300 shadow-[0_0_0_5px_rgba(16,185,129,0.14),0_18px_44px_rgba(16,185,129,0.18)]"
          : "border-slate-200 shadow-[0_10px_34px_rgba(15,23,42,0.08)]"
      }`}
    >
      {isActive ? <div className="pointer-events-none absolute inset-0 animate-pulse rounded-[28px] ring-2 ring-emerald-300/60" /> : null}
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-slate-500" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-slate-500" />

      {showPreview ? (
        <div className="border-b border-slate-200 bg-slate-100">
          <img
            src={previewUrl}
            alt={`${node.label} preview`}
            className="h-40 w-full object-cover"
            loading="lazy"
            onError={() => setPreviewFailed(true)}
          />
        </div>
      ) : null}

      <div className={isDirection ? "border-b border-emerald-100 bg-emerald-50/70 p-4" : "p-4 pb-2"}>
        <div className="flex flex-wrap gap-1.5">
          <Badge tone={tone(node.type)}>{nodeTypeLabel(node.type)}</Badge>
          {node.year ? <Badge tone="slate">{String(node.year)}</Badge> : null}
          {node.venue ? <Badge tone="blue">{node.venue}</Badge> : null}
          {node.direction_index ? <Badge tone="green">{`方向 ${node.direction_index}`}</Badge> : null}
          {node.status ? <Badge tone="violet">{node.status}</Badge> : null}
          {previewBadgeLabel ? <Badge tone="amber">{previewBadgeLabel}</Badge> : null}
          {node.summary_source ? <Badge tone="slate">{summarySourceLabel(node.summary_source)}</Badge> : null}
          {node.isManual ? <Badge tone="amber">手工节点</Badge> : null}
        </div>
        <div className="mt-3 line-clamp-2 text-base font-semibold leading-6 text-slate-950">{node.label}</div>
        {isDirection ? <div className="mt-1 text-xs font-medium text-emerald-700">{directionSubtitle(node)}</div> : null}
      </div>

      <div className="p-4">
        <div className={isDirection ? "rounded-2xl border border-emerald-100 bg-white p-3" : "rounded-2xl border border-slate-200 bg-slate-50 p-3"}>
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{isDirection ? "方向说明" : "卡片摘要"}</div>
          <p className={`${isDirection ? "line-clamp-8" : "line-clamp-6"} whitespace-pre-line text-xs leading-5 text-slate-600`}>
            {summarizeForNode(node)}
          </p>
        </div>

        {node.userNote ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">{node.userNote}</div>
        ) : null}
      </div>
    </div>
  );
}
