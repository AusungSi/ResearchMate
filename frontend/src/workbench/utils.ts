import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type {
  Backend,
  CanvasResponse,
  CanvasUiState,
  FlowNodeData,
  GraphEdge,
  GraphNode,
  GraphResponse,
  RunEvent,
  RunSummary,
  TaskMode,
} from "./types";

const elk = new ELK();

export const edgeVisual = {
  type: "smoothstep" as const,
  style: { stroke: "#64748b", strokeWidth: 2.25, strokeDasharray: "10 8" },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: "#64748b",
    width: 18,
    height: 18,
  },
};

export function defaultCanvasUi(): CanvasUiState {
  return {
    left_sidebar_collapsed: false,
    right_sidebar_collapsed: false,
    left_sidebar_width: 320,
    right_sidebar_width: 420,
    show_minimap: false,
    layout_mode: "elk_layered",
  };
}

export function tone(type?: string): "slate" | "blue" | "green" | "violet" | "amber" {
  if (type === "topic" || type === "checkpoint") return "blue";
  if (type === "direction" || type === "group") return "green";
  if (type === "round" || type === "report" || type === "reference") return "violet";
  if (type === "paper" || type === "question") return "amber";
  return "slate";
}

export function nodeTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    topic: "主题",
    direction: "方向",
    round: "轮次",
    paper: "论文",
    checkpoint: "Checkpoint",
    report: "阶段报告",
    note: "笔记",
    group: "分组",
    reference: "参考资料",
    question: "问题",
  };
  return labels[type || ""] || type || "节点";
}

export function stepLabel(step?: string) {
  const labels: Record<string, string> = {
    task_created: "任务创建",
    plan_queued: "方向规划排队",
    plan_completed: "方向规划完成",
    search_queued: "论文检索排队",
    search_completed: "论文检索完成",
    exploration_started: "开始探索",
    candidates_generated: "生成候选",
    candidate_selected: "选择候选",
    next_round_created: "进入下一轮",
    graph_queued: "图谱构建排队",
    tree_graph_completed: "树图生成完成",
    citation_graph_completed: "引用图生成完成",
    fulltext_queued: "全文处理排队",
    fulltext_completed: "全文处理完成",
    paper_saved: "论文已保存",
    paper_summary_queued: "论文总结排队",
    paper_summary_completed: "论文总结完成",
  };
  return labels[step || ""] || step || "步骤";
}

export function manualNodeDefaultLabel(type: "note" | "question" | "reference" | "group") {
  const labels = {
    note: "新的笔记",
    question: "新的问题",
    reference: "新的参考资料",
    group: "新的分组",
  };
  return labels[type];
}

export function modeLabel(mode: TaskMode) {
  return mode === "openclaw_auto" ? "OpenClaw Auto" : "GPT Step";
}

export function backendLabel(backend: Backend) {
  return backend === "openclaw" ? "OpenClaw" : "GPT API";
}

export function autoStatusLabel(status: string) {
  const labels: Record<string, string> = {
    idle: "待命",
    running: "运行中",
    awaiting_guidance: "等待你的引导",
    completed: "已完成",
    failed: "运行失败",
    canceled: "已取消",
  };
  return labels[status] || status || "未知";
}

export function eventTypeLabel(eventType: string, payload?: Record<string, unknown>) {
  if (payload?.kind === "gpt_step") {
    return stepLabel(String(payload.step || ""));
  }
  const labels: Record<string, string> = {
    progress: "进度",
    node_upsert: "节点更新",
    edge_upsert: "连线更新",
    paper_upsert: "论文更新",
    checkpoint: "Checkpoint",
    report_chunk: "阶段报告",
    artifact: "产出物",
    error: "错误",
  };
  return labels[eventType] || eventType;
}

function typeColumn(type: string) {
  if (type === "topic") return 0;
  if (type === "direction") return 1;
  if (type === "round" || type === "checkpoint") return 2;
  if (type === "paper" || type === "report") return 3;
  return 4;
}

function defaultPositionForNode(type: string, row: number) {
  return { x: 140 + typeColumn(type) * 420, y: 120 + row * 240 };
}

function buildEventGraph(taskId: string, events: RunEvent[]) {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();

  for (const event of events) {
    const payload = event.payload || {};

    if (event.event_type === "node_upsert" || event.event_type === "paper_upsert") {
      const id = String(payload.id || "");
      if (!id) continue;
      nodes.set(id, {
        id,
        type: String(payload.type || "note"),
        label: String(payload.label || payload.title || id),
        summary: stringifyBest(payload.summary, payload.content, payload.abstract),
        status: asOptionalString(payload.status),
        year: asOptionalNumber(payload.year),
        source: asOptionalString(payload.source),
        venue: asOptionalString(payload.venue),
        direction_index: asOptionalNumber(payload.direction_index),
      });
      continue;
    }

    if (event.event_type === "checkpoint") {
      const checkpointId = String(payload.checkpoint_id || event.seq);
      const nodeId = `checkpoint:${checkpointId}`;
      nodes.set(nodeId, {
        id: nodeId,
        type: "checkpoint",
        label: String(payload.title || "Checkpoint"),
        summary: stringifyBest(payload.summary, payload.report_excerpt),
        status: "awaiting_guidance",
      });
      edges.set(`${taskId}:topic:${nodeId}:checkpoint`, {
        source: `topic:${taskId}`,
        target: nodeId,
        type: "topic_checkpoint",
        weight: 1,
      });
      continue;
    }

    if (event.event_type === "report_chunk") {
      const nodeId = `report:${event.run_id}`;
      nodes.set(nodeId, {
        id: nodeId,
        type: "report",
        label: String(payload.title || "阶段报告"),
        summary: stringifyBest(payload.content, payload.summary),
        status: "done",
      });
      edges.set(`${taskId}:topic:${nodeId}:report`, {
        source: `topic:${taskId}`,
        target: nodeId,
        type: "topic_report",
        weight: 1,
      });
      continue;
    }

    if (event.event_type === "edge_upsert") {
      const source = String(payload.source || "");
      const target = String(payload.target || "");
      if (!source || !target) continue;
      const type = String(payload.type || "related");
      edges.set(`${source}:${target}:${type}`, {
        source,
        target,
        type,
        weight: asOptionalNumber(payload.weight) || 1,
      });
    }
  }

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

export function mergeCanvasWithGraph(
  graph?: GraphResponse,
  canvas?: CanvasResponse,
  events: RunEvent[] = [],
  fallbackUi: CanvasUiState = defaultCanvasUi(),
) {
  const eventGraph = buildEventGraph(graph?.task_id || canvas?.task_id || "", events);
  const canonicalNodes = new Map<string, GraphNode>();
  const canonicalEdges = new Map<string, GraphEdge>();

  for (const node of graph?.nodes || []) canonicalNodes.set(node.id, node);
  for (const node of eventGraph.nodes) canonicalNodes.set(node.id, { ...(canonicalNodes.get(node.id) || {}), ...node });

  for (const edge of graph?.edges || []) canonicalEdges.set(`${edge.source}:${edge.target}:${edge.type}`, edge);
  for (const edge of eventGraph.edges) canonicalEdges.set(`${edge.source}:${edge.target}:${edge.type}`, edge);

  const savedNodes = new Map((canvas?.nodes || []).map((node) => [node.id, node]));
  const counts: Record<string, number> = {};
  const nodes: Array<Node<FlowNodeData>> = [];

  for (const node of canonicalNodes.values()) {
    const cached = savedNodes.get(node.id);
    const row = counts[node.type] || 0;
    counts[node.type] = row + 1;
    nodes.push({
      id: node.id,
      type: "cardNode",
      position: cached?.position || defaultPositionForNode(node.type, row),
      hidden: cached?.hidden,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        ...node,
        userNote: typeof cached?.data?.userNote === "string" ? cached.data.userNote : undefined,
      },
    });
  }

  for (const node of canvas?.nodes || []) {
    if (canonicalNodes.has(node.id)) continue;
    nodes.push({
      id: node.id,
      type: "cardNode",
      position: node.position,
      hidden: node.hidden,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        ...(node.data || {}),
        id: node.id,
        type: node.type,
        label: String(node.data?.label || node.id),
        isManual: true,
      } as FlowNodeData,
    });
  }

  const edges: Array<Edge> = [];
  const existing = new Set<string>();
  for (const edge of canonicalEdges.values()) {
    const key = `${edge.source}:${edge.target}:${edge.type}`;
    existing.add(key);
    edges.push({
      id: `graph:${key}`,
      source: edge.source,
      target: edge.target,
      type: edgeVisual.type,
      style: edgeVisual.style,
      markerEnd: edgeVisual.markerEnd,
      data: { ...edge, kind: "graph" },
    });
  }

  for (const edge of canvas?.edges || []) {
    const key = `${edge.source}:${edge.target}:${edge.type || "default"}`;
    if (existing.has(key)) continue;
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: edge.type || edgeVisual.type,
      style: edgeVisual.style,
      markerEnd: edgeVisual.markerEnd,
      data: edge.data,
      hidden: edge.hidden,
    });
  }

  return {
    nodes,
    edges,
    viewport: canvas?.viewport || { x: 0, y: 0, zoom: 1 },
    ui: { ...fallbackUi, ...(canvas?.ui || {}) },
  };
}

export async function runAutoLayout(
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge>,
  mode = "elk_layered",
) {
  const systemNodes = nodes.filter((node) => !isManualNode(node));
  if (!systemNodes.length || !mode.startsWith("elk")) {
    return new Map<string, { x: number; y: number }>();
  }

  const layout = await elk.layout({
    id: "research-canvas",
    layoutOptions: {
      "elk.algorithm": mode === "elk_stress" ? "stress" : "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "120",
      "elk.layered.spacing.nodeNodeBetweenLayers": "220",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=60,left=80,bottom=60,right=80]",
    },
    children: systemNodes.map((node) => ({
      id: node.id,
      width: 340,
      height: 220,
    })),
    edges: edges
      .filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target))
      .map((edge) => ({
        id: String(edge.id),
        sources: [edge.source],
        targets: [edge.target],
      })),
  });

  const positions = new Map<string, { x: number; y: number }>();
  for (const child of layout.children || []) {
    positions.set(child.id, { x: child.x || 0, y: child.y || 0 });
  }
  return positions;
}

export function reconcileFlowState(
  currentNodes: Array<Node<FlowNodeData>>,
  currentEdges: Array<Edge>,
  nextNodes: Array<Node<FlowNodeData>>,
  nextEdges: Array<Edge>,
) {
  const currentNodeMap = new Map(currentNodes.map((node) => [node.id, node]));
  const currentEdgeMap = new Map(currentEdges.map((edge) => [edge.id, edge]));

  const nodes = nextNodes.map((node) => {
    const current = currentNodeMap.get(node.id);
    if (!current) return node;
    return {
      ...current,
      ...node,
      position: current.dragging ? current.position : node.position,
      selected: current.selected,
    };
  });

  const edges = nextEdges.map((edge) => {
    const current = currentEdgeMap.get(edge.id);
    if (!current) return edge;
    return { ...current, ...edge, selected: current.selected };
  });

  return { nodes, edges };
}

export function buildCanvasPayload(
  taskId: string,
  nodes: Array<Node<FlowNodeData>>,
  edges: Array<Edge>,
  viewport: { x: number; y: number; zoom: number },
  ui: CanvasUiState,
) {
  return {
    task_id: taskId,
    nodes: nodes.map((node) => {
      const nodeType = String(node.data?.type || "note");
      const manual = isManualNode(node);
      return {
        id: node.id,
        type: nodeType,
        position: node.position,
        data: manual
          ? {
              id: node.id,
              type: nodeType,
              label: String(node.data?.label || node.id),
              summary: typeof node.data?.summary === "string" ? node.data.summary : "",
              userNote: typeof node.data?.userNote === "string" ? node.data.userNote : "",
              isManual: true,
            }
          : {
              userNote: typeof node.data?.userNote === "string" ? node.data.userNote : "",
            },
        hidden: node.hidden,
      };
    }),
    edges: edges
      .filter((edge) => isManualEdge(edge))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type || edgeVisual.type,
        data: sanitizeEdgeData((edge.data as Record<string, unknown> | undefined) || {}),
        hidden: edge.hidden,
      })),
    viewport,
    ui,
  };
}

export function canvasPayloadSignature(payload: CanvasResponse) {
  return JSON.stringify(payload);
}

export function canonicalGraphSignature(graph?: GraphResponse, events: RunEvent[] = []) {
  return JSON.stringify({
    task_id: graph?.task_id || "",
    node_count: graph?.nodes.length || 0,
    edge_count: graph?.edges.length || 0,
    event_count: events.length,
    last_event_seq: events[events.length - 1]?.seq || 0,
    updated: graph?.stats?.updated_at || "",
  });
}

export function summarizeForNode(data?: Partial<FlowNodeData> | null) {
  return stringifyBest(data?.summary, data?.method_summary, data?.abstract, data?.feedback_text) || "这个节点还没有摘要信息。";
}

export function formatRunState(mode: TaskMode, runId: string, autoStatus: string, summary?: RunSummary | null) {
  if (mode === "openclaw_auto") {
    return `运行 ${runId || "未启动"} · ${autoStatusLabel(autoStatus)} · ${summary?.total || 0} 条事件`;
  }
  return `GPT Step · ${summary?.total || 0} 条步骤记录`;
}

export function inferRoundId(nodeId: string, data?: Partial<FlowNodeData> | null) {
  if (typeof data?.depth === "number" && nodeId.startsWith("round:")) {
    const value = Number(nodeId.split(":").pop());
    return Number.isFinite(value) ? value : null;
  }
  if (nodeId.startsWith("round:")) {
    const value = Number(nodeId.split(":").pop());
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

export function isPaperNode(nodeId?: string) {
  return Boolean(nodeId && nodeId.startsWith("paper:"));
}

export function isManualNode(node: Node<FlowNodeData>) {
  return Boolean(node.data?.isManual) || /^(note|question|reference|group):/.test(node.id);
}

export function selectedPaperNodes(nodes: Array<Node<FlowNodeData>>) {
  return nodes.filter((node) => Boolean(node.selected) && isPaperNode(node.id));
}

function stringifyBest(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function asOptionalNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isManualEdge(edge: Edge) {
  if (String(edge.id || "").startsWith("graph:")) return false;
  const data = edge.data as Record<string, unknown> | undefined;
  return data?.kind === "manual" || !String(edge.id || "").startsWith("graph:");
}

function sanitizeEdgeData(data: Record<string, unknown>) {
  const next: Record<string, unknown> = {};
  if (typeof data.kind === "string" && data.kind.trim()) next.kind = data.kind;
  if (typeof data.label === "string" && data.label.trim()) next.label = data.label;
  return next;
}
