import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEdgesState, useNodesState, type Connection, type Edge, type Node, type NodeChange, type ReactFlowInstance } from "@xyflow/react";
import { apiFetch, apiPostSse } from "../lib/api";
import { AppShell } from "./components/AppShell";
import { CanvasActionBar } from "./components/CanvasActionBar";
import { CollectionDetailPanel } from "./components/CollectionDetailPanel";
import { ComparePanel } from "./components/ComparePanel";
import { ContextChatPanel } from "./components/ContextChatPanel";
import { DetailPanel } from "./components/DetailPanel";
import { ProjectSidebar, type SidebarEntry } from "./components/ProjectSidebar";
import { ResearchCanvas, buildManualConnection } from "./components/ResearchCanvas";
import { RunTimeline } from "./components/RunTimeline";
import { SectionTitle, SmallButton } from "./components/shared";
import { edgeCountLabel } from "./display";
import { useRunEvents } from "./hooks/useRunEvents";
import type {
  ActionResponse,
  ActionStatus,
  Backend,
  CanvasResponse,
  CanvasUiState,
  ChatAttachment,
  ChatAttachmentListResponse,
  ChatMessage,
  ChatMessageListResponse,
  ChatThread,
  ChatThreadListResponse,
  CollectionGraphResponse,
  CollectionSummary,
  CompareReport,
  ExportListResponse,
  ExportResponse,
  FlowNodeData,
  GraphResponse,
  PaperAssetItem,
  PaperAssetResponse,
  PaperDetail,
  ProjectDashboard,
  ProjectSummary,
  RoundCandidate,
  TaskMode,
  TaskSummary,
  WorkbenchConfig,
  ZoteroConfig,
  ZoteroImportResponse,
} from "./types";
import {
  buildCanvasPayload,
  canonicalGraphSignature,
  canvasPayloadSignature,
  defaultCanvasUi,
  derivePaperPdfUrl,
  inferRoundId,
  isPaperNode,
  mergeCanvasWithGraph,
  reconcileFlowState,
  runAutoLayout,
} from "./utils";

type ExportFormat = "md" | "bib" | "json" | "csljson";
type WorkbenchActionResult = ActionResponse & { candidates?: RoundCandidate[] };
type CanvasSavePayload = { taskId: string; payload: CanvasResponse };
type DetailTab = "info" | "chat";
type CenterSheetMode = SidebarEntry | null;
type ManualCardType = "note" | "group" | "report";
type AssetPreviewState = { title: string; kind: string; url: string; filename?: string | null } | null;

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

const FIXED_LEFT_RAIL_WIDTH = 104;

const MANUAL_NODE_LABELS: Record<ManualCardType, string> = {
  note: "新的笔记",
  group: "新的分组",
  report: "新的报告",
};

function normalizeCanvasUi(ui?: Partial<CanvasUiState> | null): CanvasUiState {
  return {
    ...defaultCanvasUi(),
    ...(ui || {}),
    left_sidebar_collapsed: false,
    left_sidebar_width: FIXED_LEFT_RAIL_WIDTH,
  };
}

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
  const [uiState, setUiState] = useState<CanvasUiState>(normalizeCanvasUi(defaultCanvasUi()));
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [activeChatThreadId, setActiveChatThreadId] = useState("");
  const [chatContextNodeIds, setChatContextNodeIds] = useState<string[]>([]);
  const [chatAttachments, setChatAttachments] = useState<ChatAttachment[]>([]);
  const [chatUploadingNames, setChatUploadingNames] = useState<string[]>([]);
  const [chatDraft, setChatDraft] = useState("");
  const [chatStreamError, setChatStreamError] = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const [centerSheetMode, setCenterSheetMode] = useState<CenterSheetMode>(null);
  const [projectDraft, setProjectDraft] = useState({ name: "", description: "" });
  const [taskDraft, setTaskDraft] = useState({
    topic: "",
    mode: "gpt_step" as TaskMode,
    llm_backend: "gpt" as Backend,
    llm_model: "gpt-5.4",
  });
  const [collectionDraft, setCollectionDraft] = useState({ name: "", description: "" });
  const [pendingCollectionPaperIds, setPendingCollectionPaperIds] = useState<string[]>([]);
  const [importCollectionName, setImportCollectionName] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [roundCandidates, setRoundCandidates] = useState<Record<number, RoundCandidate[]>>({});
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [compareReport, setCompareReport] = useState<CompareReport | null>(null);
  const [collectionSearchText, setCollectionSearchText] = useState("");
  const [collectionLimit, setCollectionLimit] = useState(50);
  const [selectedCollectionItemIds, setSelectedCollectionItemIds] = useState<number[]>([]);
  const [relayoutNonce, setRelayoutNonce] = useState(0);
  const [cardMenuOpen, setCardMenuOpen] = useState(false);
  const [assetPreviewState, setAssetPreviewState] = useState<AssetPreviewState>(null);
  const flowRef = useRef<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null);
  const persistTimer = useRef<number | null>(null);
  const suppressViewportPersistRef = useRef(false);
  const interactionLockRef = useRef(false);
  const lastSavedCanvasSignature = useRef("");
  const pendingCanvasSignature = useRef("");
  const canvasRetryCountRef = useRef<Record<string, number>>({});
  const nodesRef = useRef<Array<Node<FlowNodeData>>>([]);
  const edgesRef = useRef<Array<Edge>>([]);
  const viewportRef = useRef(viewport);
  const layoutSignatureRef = useRef("");
  const lastTaskIdRef = useRef("");
  const chatAbortRef = useRef<AbortController | null>(null);

  const configQuery = useQuery({
    queryKey: ["workbench-config"],
    queryFn: () => apiFetch<WorkbenchConfig>("/api/v1/research/workbench/config"),
  });

  const zoteroConfigQuery = useQuery({
    queryKey: ["zotero-config"],
    queryFn: () => apiFetch<ZoteroConfig>("/api/v1/research/integrations/zotero/config"),
  });

  useEffect(() => {
    if (!configQuery.data) return;
    setTaskDraft((current) => {
      const nextMode = current.topic.trim() ? current.mode : configQuery.data.default_mode;
      const nextBackend = nextMode === "openclaw_auto" ? "openclaw" : current.topic.trim() ? current.llm_backend : configQuery.data.default_backend;
      return {
        ...current,
        mode: nextMode,
        llm_backend: nextBackend,
        llm_model:
          nextMode === "openclaw_auto"
            ? configQuery.data.default_openclaw_model || "main"
            : current.topic.trim()
              ? current.llm_model
              : configQuery.data.default_gpt_model || "gpt-5.4",
      };
    });
  }, [configQuery.data]);

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
  const activeProject = useMemo(
    () => projectsQuery.data?.items?.find((project) => project.project_id === activeProjectId) || null,
    [activeProjectId, projectsQuery.data?.items],
  );

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
    queryFn: () => apiFetch<GraphResponse>(`/api/v1/research/tasks/${activeTaskId}/graph?view=tree&include_papers=true&paper_limit=50`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  const canvasQuery = useQuery({
    queryKey: ["canvas", activeTaskId],
    queryFn: () => apiFetch<CanvasResponse>(`/api/v1/research/tasks/${activeTaskId}/canvas`),
    enabled: Boolean(activeTaskId),
  });

  const activeTask = taskQuery.data || null;
  const activeSheetEntry = centerSheetMode;

  function closeCenterSheet() {
    setCenterSheetMode(null);
    setPendingCollectionPaperIds([]);
  }

  function openCenterSheet(mode: CenterSheetMode) {
    setCenterSheetMode(mode);
    if (mode !== "collection") {
      setPendingCollectionPaperIds([]);
    }
  }

  function selectProject(projectId: string) {
    chatAbortRef.current?.abort();
    setActiveProjectId(projectId);
    setActiveTaskId("");
    setRunId("");
    setActiveCollectionId("");
    setSelectedNodeId("");
    setSelectedNodeIds([]);
    setDetailTab("info");
    setAssetPreviewState(null);
    setActiveChatThreadId("");
    setChatContextNodeIds([]);
    setChatAttachments([]);
    setChatDraft("");
    setRoundCandidates({});
    setCompareReport(null);
    setCollectionSearchText("");
    setCollectionLimit(50);
    setSelectedCollectionItemIds([]);
    setChatStreamError("");
    setChatStreaming(false);
    setPendingCollectionPaperIds([]);
    layoutSignatureRef.current = "";
    setActionStatus(null);
    closeCenterSheet();
  }

  function selectTask(taskId: string) {
    if (taskId === activeTaskId) {
      setActiveCollectionId("");
      setSelectedNodeId("");
      setSelectedNodeIds([]);
      setDetailTab("info");
      setAssetPreviewState(null);
      setActionStatus({ tone: "neutral", text: "已切回当前任务视图" });
      closeCenterSheet();
      return;
    }
    chatAbortRef.current?.abort();
    setActiveTaskId(taskId);
    setActiveCollectionId("");
    setSelectedNodeId("");
    setSelectedNodeIds([]);
    setDetailTab("info");
    setAssetPreviewState(null);
    setActiveChatThreadId("");
    setChatContextNodeIds([]);
    setChatAttachments([]);
    setChatDraft("");
    setRoundCandidates({});
    setCompareReport(null);
    setCollectionSearchText("");
    setCollectionLimit(50);
    setSelectedCollectionItemIds([]);
    setChatStreamError("");
    setChatStreaming(false);
    layoutSignatureRef.current = "";
    setActionStatus(null);
    closeCenterSheet();
  }

  function selectCollection(collectionId: string) {
    setActiveCollectionId(collectionId);
    setSelectedNodeId("");
    setSelectedNodeIds([]);
    closeCenterSheet();
  }
  const eventsState = useRunEvents({
    taskId: activeTaskId,
    runId,
    enabled: Boolean(activeTaskId && runId),
    intervalMs: activeTask?.mode === "openclaw_auto" ? 3000 : 4000,
  });

  const merged = useMemo(
    () => mergeCanvasWithGraph(graphQuery.data, canvasQuery.data, eventsState.items, normalizeCanvasUi(configQuery.data?.default_canvas_ui || defaultCanvasUi())),
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
    setUiState(normalizeCanvasUi(canvasQuery.data.ui));
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
    if (!chatContextNodeIds.length) return;
    const nodeIds = new Set(nodes.map((node) => node.id));
    const nextIds = chatContextNodeIds.filter((nodeId) => nodeIds.has(nodeId));
    if (nextIds.length !== chatContextNodeIds.length) {
      setChatContextNodeIds(nextIds);
    }
  }, [chatContextNodeIds, nodes]);

  useEffect(() => {
    if (activeTaskId === lastTaskIdRef.current) return;
    lastTaskIdRef.current = activeTaskId;
    chatAbortRef.current?.abort();
    setActiveCollectionId("");
    setSelectedNodeId("");
    setSelectedNodeIds([]);
    setDetailTab("info");
    setAssetPreviewState(null);
    setActiveChatThreadId("");
    setChatContextNodeIds([]);
    setChatAttachments([]);
    setChatUploadingNames([]);
    setChatDraft("");
    setChatStreamError("");
    setChatStreaming(false);
    setRoundCandidates({});
    setCompareReport(null);
    setPendingCollectionPaperIds([]);
    setCollectionSearchText("");
    setCollectionLimit(50);
    setSelectedCollectionItemIds([]);
    setImportFile(null);
    setCardMenuOpen(false);
    layoutSignatureRef.current = "";
    lastSavedCanvasSignature.current = "";
    pendingCanvasSignature.current = "";
    canvasRetryCountRef.current = {};
  }, [activeTaskId]);

  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      if (persistTimer.current) {
        window.clearTimeout(persistTimer.current);
      }
    };
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedPaperId = selectedNode && isPaperNode(selectedNode) ? selectedNode.id : "";
  const selectedPaperIds = useMemo(
    () =>
      selectedNodeIds.filter((nodeId) => {
        const node = nodes.find((item) => item.id === nodeId);
        return isPaperNode(node ? node : nodeId);
      }),
    [nodes, selectedNodeIds],
  );
  const selectedPaperCount = selectedPaperIds.length;

  useEffect(() => {
    setAssetPreviewState(null);
  }, [selectedPaperId]);

  useEffect(() => {
    if (detailTab !== "chat" || uiState.right_sidebar_collapsed || uiState.right_sidebar_width >= 560) return;
    const next = normalizeCanvasUi({ ...uiState, right_sidebar_width: 560 });
    setUiState(next);
    queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
  }, [detailTab, uiState]);

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
  const resolvedPaperPdfUrl = derivePaperPdfUrl(paperAssetQuery.data, paperDetailQuery.data);
  const resolvedPaperPdfFilename =
    paperAssetQuery.data?.items.find((item) => item.kind === "pdf")?.filename || (selectedPaperId ? `${selectedPaperId}.pdf` : "paper.pdf");

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

  const assetPreviewQuery = useQuery({
    queryKey: ["asset-text-preview", assetPreviewState?.url],
    queryFn: async () => {
      const response = await fetch(resolveBrowserUrl(assetPreviewState?.url));
      if (!response.ok) {
        throw new Error((await response.text()) || `asset preview failed: ${response.status}`);
      }
      return response.text();
    },
    enabled: Boolean(assetPreviewState?.url),
  });

  const chatThreadsQuery = useQuery({
    queryKey: ["task-chat-threads", activeTaskId],
    queryFn: () => apiFetch<ChatThreadListResponse>(`/api/v1/research/tasks/${activeTaskId}/chat/threads`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    const threads = chatThreadsQuery.data?.items || [];
    if (!threads.length) {
      if (activeChatThreadId) {
        setActiveChatThreadId("");
      }
      return;
    }
    if (!activeChatThreadId || !threads.some((item) => item.thread_id === activeChatThreadId)) {
      setActiveChatThreadId(threads[0].thread_id);
    }
  }, [activeChatThreadId, chatThreadsQuery.data?.items]);

  const chatMessagesQuery = useQuery({
    queryKey: ["task-chat-messages", activeTaskId, activeChatThreadId],
    queryFn: () =>
      apiFetch<ChatMessageListResponse>(
        `/api/v1/research/tasks/${activeTaskId}/chat/messages?thread_id=${encodeURIComponent(activeChatThreadId)}`,
      ),
    enabled: Boolean(activeTaskId && activeChatThreadId),
    refetchOnWindowFocus: false,
  });

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
    const payload = buildCanvasPayload(activeTaskId, nextNodes, nextEdges, nextViewport, normalizeCanvasUi(nextUi)) as CanvasResponse;
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
      setProjectDraft({ name: "", description: "" });
      closeCenterSheet();
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
      setSelectedNodeIds([]);
      setRunId(task.latest_run_id || "");
      setAssetPreviewState(null);
      setActiveChatThreadId("");
      setChatContextNodeIds([]);
      setChatAttachments([]);
      setRoundCandidates({});
      setCompareReport(null);
      closeCenterSheet();
      setTaskDraft((current) => ({ ...current, topic: "" }));
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
      closeCenterSheet();
      setImportCollectionName("");
      setImportFile(null);
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

  const createChatThread = useMutation({
    mutationFn: async (title?: string) =>
      apiFetch<ChatThread>(`/api/v1/research/tasks/${activeTaskId}/chat/threads`, {
        method: "POST",
        body: JSON.stringify({ title: title || null }),
      }),
    onSuccess: (thread) => {
      setActiveChatThreadId(thread.thread_id);
      client.invalidateQueries({ queryKey: ["task-chat-threads", activeTaskId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const uploadChatAttachment = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiFetch<ChatAttachmentListResponse>(`/api/v1/research/tasks/${activeTaskId}/chat/attachments`, {
        method: "POST",
        body: form,
      });
    },
    onSuccess: (data) => {
      setChatAttachments((current) => [...current, ...data.items]);
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  function addManualNode(type: ManualCardType, summary?: string, label?: string) {
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
          summary: summary || "这是一个手工工作台节点，可用于整理思路、沉淀阶段总结、归纳结论或组织研究分组。",
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
      setSelectedNodeIds([]);
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
    setSelectedNodeIds([]);
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
    setSelectedNodeIds([]);
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

  function syncCanvasSelection(nodeIds: string[]) {
    setSelectedNodeIds(nodeIds);
    if (!nodeIds.length) {
      setSelectedNodeId("");
      return;
    }
    if (selectedNodeId && nodeIds.includes(selectedNodeId)) {
      return;
    }
    setSelectedNodeId(nodeIds[nodeIds.length - 1] || nodeIds[0]);
  }

  function saveChatAnswerAsNode(kind: "note" | "report", item: ChatMessage) {
    const label = kind === "note" ? "问答笔记" : "问答报告";
    addManualNode(kind, item.content, label);
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

  function addNodesToChatContext(nodeIds: string[]) {
    const nextIds = [...new Set([...chatContextNodeIds, ...nodeIds.filter(Boolean)])].slice(0, 8);
    setChatContextNodeIds(nextIds);
    setDetailTab("chat");
  }

  async function ensureActiveChatThread() {
    if (activeChatThreadId) return activeChatThreadId;
    const created = await createChatThread.mutateAsync("新对话");
    return created.thread_id;
  }

  async function handleUploadChatFiles(files: FileList) {
    if (!activeTaskId || !files.length) return;
    const queue = Array.from(files);
    setChatUploadingNames(queue.map((file) => file.name));
    for (const file of queue) {
      try {
        await uploadChatAttachment.mutateAsync(file);
      } finally {
        setChatUploadingNames((current) => current.filter((name) => name !== file.name));
      }
    }
  }

  async function handleSendTaskChat() {
    if (!activeTaskId || !chatDraft.trim() || chatStreaming) return;
    const threadId = await ensureActiveChatThread();
    const text = chatDraft.trim();
    const contextIds = [...chatContextNodeIds];
    const attachmentIds = chatAttachments.map((item) => item.attachment_id);

    const userMessage: ChatMessage = {
      id: Date.now(),
      task_id: activeTaskId,
      thread_id: threadId,
      role: "user",
      content: text,
      context_node_ids: contextIds,
      attachment_ids: attachmentIds,
      provider: null,
      model: null,
      status: "done",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const assistantMessage: ChatMessage = {
      id: Date.now() + 1,
      task_id: activeTaskId,
      thread_id: threadId,
      role: "assistant",
      content: "",
      context_node_ids: contextIds,
      attachment_ids: attachmentIds,
      provider: null,
      model: null,
      status: "streaming",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setActiveChatThreadId(threadId);
    setChatDraft("");
    setChatStreamError("");
    setChatStreaming(true);
    setChatAttachments([]);
    client.setQueryData<ChatMessageListResponse>(["task-chat-messages", activeTaskId, threadId], (current) => ({
      task_id: activeTaskId,
      thread_id: threadId,
      items: [...(current?.items || []), userMessage, assistantMessage],
    }));

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    try {
      await apiPostSse(
        `/api/v1/research/tasks/${activeTaskId}/chat/stream`,
        {
          thread_id: threadId,
          message: text,
          context_node_ids: contextIds,
          attachment_ids: attachmentIds,
        },
        (eventType, payload) => {
          if (eventType === "message_start") {
            const nextThreadId = typeof payload.thread_id === "string" ? payload.thread_id : threadId;
            if (nextThreadId && nextThreadId !== threadId) {
              setActiveChatThreadId(nextThreadId);
            }
            return;
          }

          if (eventType === "message_delta") {
            const delta = String(payload.delta || "");
            if (!delta) return;
            client.setQueryData<ChatMessageListResponse>(["task-chat-messages", activeTaskId, threadId], (current) => ({
              task_id: activeTaskId,
              thread_id: threadId,
              items: (current?.items || []).map((item, index, items) =>
                index === items.length - 1 && item.role === "assistant" ? { ...item, content: `${item.content}${delta}` } : item,
              ),
            }));
            return;
          }

          if (eventType === "message_done") {
            const finalMessage = payload.message as ChatMessage | undefined;
            client.setQueryData<ChatMessageListResponse>(["task-chat-messages", activeTaskId, threadId], (current) => ({
              task_id: activeTaskId,
              thread_id: threadId,
              items: (current?.items || []).map((item, index, items) =>
                index === items.length - 1 && item.role === "assistant"
                  ? {
                      ...item,
                      ...(finalMessage || {}),
                      content: String(finalMessage?.content || item.content || ""),
                      status: "done",
                    }
                  : item,
              ),
            }));
            return;
          }

          if (eventType === "message_error") {
            const errorText = String(payload.message || "聊天流返回失败");
            setChatStreamError(errorText);
            client.setQueryData<ChatMessageListResponse>(["task-chat-messages", activeTaskId, threadId], (current) => ({
              task_id: activeTaskId,
              thread_id: threadId,
              items: (current?.items || []).map((item, index, items) =>
                index === items.length - 1 && item.role === "assistant"
                  ? {
                      ...item,
                      content: item.content || `本轮对话失败：${errorText}`,
                      status: "failed",
                    }
                  : item,
              ),
            }));
          }
        },
        controller.signal,
      );
      client.invalidateQueries({ queryKey: ["task-chat-threads", activeTaskId] });
      client.invalidateQueries({ queryKey: ["task-chat-messages", activeTaskId, threadId] });
    } catch (cause) {
      const errorText = cause instanceof Error ? cause.message : String(cause);
      setChatStreamError(errorText);
      client.invalidateQueries({ queryKey: ["task-chat-messages", activeTaskId, threadId] });
    } finally {
      setChatStreaming(false);
    }
  }

  async function handleCreateCollectionFromSheet() {
    if (!activeProjectId || !collectionDraft.name.trim()) return;
    const created = await createCollection.mutateAsync(collectionDraft);
    if (pendingCollectionPaperIds.length && activeTaskId) {
      await addItemsToCollection.mutateAsync({
        collectionId: created.collection_id,
        items: pendingCollectionPaperIds.map((paperId) => ({ task_id: activeTaskId, paper_id: paperId })),
      });
    }
    setCollectionDraft({ name: "", description: "" });
    closeCenterSheet();
  }

  async function handleAddSelectionToCollection() {
    if (!activeTaskId) return;
    if (!selectedPaperIds.length) {
      setActionStatus({ tone: "warning", text: "请先框选或多选论文节点，再加入 Collection。" });
      return;
    }
    setPendingCollectionPaperIds(selectedPaperIds);
    openCenterSheet("collection");
  }

  async function handleAttachSelectionToCollection(collectionId: string) {
    if (!activeTaskId || !pendingCollectionPaperIds.length) return;
    await addItemsToCollection.mutateAsync({
      collectionId,
      items: pendingCollectionPaperIds.map((paperId) => ({ task_id: activeTaskId, paper_id: paperId })),
    });
    closeCenterSheet();
  }

  async function handleCompareSelection() {
    if (selectedPaperIds.length < 2) {
      setActionStatus({ tone: "warning", text: "请至少选中两篇论文再做对比" });
      return;
    }
    await compareTaskPapers.mutateAsync({ paperIds: selectedPaperIds });
  }

  const selectedRoundCandidates = useMemo(() => {
    const roundId = inferRoundId(selectedNode?.id || "", selectedNode?.data);
    return roundId ? roundCandidates[roundId] || [] : [];
  }, [roundCandidates, selectedNode?.data, selectedNode?.id]);

  const activeCollection = collectionDetailQuery.data || null;
  const chatMessages = chatMessagesQuery.data?.items || [];
  const chatNodeOptions = useMemo(
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
  const isResearchRunning =
    activeTask?.mode === "openclaw_auto" ? activeTask.auto_status === "running" : ["planning", "searching"].includes(activeTask?.status || "");
  const activeRunNodeIds = isResearchRunning ? eventsState.summary?.active_node_ids || [] : [];
  const activeRunEdges = isResearchRunning ? eventsState.summary?.active_edges || [] : [];
  const decoratedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: activeRunNodeIds.includes(node.id),
        },
      })),
    [activeRunNodeIds, nodes],
  );
  const decoratedEdges = useMemo(
    () =>
      edges.map((edge) => {
        const edgeKey = String(edge.id || "").startsWith("graph:")
          ? String(edge.id).slice("graph:".length)
          : `${edge.source}:${edge.target}:${String(edge.data && typeof edge.data === "object" && "type" in edge.data ? (edge.data as { type?: string }).type : edge.type || "default")}`;
        const isActive = activeRunEdges.includes(edgeKey);
        return isActive
          ? {
              ...edge,
              animated: true,
              style: { ...(edge.style || {}), stroke: "#10b981", strokeWidth: 3 },
            }
          : { ...edge, animated: false };
      }),
    [activeRunEdges, edges],
  );
  const toolbarButtonClass = "h-9 rounded-full px-3 text-xs";
  const toolbarSelectClass = "h-9 rounded-full border border-slate-200 bg-white px-3 text-xs text-slate-600 outline-none";

  return (
    <>
      <AppShell
        leftCollapsed={false}
        rightCollapsed={uiState.right_sidebar_collapsed}
        leftWidth={FIXED_LEFT_RAIL_WIDTH}
        rightWidth={uiState.right_sidebar_width}
        onToggleLeft={() => undefined}
        onToggleRight={() => {
          const next = normalizeCanvasUi({ ...uiState, right_sidebar_collapsed: !uiState.right_sidebar_collapsed });
          setUiState(next);
          queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
        }}
        onResizeLeft={() => undefined}
        onResizeRight={(width) => {
          const next = normalizeCanvasUi({ ...uiState, right_sidebar_width: width });
          setUiState(next);
          queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
        }}
        sidebar={
          <ProjectSidebar
            activeEntry={activeSheetEntry}
            projectCount={projectsQuery.data?.items?.length || 0}
            taskCount={tasksQuery.data?.items?.length || 0}
            collectionCount={collectionsQuery.data?.items?.length || 0}
            onOpenEntry={openCenterSheet}
          />
        }
      canvas={
        <main className="relative h-full overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.06),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.05),transparent_20%),linear-gradient(to_bottom,white,white)]">
          <div className="border-b border-slate-200 px-6 py-4">
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
                <div className="relative">
                  <SmallButton
                    tone="solid"
                    className={toolbarButtonClass}
                    onClick={() => setCardMenuOpen((current) => !current)}
                  >
                    添加卡片
                  </SmallButton>
                  {cardMenuOpen ? (
                    <div className="absolute right-0 top-12 z-20 min-w-40 rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_20px_44px_rgba(15,23,42,0.14)]">
                      {(["note", "group", "report"] as ManualCardType[]).map((type) => (
                        <button
                          key={type}
                          className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                          onClick={() => {
                            addManualNode(type);
                            setCardMenuOpen(false);
                          }}
                        >
                          <span>{MANUAL_NODE_LABELS[type]}</span>
                          <span className="text-xs text-slate-400">{type}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <button
                  className={`${toolbarButtonClass} border ${uiState.show_minimap ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"}`}
                  onClick={() => {
                    const next = normalizeCanvasUi({ ...uiState, show_minimap: !uiState.show_minimap });
                    setUiState(next);
                    queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
                  }}
                >
                  MiniMap
                </button>
                <select
                  className={toolbarSelectClass}
                  value={uiState.layout_mode}
                  onChange={(event) => {
                    const next = normalizeCanvasUi({ ...uiState, layout_mode: event.target.value });
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
                  className={`${toolbarButtonClass} border border-slate-200 bg-white text-slate-600`}
                  onClick={() => {
                    layoutSignatureRef.current = "";
                    setRelayoutNonce((current) => current + 1);
                  }}
                >
                  重新布局
                </button>
                <div className={`${toolbarButtonClass} inline-flex items-center rounded-full border border-slate-200 bg-white text-slate-600`}>已选论文 {selectedPaperCount}</div>
              </div>
            </div>
            {eventsState.summary?.running_label ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <div
                  className={`rounded-full border px-3 py-1 text-xs font-medium ${
                    isResearchRunning ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {isResearchRunning ? "正在执行" : "最近阶段"} · {eventsState.summary.running_label}
                </div>
                {isResearchRunning && activeRunNodeIds.length ? (
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
                    活跃节点 {activeRunNodeIds.length}
                  </div>
                ) : null}
                {isResearchRunning && activeRunEdges.length ? (
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-500">
                    活跃连线 {activeRunEdges.length}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="h-[calc(100%-86px)]">
            <ResearchCanvas
              nodes={decoratedNodes}
              edges={decoratedEdges}
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
                syncCanvasSelection([nodeId]);
                setSelectedNodeId(nodeId);
                setActiveCollectionId("");
                setDetailTab("info");
                setAssetPreviewState(null);
                setCardMenuOpen(false);
              }}
              onPaneClick={() => {
                syncCanvasSelection([]);
                setCardMenuOpen(false);
              }}
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
              onSelectionChange={(selection) => syncCanvasSelection(selection.nodes.map((node) => node.id))}
              onNodesDelete={() => undefined}
              onEdgesDelete={(deleted) => {
                const deletedIds = new Set(deleted.filter((edge) => !String(edge.id).startsWith("graph:")).map((edge) => edge.id));
                const nextEdges = edgesRef.current.filter((edge) => !deletedIds.has(edge.id));
                setEdges(nextEdges);
                queueSave(nodesRef.current, nextEdges);
              }}
            />
          </div>

          <CanvasActionBar
            selectionLabel={
              selectedPaperCount > 1
                ? `已选 ${selectedPaperCount} 篇论文`
                : selectedNode
                  ? `已选节点 · ${String(selectedNode.data?.label || selectedNode.id)}`
                  : ""
            }
            multiPaper={selectedPaperCount > 1}
            singleNodeType={selectedPaperCount > 1 ? null : String(selectedNode?.data?.type || "")}
            canDeleteOrHide={Boolean(selectedNode)}
            deleteOrHideLabel={selectedNode?.data?.isManual ? "删除节点" : "隐藏节点"}
            onDeleteOrHide={deleteSelectedNode}
            onReferenceToChat={() => {
              const ids = selectedPaperCount > 1 ? selectedPaperIds : selectedNodeId ? [selectedNodeId] : [];
              addNodesToChatContext(ids);
            }}
            onOpenPdf={() => {
              if (!openExternalUrl(resolvedPaperPdfUrl)) {
                setActionStatus({ tone: "warning", text: "当前论文还没有可打开的 PDF。" });
              }
            }}
            onDownloadPdf={() => {
              if (!downloadExternalUrl(resolvedPaperPdfUrl, resolvedPaperPdfFilename)) {
                setActionStatus({ tone: "warning", text: "当前论文还没有可下载的 PDF。" });
              }
            }}
            onSummarizePaper={() => selectedPaperId && workbenchAction.mutate({ type: "summarize_paper", paperId: selectedPaperId })}
            onRebuildVisual={() => rebuildPaperVisual.mutate()}
            onSearchDirection={() => selectedNode?.data?.direction_index && workbenchAction.mutate({ type: "search_direction", directionIndex: selectedNode.data.direction_index })}
            onStartExplore={() => selectedNode?.data?.direction_index && workbenchAction.mutate({ type: "start_explore", directionIndex: selectedNode.data.direction_index })}
            onBuildGraph={() =>
              workbenchAction.mutate({
                type: "build_graph",
                directionIndex: typeof selectedNode?.data?.direction_index === "number" ? selectedNode.data.direction_index : undefined,
                roundId: selectedNode ? inferRoundId(selectedNode.id, selectedNode.data) || undefined : undefined,
              })
            }
            onProposeCandidates={() => {
              const roundId = selectedNode ? inferRoundId(selectedNode.id, selectedNode.data) : null;
              if (!roundId) return;
              workbenchAction.mutate({ type: "propose", roundId, action: "expand", feedbackText: "" });
            }}
            onNextRound={() => {
              const roundId = selectedNode ? inferRoundId(selectedNode.id, selectedNode.data) : null;
              if (!roundId) return;
              workbenchAction.mutate({ type: "next_round", roundId, intentText: "继续围绕当前轮次扩展高价值证据。" });
            }}
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
          />
        </main>
      }
      detail={
        <aside className="flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,#f8fafc_0%,#eef2f7_100%)] p-5">
          <div className="rounded-[28px] border border-slate-200/80 bg-white/85 p-2 shadow-[0_12px_36px_rgba(15,23,42,0.08)] backdrop-blur">
            <div className="flex gap-2">
              <button
                className={`flex-1 rounded-2xl px-3 py-2 text-sm font-medium transition ${
                  detailTab === "info" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
                onClick={() => setDetailTab("info")}
              >
                展示信息
              </button>
              <button
                className={`flex-1 rounded-2xl px-3 py-2 text-sm font-medium transition ${
                  detailTab === "chat" ? "bg-slate-900 text-white shadow-sm" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}
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
                taskTitle={activeTask?.topic || ""}
                threads={chatThreadsQuery.data?.items || []}
                activeThreadId={activeChatThreadId}
                messages={chatMessages}
                nodeOptions={chatNodeOptions}
                contextNodeIds={chatContextNodeIds}
                attachments={chatAttachments}
                uploadingNames={chatUploadingNames}
                draft={chatDraft}
                busy={chatStreaming || createChatThread.isPending}
                streaming={chatStreaming}
                error={chatStreamError}
                onDraftChange={setChatDraft}
                onSelectThread={setActiveChatThreadId}
                onNewThread={() => {
                  createChatThread.mutate("新对话");
                  setChatContextNodeIds([]);
                  setChatAttachments([]);
                  setChatDraft("");
                  setChatStreamError("");
                }}
                onSend={() => {
                  handleSendTaskChat().catch((cause) => {
                    setChatStreamError(cause instanceof Error ? cause.message : String(cause));
                  });
                }}
                onUploadFiles={(files) => {
                  handleUploadChatFiles(files).catch((cause) => {
                    setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
                  });
                }}
                onRemoveAttachment={(attachmentId) => setChatAttachments((current) => current.filter((item) => item.attachment_id !== attachmentId))}
                onAddContextNode={(nodeId) => setChatContextNodeIds((current) => [...new Set([...current, nodeId])].slice(0, 8))}
                onRemoveContextNode={(nodeId) => setChatContextNodeIds((current) => current.filter((item) => item !== nodeId))}
                onUseSuggestion={setChatDraft}
                onSaveAnswer={saveChatAnswerAsNode}
              />
            ) : (
              <div className="space-y-4">
                <div className="rounded-3xl border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-auto px-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Task Export</div>
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
                </div>

                <ComparePanel report={compareReport} onSaveAsNote={() => saveCompareAsNode("note")} onSaveAsReport={() => saveCompareAsNode("report")} onClose={() => setCompareReport(null)} />

                {activeCollection ? (
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
                ) : null}

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
                    if (!resolvedPaperPdfUrl) {
                      setActionStatus({ tone: "warning", text: "当前论文还没有可打开的 PDF。" });
                      return;
                    }
                    openExternalUrl(resolvedPaperPdfUrl);
                  }}
                  onDownloadPdf={() => {
                    if (!resolvedPaperPdfUrl) {
                      setActionStatus({ tone: "warning", text: "当前论文还没有可下载的 PDF。" });
                      return;
                    }
                    downloadExternalUrl(resolvedPaperPdfUrl, resolvedPaperPdfFilename);
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
                  onPreviewTextAsset={(item: PaperAssetItem) => {
                    const url = item.open_url || item.download_url;
                    if (!url) {
                      setActionStatus({ tone: "warning", text: "当前文本资产还不能预览。" });
                      return;
                    }
                    setAssetPreviewState({
                      title: item.kind === "txt" ? "论文文本" : item.kind === "md" ? "Markdown" : item.kind === "bib" ? "BibTeX" : item.kind,
                      kind: item.kind,
                      url,
                      filename: item.filename,
                    });
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
                      addNodesToChatContext([selectedNode.id]);
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
                  providerStatus={configQuery.data?.provider_status || []}
                  error={eventsState.error}
                  onStart={() => workbenchAction.mutate({ type: "quick", action: "auto_start" })}
                  onGuidance={(text) => workbenchAction.mutate({ type: "guidance", text })}
                  onContinue={() => workbenchAction.mutate({ type: "auto_continue" })}
                  onCancel={() => workbenchAction.mutate({ type: "auto_cancel" })}
                />
              </div>
            )}
          </div>
        </aside>
      }
      />
      {assetPreviewState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-6 py-10 backdrop-blur-sm">
          <div className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-5">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Asset Preview</div>
                <div className="mt-1 truncate text-xl font-semibold text-slate-900">{assetPreviewState.title}</div>
                {assetPreviewState.filename ? <div className="mt-1 truncate text-xs text-slate-500">{assetPreviewState.filename}</div> : null}
              </div>
              <SmallButton onClick={() => setAssetPreviewState(null)}>关闭</SmallButton>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-6">
              {assetPreviewQuery.isLoading ? <div className="rounded-2xl bg-white p-4 text-sm text-slate-500">正在加载文本资产...</div> : null}
              {assetPreviewQuery.error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                  {assetPreviewQuery.error instanceof Error ? assetPreviewQuery.error.message : "文本资产加载失败"}
                </div>
              ) : null}
              {assetPreviewQuery.data ? (
                <pre className="whitespace-pre-wrap break-words rounded-3xl border border-slate-200 bg-white p-5 text-sm leading-7 text-slate-700">
                  {assetPreviewQuery.data}
                </pre>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {centerSheetMode ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/30 px-6 py-10 backdrop-blur-sm">
          <div className="w-full max-w-5xl overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
            <div className="flex items-start justify-between border-b border-slate-200 px-6 py-5">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Workspace Sheet</div>
                <div className="mt-1 text-xl font-semibold text-slate-900">
                  {centerSheetMode === "overview"
                    ? "工作台总览"
                    : centerSheetMode === "project"
                      ? "项目面板"
                      : centerSheetMode === "task"
                        ? "任务面板"
                        : centerSheetMode === "collection"
                          ? "Collection 面板"
                          : "导入文献"}
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {centerSheetMode === "overview"
                    ? "从这里查看当前项目概览、最近任务，并跳转到对应配置面板。"
                    : centerSheetMode === "project"
                      ? "左侧只保留项目入口，具体的选择与新建在中央完成。"
                      : centerSheetMode === "task"
                        ? "在当前项目内切换任务，或创建新的研究任务。"
                        : centerSheetMode === "collection"
                          ? pendingCollectionPaperIds.length
                            ? `将 ${pendingCollectionPaperIds.length} 篇已选论文加入已有 Collection，或先新建 Collection。`
                            : "在当前项目内选择 Collection，或创建新的可复用论文集合。"
                          : "推荐导入 Zotero Desktop 导出的 CSL JSON 或 BibTeX 文件。"}
                </div>
              </div>
              <SmallButton onClick={closeCenterSheet}>关闭</SmallButton>
            </div>

            {centerSheetMode === "overview" ? (
              <div className="grid gap-6 px-6 py-6 md:grid-cols-[1.05fr,0.95fr]">
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <MetricPanel label="项目" value={String(projectsQuery.data?.items?.length || 0)} />
                    <MetricPanel label="任务" value={String(tasksQuery.data?.items?.length || 0)} />
                    <MetricPanel label="Collection" value={String(collectionsQuery.data?.items?.length || 0)} />
                    <MetricPanel label="论文" value={String(dashboardQuery.data?.paper_count || 0)} />
                  </div>
                  <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                    <div className="text-sm font-semibold text-slate-900">当前项目</div>
                    <div className="mt-3 text-lg font-semibold text-slate-900">{activeProject?.name || "未选择项目"}</div>
                    <div className="mt-2 text-sm leading-6 text-slate-600">
                      {activeProject?.description || "项目用于组织长期主题，任务承载具体研究流程，Collection 用来沉淀可复用的论文集合。"}
                    </div>
                    {activeTask ? (
                      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">当前任务</div>
                        <div className="mt-2 text-sm font-medium text-slate-900">{activeTask.topic}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {activeTask.mode === "openclaw_auto" ? "OpenClaw Auto" : "GPT Step"} · {activeTask.status}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="text-sm font-semibold text-slate-900">快捷入口</div>
                  <div className="mt-4 grid gap-3">
                    <SmallButton tone="solid" onClick={() => openCenterSheet("project")}>
                      打开项目面板
                    </SmallButton>
                    <SmallButton onClick={() => openCenterSheet("task")}>打开任务面板</SmallButton>
                    <SmallButton onClick={() => openCenterSheet("collection")}>打开 Collection 面板</SmallButton>
                    <SmallButton onClick={() => openCenterSheet("import")}>导入文献</SmallButton>
                  </div>
                  <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
                    当前左侧栏只保留入口按钮，所有详细配置、列表切换和导入动作都统一收口到这里。
                  </div>
                </div>
              </div>
            ) : null}

            {centerSheetMode === "project" ? (
              <div className="grid gap-6 px-6 py-6 md:grid-cols-[1.1fr,0.9fr]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="text-sm font-semibold text-slate-900">项目列表</div>
                  <div className="mt-4 space-y-3">
                    {(projectsQuery.data?.items || []).map((project) => (
                      <button
                        key={project.project_id}
                        className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                          project.project_id === activeProjectId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 hover:border-slate-300"
                        }`}
                        onClick={() => selectProject(project.project_id)}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="line-clamp-1 text-sm font-medium">{project.name}</div>
                          <div className={`text-[11px] ${project.project_id === activeProjectId ? "text-slate-300" : "text-slate-400"}`}>
                            任务 {project.task_count} · Collection {project.collection_count}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">新建项目</div>
                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <div className="text-sm font-medium text-slate-900">项目名称</div>
                      <input
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                        value={projectDraft.name}
                        onChange={(event) => setProjectDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="例如：Embodied AI Long-term Study"
                      />
                    </label>
                    <label className="block">
                      <div className="text-sm font-medium text-slate-900">说明</div>
                      <textarea
                        className="mt-2 h-28 w-full rounded-3xl border border-slate-200 bg-white px-4 py-4 text-sm outline-none"
                        value={projectDraft.description}
                        onChange={(event) => setProjectDraft((current) => ({ ...current, description: event.target.value }))}
                        placeholder="可选，记录这个项目希望长期追踪的问题与范围。"
                      />
                    </label>
                    <SmallButton
                      className="w-full"
                      tone="solid"
                      disabled={!projectDraft.name.trim() || createProject.isPending}
                      onClick={() => createProject.mutate(projectDraft)}
                    >
                      {createProject.isPending ? "创建中..." : "创建项目"}
                    </SmallButton>
                  </div>
                </div>
              </div>
            ) : null}

            {centerSheetMode === "task" ? (
              <div className="grid gap-6 px-6 py-6 md:grid-cols-[0.95fr,1.05fr]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">当前项目任务</div>
                    <div className="text-xs text-slate-500">{activeProject?.name || "未选择项目"}</div>
                  </div>
                  {!activeProjectId ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">请先在“项目面板”里选择一个项目。</div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {(tasksQuery.data?.items || []).map((task) => (
                        <button
                          key={task.task_id}
                          className={`w-full rounded-3xl border px-4 py-4 text-left transition ${
                            task.task_id === activeTaskId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 hover:border-slate-300"
                          }`}
                          onClick={() => selectTask(task.task_id)}
                        >
                          <div className="line-clamp-2 text-sm font-medium">{task.topic}</div>
                          <div className={`mt-2 text-xs ${task.task_id === activeTaskId ? "text-slate-300" : "text-slate-500"}`}>
                            {task.mode === "openclaw_auto" ? "OpenClaw Auto" : "GPT Step"} · {task.status}
                          </div>
                        </button>
                      ))}
                      {!tasksQuery.data?.items?.length ? <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">当前项目还没有研究任务。</div> : null}
                    </div>
                  )}
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">新建研究任务</div>
                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <div className="text-sm font-medium text-slate-900">研究主题</div>
                      <textarea
                        className="mt-2 h-32 w-full rounded-3xl border border-slate-200 bg-white px-4 py-4 text-sm outline-none"
                        value={taskDraft.topic}
                        onChange={(event) => setTaskDraft((current) => ({ ...current, topic: event.target.value }))}
                        placeholder="例如：围绕具身智能中的世界模型、VLA 与数据效率做一轮可继续迭代的研究。"
                      />
                    </label>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="block">
                        <div className="text-sm font-medium text-slate-900">模式</div>
                        <select
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          value={taskDraft.mode}
                          onChange={(event) =>
                            setTaskDraft((current) => ({
                              ...current,
                              mode: event.target.value as TaskMode,
                              llm_backend: event.target.value === "openclaw_auto" ? "openclaw" : current.llm_backend === "openclaw" ? "gpt" : current.llm_backend,
                              llm_model:
                                event.target.value === "openclaw_auto"
                                  ? configQuery.data?.default_openclaw_model || "main"
                                  : configQuery.data?.default_gpt_model || "gpt-5.4",
                            }))
                          }
                        >
                          <option value="gpt_step">GPT Step</option>
                          <option value="openclaw_auto">OpenClaw Auto</option>
                        </select>
                      </label>
                      <label className="block">
                        <div className="text-sm font-medium text-slate-900">Backend</div>
                        <select
                          className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                          value={taskDraft.llm_backend}
                          disabled={taskDraft.mode === "openclaw_auto"}
                          onChange={(event) => setTaskDraft((current) => ({ ...current, llm_backend: event.target.value as Backend }))}
                        >
                          <option value="gpt">GPT API</option>
                          <option value="openclaw">OpenClaw</option>
                        </select>
                      </label>
                    </div>
                    <label className="block">
                      <div className="text-sm font-medium text-slate-900">模型</div>
                      <input
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                        value={taskDraft.llm_model}
                        onChange={(event) => setTaskDraft((current) => ({ ...current, llm_model: event.target.value }))}
                        placeholder="例如 gpt-5.4 / main"
                      />
                    </label>
                    <SmallButton
                      className="w-full"
                      tone="solid"
                      disabled={!activeProjectId || !taskDraft.topic.trim() || createTask.isPending}
                      onClick={() => createTask.mutate(taskDraft)}
                    >
                      {createTask.isPending ? "创建中..." : "创建研究任务"}
                    </SmallButton>
                  </div>
                </div>
              </div>
            ) : null}

            {centerSheetMode === "collection" ? (
              <div className="grid gap-6 px-6 py-6 md:grid-cols-[1.05fr,0.95fr]">
                <div className="rounded-[28px] border border-slate-200 bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900">当前项目 Collections</div>
                    <div className="text-xs text-slate-500">{activeProject?.name || "未选择项目"}</div>
                  </div>
                  {pendingCollectionPaperIds.length ? (
                    <div className="mt-4 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
                      当前待加入 {pendingCollectionPaperIds.length} 篇论文。选择已有 Collection 后会直接加入。
                    </div>
                  ) : null}
                  {!activeProjectId ? (
                    <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">请先在“项目面板”里选择一个项目。</div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {(collectionsQuery.data?.items || []).map((collection) => (
                        <div key={collection.collection_id} className={`rounded-3xl border px-4 py-4 ${collection.collection_id === activeCollectionId ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-slate-50"}`}>
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="line-clamp-1 text-sm font-medium text-slate-900">{collection.name}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {collection.item_count} 项 · {collection.source_type}
                              </div>
                            </div>
                            <SmallButton
                              tone={pendingCollectionPaperIds.length ? "solid" : "slate"}
                              disabled={addItemsToCollection.isPending}
                              onClick={() => {
                                if (pendingCollectionPaperIds.length) {
                                  handleAttachSelectionToCollection(collection.collection_id).catch((cause) => {
                                    setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
                                  });
                                  return;
                                }
                                selectCollection(collection.collection_id);
                              }}
                            >
                              {pendingCollectionPaperIds.length ? "加入所选论文" : "查看详情"}
                            </SmallButton>
                          </div>
                        </div>
                      ))}
                      {!collectionsQuery.data?.items?.length ? <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">当前项目还没有 Collection。</div> : null}
                    </div>
                  )}
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">{pendingCollectionPaperIds.length ? "新建 Collection 并加入所选论文" : "新建 Collection"}</div>
                  <div className="mt-4 space-y-4">
                    <label className="block">
                      <div className="text-sm font-medium text-slate-900">Collection 名称</div>
                      <input
                        className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                        value={collectionDraft.name}
                        onChange={(event) => setCollectionDraft((current) => ({ ...current, name: event.target.value }))}
                        placeholder="例如：Embodied AI Core Papers"
                      />
                    </label>
                    <label className="block">
                      <div className="text-sm font-medium text-slate-900">说明</div>
                      <textarea
                        className="mt-2 h-32 w-full rounded-3xl border border-slate-200 bg-white px-4 py-4 text-sm outline-none"
                        value={collectionDraft.description}
                        onChange={(event) => setCollectionDraft((current) => ({ ...current, description: event.target.value }))}
                        placeholder="记录这个 Collection 的来源、用途或准备支持的研究问题。"
                      />
                    </label>
                    <SmallButton
                      className="w-full"
                      tone="solid"
                      disabled={!activeProjectId || !collectionDraft.name.trim() || createCollection.isPending || addItemsToCollection.isPending}
                      onClick={() => {
                        handleCreateCollectionFromSheet().catch((cause) => {
                          setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
                        });
                      }}
                    >
                      {createCollection.isPending || addItemsToCollection.isPending ? "处理中..." : pendingCollectionPaperIds.length ? "创建并加入论文" : "创建 Collection"}
                    </SmallButton>
                  </div>
                </div>
              </div>
            ) : null}

            {centerSheetMode === "import" ? (
              <div className="grid gap-6 px-6 py-6 md:grid-cols-[1.1fr,0.9fr]">
                <div className="space-y-4">
                  <label className="block">
                    <div className="text-sm font-medium text-slate-900">选择文件</div>
                    <input
                      className="mt-2 block w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      type="file"
                      accept=".json,.csljson,.bib"
                      onChange={(event) => setImportFile(event.target.files?.[0] || null)}
                    />
                  </label>
                  <label className="block">
                    <div className="text-sm font-medium text-slate-900">Collection 名称</div>
                    <input
                      className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
                      value={importCollectionName}
                      onChange={(event) => setImportCollectionName(event.target.value)}
                      placeholder="留空时默认使用文件名"
                    />
                  </label>
                </div>
                <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-5">
                  <div className="text-sm font-semibold text-slate-900">导入说明</div>
                  <div className="mt-3 text-sm leading-6 text-slate-600">
                    默认走本地导入主路径，不需要配置 Zotero API Key。导入结果会落到当前项目下的新 Collection。
                  </div>
                  <div className="mt-3 text-xs text-slate-500">支持格式：{zoteroConfigQuery.data?.import_formats?.join(" / ") || "csljson / bib"}</div>
                  <SmallButton
                    className="mt-5 w-full"
                    tone="solid"
                    disabled={!importFile || importZoteroLocal.isPending}
                    onClick={() => importFile && importZoteroLocal.mutate({ file: importFile, collectionName: importCollectionName || undefined })}
                  >
                    {importZoteroLocal.isPending ? "导入中..." : "开始导入"}
                  </SmallButton>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
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

function MetricPanel(props: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{props.label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{props.value}</div>
    </div>
  );
}

function isSameViewport(
  left: { x: number; y: number; zoom: number },
  right: { x: number; y: number; zoom: number },
) {
  return Math.abs(left.x - right.x) < 0.5 && Math.abs(left.y - right.y) < 0.5 && Math.abs(left.zoom - right.zoom) < 0.01;
}

