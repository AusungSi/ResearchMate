import ELK from "elkjs/lib/elk.bundled.js";
import { MarkerType, Position, type Edge, type Node } from "@xyflow/react";
import type { Backend, CanvasResponse, CanvasUiState, FlowNodeData, GraphEdge, GraphNode, GraphResponse, RunEvent, RunSummary, TaskMode } from "./types";

const elk = new ELK();

export const edgeVisual = {
  type: "step" as const,
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
    reference: "参考",
    question: "问题",
  };
  return labels[type || ""] || type || "节点";
}

export function stepLabel(step?: string) {
  const labels: Record<string, string> = {
    task_created: "任务创建",
    plan_queued: "方向规划已排队",
    plan_completed: "方向规划完成",
    search_queued: "论文检索已排队",
    search_completed: "论文检索完成",
    exploration_started: "开始探索",
    candidates_generated: "候选方向已生成",
    candidate_selected: "候选方向已选择",
    next_round_created: "继续下一轮",
    graph_queued: "图谱构建已排队",
    tree_graph_completed: "树状图谱完成",
    citation_graph_completed: "引文图谱完成",
    fulltext_queued: "全文处理已排队",
    fulltext_completed: "全文处理完成",
    paper_saved: "论文已保存",
    paper_summary_queued: "论文总结已排队",
    paper_summary_completed: "论文总结完成",
    export_requested: "导出已排队",
    export_completed: "导出完成",
  };
  return labels[step || ""] || step || "步骤";
}

export function manualNodeDefaultLabel(type: "note" | "question" | "reference" | "group" | "report") {
  const labels = {
    note: "新的笔记",
    question: "新的问题",
    reference: "新的参考",
    group: "新的分组",
    report: "新的报告",
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
    artifact: "产物",
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
  return { x: 160 + typeColumn(type) * 500, y: 120 + row * 320 };
}

function layoutTypeRank(type: string) {
  const order: Record<string, number> = {
    topic: 0,
    direction: 1,
    round: 2,
    paper: 3,
    checkpoint: 4,
    report: 5,
  };
  return order[type] ?? 9;
}

function semanticStage(node: Node<FlowNodeData>) {
  const type = String(node.data?.type || node.type || "");
  if (type === "topic") return 0;
  if (type === "direction") return 1;
  if (type === "round") return 1 + Math.max(1, Number(node.data?.depth || 1));
  if (type === "paper") return 4;
  if (type === "checkpoint") return 5;
  if (type === "report") return 6;
  return 7;
}

function stageKey(node: Node<FlowNodeData>) {
  const directionIndex = typeof node.data?.direction_index === "number" ? node.data.direction_index : 999;
  const depth = typeof node.data?.depth === "number" ? node.data.depth : 0;
  const rank = layoutTypeRank(String(node.data?.type || node.type || ""));
  return `${String(directionIndex).padStart(3, "0")}:${String(rank).padStart(2, "0")}:${String(depth).padStart(3, "0")}:${String(node.data?.label || node.id)}`;
}

function buildStageLayout(nodes: Array<Node<FlowNodeData>>, edges: Array<Edge>) {
  const systemNodes = nodes.filter((node) => !isManualNode(node));
  if (!systemNodes.length) {
    return new Map<string, { x: number; y: number }>();
  }

  const nodeMap = new Map(systemNodes.map((node) => [node.id, node]));
  const systemEdges = edges.filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();

  for (const node of systemNodes) {
    incoming.set(node.id, []);
    outgoing.set(node.id, []);
  }
  for (const edge of systemEdges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.get(edge.target)?.push(edge.source);
  }

  const stage = new Map<string, number>();
  const branch = new Map<string, number>();

  for (const node of systemNodes) {
    const type = String(node.data?.type || node.type || "");
    if (type === "topic") {
      stage.set(node.id, 0);
      branch.set(node.id, 0);
      continue;
    }
    if (typeof node.data?.direction_index === "number") {
      branch.set(node.id, node.data.direction_index);
    }
    if (type === "direction") {
      stage.set(node.id, 1);
    }
  }

  const maxPasses = Math.max(4, systemNodes.length * 2);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let changed = false;
    for (const edge of systemEdges) {
      const sourceStage = stage.get(edge.source);
      if (typeof sourceStage === "number") {
        const nextStage = sourceStage + 1;
        const currentStage = stage.get(edge.target);
        if (typeof currentStage !== "number" || nextStage > currentStage) {
          stage.set(edge.target, nextStage);
          changed = true;
        }
      }
      const sourceBranch = branch.get(edge.source);
      if (typeof sourceBranch === "number" && !branch.has(edge.target)) {
        branch.set(edge.target, sourceBranch);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  for (const node of systemNodes) {
    if (!stage.has(node.id)) {
      stage.set(node.id, semanticStage(node));
    }
    if (!branch.has(node.id)) {
      branch.set(node.id, 0);
    }
  }

  const branchValues = [...new Set([...branch.values()].filter((value) => value > 0))].sort((left, right) => left - right);
  const branchBaseY = new Map<number, number>();
  branchValues.forEach((value, index) => {
    branchBaseY.set(value, 120 + index * 460);
  });

  const fallbackBranchY = branchBaseY.size
    ? [...branchBaseY.values()].reduce((sum, value) => sum + value, 0) / branchBaseY.size
    : 240;

  const stageGroups = new Map<number, Array<Node<FlowNodeData>>>();
  for (const node of systemNodes) {
    const level = stage.get(node.id) || 0;
    const current = stageGroups.get(level) || [];
    current.push(node);
    stageGroups.set(level, current);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const stageGapX = 430;
  const innerGapY = 300;

  for (const [level, items] of [...stageGroups.entries()].sort((left, right) => left[0] - right[0])) {
    const x = 140 + level * stageGapX;
    const laneCounts = new Map<number, number>();
    items.sort((left, right) => stageKey(left).localeCompare(stageKey(right), "zh-CN"));
    for (const node of items) {
      const currentBranch = branch.get(node.id) || 0;
      const laneIndex = laneCounts.get(currentBranch) || 0;
      laneCounts.set(currentBranch, laneIndex + 1);
      const baseY = currentBranch > 0 ? branchBaseY.get(currentBranch) || fallbackBranchY : fallbackBranchY;
      const y = String(node.data?.type || node.type || "") === "topic" ? fallbackBranchY + 180 : baseY + laneIndex * innerGapY;
      positions.set(node.id, { x, y });
    }
  }

  return positions;
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
        summary: stringifyBest(payload.content, payload.summary, payload.report_excerpt),
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

export function mergeCanvasWithGraph(graph?: GraphResponse, canvas?: CanvasResponse, events: RunEvent[] = [], fallbackUi: CanvasUiState = defaultCanvasUi()) {
  const eventGraph = buildEventGraph(graph?.task_id || canvas?.task_id || "", events);
  const canonicalNodes = new Map<string, GraphNode>();
  const canonicalEdges = new Map<string, GraphEdge>();
  const savedNodes = new Map((canvas?.nodes || []).map((node) => [node.id, node]));
  const allowEventOnlyGraph = !(graph?.nodes?.length || canvas?.nodes?.length);

  for (const node of graph?.nodes || []) canonicalNodes.set(node.id, node);
  for (const node of eventGraph.nodes) {
    if (!allowEventOnlyGraph && !canonicalNodes.has(node.id) && !savedNodes.has(node.id)) continue;
    canonicalNodes.set(node.id, { ...(canonicalNodes.get(node.id) || {}), ...node });
  }

  for (const edge of graph?.edges || []) canonicalEdges.set(`${edge.source}:${edge.target}:${edge.type}`, edge);
  for (const edge of eventGraph.edges) {
    if (!allowEventOnlyGraph && (!canonicalNodes.has(edge.source) || !canonicalNodes.has(edge.target)) && (!savedNodes.has(edge.source) || !savedNodes.has(edge.target))) {
      continue;
    }
    canonicalEdges.set(`${edge.source}:${edge.target}:${edge.type}`, edge);
  }

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

  const hiddenNodeIds = new Set(nodes.filter((node) => Boolean(node.hidden)).map((node) => node.id));
  const edges: Array<Edge> = [];
  const existing = new Set<string>();
  const nodeIds = new Set(nodes.map((node) => node.id));
  for (const edge of canonicalEdges.values()) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
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
      hidden: hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target),
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
      hidden: Boolean(edge.hidden) || hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target),
    });
  }

  return {
    nodes,
    edges,
    viewport: canvas?.viewport || { x: 0, y: 0, zoom: 1 },
    ui: { ...fallbackUi, ...(canvas?.ui || {}) },
  };
}

export async function runAutoLayout(nodes: Array<Node<FlowNodeData>>, edges: Array<Edge>, mode = "elk_layered") {
  const systemNodes = nodes.filter((node) => !isManualNode(node));
  if (!systemNodes.length || !mode.startsWith("elk")) {
    return new Map<string, { x: number; y: number }>();
  }

  if (mode === "elk_layered") {
    return buildStageLayout(nodes, edges);
  }

  const layout = await elk.layout({
    id: "research-canvas",
    layoutOptions: {
      "elk.algorithm": mode === "elk_stress" ? "stress" : "layered",
      "elk.direction": "RIGHT",
      "elk.spacing.nodeNode": "240",
      "elk.layered.spacing.nodeNodeBetweenLayers": "320",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      "elk.padding": "[top=80,left=120,bottom=80,right=140]",
    },
    children: systemNodes.map((node) => ({
      id: node.id,
      width: 380,
      height: 320,
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

export function reconcileFlowState(currentNodes: Array<Node<FlowNodeData>>, currentEdges: Array<Edge>, nextNodes: Array<Node<FlowNodeData>>, nextEdges: Array<Edge>) {
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

export function buildCanvasPayload(taskId: string, nodes: Array<Node<FlowNodeData>>, edges: Array<Edge>, viewport: { x: number; y: number; zoom: number }, ui: CanvasUiState) {
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
  return stringifyBest(data?.card_summary, data?.summary, data?.method_summary, data?.abstract, data?.feedback_text) || "这个节点暂时还没有可展示的摘要。";
}

export function formatRunState(mode: TaskMode, runId: string, autoStatus: string, summary?: RunSummary | null) {
  if (mode === "openclaw_auto") {
    return `运行 ${runId || "未启动"} · ${autoStatusLabel(autoStatus)} · ${summary?.total || 0} 条事件`;
  }
  return `GPT Step · ${summary?.step_cards?.length || summary?.total || 0} 条步骤记录`;
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
  return Boolean(node.data?.isManual) || /^(note|question|reference|group|report|checkpoint):/.test(node.id);
}

export function selectedPaperNodes(nodes: Array<Node<FlowNodeData>>) {
  return nodes.filter((node) => Boolean(node.selected) && isPaperNode(node.id));
}

export function formatDateTime(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
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
