import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeChange, type ReactFlowInstance } from "@xyflow/react";
import { apiFetch } from "../lib/api";
import { AppShell } from "./components/AppShell";
import { CollectionDetailPanel } from "./components/CollectionDetailPanel";
import { ComparePanel } from "./components/ComparePanel";
import { ContextChatPanel } from "./components/ContextChatPanel";
import { DetailPanel } from "./components/DetailPanel";
import { PdfPanel } from "./components/PdfPanel";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { QuickActionBar } from "./components/QuickActionBar";
import { ResearchCanvas, buildManualConnection } from "./components/ResearchCanvas";
import { RunTimeline } from "./components/RunTimeline";
import { TaskProgress } from "./components/TaskProgress";
import { SectionTitle, SmallButton } from "./components/shared";
import { edgeCountLabel } from "./display";
import { useRunEvents } from "./hooks/useRunEvents";
import { deriveTaskProgress } from "./progress";
import type {
  ActionResponse,
  ActionStatus,
  Backend,
  CanvasResponse,
  CanvasUiState,
  ChatItem,
  ChatResponse,
  CollectionGraphResponse,
  CollectionSummary,
  CompareReport,
  ExportListResponse,
  ExportResponse,
  FlowNodeData,
  FulltextStatusResponse,
  GraphResponse,
  PaperAssetResponse,
  PaperDetail,
  ProjectDashboard,
  ProjectSummary,
  RoundCandidate,
  TaskMode,
  TaskSummary,
  TaskVenueMetricItem,
  TaskVenueMetricsResponse,
  WorkbenchConfig,
  ZoteroConfig,
  ZoteroImportResponse,
} from "./types";
import {
  buildCanvasPayload,
  canonicalGraphSignature,
  canvasPayloadSignature,
  defaultCanvasUi,
  inferRoundId,
  isPaperNode,
  mergeCanvasWithGraph,
  reconcileFlowState,
  runAutoLayout,
  selectedPaperNodes,
} from "./utils";

type ExportFormat = "md" | "bib" | "json" | "csljson";
type WorkbenchActionResult = ActionResponse & { candidates?: RoundCandidate[] };
type CanvasSavePayload = { taskId: string; payload: CanvasResponse };
type DetailTab = "info" | "chat";

type WorkbenchAction =
  | { type: "quick"; action: "plan" | "search_first" | "build_graph" | "build_fulltext" | "auto_start" }
  | { type: "search_direction"; directionIndex: number }
  | { type: "start_explore"; directionIndex: number }
  | { type: "build_graph"; directionIndex?: number; roundId?: number }
  | { type: "propose"; roundId: number; action: string; feedbackText: string }
  | { type: "select_candidate"; roundId: number; candidateId: number }
  | { type: "next_round"; roundId: number; intentText: string }
  | { type: "save_paper"; paperId: string }
  | { type: "summarize_paper"; paperId: string }
  | { type: "guidance"; text: string }
  | { type: "auto_continue" }
  | { type: "auto_cancel" };

const MANUAL_NODE_LABELS: Record<"note" | "question" | "reference" | "group" | "report", string> = {
  note: "新的笔记",
  question: "新的问题",
  reference: "新的参考",
  group: "新的分组",
  report: "新的报告",
};

function isTransientCanvasSaveError(cause: unknown) {
  const message = cause instanceof Error ? cause.message.toLowerCase() : String(cause).toLowerCase();
  return (
    message.includes("画布正在和后台研究结果同步") ||
    message.includes("节点问答正在和后台研究结果同步") ||
    message.includes("canvas_save_busy") ||
    message.includes("node_chat_busy") ||
    message.includes("database is locked")
  );
}

export function Workbench() {
  const client = useQueryClient();
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeCollectionId, setActiveCollectionId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [detailTab, setDetailTab] = useState<DetailTab>("info");
  const [runId, setRunId] = useState("");
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [uiState, setUiState] = useState<CanvasUiState>(defaultCanvasUi());
  const [pdfUrl, setPdfUrl] = useState("");
  const [chatByNode, setChatByNode] = useState<Record<string, ChatItem[]>>({});
  const [chatTargetNodeId, setChatTargetNodeId] = useState("");
  const [chatDraft, setChatDraft] = useState("");
  const [roundCandidates, setRoundCandidates] = useState<Record<number, RoundCandidate[]>>({});
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [compareReport, setCompareReport] = useState<CompareReport | null>(null);
  const [collectionSearchText, setCollectionSearchText] = useState("");
  const [collectionLimit, setCollectionLimit] = useState(50);
  const [selectedCollectionItemIds, setSelectedCollectionItemIds] = useState<number[]>([]);
  const [relayoutNonce, setRelayoutNonce] = useState(0);
  const flowRef = useRef<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null);
  const zoteroFileInputRef = useRef<HTMLInputElement | null>(null);
  const persistTimer = useRef<number | null>(null);
  const suppressViewportPersistRef = useRef(false);
  const interactionLockRef = useRef(false);
  const lastSavedCanvasSignature = useRef("");
  const pendingCanvasSignature = useRef("");
  const canvasRetryCountRef = useRef<Record<string, number>>({});
  const nodeChatRetryCountRef = useRef<Record<string, number>>({});
  const nodesRef = useRef<Array<Node<FlowNodeData>>>([]);
  const edgesRef = useRef<Array<Edge>>([]);
  const viewportRef = useRef(viewport);
  const layoutSignatureRef = useRef("");
  const lastTaskIdRef = useRef("");

  const configQuery = useQuery({
    queryKey: ["workbench-config"],
    queryFn: () => apiFetch<WorkbenchConfig>("/api/v1/research/workbench/config"),
  });

  const zoteroConfigQuery = useQuery({
    queryKey: ["zotero-config"],
    queryFn: () => apiFetch<ZoteroConfig>("/api/v1/research/integrations/zotero/config"),
  });

  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiFetch<{ items: ProjectSummary[]; total: number; default_project_id?: string | null }>("/api/v1/research/projects"),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!activeProjectId && projectsQuery.data?.default_project_id) {
      setActiveProjectId(projectsQuery.data.default_project_id);
      return;
    }
    if (!activeProjectId && projectsQuery.data?.items?.length) {
      setActiveProjectId(projectsQuery.data.items[0].project_id);
    }
  }, [activeProjectId, projectsQuery.data]);

  const dashboardQuery = useQuery({
    queryKey: ["project-dashboard", activeProjectId],
    queryFn: () => apiFetch<ProjectDashboard>(`/api/v1/research/projects/${activeProjectId}/dashboard`),
    enabled: Boolean(activeProjectId),
    refetchInterval: 5000,
  });

  const tasksQuery = useQuery({
    queryKey: ["tasks", activeProjectId],
    queryFn: () => apiFetch<{ items: TaskSummary[] }>(`/api/v1/research/tasks?limit=50&project_id=${encodeURIComponent(activeProjectId)}`),
    enabled: Boolean(activeProjectId),
    refetchInterval: 5000,
  });

  const collectionsQuery = useQuery({
    queryKey: ["collections", activeProjectId],
    queryFn: () => apiFetch<{ items: CollectionSummary[] }>(`/api/v1/research/projects/${activeProjectId}/collections`),
    enabled: Boolean(activeProjectId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!activeProjectId) return;
    const tasks = tasksQuery.data?.items || [];
    if (!tasks.length) {
      setActiveTaskId("");
      return;
    }
    if (!tasks.some((task) => task.task_id === activeTaskId)) {
      setActiveTaskId(tasks[0].task_id);
    }
  }, [activeProjectId, activeTaskId, tasksQuery.data]);

  useEffect(() => {
    if (!activeProjectId) return;
    const collections = collectionsQuery.data?.items || [];
    if (!collections.some((collection) => collection.collection_id === activeCollectionId)) {
      setActiveCollectionId("");
    }
  }, [activeCollectionId, activeProjectId, collectionsQuery.data]);

  useEffect(() => {
    setCollectionLimit(50);
    setCollectionSearchText("");
    setSelectedCollectionItemIds([]);
  }, [activeCollectionId]);

  const collectionDetailQuery = useQuery({
    queryKey: ["collection", activeCollectionId, collectionLimit],
    queryFn: () => apiFetch<CollectionSummary>(`/api/v1/research/collections/${activeCollectionId}?offset=0&limit=${collectionLimit}`),
    enabled: Boolean(activeCollectionId),
  });

  const collectionExportsQuery = useQuery({
    queryKey: ["collection-exports", activeCollectionId],
    queryFn: () => apiFetch<ExportListResponse>(`/api/v1/research/collections/${activeCollectionId}/exports`),
    enabled: Boolean(activeCollectionId),
    refetchInterval: 5000,
  });

  const taskQuery = useQuery({
    queryKey: ["task", activeTaskId],
    queryFn: () => apiFetch<TaskSummary>(`/api/v1/research/tasks/${activeTaskId}`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (taskQuery.data?.latest_run_id) {
      setRunId(taskQuery.data.latest_run_id);
    }
  }, [taskQuery.data?.latest_run_id]);

  const graphQuery = useQuery({
    queryKey: ["graph", activeTaskId],
    queryFn: () => apiFetch<GraphResponse>(`/api/v1/research/tasks/${activeTaskId}/graph?view=tree&include_papers=true&paper_limit=24`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  const canvasQuery = useQuery({
    queryKey: ["canvas", activeTaskId],
    queryFn: () => apiFetch<CanvasResponse>(`/api/v1/research/tasks/${activeTaskId}/canvas`),
    enabled: Boolean(activeTaskId),
  });

  const taskExportsQuery = useQuery({
    queryKey: ["task-exports", activeTaskId],
    queryFn: () => apiFetch<ExportListResponse>(`/api/v1/research/tasks/${activeTaskId}/exports`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  const fulltextStatusQuery = useQuery({
    queryKey: ["fulltext-status", activeTaskId],
    queryFn: () => apiFetch<FulltextStatusResponse>(`/api/v1/research/tasks/${activeTaskId}/fulltext/status`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  const venueMetricsQuery = useQuery({
    queryKey: ["venue-metrics", activeTaskId],
    queryFn: () => apiFetch<TaskVenueMetricsResponse>(`/api/v1/research/tasks/${activeTaskId}/venues/metrics`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 30000,
  });

  const activeTask = taskQuery.data || null;
  const eventsState = useRunEvents({
    taskId: activeTaskId,
    runId,
    enabled: Boolean(activeTaskId && runId),
    intervalMs: activeTask?.mode === "openclaw_auto" ? 3000 : 4000,
  });
  const taskProgress = useMemo(() => deriveTaskProgress(activeTask, eventsState.summary, eventsState.items), [activeTask, eventsState.items, eventsState.summary]);

  const merged = useMemo(
    () => mergeCanvasWithGraph(graphQuery.data, canvasQuery.data, eventsState.items, configQuery.data?.default_canvas_ui || defaultCanvasUi()),
    [graphQuery.data, canvasQuery.data, configQuery.data?.default_canvas_ui, eventsState.items],
  );
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
    viewportRef.current = viewport;
  }, [edges, nodes, viewport]);

  useEffect(() => {
    if (!canvasQuery.data) return;
    lastSavedCanvasSignature.current = canvasPayloadSignature(canvasQuery.data);
    if (pendingCanvasSignature.current === lastSavedCanvasSignature.current) {
      pendingCanvasSignature.current = "";
    }
    setUiState({ ...defaultCanvasUi(), ...(canvasQuery.data.ui || {}) });
    setViewport(canvasQuery.data.viewport);
  }, [canvasQuery.data]);

  useEffect(() => {
    const preservePositions = interactionLockRef.current || Boolean(pendingCanvasSignature.current);
    const incomingNodes = preservePositions
      ? merged.nodes.map((node) => {
          const current = nodesRef.current.find((item) => item.id === node.id);
          if (!current) return node;
          return { ...node, position: current.position };
        })
      : merged.nodes;
    const reconciled = reconcileFlowState(nodesRef.current, edgesRef.current, incomingNodes, merged.edges);
    setNodes(reconciled.nodes);
    setEdges(reconciled.edges);
    if (!interactionLockRef.current && !pendingCanvasSignature.current && !isSameViewport(viewportRef.current, merged.viewport)) {
      setViewport(merged.viewport);
      if (flowRef.current) {
        suppressViewportPersistRef.current = true;
        flowRef.current.setViewport(merged.viewport, { duration: 120 });
      }
    }
  }, [merged, setEdges, setNodes]);

  const canonicalSignature = useMemo(() => canonicalGraphSignature(graphQuery.data, eventsState.items), [graphQuery.data, eventsState.items]);
  const canvasReady = canvasQuery.isFetched;
  const hasSavedSystemLayout = useMemo(
    () => Boolean(canvasQuery.data?.nodes?.some((node) => !/^(note|question|reference|group|report|checkpoint):/.test(node.id))),
    [canvasQuery.data?.nodes],
  );

  useEffect(() => {
    if (!activeTaskId || !canvasReady || !nodesRef.current.length || interactionLockRef.current) return;
    const shouldRelayout = relayoutNonce > 0 || !hasSavedSystemLayout;
    if (!shouldRelayout) return;
    const signature = `${activeTaskId}:${canonicalSignature}:${uiState.layout_mode}:${relayoutNonce}`;
    if (layoutSignatureRef.current === signature) return;
    let canceled = false;
    runAutoLayout(nodesRef.current, edgesRef.current, uiState.layout_mode)
      .then((positions) => {
        if (canceled || !positions.size) return;
        const nextNodes = nodesRef.current.map((node) => {
          if (node.data?.isManual) return node;
          const position = positions.get(node.id);
          if (!position) return node;
          return { ...node, position };
        });
        layoutSignatureRef.current = signature;
        setNodes(nextNodes);
        queueSave(nextNodes, edgesRef.current, viewportRef.current, uiState);
        if (flowRef.current && (!hasSavedSystemLayout || relayoutNonce > 0)) {
          suppressViewportPersistRef.current = true;
          window.setTimeout(() => {
            flowRef.current?.fitView({ duration: 180, padding: 0.14 });
          }, 40);
        }
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [activeTaskId, canvasReady, canonicalSignature, hasSavedSystemLayout, relayoutNonce, setNodes, uiState]);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    if (chatTargetNodeId && !nodes.some((node) => node.id === chatTargetNodeId)) {
      setChatTargetNodeId("");
      setChatDraft("");
    }
  }, [chatTargetNodeId, nodes]);

  useEffect(() => {
    if (activeTaskId === lastTaskIdRef.current) return;
    lastTaskIdRef.current = activeTaskId;
    setActiveCollectionId("");
    setSelectedNodeId("");
    setDetailTab("info");
    setPdfUrl("");
    setChatByNode({});
    setChatTargetNodeId("");
    setChatDraft("");
    setRoundCandidates({});
    setCompareReport(null);
    setCollectionSearchText("");
    setCollectionLimit(50);
    setSelectedCollectionItemIds([]);
    layoutSignatureRef.current = "";
    lastSavedCanvasSignature.current = "";
    pendingCanvasSignature.current = "";
    canvasRetryCountRef.current = {};
    nodeChatRetryCountRef.current = {};
  }, [activeTaskId]);

  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        window.clearTimeout(persistTimer.current);
      }
    };
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedPaperId = selectedNode?.id && isPaperNode(selectedNode.id, selectedNode.data) ? selectedNode.id : "";
  const selectedPaperCount = useMemo(() => selectedPaperNodes(nodes).length, [nodes]);
  const selectedFulltextItem = useMemo(
    () => fulltextStatusQuery.data?.items.find((item) => item.paper_id === selectedPaperId) || null,
    [fulltextStatusQuery.data?.items, selectedPaperId],
  );

  useEffect(() => {
    setPdfUrl("");
  }, [selectedPaperId]);

  const paperDetailQuery = useQuery({
    queryKey: ["paper-detail", activeTaskId, selectedPaperId],
    queryFn: () => apiFetch<PaperDetail>(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(selectedPaperId)}`),
    enabled: Boolean(activeTaskId && selectedPaperId),
  });

  const paperAssetQuery = useQuery({
    queryKey: ["paper-assets", activeTaskId, selectedPaperId],
    queryFn: () => apiFetch<PaperAssetResponse>(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(selectedPaperId)}/asset/meta`),
    enabled: Boolean(activeTaskId && selectedPaperId),
  });

  function resolveBrowserUrl(url?: string | null) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return new URL(url, window.location.origin).toString();
  }

  function openExternalUrl(url?: string | null) {
    const nextUrl = resolveBrowserUrl(url);
    if (!nextUrl) return false;
    window.open(nextUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  function downloadExternalUrl(url?: string | null, filename?: string | null) {
    const nextUrl = resolveBrowserUrl(url);
    if (!nextUrl) return false;
    const anchor = document.createElement("a");
    anchor.href = nextUrl;
    anchor.rel = "noreferrer";
    if (filename) {
      anchor.download = filename;
    }
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    return true;
  }

  const chatHistoryQuery = useQuery({
    queryKey: ["node-chat-history", activeTaskId, chatTargetNodeId],
    queryFn: () => apiFetch<ChatResponse>(`/api/v1/research/tasks/${activeTaskId}/nodes/${encodeURIComponent(chatTargetNodeId)}/chat`),
    enabled: Boolean(activeTaskId && chatTargetNodeId),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!chatTargetNodeId || !chatHistoryQuery.data) return;
    setChatByNode((current) => {
      const nextHistory = chatHistoryQuery.data?.history || [];
      const existing = current[chatTargetNodeId] || [];
      if (JSON.stringify(existing) === JSON.stringify(nextHistory)) {
        return current;
      }
      return { ...current, [chatTargetNodeId]: nextHistory };
    });
  }, [chatHistoryQuery.data, chatTargetNodeId]);

  const saveCanvas = useMutation({
    mutationFn: ({ taskId, payload }: CanvasSavePayload) =>
      apiFetch<CanvasResponse>(`/api/v1/research/tasks/${taskId}/canvas`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (data, variables) => {
      lastSavedCanvasSignature.current = canvasPayloadSignature(data);
      pendingCanvasSignature.current = "";
      delete canvasRetryCountRef.current[canvasPayloadSignature(variables.payload)];
      client.setQueryData(["canvas", variables.taskId], data);
    },
    onError: (cause, variables) => {
      const signature = canvasPayloadSignature(variables.payload);
      const retryCount = canvasRetryCountRef.current[signature] || 0;
      pendingCanvasSignature.current = "";
      if (isTransientCanvasSaveError(cause)) {
        if (variables.taskId === activeTaskId && retryCount < 2) {
          canvasRetryCountRef.current[signature] = retryCount + 1;
          window.setTimeout(() => {
            if (variables.taskId !== activeTaskId) return;
            pendingCanvasSignature.current = signature;
            saveCanvas.mutate(variables);
          }, 1200 * (retryCount + 1));
        }
        setActionStatus({ tone: "warning", text: "后台正在同步研究结果，画布会自动重试保存。" });
        return;
      }
      delete canvasRetryCountRef.current[signature];
      setActionStatus({ tone: "warning", text: cause instanceof Error ? `画布保存失败：${cause.message}` : "画布保存失败" });
    },
  });

  function queueSave(
    nextNodes: Array<Node<FlowNodeData>>,
    nextEdges: Array<Edge>,
    nextViewport = viewportRef.current,
    nextUi = uiState,
  ) {
    if (!activeTaskId) return;
    const payload = buildCanvasPayload(activeTaskId, nextNodes, nextEdges, nextViewport, nextUi) as CanvasResponse;
    const signature = canvasPayloadSignature(payload);
    if (signature === lastSavedCanvasSignature.current || signature === pendingCanvasSignature.current) {
      return;
    }
    if (persistTimer.current) {
      window.clearTimeout(persistTimer.current);
    }
    pendingCanvasSignature.current = signature;
    persistTimer.current = window.setTimeout(() => {
      saveCanvas.mutate({ taskId: activeTaskId, payload });
    }, 450);
  }

  const createProject = useMutation({
    mutationFn: (payload: { name: string; description: string }) =>
      apiFetch<ProjectSummary>("/api/v1/research/projects", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (project) => {
      setActiveProjectId(project.project_id);
      setActionStatus({ tone: "success", text: `已创建项目：${project.name}` });
      client.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const createCollection = useMutation({
    mutationFn: (payload: { name: string; description: string }) =>
      apiFetch<CollectionSummary>(`/api/v1/research/projects/${activeProjectId}/collections`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (collection) => {
      setActiveCollectionId(collection.collection_id);
      setActionStatus({ tone: "success", text: `已创建 Collection：${collection.name}` });
      client.invalidateQueries({ queryKey: ["collections", activeProjectId] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const createTask = useMutation({
    mutationFn: (payload: { topic: string; mode: TaskMode; llm_backend: Backend; llm_model: string }) =>
      apiFetch<TaskSummary>("/api/v1/research/tasks", {
        method: "POST",
        body: JSON.stringify({ ...payload, project_id: activeProjectId }),
      }),
    onSuccess: (task) => {
      setActiveProjectId(task.project_id || activeProjectId);
      setActiveTaskId(task.task_id);
      setSelectedNodeId("");
      setRunId(task.latest_run_id || "");
      setPdfUrl("");
      setChatByNode({});
      setRoundCandidates({});
      setCompareReport(null);
      setActionStatus({ tone: "success", text: `已创建任务：${task.topic}` });
      client.invalidateQueries({ queryKey: ["tasks", activeProjectId] });
      client.invalidateQueries({ queryKey: ["projects"] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const addItemsToCollection = useMutation({
    mutationFn: async (payload: { collectionId: string; items: Array<{ task_id: string; paper_id: string }> }) =>
      apiFetch<CollectionSummary>(`/api/v1/research/collections/${payload.collectionId}/items`, {
        method: "POST",
        body: JSON.stringify({ items: payload.items }),
      }),
    onSuccess: (collection) => {
      setActiveCollectionId(collection.collection_id);
      setActionStatus({ tone: "success", text: `已加入 Collection：${collection.name}` });
      client.invalidateQueries({ queryKey: ["collections", activeProjectId] });
      client.invalidateQueries({ queryKey: ["collection", collection.collection_id] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const removeCollectionItems = useMutation({
    mutationFn: async (payload: { collectionId: string; itemIds: number[] }) =>
      apiFetch<CollectionSummary>(`/api/v1/research/collections/${payload.collectionId}/items/remove`, {
        method: "POST",
        body: JSON.stringify({ item_ids: payload.itemIds }),
      }),
    onSuccess: (collection) => {
      setSelectedCollectionItemIds([]);
      setActionStatus({ tone: "success", text: `已从 Collection 中移除 ${collection.item_count >= 0 ? "所选条目" : ""}` });
      client.invalidateQueries({ queryKey: ["collection", collection.collection_id] });
      client.invalidateQueries({ queryKey: ["collections", activeProjectId] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const createStudyFromCollection = useMutation({
    mutationFn: async (payload: { collectionId: string; topic?: string }) =>
      apiFetch<TaskSummary>(`/api/v1/research/collections/${payload.collectionId}/study`, {
        method: "POST",
        body: JSON.stringify({ topic: payload.topic }),
      }),
    onSuccess: (task) => {
      setActiveTaskId(task.task_id);
      setActiveProjectId(task.project_id || activeProjectId);
      setActionStatus({ tone: "success", text: `已基于 Collection 创建派生任务：${task.topic}` });
      client.invalidateQueries({ queryKey: ["tasks", activeProjectId] });
      client.invalidateQueries({ queryKey: ["projects"] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const summarizeCollection = useMutation({
    mutationFn: async (collectionId: string) =>
      apiFetch<{ summary_text: string }>(`/api/v1/research/collections/${collectionId}/summarize`, { method: "POST" }),
    onSuccess: (_data, collectionId) => {
      setActionStatus({ tone: "success", text: "已生成集合摘要" });
      client.invalidateQueries({ queryKey: ["collection", collectionId] });
      client.invalidateQueries({ queryKey: ["collections", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const buildCollectionGraph = useMutation({
    mutationFn: async (collectionId: string) =>
      apiFetch<CollectionGraphResponse>(`/api/v1/research/collections/${collectionId}/graph/build`, { method: "POST" }),
    onSuccess: () => {
      setActionStatus({ tone: "success", text: "集合图谱已生成" });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const compareCollection = useMutation({
    mutationFn: async (payload: { collectionId: string; focus?: string }) =>
      apiFetch<CompareReport>(`/api/v1/research/collections/${payload.collectionId}/compare`, {
        method: "POST",
        body: JSON.stringify({ focus: payload.focus || null }),
      }),
    onSuccess: (report) => {
      setCompareReport(report);
      setActionStatus({ tone: "success", text: "Collection compare 已生成" });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const compareTaskPapers = useMutation({
    mutationFn: async (payload: { paperIds: string[]; focus?: string }) =>
      apiFetch<CompareReport>(`/api/v1/research/tasks/${activeTaskId}/papers/compare`, {
        method: "POST",
        body: JSON.stringify({ paper_ids: payload.paperIds, focus: payload.focus || null }),
      }),
    onSuccess: (report) => {
      setCompareReport(report);
      setActionStatus({ tone: "success", text: "论文对比已生成" });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const importZoteroLocal = useMutation({
    mutationFn: async (payload: { file: File; collectionName?: string }) => {
      const form = new FormData();
      form.append("file", payload.file);
      if (activeProjectId) {
        form.append("project_id", activeProjectId);
      }
      if (payload.collectionName?.trim()) {
        form.append("collection_name", payload.collectionName.trim());
      }
      return apiFetch<ZoteroImportResponse>("/api/v1/research/integrations/zotero/import-local", {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (data) => {
      const nextProjectId = data.project_id || activeProjectId;
      setActiveProjectId(nextProjectId);
      setActiveCollectionId(data.collection.collection_id);
      setActionStatus({
        tone: "success",
        text: `已导入 Zotero 文件：${data.collection.name}（导入 ${data.imported_items}，去重 ${data.deduped_items}）`,
      });
      client.invalidateQueries({ queryKey: ["collections", nextProjectId] });
      client.invalidateQueries({ queryKey: ["project-dashboard", nextProjectId] });
      client.invalidateQueries({ queryKey: ["projects"] });
      client.invalidateQueries({ queryKey: ["zotero-config"] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const exportTask = useMutation({
    mutationFn: async (format: ExportFormat) =>
      apiFetch<ExportResponse>(`/api/v1/research/tasks/${activeTaskId}/export?format=${format}`),
    onSuccess: (data, format) => {
      const filename = data.filename || `${activeTaskId}.${format}`;
      setActionStatus({ tone: "success", text: `${format.toUpperCase()} 导出已生成：${filename}。可在右侧导出历史中打开或下载。` });
      client.invalidateQueries({ queryKey: ["task-exports", activeTaskId] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const exportCollection = useMutation({
    mutationFn: async (payload: { collectionId: string; format: "bib" | "csljson" }) =>
      apiFetch<ExportResponse>(`/api/v1/research/collections/${payload.collectionId}/export?format=${payload.format}`),
    onSuccess: (data, payload) => {
      const filename = data.filename || `${payload.collectionId}.${payload.format}`;
      setActionStatus({ tone: "success", text: `Collection ${payload.format.toUpperCase()} 导出已生成：${filename}。可在右侧导出历史中打开或下载。` });
      client.invalidateQueries({ queryKey: ["collection-exports", payload.collectionId] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const uploadPdf = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(selectedPaperId)}/pdf/upload`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: () => {
      setActionStatus({ tone: "success", text: "PDF 上传并解析完成" });
      client.invalidateQueries({ queryKey: ["paper-assets", activeTaskId, selectedPaperId] });
      client.invalidateQueries({ queryKey: ["paper-detail", activeTaskId, selectedPaperId] });
      client.invalidateQueries({ queryKey: ["fulltext-status", activeTaskId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const rebuildPaperVisual = useMutation({
    mutationFn: async () => {
      if (!activeTaskId || !selectedPaperId) throw new Error("请先选择论文节点");
      return apiFetch<PaperAssetResponse>(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(selectedPaperId)}/visual/build`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      setActionStatus({ tone: "success", text: "论文主图 / 展示图已重建" });
      client.invalidateQueries({ queryKey: ["paper-assets", activeTaskId, selectedPaperId] });
      client.invalidateQueries({ queryKey: ["paper-detail", activeTaskId, selectedPaperId] });
      client.invalidateQueries({ queryKey: ["graph", activeTaskId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const workbenchAction = useMutation({
    mutationFn: async (action: WorkbenchAction) => {
      if (!activeTaskId) throw new Error("请先选择任务");
      switch (action.type) {
        case "quick":
          if (action.action === "plan") {
            return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/plan`, { method: "POST" });
          }
          if (action.action === "search_first") {
            return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/search`, {
              method: "POST",
              body: JSON.stringify({ direction_index: 1, top_n: 12 }),
            });
          }
          if (action.action === "build_graph") {
            return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/graph/build`, {
              method: "POST",
              body: JSON.stringify({ view: "tree" }),
            });
          }
          if (action.action === "build_fulltext") {
            return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/fulltext/build`, { method: "POST" });
          }
          if (action.action === "auto_start") {
            return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/auto/start`, { method: "POST" });
          }
          return null;
        case "search_direction":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/search`, {
            method: "POST",
            body: JSON.stringify({ direction_index: action.directionIndex, top_n: 12 }),
          });
        case "start_explore":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/explore/start`, {
            method: "POST",
            body: JSON.stringify({ direction_index: action.directionIndex, top_n: 8 }),
          });
        case "build_graph":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/graph/build`, {
            method: "POST",
            body: JSON.stringify({
              view: action.roundId ? "citation" : "tree",
              direction_index: action.directionIndex,
              round_id: action.roundId,
            }),
          });
        case "propose":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/explore/rounds/${action.roundId}/propose`, {
            method: "POST",
            body: JSON.stringify({ action: action.action, feedback_text: action.feedbackText, candidate_count: 4 }),
          });
        case "select_candidate":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/explore/rounds/${action.roundId}/select`, {
            method: "POST",
            body: JSON.stringify({ candidate_id: action.candidateId, top_n: 8 }),
          });
        case "next_round":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/explore/rounds/${action.roundId}/next`, {
            method: "POST",
            body: JSON.stringify({ intent_text: action.intentText, top_n: 8 }),
          });
        case "save_paper":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(action.paperId)}/save`, {
            method: "POST",
            body: JSON.stringify({}),
          });
        case "summarize_paper":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(action.paperId)}/summarize`, {
            method: "POST",
          });
        case "guidance":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/guidance`, {
            method: "POST",
            body: JSON.stringify({ text: action.text }),
          });
        case "auto_continue":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/continue`, { method: "POST" });
        case "auto_cancel":
          return apiFetch<WorkbenchActionResult>(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/cancel`, { method: "POST" });
        default:
          return null;
      }
    },
    onSuccess: (data, action) => {
      if (action.type === "quick" && action.action === "auto_start" && data?.run_id) {
        setRunId(String(data.run_id || ""));
      }
      if (action.type === "propose" && data?.candidates) {
        setRoundCandidates((current) => ({ ...current, [action.roundId]: data.candidates || [] }));
      }
      if (activeTask?.mode === "gpt_step") {
        setRunId(`step-${activeTaskId}`);
      }
      setActionStatus(resolveActionStatus(action, data));
      client.invalidateQueries({ queryKey: ["tasks", activeProjectId] });
      client.invalidateQueries({ queryKey: ["task", activeTaskId] });
      client.invalidateQueries({ queryKey: ["graph", activeTaskId] });
      client.invalidateQueries({ queryKey: ["paper-detail", activeTaskId, selectedPaperId] });
      client.invalidateQueries({ queryKey: ["paper-assets", activeTaskId, selectedPaperId] });
      client.invalidateQueries({ queryKey: ["fulltext-status", activeTaskId] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const nodeChat = useMutation({
    mutationFn: (payload: { nodeId: string; question: string; threadId?: string }) =>
      apiFetch<ChatResponse>(`/api/v1/research/tasks/${activeTaskId}/nodes/${encodeURIComponent(payload.nodeId)}/chat`, {
        method: "POST",
        body: JSON.stringify({ question: payload.question, thread_id: payload.threadId }),
      }),
    onSuccess: (data) => {
      setChatByNode((current) => ({ ...current, [data.node_id]: data.history }));
      const latest = data.history[data.history.length - 1] || data.item || null;
      if (latest) {
        delete nodeChatRetryCountRef.current[`${data.node_id}:${latest.question}:${latest.thread_id || ""}`];
      }
      const target = nodesRef.current.find((node) => node.id === data.node_id);
      if (latest && target?.data?.isManual && target.data.type === "question") {
        const nextNodes = nodesRef.current.map((node) =>
          node.id === data.node_id
            ? {
                ...node,
                data: {
                  ...node.data,
                  label: latest.question.slice(0, 28) || node.data.label,
                  summary: `问题：${latest.question}\n\n回答：${latest.answer}`,
                },
              }
            : node,
        );
        setNodes(nextNodes);
        queueSave(nextNodes, edgesRef.current);
      }
      setActionStatus({ tone: "neutral", text: "节点问答已更新" });
      client.invalidateQueries({ queryKey: ["node-chat-history", activeTaskId, data.node_id] });
    },
    onError: (cause, variables) => {
      if (isTransientCanvasSaveError(cause)) {
        const key = `${variables.nodeId}:${variables.question}:${variables.threadId || ""}`;
        const retryCount = nodeChatRetryCountRef.current[key] || 0;
        if (retryCount < 2) {
          nodeChatRetryCountRef.current[key] = retryCount + 1;
          setActionStatus({ tone: "warning", text: "后台正在同步研究结果，节点问答会自动重试。" });
          window.setTimeout(() => nodeChat.mutate(variables), 1200 * (retryCount + 1));
        } else {
          delete nodeChatRetryCountRef.current[key];
          setActionStatus({ tone: "warning", text: "后台仍在同步，请稍后再问一次。" });
        }
        return;
      }
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  function addManualNode(type: "note" | "question" | "reference" | "group" | "report", summary?: string, label?: string) {
    const id = `${type}:${Math.random().toString(16).slice(2, 10)}`;
    const nextNodes = [
      ...nodesRef.current,
      {
        id,
        type: "cardNode",
        position: { x: 320 + nodesRef.current.length * 18, y: 220 + nodesRef.current.length * 14 },
        sourcePosition: "right",
        targetPosition: "left",
        data: {
          id,
          type,
          label: label || MANUAL_NODE_LABELS[type],
          summary: summary || "这是一个手工工作台节点，可用于整理思路、记录问题、沉淀阶段总结或挂接参考资料。",
          isManual: true,
        },
      } as Node<FlowNodeData>,
    ];
    setNodes(nextNodes);
    queueSave(nextNodes, edgesRef.current);
  }

  function applyHiddenEdgeVisibility(nextNodes: Array<Node<FlowNodeData>>, sourceEdges: Array<Edge>) {
    const hiddenNodeIds = new Set(nextNodes.filter((node) => Boolean(node.hidden)).map((node) => node.id));
    return sourceEdges.map((edge) => {
      const nextHidden = hiddenNodeIds.has(edge.source) || hiddenNodeIds.has(edge.target);
      if (Boolean(edge.hidden) === nextHidden) return edge;
      return { ...edge, hidden: nextHidden };
    });
  }

  function updateSelectedNote(note: string) {
    const nextNodes = nodesRef.current.map((node) => (node.id === selectedNodeId ? { ...node, data: { ...node.data, userNote: note } } : node));
    setNodes(nextNodes);
    queueSave(nextNodes, edgesRef.current);
  }

  function toggleSelectedHidden() {
    if (!selectedNodeId) return;
    const nextNodes = nodesRef.current.map((node) => (node.id === selectedNodeId ? { ...node, hidden: !node.hidden } : node));
    const nextEdges = applyHiddenEdgeVisibility(nextNodes, edgesRef.current);
    setNodes(nextNodes);
    setEdges(nextEdges);
    queueSave(nextNodes, nextEdges);
  }

  function deleteSelectedNode() {
    if (!selectedNodeId) return;
    const target = nodesRef.current.find((node) => node.id === selectedNodeId);
    if (!target) return;
    if (!target.data?.isManual) {
      const nextNodes = nodesRef.current.map((node) => (node.id === selectedNodeId ? { ...node, hidden: true } : node));
      const nextEdges = applyHiddenEdgeVisibility(nextNodes, edgesRef.current);
      setSelectedNodeId("");
      setNodes(nextNodes);
      setEdges(nextEdges);
      queueSave(nextNodes, nextEdges);
      setActionStatus({ tone: "success", text: "系统节点已从画布隐藏；研究数据仍然保留，可从画布状态中恢复。" });
      return;
    }
    const nextNodes = nodesRef.current.filter((node) => node.id !== selectedNodeId);
    const nextEdges = edgesRef.current.filter(
      (edge) =>
        edge.source !== selectedNodeId &&
        edge.target !== selectedNodeId,
    );
    setSelectedNodeId("");
    setNodes(nextNodes);
    setEdges(nextEdges);
    queueSave(nextNodes, nextEdges);
    setActionStatus({ tone: "success", text: "已删除手工节点。" });
  }

  function handleNodesChange(changes: NodeChange<Node<FlowNodeData>>[]) {
    const removedIds = changes.filter((change) => change.type === "remove").map((change) => change.id);
    if (!removedIds.length) {
      onNodesChangeBase(changes);
      return;
    }

    const removed = new Set(removedIds);
    const manualIds = new Set(nodesRef.current.filter((node) => removed.has(node.id) && node.data?.isManual).map((node) => node.id));
    const systemIds = new Set(nodesRef.current.filter((node) => removed.has(node.id) && !node.data?.isManual).map((node) => node.id));
    const nonRemoveChanges = changes.filter((change) => change.type !== "remove");
    if (nonRemoveChanges.length) {
      onNodesChangeBase(nonRemoveChanges);
    }

    const nextNodes = nodesRef.current
      .filter((node) => !manualIds.has(node.id))
      .map((node) => (systemIds.has(node.id) ? { ...node, hidden: true } : node));
    const nextEdges = applyHiddenEdgeVisibility(
      nextNodes,
      edgesRef.current.filter((edge) => !manualIds.has(edge.source) && !manualIds.has(edge.target)),
    );
    setSelectedNodeId("");
    setNodes(nextNodes);
    setEdges(nextEdges);
    queueSave(nextNodes, nextEdges);
    if (systemIds.size && manualIds.size) {
      setActionStatus({ tone: "success", text: "手工节点已删除，系统节点已隐藏。" });
    } else if (systemIds.size) {
      setActionStatus({ tone: "success", text: "系统节点已从画布隐藏；研究数据仍然保留。" });
    } else {
      setActionStatus({ tone: "success", text: "已删除手工节点。" });
    }
  }

  function saveChatAnswerAsNode(kind: "note" | "question" | "reference" | "report", item: ChatItem) {
    const label =
      kind === "note"
        ? "问答笔记"
        : kind === "question"
          ? "问答问题"
          : kind === "reference"
            ? "问答参考"
            : "问答报告";
    addManualNode(kind, item.answer, label);
    setActionStatus({ tone: "success", text: `已将问答结果保存为${kind === "report" ? "报告" : "手工"}节点` });
  }

  function saveCompareAsNode(kind: "note" | "report") {
    if (!compareReport) return;
    addManualNode(
      kind,
      `${compareReport.overview}\n\n共同点：\n- ${compareReport.common_points.join("\n- ")}\n\n差异点：\n- ${compareReport.differences.join("\n- ")}\n\n建议下一步：\n- ${compareReport.recommended_next_steps.join("\n- ")}`,
      compareReport.title,
    );
    setActionStatus({ tone: "success", text: `已将 compare 结果保存为${kind === "report" ? "报告" : "笔记"}节点` });
  }

  async function ensureCollectionForSelection() {
    if (activeCollectionId) return activeCollectionId;
    const created = await createCollection.mutateAsync({ name: `选中文献 ${new Date().toLocaleTimeString()}`, description: "" });
    return created.collection_id;
  }

  async function handleAddSelectionToCollection() {
    if (!activeTaskId) return;
    const selected = selectedPaperNodes(nodesRef.current);
    if (!selected.length) {
      setActionStatus({ tone: "warning", text: "请先框选或多选论文节点，再加入 Collection。" });
      return;
    }
    const collectionId = await ensureCollectionForSelection();
    await addItemsToCollection.mutateAsync({
      collectionId,
      items: selected.map((node) => ({ task_id: activeTaskId, paper_id: node.id })),
    });
  }

  async function handleCreateStudyFromSelection() {
    if (!activeTaskId) return;
    const selected = selectedPaperNodes(nodesRef.current);
    if (!selected.length) {
      setActionStatus({ tone: "warning", text: "请先框选或多选论文节点，再派生研究任务。" });
      return;
    }
    const collectionId = await ensureCollectionForSelection();
    await addItemsToCollection.mutateAsync({
      collectionId,
      items: selected.map((node) => ({ task_id: activeTaskId, paper_id: node.id })),
    });
    await createStudyFromCollection.mutateAsync({ collectionId, topic: `${activeTask?.topic || "选中文献"} 派生研究` });
  }

  async function handleCompareSelection() {
    const selected = selectedPaperNodes(nodesRef.current);
    if (selected.length < 2) {
      setActionStatus({ tone: "warning", text: "请至少选中两篇论文再做对比" });
      return;
    }
    await compareTaskPapers.mutateAsync({ paperIds: selected.map((node) => node.id) });
  }

  const selectedRoundCandidates = useMemo(() => {
    const roundId = inferRoundId(selectedNode?.id || "", selectedNode?.data);
    return roundId ? roundCandidates[roundId] || [] : [];
  }, [roundCandidates, selectedNode?.data, selectedNode?.id]);

  const activeCollection = collectionDetailQuery.data || null;
  const chatTargetNode = useMemo(
    () => nodes.find((node) => node.id === chatTargetNodeId) || null,
    [chatTargetNodeId, nodes],
  );
  const chatTargetHistory = useMemo(
    () => (chatTargetNode ? chatByNode[chatTargetNode.id] || [] : []),
    [chatByNode, chatTargetNode],
  );
  const chatTargetOptions = useMemo(
    () =>
      nodes
        .filter((node) => !node.hidden)
        .map((node) => ({
          id: node.id,
          label: `${String(node.data?.label || node.id)} · ${String(node.data?.type || "node")}`,
          type: String(node.data?.type || ""),
        }))
        .sort((left, right) => left.label.localeCompare(right.label, "zh-CN")),
    [nodes],
  );

  return (
    <>
      <input
        ref={zoteroFileInputRef}
        type="file"
        accept=".json,.csljson,.bib"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          const baseName = file.name.replace(/\.[^.]+$/, "");
          const customName = window.prompt("Collection 名称（可选，留空默认使用文件名）", baseName) || "";
          importZoteroLocal.mutate({ file, collectionName: customName.trim() || undefined });
        }}
      />
      <AppShell
      leftCollapsed={uiState.left_sidebar_collapsed}
      rightCollapsed={uiState.right_sidebar_collapsed}
      leftWidth={uiState.left_sidebar_width}
      rightWidth={uiState.right_sidebar_width}
      onToggleLeft={() => {
        const next = { ...uiState, left_sidebar_collapsed: !uiState.left_sidebar_collapsed };
        setUiState(next);
        queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
      }}
      onToggleRight={() => {
        const next = { ...uiState, right_sidebar_collapsed: !uiState.right_sidebar_collapsed };
        setUiState(next);
        queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
      }}
      onResizeLeft={(width) => {
        const next = { ...uiState, left_sidebar_width: width };
        setUiState(next);
        queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
      }}
      onResizeRight={(width) => {
        const next = { ...uiState, right_sidebar_width: width };
        setUiState(next);
        queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
      }}
      sidebar={
        <ProjectSidebar
          config={configQuery.data || null}
          dashboard={dashboardQuery.data || null}
          zoteroConfig={zoteroConfigQuery.data || null}
          projects={projectsQuery.data?.items || []}
          tasks={tasksQuery.data?.items || []}
          collections={collectionsQuery.data?.items || []}
          activeProjectId={activeProjectId}
          activeTaskId={activeTaskId}
          activeCollectionId={activeCollectionId}
          activeTask={activeTask}
          onSelectProject={(projectId) => {
            setActiveProjectId(projectId);
            setActiveTaskId("");
            setRunId("");
            setActiveCollectionId("");
            setSelectedNodeId("");
            setDetailTab("info");
            setPdfUrl("");
            setChatByNode({});
            setChatTargetNodeId("");
            setChatDraft("");
            setRoundCandidates({});
            setCompareReport(null);
            setCollectionSearchText("");
            setCollectionLimit(50);
            setSelectedCollectionItemIds([]);
            layoutSignatureRef.current = "";
            setActionStatus(null);
          }}
          onSelectTask={(taskId) => {
            if (taskId === activeTaskId) {
              setActiveCollectionId("");
              setSelectedNodeId("");
              setDetailTab("info");
              setPdfUrl("");
              setActionStatus({ tone: "neutral", text: "已切回当前任务视图" });
              return;
            }
            setActiveTaskId(taskId);
            setActiveCollectionId("");
            setSelectedNodeId("");
            setDetailTab("info");
            setPdfUrl("");
            setChatByNode({});
            setChatTargetNodeId("");
            setChatDraft("");
            setRoundCandidates({});
            setCompareReport(null);
            setCollectionSearchText("");
            setCollectionLimit(50);
            setSelectedCollectionItemIds([]);
            layoutSignatureRef.current = "";
            setActionStatus(null);
          }}
          onSelectCollection={(collectionId) => {
            setActiveCollectionId(collectionId);
            setSelectedNodeId("");
          }}
          onCreateProject={(payload) => createProject.mutate(payload)}
          onCreateCollection={(payload) => createCollection.mutate(payload)}
          onCreateTask={(payload) => createTask.mutate(payload)}
          onQuickAction={(action) => workbenchAction.mutate({ type: "quick", action })}
          onImportZoteroFile={() => zoteroFileInputRef.current?.click()}
        />
      }
      canvas={
        <main className="relative flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.06),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.05),transparent_20%),linear-gradient(to_bottom,white,white)]">
          <div className="shrink-0 border-b border-slate-200 px-6 py-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Research Canvas</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">卡片式研究画布</div>
                <div className="mt-1 text-sm text-slate-500">
                  {activeTask ? `${activeTask.topic} · ${merged.nodes.length} 个节点 / ${edgeCountLabel(merged.edges)}` : "请选择任务，或先在左侧创建一个新的研究任务。"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  系统节点来自 canonical graph，手工节点与手工连线只写入 canvas state。多选论文卡片后可以直接加入 Collection 或做 Compare。
                </div>
                {actionStatus ? <ActionBanner status={actionStatus} /> : null}
              </div>
              <div className="flex items-center gap-2">
                <button
                  className={`rounded-full border px-3 py-1 text-xs ${uiState.show_minimap ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}
                  onClick={() => {
                    const next = { ...uiState, show_minimap: !uiState.show_minimap };
                    setUiState(next);
                    queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
                  }}
                >
                  MiniMap
                </button>
                <select
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                  value={uiState.layout_mode}
                  onChange={(event) => {
                    const next = { ...uiState, layout_mode: event.target.value };
                    setUiState(next);
                    layoutSignatureRef.current = "";
                    setRelayoutNonce((current) => current + 1);
                    queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
                  }}
                >
                  <option value="elk_layered">分层工作流</option>
                  <option value="elk_stress">自由图谱</option>
                </select>
                <button
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"
                  onClick={() => {
                    layoutSignatureRef.current = "";
                    setRelayoutNonce((current) => current + 1);
                  }}
                >
                  重新布局
                </button>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">已选论文 {selectedPaperCount}</div>
              </div>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            {taskProgress ? (
              <div className="pointer-events-none absolute left-6 top-5 z-10 w-[min(37.333rem,calc(100%-3rem))]">
                <div className="pointer-events-auto">
                  <TaskProgress key={activeTask?.task_id || "task-progress"} progress={taskProgress} />
                </div>
              </div>
            ) : null}
            <ResearchCanvas
              nodes={nodes}
              edges={edges}
              showMiniMap={uiState.show_minimap}
              flowRef={flowRef}
              onNodesChange={handleNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={(connection: Connection) => {
                const nextEdges = buildManualConnection(connection, edgesRef.current);
                setEdges(nextEdges);
                queueSave(nodesRef.current, nextEdges);
              }}
              onNodeClick={(nodeId) => {
                setSelectedNodeId(nodeId);
                setActiveCollectionId("");
                setDetailTab("info");
                setPdfUrl("");
                if (!chatTargetNodeId) {
                  setChatTargetNodeId(nodeId);
                }
              }}
              onPaneClick={() => setSelectedNodeId("")}
              onMoveStart={() => {
                interactionLockRef.current = true;
              }}
              onMoveEnd={(nextViewport) => {
                interactionLockRef.current = false;
                setViewport(nextViewport);
                if (suppressViewportPersistRef.current) {
                  suppressViewportPersistRef.current = false;
                  return;
                }
                if (!isSameViewport(viewportRef.current, nextViewport)) {
                  queueSave(nodesRef.current, edgesRef.current, nextViewport);
                }
              }}
              onNodeDragStart={() => {
                interactionLockRef.current = true;
              }}
              onNodeDragStop={() => {
                interactionLockRef.current = false;
                queueSave(nodesRef.current, edgesRef.current);
              }}
              onSelectionChange={() => undefined}
              onNodesDelete={() => undefined}
              onEdgesDelete={(deleted) => {
                const deletedIds = new Set(deleted.filter((edge) => !String(edge.id).startsWith("graph:")).map((edge) => edge.id));
                const nextEdges = edgesRef.current.filter((edge) => !deletedIds.has(edge.id));
                setEdges(nextEdges);
                queueSave(nodesRef.current, nextEdges);
              }}
            />
          </div>

          <QuickActionBar
            selectedPaperCount={selectedPaperCount}
            onAddNote={() => addManualNode("note")}
            onAddQuestion={() => addManualNode("question")}
            onAddReference={() => addManualNode("reference")}
            onAddGroup={() => addManualNode("group")}
            onAddToCollection={() => {
              handleAddSelectionToCollection().catch((cause) => {
                setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
              });
            }}
            onCompareSelection={() => {
              handleCompareSelection().catch((cause) => {
                setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
              });
            }}
            onCreateStudyFromSelection={() => {
              handleCreateStudyFromSelection().catch((cause) => {
                setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
              });
            }}
            onSaveCanvas={() => queueSave(nodesRef.current, edgesRef.current)}
          />
        </main>
      }
      detail={
        <aside className="flex h-full min-h-0 flex-col bg-slate-50/60 p-5">
          <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-2xl px-3 py-2 text-sm font-medium transition ${detailTab === "info" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
                onClick={() => setDetailTab("info")}
              >
                展示信息
              </button>
              <button
                className={`flex-1 rounded-2xl px-3 py-2 text-sm font-medium transition ${detailTab === "chat" ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-600 hover:bg-slate-100"}`}
                onClick={() => setDetailTab("chat")}
              >
                对话
              </button>
            </div>
          </div>

          <div className="mt-4 min-h-0 flex-1 overflow-auto">
            {detailTab === "chat" ? (
              <ContextChatPanel
                disabled={!activeTaskId}
                nodeOptions={chatTargetOptions}
                activeNodeId={chatTargetNodeId}
                activeNodeLabel={chatTargetNode?.data?.label}
                activeNodeType={chatTargetNode?.data?.type}
                history={chatTargetHistory}
                question={chatDraft}
                busy={nodeChat.isPending}
                onQuestionChange={setChatDraft}
                onSelectNode={(nodeId) => setChatTargetNodeId(nodeId)}
                onSend={(question, threadId) => chatTargetNodeId && nodeChat.mutate({ nodeId: chatTargetNodeId, question, threadId })}
                onSaveAnswer={saveChatAnswerAsNode}
              />
            ) : (
              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <SectionTitle
                    eyebrow="Task Overview"
                    title={activeTask?.topic || "当前任务"}
                    description={activeTask ? `${activeTask.mode === "openclaw_auto" ? "OpenClaw Auto" : "GPT Step"} · ${activeTask.status}` : "选中任务后，这里会显示导出、全文和运行概况。"}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SmallButton disabled={!activeTask} onClick={() => exportTask.mutate("md")}>
                      导出 MD
                    </SmallButton>
                    <SmallButton disabled={!activeTask} onClick={() => exportTask.mutate("bib")}>
                      导出 BibTeX
                    </SmallButton>
                    <SmallButton disabled={!activeTask} onClick={() => exportTask.mutate("csljson")}>
                      导出 CSL JSON
                    </SmallButton>
                    <SmallButton disabled={!activeTask} onClick={() => exportTask.mutate("json")}>
                      导出 JSON
                    </SmallButton>
                  </div>
                  {taskExportsQuery.data?.items?.length ? (
                    <div className="mt-3 space-y-2">
                      {taskExportsQuery.data.items.slice(0, 3).map((item) => (
                        <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                          <div className="font-medium text-slate-900">
                            {item.format.toUpperCase()} · {item.status}
                          </div>
                          {item.filename ? <div className="mt-1 text-slate-500">{item.filename}</div> : null}
                          {item.output_path ? <div className="mt-1 break-all">{item.output_path}</div> : null}
                          <div className="mt-2 flex flex-wrap gap-2">
                            {item.download_url ? (
                              <SmallButton onClick={() => downloadExternalUrl(item.download_url, item.filename)}>打开 / 下载</SmallButton>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {venueMetricsQuery.data?.items?.length ? (
                    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Venue Metrics</div>
                      <div className="mt-3 space-y-2">
                        {venueMetricsQuery.data.items.slice(0, 8).map((item) => (
                          <div key={item.venue_key} className="rounded-2xl border border-slate-200 bg-white p-3 text-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="font-medium text-slate-900">{item.venue}</div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {item.source_type || "类型未知"} · {item.paper_count} 篇论文
                                </div>
                              </div>
                              <div className="text-right text-xs text-slate-500">{formatVenueMetricSummary(item) || "暂无分级数据"}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                <ComparePanel report={compareReport} onSaveAsNote={() => saveCompareAsNode("note")} onSaveAsReport={() => saveCompareAsNode("report")} onClose={() => setCompareReport(null)} />

                <CollectionDetailPanel
                  collection={activeCollection}
                  exportHistory={collectionExportsQuery.data?.items || []}
                  searchText={collectionSearchText}
                  selectedItemIds={selectedCollectionItemIds}
                  onSearchTextChange={setCollectionSearchText}
                  onToggleItem={(itemId) =>
                    setSelectedCollectionItemIds((current) => (current.includes(itemId) ? current.filter((value) => value !== itemId) : [...current, itemId]))
                  }
                  onToggleAllVisible={(itemIds) =>
                    setSelectedCollectionItemIds((current) => {
                      const allSelected = itemIds.every((itemId) => current.includes(itemId));
                      if (allSelected) {
                        return current.filter((value) => !itemIds.includes(value));
                      }
                      return [...new Set([...current, ...itemIds])];
                    })
                  }
                  onSummarize={() => activeCollectionId && summarizeCollection.mutate(activeCollectionId)}
                  onCreateStudy={() => activeCollectionId && createStudyFromCollection.mutate({ collectionId: activeCollectionId })}
                  onBuildGraph={() => activeCollectionId && buildCollectionGraph.mutate(activeCollectionId)}
                  onCompare={() => activeCollectionId && compareCollection.mutate({ collectionId: activeCollectionId })}
                  onRemoveSelected={() => activeCollectionId && selectedCollectionItemIds.length && removeCollectionItems.mutate({ collectionId: activeCollectionId, itemIds: selectedCollectionItemIds })}
                  onExportBib={() => activeCollectionId && exportCollection.mutate({ collectionId: activeCollectionId, format: "bib" })}
                  onExportCslJson={() => activeCollectionId && exportCollection.mutate({ collectionId: activeCollectionId, format: "csljson" })}
                  onLoadMore={() => setCollectionLimit((current) => current + 50)}
                />

                <DetailPanel
                  mode={activeTask?.mode || "gpt_step"}
                  node={selectedNode}
                  paperDetail={paperDetailQuery.data || null}
                  paperAssets={paperAssetQuery.data || null}
                  roundCandidates={selectedRoundCandidates}
                  onUpdateNote={updateSelectedNote}
                  onToggleHidden={toggleSelectedHidden}
                  onDeleteNode={deleteSelectedNode}
                  onOpenPdf={() => {
                    const pdf = paperAssetQuery.data?.items.find((item) => item.kind === "pdf" && item.status === "available");
                    if (!pdf?.open_url && !pdf?.download_url) {
                      setActionStatus({ tone: "warning", text: "当前论文还没有可打开的 PDF。" });
                      return;
                    }
                    openExternalUrl(pdf?.open_url || pdf?.download_url);
                  }}
                  onDownloadPdf={() => {
                    const pdf = paperAssetQuery.data?.items.find((item) => item.kind === "pdf" && item.status === "available");
                    if (!pdf?.download_url && !pdf?.open_url) {
                      setActionStatus({ tone: "warning", text: "当前论文还没有可下载的 PDF。" });
                      return;
                    }
                    downloadExternalUrl(pdf?.download_url || pdf?.open_url, pdf?.filename || "paper.pdf");
                  }}
                  onOpenAsset={(url) => {
                    if (!openExternalUrl(url)) {
                      setActionStatus({ tone: "warning", text: "当前资产还不能打开。" });
                    }
                  }}
                  onDownloadAsset={(url, filename) => {
                    if (!downloadExternalUrl(url, filename)) {
                      setActionStatus({ tone: "warning", text: "当前资产还不能下载。" });
                    }
                  }}
                  onSavePaper={() => selectedPaperId && workbenchAction.mutate({ type: "save_paper", paperId: selectedPaperId })}
                  onSummarizePaper={() => selectedPaperId && workbenchAction.mutate({ type: "summarize_paper", paperId: selectedPaperId })}
                  onRebuildVisual={() => rebuildPaperVisual.mutate()}
                  onSearchDirection={(directionIndex) => workbenchAction.mutate({ type: "search_direction", directionIndex })}
                  onStartExplore={(directionIndex) => workbenchAction.mutate({ type: "start_explore", directionIndex })}
                  onBuildGraph={(directionIndex, roundId) => workbenchAction.mutate({ type: "build_graph", directionIndex, roundId })}
                  onProposeCandidates={(roundId, action, feedbackText) => workbenchAction.mutate({ type: "propose", roundId, action, feedbackText })}
                  onSelectCandidate={(roundId, candidateId) => workbenchAction.mutate({ type: "select_candidate", roundId, candidateId })}
                  onNextRound={(roundId, intentText) => workbenchAction.mutate({ type: "next_round", roundId, intentText })}
                  onAskPreset={(question) => {
                    setDetailTab("chat");
                    if (selectedNode?.id) {
                      setChatTargetNodeId(selectedNode.id);
                    }
                    setChatDraft(question);
                  }}
                />

                <RunTimeline
                  mode={activeTask?.mode || "gpt_step"}
                  autoStatus={activeTask?.auto_status || ""}
                  runId={runId}
                  events={eventsState.items}
                  summary={eventsState.summary}
                  error={eventsState.error}
                  onGuidance={(text) => workbenchAction.mutate({ type: "guidance", text })}
                  onContinue={() => workbenchAction.mutate({ type: "auto_continue" })}
                  onCancel={() => workbenchAction.mutate({ type: "auto_cancel" })}
                />

                {selectedNode && isPaperNode(selectedNode.id) ? (
                  <PdfPanel
                    taskId={activeTaskId}
                    paperId={selectedPaperId}
                    previewUrl={pdfUrl}
                    assets={paperAssetQuery.data || null}
                    fulltextItem={selectedFulltextItem}
                    fulltextSummary={fulltextStatusQuery.data?.summary || null}
                    busy={uploadPdf.isPending || workbenchAction.isPending || rebuildPaperVisual.isPending}
                    onClose={() => setPdfUrl("")}
                    onPreviewPdf={(url) => setPdfUrl(resolveBrowserUrl(url))}
                    onOpenAsset={(url) => {
                      if (!openExternalUrl(url)) {
                        setActionStatus({ tone: "warning", text: "当前资产还不能打开。" });
                      }
                    }}
                    onDownloadAsset={(url, filename) => {
                      if (!downloadExternalUrl(url, filename)) {
                        setActionStatus({ tone: "warning", text: "当前资产还不能下载。" });
                      }
                    }}
                    onBuildFulltext={() => workbenchAction.mutate({ type: "quick", action: "build_fulltext" })}
                    onRetryFulltext={() =>
                      apiFetch(`/api/v1/research/tasks/${activeTaskId}/fulltext/retry?paper_ids=${encodeURIComponent(selectedPaperId)}`, {
                        method: "POST",
                      })
                        .then(() => {
                          setActionStatus({ tone: "success", text: "已提交全文重试请求" });
                          client.invalidateQueries({ queryKey: ["fulltext-status", activeTaskId] });
                        })
                        .catch((cause) => {
                          setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
                        })
                    }
                    onUploadPdf={(file) => uploadPdf.mutate(file)}
                    onRebuildVisual={() => rebuildPaperVisual.mutate()}
                  />
                ) : null}
              </div>
            )}
          </div>
        </aside>
      }
      />
    </>
  );

  function buildSuccessText(action: WorkbenchAction) {
    switch (action.type) {
      case "quick":
        if (action.action === "plan") return "方向规划已提交。";
        if (action.action === "search_first") return "方向 1 检索已提交。";
        if (action.action === "build_graph") return "图谱构建已提交。";
        if (action.action === "build_fulltext") return "全文处理已提交。";
        return "自动研究已启动。";
      case "search_direction":
        return `已提交方向 ${action.directionIndex} 的检索请求。`;
      case "start_explore":
        return `已为方向 ${action.directionIndex} 创建探索轮次。`;
      case "build_graph":
        return action.roundId ? `已提交第 ${action.roundId} 轮的图谱构建。` : "已提交图谱构建。";
      case "propose":
        return `已为第 ${action.roundId} 轮生成候选方向。`;
      case "select_candidate":
        return `已选择第 ${action.roundId} 轮候选，准备进入下一轮。`;
      case "next_round":
        return "已根据新的意图继续下一轮探索。";
      case "save_paper":
        return "论文已保存。";
      case "summarize_paper":
        return "论文总结已提交。";
      case "guidance":
        return "已提交新的 Checkpoint 引导。";
      case "auto_continue":
        return "自动研究已继续。";
      case "auto_cancel":
        return "自动研究已停止。";
      default:
        return "操作已提交。";
    }
  }

  function resolveActionStatus(action: WorkbenchAction, data?: WorkbenchActionResult | null): ActionStatus {
    const noopReason = data?.noop_reason || "";
    const message = data?.message?.trim();
    if (noopReason) {
      return {
        tone: isMissingPrerequisite(noopReason) ? "warning" : "neutral",
        text: message || buildNoopText(noopReason),
      };
    }
    if (data?.queued === false) {
      return {
        tone: "neutral",
        text: message || "当前操作没有执行。",
      };
    }
    return {
      tone: "success",
      text: message || buildSuccessText(action),
    };
  }
}

function buildNoopText(noopReason: string) {
  const labels: Record<string, string> = {
    directions_already_available: "已有方向结果，无需重复规划。",
    plan_already_pending: "方向规划已在队列中，无需重复提交。",
    search_already_pending: "论文检索已在队列中，无需重复提交。",
    direction_missing: "缺少方向信息，请先规划方向。",
    fulltext_already_pending: "全文处理已在队列中，无需重复提交。",
    graph_already_pending: "图谱构建已在队列中，无需重复提交。",
    paper_missing: "缺少论文节点，请先选择有效论文。",
    no_papers: "当前任务还没有论文，无法执行全文处理。",
    no_graph_seed: "当前缺少图谱种子，请先完成检索或探索。",
  };
  return labels[noopReason] || "当前操作没有执行。";
}

function isMissingPrerequisite(noopReason: string) {
  return noopReason.includes("missing") || noopReason.startsWith("no_") || noopReason === "paper_missing";
}

function ActionBanner(props: { status: ActionStatus }) {
  const className =
    props.status.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : props.status.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : props.status.tone === "danger"
          ? "border-rose-200 bg-rose-50 text-rose-700"
          : "border-slate-200 bg-slate-50 text-slate-600";

  return <div className={`mt-3 rounded-2xl border px-3 py-2 text-sm ${className}`}>{props.status.text}</div>;
}

function formatVenueMetricSummary(item: TaskVenueMetricItem) {
  const metrics = item.metrics;
  const parts = [];
  if (metrics.ccf?.rank) parts.push(`CCF ${metrics.ccf.rank}`);
  if (metrics.jcr?.quartile) parts.push(`JCR ${metrics.jcr.quartile}`);
  if (metrics.cas?.quartile) parts.push(`中科院 ${metrics.cas.quartile}`);
  if (metrics.ei?.indexed === true) parts.push("EI");
  if (typeof metrics.impact_factor?.value === "number") parts.push(`IF ${metrics.impact_factor.value}`);
  if (typeof metrics.venue_citation_count === "number") parts.push(`引用 ${metrics.venue_citation_count.toLocaleString("zh-CN")}`);
  return parts.join(" · ");
}

function isSameViewport(
  left: { x: number; y: number; zoom: number },
  right: { x: number; y: number; zoom: number },
) {
  return Math.abs(left.x - right.x) < 0.5 && Math.abs(left.y - right.y) < 0.5 && Math.abs(left.zoom - right.zoom) < 0.01;
}
