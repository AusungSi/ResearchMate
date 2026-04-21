import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { nodeTypeLabel, summarizeForNode, summarySourceLabel } from "../display";
import type { FlowNodeData } from "../types";
import { tone } from "../utils";
import { Badge } from "./shared";

export function NodeCard({ data }: NodeProps) {
  const node = data as FlowNodeData;
  const [previewFailed, setPreviewFailed] = useState(false);
  const previewUrl = node.type === "paper" && typeof node.preview_url === "string" ? node.preview_url : "";
  const showPreview = Boolean(previewUrl && !previewFailed);

  return (
    <div className="relative w-[360px] overflow-hidden rounded-[28px] border border-slate-200 bg-white/95 shadow-[0_10px_34px_rgba(15,23,42,0.08)] backdrop-blur">
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

      <div className="p-4">
        <div className="line-clamp-2 text-base font-semibold leading-6 text-slate-900">{node.label}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={tone(node.type)}>{nodeTypeLabel(node.type)}</Badge>
          {node.year ? <Badge tone="slate">{String(node.year)}</Badge> : null}
          {node.venue ? <Badge tone="blue">{node.venue}</Badge> : null}
          {node.direction_index ? <Badge tone="green">{`方向 ${node.direction_index}`}</Badge> : null}
          {node.status ? <Badge tone="violet">{node.status}</Badge> : null}
          {node.preview_kind ? <Badge tone="amber">{node.preview_kind === "figure" ? "主图" : "展示图"}</Badge> : null}
          {node.summary_source ? <Badge tone="slate">{summarySourceLabel(node.summary_source)}</Badge> : null}
          {node.isManual ? <Badge tone="amber">手工节点</Badge> : null}
        </div>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">{node.type === "question" ? "问题与回答" : "卡片摘要"}</div>
          <p className="line-clamp-6 whitespace-pre-line text-xs leading-5 text-slate-600">{summarizeForNode(node)}</p>
        </div>

        {node.userNote ? (
          <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">{node.userNote}</div>
        ) : null}
      </div>
    </div>
  );
}
