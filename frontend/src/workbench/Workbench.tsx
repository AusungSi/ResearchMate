import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEdgesState, useNodesState, type Connection, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
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
import { SectionTitle, SmallButton } from "./components/shared";
import { useRunEvents } from "./hooks/useRunEvents";
import type {
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
  manualNodeDefaultLabel,
  mergeCanvasWithGraph,
  reconcileFlowState,
  runAutoLayout,
  selectedPaperNodes,
} from "./utils";

type ExportFormat = "md" | "bib" | "json" | "csljson";

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

export function Workbench() {
  const client = useQueryClient();
  const [activeProjectId, setActiveProjectId] = useState("");
  const [activeTaskId, setActiveTaskId] = useState("");
  const [activeCollectionId, setActiveCollectionId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [runId, setRunId] = useState("");
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [uiState, setUiState] = useState<CanvasUiState>(defaultCanvasUi());
  const [pdfUrl, setPdfUrl] = useState("");
  const [chatByNode, setChatByNode] = useState<Record<string, ChatItem[]>>({});
  const [roundCandidates, setRoundCandidates] = useState<Record<number, RoundCandidate[]>>({});
  const [actionStatus, setActionStatus] = useState<ActionStatus | null>(null);
  const [compareReport, setCompareReport] = useState<CompareReport | null>(null);
  const [collectionSearchText, setCollectionSearchText] = useState("");
  const [collectionLimit, setCollectionLimit] = useState(50);
  const [selectedCollectionItemIds, setSelectedCollectionItemIds] = useState<number[]>([]);
  const flowRef = useRef<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null);
  const zoteroFileInputRef = useRef<HTMLInputElement | null>(null);
  const persistTimer = useRef<number | null>(null);
  const suppressViewportPersistRef = useRef(false);
  const interactionLockRef = useRef(false);
  const lastSavedCanvasSignature = useRef("");
  const pendingCanvasSignature = useRef("");
  const nodesRef = useRef<Array<Node<FlowNodeData>>>([]);
  const edgesRef = useRef<Array<Edge>>([]);
  const viewportRef = useRef(viewport);
  const layoutSignatureRef = useRef("");

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

  const activeTask = taskQuery.data || null;
  const eventsState = useRunEvents({
    taskId: activeTaskId,
    runId,
    enabled: Boolean(activeTaskId && runId),
    intervalMs: activeTask?.mode === "openclaw_auto" ? 3000 : 4000,
  });

  const merged = useMemo(
    () => mergeCanvasWithGraph(graphQuery.data, canvasQuery.data, eventsState.items, configQuery.data?.default_canvas_ui || defaultCanvasUi()),
    [graphQuery.data, canvasQuery.data, configQuery.data?.default_canvas_ui, eventsState.items],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
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
    const reconciled = reconcileFlowState(nodesRef.current, edgesRef.current, merged.nodes, merged.edges);
    setNodes(reconciled.nodes);
    setEdges(reconciled.edges);
    if (!interactionLockRef.current && !isSameViewport(viewportRef.current, merged.viewport)) {
      setViewport(merged.viewport);
      if (flowRef.current) {
        suppressViewportPersistRef.current = true;
        flowRef.current.setViewport(merged.viewport, { duration: 120 });
      }
    }
  }, [merged, setEdges, setNodes]);

  const canonicalSignature = useMemo(() => canonicalGraphSignature(graphQuery.data, eventsState.items), [graphQuery.data, eventsState.items]);

  useEffect(() => {
    if (!activeTaskId || !nodesRef.current.length || interactionLockRef.current) return;
    if (layoutSignatureRef.current === `${activeTaskId}:${canonicalSignature}:${uiState.layout_mode}`) return;
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
        layoutSignatureRef.current = `${activeTaskId}:${canonicalSignature}:${uiState.layout_mode}`;
        setNodes(nextNodes);
        queueSave(nextNodes, edgesRef.current, viewportRef.current, uiState);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [activeTaskId, canonicalSignature, setNodes, uiState]);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId("");
    }
  }, [nodes, selectedNodeId]);

  useEffect(() => {
    return () => {
      if (persistTimer.current) {
        window.clearTimeout(persistTimer.current);
      }
    };
  }, []);

  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedPaperId = selectedNode?.id && isPaperNode(selectedNode.id) ? selectedNode.id : "";
  const selectedPaperCount = useMemo(() => selectedPaperNodes(nodes).length, [nodes]);
  const selectedFulltextItem = useMemo(
    () => fulltextStatusQuery.data?.items.find((item) => item.paper_id === selectedPaperId) || null,
    [fulltextStatusQuery.data?.items, selectedPaperId],
  );

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

  const saveCanvas = useMutation({
    mutationFn: (payload: CanvasResponse) =>
      apiFetch<CanvasResponse>(`/api/v1/research/tasks/${activeTaskId}/canvas`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => {
      lastSavedCanvasSignature.current = canvasPayloadSignature(data);
      pendingCanvasSignature.current = "";
      client.setQueryData(["canvas", activeTaskId], data);
    },
    onError: (cause) => {
      pendingCanvasSignature.current = "";
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
      saveCanvas.mutate(payload);
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
      apiFetch<{ path: string }>(`/api/v1/research/tasks/${activeTaskId}/export?format=${format}`),
    onSuccess: (data, format) => {
      setActionStatus({ tone: "success", text: `${format.toUpperCase()} 导出完成：${data.path}` });
      client.invalidateQueries({ queryKey: ["task-exports", activeTaskId] });
      client.invalidateQueries({ queryKey: ["project-dashboard", activeProjectId] });
    },
    onError: (cause) => {
      setActionStatus({ tone: "danger", text: cause instanceof Error ? cause.message : String(cause) });
    },
  });

  const exportCollection = useMutation({
    mutationFn: async (payload: { collectionId: string; format: "bib" | "csljson" }) =>
      apiFetch<{ path: string }>(`/api/v1/research/collections/${payload.collectionId}/export?format=${payload.format}`),
    onSuccess: (data, payload) => {
      setActionStatus({ tone: "success", text: `Collection ${payload.format.toUpperCase()} 导出完成：${data.path}` });
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
            return apiFetch(`/api/v1/research/tasks/${activeTaskId}/plan`, { method: "POST" });
          }
          if (action.action === "search_first") {
            return apiFetch(`/api/v1/research/tasks/${activeTaskId}/search`, {
              method: "POST",
              body: JSON.stringify({ direction_index: 1, top_n: 12 }),
            });
          }
          if (action.action === "build_graph") {
            return apiFetch(`/api/v1/research/tasks/${activeTaskId}/graph/build`, {
              method: "POST",
              body: JSON.stringify({ view: "tree" }),
            });
          }
          if (action.action === "build_fulltext") {
            return apiFetch(`/api/v1/research/tasks/${activeTaskId}/fulltext/build`, { method: "POST" });
          }
          if (action.action === "auto_start") {
            return apiFetch<{ run_id: string }>(`/api/v1/research/tasks/${activeTaskId}/auto/start`, { method: "POST" });
          }
          return null;
        case "search_direction":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/search`, {
            method: "POST",
            body: JSON.stringify({ direction_index: action.directionIndex, top_n: 12 }),
          });
        case "start_explore":
          return apiFetch<{ round_id: number }>(`/api/v1/research/tasks/${activeTaskId}/explore/start`, {
            method: "POST",
            body: JSON.stringify({ direction_index: action.directionIndex, top_n: 8 }),
          });
        case "build_graph":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/graph/build`, {
            method: "POST",
            body: JSON.stringify({
              view: action.roundId ? "citation" : "tree",
              direction_index: action.directionIndex,
              round_id: action.roundId,
            }),
          });
        case "propose":
          return apiFetch<{ round_id: number; candidates: RoundCandidate[] }>(`/api/v1/research/tasks/${activeTaskId}/explore/rounds/${action.roundId}/propose`, {
            method: "POST",
            body: JSON.stringify({ action: action.action, feedback_text: action.feedbackText, candidate_count: 4 }),
          });
        case "select_candidate":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/explore/rounds/${action.roundId}/select`, {
            method: "POST",
            body: JSON.stringify({ candidate_id: action.candidateId, top_n: 8 }),
          });
        case "next_round":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/explore/rounds/${action.roundId}/next`, {
            method: "POST",
            body: JSON.stringify({ intent_text: action.intentText, top_n: 8 }),
          });
        case "save_paper":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(action.paperId)}/save`, {
            method: "POST",
            body: JSON.stringify({}),
          });
        case "summarize_paper":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(action.paperId)}/summarize`, {
            method: "POST",
          });
        case "guidance":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/guidance`, {
            method: "POST",
            body: JSON.stringify({ text: action.text }),
          });
        case "auto_continue":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/continue`, { method: "POST" });
        case "auto_cancel":
          return apiFetch(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/cancel`, { method: "POST" });
        default:
          return null;
      }
    },
    onSuccess: (data, action) => {
      if (action.type === "quick" && action.action === "auto_start" && data && typeof data === "object" && "run_id" in data) {
        setRunId(String(data.run_id || ""));
      }
      if (action.type === "propose" && data && typeof data === "object" && "candidates" in data) {
        setRoundCandidates((current) => ({ ...current, [action.roundId]: (data.candidates as RoundCandidate[]) || [] }));
      }
      if (activeTask?.mode === "gpt_step") {
        setRunId(`step-${activeTaskId}`);
      }
      setActionStatus({ tone: "success", text: buildSuccessText(action) });
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
      setActionStatus({ tone: "neutral", text: "节点问答已更新" });
    },
    onError: (cause) => {
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
          label: label || manualNodeDefaultLabel(type),
          summary: summary || "这是一个手工工作台节点，可用于整理思路、记录问题、沉淀阶段总结或挂接参考资料。",
          isManual: true,
        },
      } as Node<FlowNodeData>,
    ];
    setNodes(nextNodes);
    queueSave(nextNodes, edgesRef.current);
  }

  function updateSelectedNote(note: string) {
    const nextNodes = nodesRef.current.map((node) => (node.id === selectedNodeId ? { ...node, data: { ...node.data, userNote: note } } : node));
    setNodes(nextNodes);
    queueSave(nextNodes, edgesRef.current);
  }

  function toggleSelectedHidden() {
    if (!selectedNodeId) return;
    const nextNodes = nodesRef.current.map((node) => (node.id === selectedNodeId ? { ...node, hidden: !node.hidden } : node));
    setNodes(nextNodes);
    queueSave(nextNodes, edgesRef.current);
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
    if (!selected.length) return;
    const collectionId = await ensureCollectionForSelection();
    await addItemsToCollection.mutateAsync({
      collectionId,
      items: selected.map((node) => ({ task_id: activeTaskId, paper_id: node.id })),
    });
  }

  async function handleCreateStudyFromSelection() {
    if (!activeTaskId) return;
    const selected = selectedPaperNodes(nodesRef.current);
    if (!selected.length) return;
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
          currentExports={taskExportsQuery.data?.items || []}
          zoteroConfig={zoteroConfigQuery.data || null}
          projects={projectsQuery.data?.items || []}
          tasks={tasksQuery.data?.items || []}
          collections={collectionsQuery.data?.items || []}
          activeProjectId={activeProjectId}
          activeTaskId={activeTaskId}
          activeCollectionId={activeCollectionId}
          activeTask={activeTask}
          actionStatus={actionStatus}
          onSelectProject={(projectId) => {
            setActiveProjectId(projectId);
            setActiveCollectionId("");
            setActionStatus(null);
          }}
          onSelectTask={(taskId) => {
            setActiveTaskId(taskId);
            setSelectedNodeId("");
            setPdfUrl("");
            setChatByNode({});
            setRoundCandidates({});
            setCompareReport(null);
            setActionStatus(null);
          }}
          onSelectCollection={(collectionId) => setActiveCollectionId(collectionId)}
          onCreateProject={(payload) => createProject.mutate(payload)}
          onCreateCollection={(payload) => createCollection.mutate(payload)}
          onCreateTask={(payload) => createTask.mutate(payload)}
          onQuickAction={(action) => workbenchAction.mutate({ type: "quick", action })}
          onImportZoteroFile={() => zoteroFileInputRef.current?.click()}
          onExport={(format) => exportTask.mutate(format)}
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
                  {activeTask ? `${activeTask.topic} · ${merged.nodes.length} 个节点 / ${merged.edges.length} 条连线` : "请选择任务，或先在左侧创建一个新的研究任务。"}
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  系统节点来自 canonical graph，手工节点与手工连线只写入 canvas state。多选论文卡片后可以直接加入 Collection 或做 Compare。
                </div>
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
                    queueSave(nodesRef.current, edgesRef.current, viewportRef.current, next);
                  }}
                >
                  <option value="elk_layered">ELK Layered</option>
                  <option value="elk_stress">ELK Stress</option>
                </select>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600">已选论文 {selectedPaperCount}</div>
              </div>
            </div>
          </div>

          <div className="h-[calc(100%-86px)]">
            <ResearchCanvas
              nodes={nodes}
              edges={edges}
              showMiniMap={uiState.show_minimap}
              flowRef={flowRef}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={(connection: Connection) => {
                const nextEdges = buildManualConnection(connection, edgesRef.current);
                setEdges(nextEdges);
                queueSave(nodesRef.current, nextEdges);
              }}
              onNodeClick={(nodeId) => setSelectedNodeId(nodeId)}
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
              onNodesDelete={(deleted) => {
                const manualIds = new Set(deleted.filter((node) => Boolean(node.data?.isManual)).map((node) => node.id));
                const nextNodes = nodesRef.current.filter((node) => !manualIds.has(node.id));
                setNodes(nextNodes);
                queueSave(nextNodes, edgesRef.current);
              }}
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
        <aside className="h-full overflow-auto bg-slate-50/60 p-5">
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
                    <div className="mt-1 break-all">{item.output_path || item.error || "无路径"}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <ComparePanel report={compareReport} onSaveAsNote={() => saveCompareAsNode("note")} onSaveAsReport={() => saveCompareAsNode("report")} onClose={() => setCompareReport(null)} />

          <div className="mt-4">
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
          </div>

          <div className="mt-4">
            <DetailPanel
              mode={activeTask?.mode || "gpt_step"}
              node={selectedNode}
              paperDetail={paperDetailQuery.data || null}
              paperAssets={paperAssetQuery.data || null}
              roundCandidates={selectedRoundCandidates}
              onUpdateNote={updateSelectedNote}
              onToggleHidden={toggleSelectedHidden}
              onOpenPdf={() => {
                const pdf = paperAssetQuery.data?.items.find((item) => item.kind === "pdf" && item.status === "available");
                setPdfUrl(pdf?.download_url || "");
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
              onAskPreset={(question) => selectedNode && nodeChat.mutate({ nodeId: selectedNode.id, question })}
            />
          </div>

          <ContextChatPanel
            disabled={!selectedNode}
            history={selectedNode ? chatByNode[selectedNode.id] || [] : []}
            onSend={(question, threadId) => selectedNode && nodeChat.mutate({ nodeId: selectedNode.id, question, threadId })}
            onSaveAnswer={saveChatAnswerAsNode}
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
              pdfUrl={pdfUrl}
              assets={paperAssetQuery.data || null}
              fulltextItem={selectedFulltextItem}
              fulltextSummary={fulltextStatusQuery.data?.summary || null}
              busy={uploadPdf.isPending || workbenchAction.isPending || rebuildPaperVisual.isPending}
              onClose={() => setPdfUrl("")}
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
}

function isSameViewport(
  left: { x: number; y: number; zoom: number },
  right: { x: number; y: number; zoom: number },
) {
  return Math.abs(left.x - right.x) < 0.5 && Math.abs(left.y - right.y) < 0.5 && Math.abs(left.zoom - right.zoom) < 0.01;
}

