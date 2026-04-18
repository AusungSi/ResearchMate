import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "./lib/api";

type TaskMode = "gpt_step" | "openclaw_auto";
type Backend = "gpt" | "openclaw";

type TaskSummary = {
  task_id: string;
  topic: string;
  status: string;
  mode: TaskMode;
  llm_backend: Backend;
  llm_model?: string | null;
  auto_status: string;
  latest_run_id?: string | null;
  directions: Array<{ direction_index: number; name: string; papers_count: number }>;
};

type GraphNode = {
  id: string;
  type: string;
  label: string;
  year?: number | null;
  source?: string | null;
  venue?: string | null;
  abstract?: string | null;
  method_summary?: string | null;
  direction_index?: number | null;
  status?: string | null;
  feedback_text?: string | null;
  summary?: string | null;
};

type GraphEdge = { source: string; target: string; type: string; weight?: number };
type GraphResponse = { task_id: string; status: string; view: string; nodes: GraphNode[]; edges: GraphEdge[] };
type CanvasResponse = {
  task_id: string;
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data?: Record<string, unknown>; hidden?: boolean }>;
  edges: Array<{ id: string; source: string; target: string; type?: string; data?: Record<string, unknown>; hidden?: boolean }>;
  viewport: { x: number; y: number; zoom: number };
};
type RunEvent = { run_id: string; task_id: string; event_type: string; seq: number; payload: Record<string, unknown>; created_at: string };
type RunEventsResponse = { task_id: string; run_id: string; items: RunEvent[] };
type ChatItem = { task_id: string; node_id: string; thread_id: string; question: string; answer: string; provider: string; model?: string | null; created_at: string };
type ChatResponse = { task_id: string; node_id: string; thread_id: string; item: ChatItem; history: ChatItem[] };
type FlowNodeData = GraphNode & { userNote?: string; isManual?: boolean };

const queryClient = new QueryClient();

const edgeVisual = {
  type: "smoothstep" as const,
  style: { stroke: "#64748b", strokeWidth: 2.5 },
  markerEnd: {
    type: MarkerType.ArrowClosed,
    color: "#64748b",
    width: 18,
    height: 18,
  },
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Workbench />
    </QueryClientProvider>
  );
}

function Workbench() {
  const client = useQueryClient();
  const [activeTaskId, setActiveTaskId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [runId, setRunId] = useState("");
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [pdfUrl, setPdfUrl] = useState("");
  const [chatByNode, setChatByNode] = useState<Record<string, ChatItem[]>>({});
  const flowRef = useRef<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>(null);
  const persistTimer = useRef<number | null>(null);

  const tasksQuery = useQuery({
    queryKey: ["tasks"],
    queryFn: () => apiFetch<{ items: TaskSummary[] }>("/api/v1/research/tasks?limit=50"),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!activeTaskId && tasksQuery.data?.items?.length) {
      setActiveTaskId(tasksQuery.data.items[0].task_id);
    }
  }, [activeTaskId, tasksQuery.data]);

  const taskQuery = useQuery({
    queryKey: ["task", activeTaskId],
    queryFn: () => apiFetch<TaskSummary>(`/api/v1/research/tasks/${activeTaskId}`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!runId && taskQuery.data?.latest_run_id) {
      setRunId(taskQuery.data.latest_run_id);
    }
  }, [runId, taskQuery.data]);

  const graphQuery = useQuery({
    queryKey: ["graph", activeTaskId],
    queryFn: () => apiFetch<GraphResponse>(`/api/v1/research/tasks/${activeTaskId}/graph?view=tree&include_papers=true&paper_limit=12`),
    enabled: Boolean(activeTaskId),
    refetchInterval: 5000,
  });

  const canvasQuery = useQuery({
    queryKey: ["canvas", activeTaskId],
    queryFn: () => apiFetch<CanvasResponse>(`/api/v1/research/tasks/${activeTaskId}/canvas`),
    enabled: Boolean(activeTaskId),
  });

  const eventsQuery = useQuery({
    queryKey: ["events", activeTaskId, runId],
    queryFn: () => apiFetch<RunEventsResponse>(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/events`),
    enabled: Boolean(activeTaskId && runId),
    refetchInterval: taskQuery.data?.mode === "openclaw_auto" ? 3000 : false,
  });

  const merged = useMemo(() => mergeCanvasWithGraph(graphQuery.data, canvasQuery.data), [graphQuery.data, canvasQuery.data]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>(merged.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(merged.edges);

  useEffect(() => {
    setNodes(merged.nodes);
    setEdges(merged.edges);
    setViewport(merged.viewport);
    if (flowRef.current) {
      flowRef.current.setViewport(merged.viewport, { duration: 200 });
    }
  }, [merged, setEdges, setNodes]);

  const saveCanvas = useMutation({
    mutationFn: (payload: CanvasResponse) =>
      apiFetch<CanvasResponse>(`/api/v1/research/tasks/${activeTaskId}/canvas`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (data) => client.setQueryData(["canvas", activeTaskId], data),
  });

  function queueSave(nextNodes: Node<FlowNodeData>[], nextEdges: Edge[], nextViewport = viewport) {
    if (!activeTaskId) return;
    if (persistTimer.current) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      saveCanvas.mutate({
        task_id: activeTaskId,
        nodes: nextNodes.map((node) => ({
          id: node.id,
          type: String(node.data?.type || "note"),
          position: node.position,
          data: node.data,
          hidden: node.hidden,
        })),
        edges: nextEdges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          type: edge.type,
          data: edge.data as Record<string, unknown> | undefined,
          hidden: edge.hidden,
        })),
        viewport: nextViewport,
      });
    }, 400);
  }

  const createTask = useMutation({
    mutationFn: (payload: { topic: string; mode: TaskMode; llm_backend: Backend; llm_model: string }) =>
      apiFetch<TaskSummary>("/api/v1/research/tasks", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (task) => {
      setActiveTaskId(task.task_id);
      setRunId("");
      client.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const runAction = useMutation({
    mutationFn: async (action: string) => {
      if (!activeTaskId) return null;
      if (action === "plan") return apiFetch(`/api/v1/research/tasks/${activeTaskId}/plan`, { method: "POST" });
      if (action === "search-first") {
        return apiFetch(`/api/v1/research/tasks/${activeTaskId}/search`, {
          method: "POST",
          body: JSON.stringify({ direction_index: 1, top_n: 12 }),
        });
      }
      if (action === "graph") {
        return apiFetch(`/api/v1/research/tasks/${activeTaskId}/graph/build`, {
          method: "POST",
          body: JSON.stringify({ view: "tree" }),
        });
      }
      if (action === "fulltext") return apiFetch(`/api/v1/research/tasks/${activeTaskId}/fulltext/build`, { method: "POST" });
      if (action === "auto-start") {
        const data = await apiFetch<{ run_id: string }>(`/api/v1/research/tasks/${activeTaskId}/auto/start`, { method: "POST" });
        setRunId(data.run_id);
        return data;
      }
      if (action === "auto-continue") return apiFetch(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/continue`, { method: "POST" });
      if (action === "auto-cancel") return apiFetch(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/cancel`, { method: "POST" });
      return null;
    },
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["tasks"] });
      client.invalidateQueries({ queryKey: ["task", activeTaskId] });
      client.invalidateQueries({ queryKey: ["graph", activeTaskId] });
      client.invalidateQueries({ queryKey: ["events", activeTaskId, runId] });
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
    },
  });

  const submitGuidance = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/api/v1/research/tasks/${activeTaskId}/runs/${runId}/guidance`, {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ["events", activeTaskId, runId] });
    },
  });

  const activeTask = taskQuery.data || null;
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) || null;

  function addManualNode(type: "note" | "question" | "reference" | "group") {
    const id = `${type}:${Math.random().toString(16).slice(2, 10)}`;
    const nextNodes = [
      ...nodes,
      {
        id,
        type: "cardNode",
        position: { x: 300 + nodes.length * 10, y: 180 + nodes.length * 10 },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        data: {
          id,
          type,
          label: manualNodeDefaultLabel(type),
          summary: "这是一个手工工作台节点，可用于整理思路、记录问题或挂接参考资料。",
          isManual: true,
        },
      },
    ];
    setNodes(nextNodes);
    queueSave(nextNodes, edges);
  }

  function updateSelectedNote(note: string) {
    const nextNodes = nodes.map((node) =>
      node.id === selectedNodeId ? { ...node, data: { ...node.data, userNote: note } } : node,
    );
    setNodes(nextNodes);
    queueSave(nextNodes, edges);
  }

  return (
    <div className="min-h-screen bg-slate-100 p-5 text-slate-900">
      <div className="mx-auto h-[calc(100vh-40px)] max-w-[1600px] overflow-hidden rounded-[32px] border border-slate-200 bg-white shadow-[0_20px_80px_rgba(15,23,42,0.12)]">
        <div className="grid h-full grid-cols-[320px_1fr_400px]">
          <Sidebar
            tasks={tasksQuery.data?.items || []}
            activeTaskId={activeTaskId}
            activeTask={activeTask}
            onSelectTask={(taskId) => {
              setActiveTaskId(taskId);
              setRunId("");
            }}
            onCreateTask={(payload) => createTask.mutate(payload)}
            onAction={(action) => runAction.mutate(action)}
          />

          <main className="relative overflow-hidden bg-[radial-gradient(circle_at_20%_20%,rgba(59,130,246,0.06),transparent_26%),radial-gradient(circle_at_80%_20%,rgba(16,185,129,0.05),transparent_20%),linear-gradient(to_bottom,white,white)]">
            <div className="border-b border-slate-200 px-6 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Research Canvas</div>
                  <div className="mt-1 text-lg font-semibold">卡片式研究画布</div>
                  <div className="mt-1 text-sm text-slate-500">
                    {activeTask
                      ? `${activeTask.topic} · ${modeLabel(activeTask.mode)} · ${nodes.length} 个节点 / ${edges.length} 条连线`
                      : "请选择任务，或先创建一个新的研究任务。"}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">拖拽卡片可重新布局，左右两侧圆点可以手动连线。</div>
                </div>
                <button className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm" onClick={() => queueSave(nodes, edges)}>
                  保存画布
                </button>
              </div>
            </div>

            <div className="h-[calc(100%-86px)]">
              <ReactFlow
                fitView
                nodes={nodes}
                edges={edges}
                nodeTypes={{ cardNode: CardNode }}
                onNodesChange={(changes) => onNodesChange(changes)}
                onEdgesChange={(changes) => onEdgesChange(changes)}
                onNodeDragStop={() => queueSave(nodes, edges)}
                onNodesDelete={(deleted) => queueSave(nodes.filter((node) => !deleted.some((item) => item.id === node.id)), edges)}
                onEdgesDelete={(deleted) => queueSave(nodes, edges.filter((edge) => !deleted.some((item) => item.id === edge.id)))}
                onConnect={(connection: Connection) => {
                  const nextEdges = addEdge({ ...connection, ...edgeVisual, data: { kind: "manual" } }, edges);
                  setEdges(nextEdges);
                  queueSave(nodes, nextEdges);
                }}
                onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                onPaneClick={() => setSelectedNodeId("")}
                onMoveEnd={(_, nextViewport) => {
                  setViewport(nextViewport);
                  queueSave(nodes, edges, nextViewport);
                }}
                onInit={(instance) => {
                  flowRef.current = instance;
                }}
                defaultEdgeOptions={edgeVisual}
                connectionLineStyle={{ stroke: "#64748b", strokeWidth: 2.5 }}
              >
                <Background color="#e2e8f0" gap={26} />
                <MiniMap pannable zoomable />
                <Controls />
              </ReactFlow>
            </div>

            <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
              <div className="text-sm text-slate-500">快捷操作</div>
              <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white" onClick={() => addManualNode("note")}>
                添加笔记
              </button>
              <button className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700" onClick={() => addManualNode("question")}>
                添加问题
              </button>
              <button className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700" onClick={() => addManualNode("reference")}>
                添加参考
              </button>
            </div>
          </main>

          <aside className="border-l border-slate-200 bg-slate-50/60 p-5">
            <DetailPanel
              node={selectedNode}
              onOpenPdf={() => {
                if (!activeTaskId || !selectedNode || !String(selectedNode.id).startsWith("paper:")) return;
                setPdfUrl(`/api/v1/research/tasks/${activeTaskId}/papers/${encodeURIComponent(selectedNode.id)}/asset?kind=pdf`);
              }}
              onUpdateNote={updateSelectedNote}
            />
            <ChatPanel
              disabled={!selectedNode}
              history={selectedNode ? chatByNode[selectedNode.id] || [] : []}
              onSend={(question, threadId) => selectedNode && nodeChat.mutate({ nodeId: selectedNode.id, question, threadId })}
            />
            <TimelinePanel
              mode={activeTask?.mode || "gpt_step"}
              autoStatus={activeTask?.auto_status || ""}
              runId={runId}
              events={eventsQuery.data?.items || []}
              onGuidance={(text) => submitGuidance.mutate(text)}
              onContinue={() => runAction.mutate("auto-continue")}
              onCancel={() => runAction.mutate("auto-cancel")}
            />
            {pdfUrl && (
              <div className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">PDF / 全文</div>
                  <button className="rounded-xl border border-slate-200 px-3 py-1 text-xs text-slate-600" onClick={() => setPdfUrl("")}>
                    关闭
                  </button>
                </div>
                <iframe title="pdf-preview" src={pdfUrl} className="h-[420px] w-full border-0" />
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function Sidebar(props: {
  tasks: TaskSummary[];
  activeTaskId: string;
  activeTask: TaskSummary | null;
  onSelectTask: (taskId: string) => void;
  onCreateTask: (payload: { topic: string; mode: TaskMode; llm_backend: Backend; llm_model: string }) => void;
  onAction: (action: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<TaskMode>("gpt_step");
  const [backend, setBackend] = useState<Backend>("gpt");
  const [model, setModel] = useState("gpt-5.2");
  const taskReady = Boolean(props.activeTask);

  useEffect(() => {
    if (mode === "openclaw_auto") {
      setBackend("openclaw");
      setModel("openclaw");
    } else if (mode === "gpt_step" && backend === "openclaw") {
      setBackend("gpt");
      setModel("gpt-5.2");
    }
  }, [backend, mode]);

  return (
    <aside className="overflow-auto border-r border-slate-200 bg-slate-50/70 p-5">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Project View</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight">论文研究工作台</div>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Research-only 本地工作台。`GPT Step` 适合一步一步推进，`OpenClaw Auto` 会在 checkpoint 暂停，等待你给出下一步引导。
        </p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">创建任务</div>
        <textarea
          className="mt-3 h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="输入你的研究主题、问题或方向，例如：多智能体科研助手的论文调研框架"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm" value={mode} onChange={(e) => setMode(e.target.value as TaskMode)}>
            <option value="gpt_step">GPT Step</option>
            <option value="openclaw_auto">OpenClaw Auto</option>
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={backend}
            onChange={(e) => setBackend(e.target.value as Backend)}
            disabled={mode === "openclaw_auto"}
          >
            <option value="gpt">GPT API</option>
            <option value="openclaw">OpenClaw</option>
          </select>
        </div>
        <input
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="模型名称，例如 gpt-5.2"
        />
        <button
          className="mt-3 w-full rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={!topic.trim()}
          onClick={() => {
            props.onCreateTask({ topic, mode, llm_backend: backend, llm_model: model });
            setTopic("");
          }}
        >
          创建研究任务
        </button>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">测试说明</div>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <p>当前画布展示的是任务的真实研究图谱，不是前端写死的 demo 卡片。</p>
          <p>如果想快速看到更完整的节点和连线，推荐按顺序点击：</p>
          <p className="rounded-2xl bg-slate-50 px-3 py-2 text-slate-700">1. 规划方向 → 2. 检索方向 1 → 3. 构建树图</p>
          <p>卡片左右两侧的小圆点可以用来手工连线，拖动后会自动保存到 canvas。</p>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">API Key 配置</div>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <p>
            GPT 模式请在项目根目录的 <code>.env</code> 中填写：
          </p>
          <p className="rounded-2xl bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">RESEARCH_GPT_API_KEY=你的_API_Key</p>
          <p>
            如果你走兼容 OpenAI 的网关，也可以同时修改 <code>RESEARCH_GPT_BASE_URL</code>。
          </p>
          <p>
            OpenClaw 模式请填写 <code>OPENCLAW_ENABLED=true</code>、<code>OPENCLAW_BASE_URL</code> 和 <code>OPENCLAW_GATEWAY_TOKEN</code>。
          </p>
          <p>
            如果你想让论文检索更稳定，建议再补上 <code>SEMANTIC_SCHOLAR_API_KEY</code>，否则可能碰到 429 限流。
          </p>
          <p>修改完成后，重启 backend 和 worker 即可生效。</p>
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">快捷操作</div>
        <div className="mt-3 grid gap-2 text-sm">
          <ActionButton label="1. 规划方向" disabled={!taskReady} onClick={() => props.onAction("plan")} />
          <ActionButton label="2. 检索方向 1" disabled={!taskReady} onClick={() => props.onAction("search-first")} />
          <ActionButton label="3. 构建树图" disabled={!taskReady} onClick={() => props.onAction("graph")} />
          <ActionButton label="4. 构建全文" disabled={!taskReady} onClick={() => props.onAction("fulltext")} />
          {props.activeTask?.mode === "openclaw_auto" && (
            <button className="rounded-2xl bg-slate-900 px-3 py-2 text-left text-white" onClick={() => props.onAction("auto-start")}>
              启动自动调研
            </button>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium">任务列表</div>
        <div className="mt-3 space-y-2">
          {props.tasks.map((task) => (
            <button
              key={task.task_id}
              className={`w-full rounded-2xl border px-3 py-3 text-left ${
                task.task_id === props.activeTaskId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50"
              }`}
              onClick={() => props.onSelectTask(task.task_id)}
            >
              <div className="text-sm font-medium">{task.topic}</div>
              <div className={`mt-1 text-xs ${task.task_id === props.activeTaskId ? "text-slate-300" : "text-slate-500"}`}>
                {modeLabel(task.mode)} · 状态 {task.status} · 自动 {autoStatusLabel(task.auto_status)}
              </div>
              <div className={`mt-1 text-[11px] ${task.task_id === props.activeTaskId ? "text-slate-400" : "text-slate-400"}`}>
                {backendLabel(task.llm_backend)}
                {task.llm_model ? ` / ${task.llm_model}` : ""}
              </div>
            </button>
          ))}
          {!props.tasks.length && <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">还没有任务，先创建一个研究主题吧。</div>}
        </div>
      </section>
    </aside>
  );
}

function ActionButton(props: { label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      className="rounded-2xl border border-slate-200 px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.label}
    </button>
  );
}

function DetailPanel(props: { node: Node<FlowNodeData> | null; onOpenPdf: () => void; onUpdateNote: (note: string) => void }) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">当前节点</div>
      <div className="mt-2 text-lg font-semibold leading-7">{props.node?.data?.label || "请选择一个节点"}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.node?.data?.type && <Badge tone={tone(String(props.node.data.type))}>{nodeTypeLabel(String(props.node.data.type))}</Badge>}
        {props.node?.data?.status && <Badge tone="slate">{String(props.node.data.status)}</Badge>}
      </div>
      <div className="mt-3 text-sm leading-6 text-slate-600">
        {String(props.node?.data?.summary || props.node?.data?.method_summary || props.node?.data?.abstract || "这个节点还没有摘要信息。")}
      </div>
      <div className="mt-4 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">整理备注</div>
      <textarea
        className="mt-2 h-24 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
        value={String(props.node?.data?.userNote || "")}
        onChange={(e) => props.onUpdateNote(e.target.value)}
        disabled={!props.node}
        placeholder="添加你的判断、标签、下一步计划或引用理由..."
      />
      <div className="mt-3 flex gap-2">
        <button
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
          disabled={!props.node || !String(props.node.id).startsWith("paper:")}
          onClick={props.onOpenPdf}
        >
          打开 PDF
        </button>
        <button className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700">对比</button>
      </div>
    </div>
  );
}

function ChatPanel(props: { disabled: boolean; history: ChatItem[]; onSend: (question: string, threadId?: string) => void }) {
  const [question, setQuestion] = useState("");
  const threadId = props.history[0]?.thread_id;

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">上下文问答</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {["这个节点为什么重要？", "请总结这个节点", "下一步应该读什么？"].map((chip) => (
          <button
            key={chip}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
            onClick={() => setQuestion(chip)}
            disabled={props.disabled}
          >
            {chip}
          </button>
        ))}
      </div>
      <div className="mt-3 max-h-52 space-y-3 overflow-auto pr-1">
        {props.history.map((item, index) => (
          <div key={`${item.created_at}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">问题</div>
            <div className="mt-1 text-sm text-slate-800">{item.question}</div>
            <div className="mt-2 text-xs font-medium text-slate-500">回答</div>
            <div className="mt-1 text-sm leading-6 text-slate-700">{item.answer}</div>
          </div>
        ))}
        {!props.history.length && <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">选择一个节点后，就可以围绕这个节点提问。</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="围绕当前节点提一个问题..."
          disabled={props.disabled}
        />
        <button
          className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          disabled={props.disabled || !question.trim()}
          onClick={() => {
            props.onSend(question, threadId);
            setQuestion("");
          }}
        >
          提问
        </button>
      </div>
    </div>
  );
}

function TimelinePanel(props: {
  mode: TaskMode;
  autoStatus: string;
  runId: string;
  events: RunEvent[];
  onGuidance: (text: string) => void;
  onContinue: () => void;
  onCancel: () => void;
}) {
  const [guidance, setGuidance] = useState("");

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">运行日志</div>
        <div className="flex gap-2">
          {props.mode === "openclaw_auto" && props.autoStatus === "awaiting_guidance" && (
            <button className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-medium text-white" onClick={props.onContinue}>
              继续自动调研
            </button>
          )}
          {props.mode === "openclaw_auto" && props.runId && (
            <button className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700" onClick={props.onCancel}>
              停止在此
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 text-xs text-slate-500">
        {props.mode === "openclaw_auto"
          ? `运行 ${props.runId || "尚未启动"} · ${autoStatusLabel(props.autoStatus)}`
          : "GPT Step 模式会在后端逐步沉淀更多 step 日志，这里会持续补充。"}
      </div>
      {props.mode === "openclaw_auto" && props.runId && (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            className="h-20 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
            placeholder="在这里输入 checkpoint 引导，例如：更关注多智能体协作和引用图谱。"
            value={guidance}
            onChange={(event) => setGuidance(event.target.value)}
          />
          <button
            className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 disabled:opacity-50"
            disabled={!guidance.trim()}
            onClick={() => {
              props.onGuidance(guidance);
              setGuidance("");
            }}
          >
            提交引导
          </button>
        </div>
      )}
      <div className="mt-3 max-h-60 space-y-3 overflow-auto pr-1">
        {props.events.map((event) => (
          <div key={event.seq} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>{eventTypeLabel(event.event_type)}</span>
              <span>#{event.seq}</span>
            </div>
            <div className="mt-2 text-sm text-slate-700">
              {String(event.payload.message || event.payload.title || event.payload.summary || JSON.stringify(event.payload))}
            </div>
          </div>
        ))}
        {!props.events.length && props.mode === "openclaw_auto" && (
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">启动自动调研后，这里会看到进度、checkpoint 和阶段报告。</div>
        )}
      </div>
    </div>
  );
}

function CardNode({ data }: NodeProps) {
  const node = data as FlowNodeData;

  return (
    <div className="relative w-[300px] rounded-3xl border border-slate-200 bg-white/95 shadow-[0_8px_30px_rgba(15,23,42,0.08)] backdrop-blur">
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-slate-500" />
      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-slate-500" />
      <div className="p-4">
        <div className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">{node.label}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Badge tone={tone(node.type)}>{nodeTypeLabel(node.type)}</Badge>
          {node.year && <Badge tone="slate">{String(node.year)}</Badge>}
          {node.venue && <Badge tone="blue">{node.venue}</Badge>}
          {node.direction_index && <Badge tone="green">{`方向 ${node.direction_index}`}</Badge>}
        </div>
        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">摘要</div>
          <p className="line-clamp-4 text-xs leading-5 text-slate-600">
            {node.summary || node.method_summary || node.abstract || node.feedback_text || "当前还没有摘要信息。"}
          </p>
        </div>
        <div className="mt-3 text-[11px] text-slate-500">{node.status || (node.isManual ? "手工节点" : "系统节点")}</div>
      </div>
    </div>
  );
}

function Badge(props: { children: ReactNode; tone: "slate" | "blue" | "green" | "violet" | "amber" }) {
  const tones = {
    slate: "border-slate-200 bg-slate-100 text-slate-700",
    blue: "border-blue-200 bg-blue-50 text-blue-700",
    green: "border-emerald-200 bg-emerald-50 text-emerald-700",
    violet: "border-violet-200 bg-violet-50 text-violet-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
  };

  return <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-medium ${tones[props.tone]}`}>{props.children}</span>;
}

function tone(type?: string): "slate" | "blue" | "green" | "violet" | "amber" {
  if (type === "topic" || type === "checkpoint") return "blue";
  if (type === "direction" || type === "group") return "green";
  if (type === "round" || type === "report" || type === "reference") return "violet";
  if (type === "paper" || type === "question") return "amber";
  return "slate";
}

function mergeCanvasWithGraph(graph?: GraphResponse, canvas?: CanvasResponse) {
  const graphNodes = graph?.nodes || [];
  const graphEdges = graph?.edges || [];
  const canvasNodes = canvas?.nodes || [];
  const canvasEdges = canvas?.edges || [];
  const saved = new Map(canvasNodes.map((node) => [node.id, node]));
  const seen = new Set(graphNodes.map((node) => node.id));
  const rows: Record<string, number> = {};

  const nodes: Node<FlowNodeData>[] = graphNodes.map((node) => {
    const cached = saved.get(node.id);
    const row = rows[node.type] || 0;
    rows[node.type] = row + 1;
    return {
      id: node.id,
      type: "cardNode",
      position: cached?.position || { x: 120 + typeColumn(node.type) * 320, y: 110 + row * 170 },
      hidden: cached?.hidden,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: { ...node, ...(cached?.data || {}) },
    };
  });

  for (const node of canvasNodes) {
    if (seen.has(node.id)) continue;
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

  const edges: Edge[] = graphEdges.map((edge, index) => ({
    id: `graph:${index}:${edge.source}:${edge.target}:${edge.type}`,
    source: edge.source,
    target: edge.target,
    type: edgeVisual.type,
    style: edgeVisual.style,
    markerEnd: edgeVisual.markerEnd,
    data: edge,
  }));

  for (const edge of canvasEdges) {
    if (edges.some((current) => current.source === edge.source && current.target === edge.target)) continue;
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

  return { nodes, edges, viewport: canvas?.viewport || { x: 0, y: 0, zoom: 1 } };
}

function typeColumn(type: string) {
  if (type === "topic") return 0;
  if (type === "direction") return 1;
  if (type === "round" || type === "checkpoint") return 2;
  if (type === "paper" || type === "report") return 3;
  return 4;
}

function nodeTypeLabel(type?: string) {
  const labels: Record<string, string> = {
    topic: "主题",
    direction: "方向",
    round: "轮次",
    paper: "论文",
    checkpoint: "检查点",
    report: "报告",
    note: "笔记",
    group: "分组",
    reference: "参考",
    question: "问题",
  };
  return labels[type || ""] || type || "节点";
}

function manualNodeDefaultLabel(type: "note" | "question" | "reference" | "group") {
  const labels = {
    note: "新的笔记",
    question: "新的问题",
    reference: "新的参考",
    group: "新的分组",
  };
  return labels[type];
}

function modeLabel(mode: TaskMode) {
  return mode === "openclaw_auto" ? "OpenClaw Auto" : "GPT Step";
}

function backendLabel(backend: Backend) {
  return backend === "openclaw" ? "OpenClaw" : "GPT API";
}

function autoStatusLabel(status: string) {
  const labels: Record<string, string> = {
    idle: "待命",
    running: "运行中",
    awaiting_guidance: "等待引导",
    completed: "已完成",
    failed: "失败",
    canceled: "已取消",
  };
  return labels[status] || status || "未知";
}

function eventTypeLabel(type: string) {
  const labels: Record<string, string> = {
    progress: "进度",
    node_upsert: "节点更新",
    edge_upsert: "连线更新",
    paper_upsert: "论文更新",
    checkpoint: "检查点",
    report_chunk: "阶段报告",
    artifact: "产物",
    error: "错误",
  };
  return labels[type] || type;
}
