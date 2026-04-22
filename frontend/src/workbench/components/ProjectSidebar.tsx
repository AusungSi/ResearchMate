import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { autoStatusLabel, backendLabel, modeLabel } from "../display";
import { deriveTaskProgress } from "../progress";
import type { Backend, CollectionSummary, ProjectDashboard, ProjectSummary, TaskMode, TaskSummary, WorkbenchConfig, ZoteroConfig } from "../types";
import { formatDateTime } from "../utils";
import { Badge, SmallButton } from "./shared";

type Props = {
  config?: WorkbenchConfig | null;
  dashboard?: ProjectDashboard | null;
  zoteroConfig?: ZoteroConfig | null;
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  collections: CollectionSummary[];
  activeProjectId: string;
  activeTaskId: string;
  activeCollectionId: string;
  activeTask: TaskSummary | null;
  onSelectProject: (projectId: string) => void;
  onSelectTask: (taskId: string) => void;
  onSelectCollection: (collectionId: string) => void;
  onCreateProject: (payload: { name: string; description: string }) => void;
  onCreateCollection: (payload: { name: string; description: string }) => void;
  onCreateTask: (payload: { topic: string; mode: TaskMode; llm_backend: Backend; llm_model: string }) => void;
  onQuickAction: (action: "plan" | "search_first" | "build_graph" | "build_fulltext" | "auto_start") => void;
  onImportZoteroFile: () => void;
};

type SectionKey = "overview" | "create" | "projects" | "collections" | "tasks" | "actions" | "providers";

export function ProjectSidebar(props: Props) {
  const [topic, setTopic] = useState("");
  const [projectName, setProjectName] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [mode, setMode] = useState<TaskMode>(props.config?.default_mode || "gpt_step");
  const [backend, setBackend] = useState<Backend>(props.config?.default_backend || "gpt");
  const [model, setModel] = useState(props.config?.default_gpt_model || "gpt-5.4");
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({
    overview: false,
    create: false,
    projects: false,
    collections: false,
    tasks: false,
    actions: false,
    providers: true,
  });

  useEffect(() => {
    if (!props.config) return;
    setMode(props.config.default_mode || "gpt_step");
    setBackend(props.config.default_backend || "gpt");
    setModel(props.config.default_gpt_model || "gpt-5.4");
  }, [props.config]);

  useEffect(() => {
    if (mode === "openclaw_auto") {
      setBackend("openclaw");
      setModel(props.config?.default_openclaw_model || "main");
      return;
    }
    if (backend === "openclaw") {
      setBackend("gpt");
      setModel(props.config?.default_gpt_model || "gpt-5.4");
    }
  }, [backend, mode, props.config]);

  const activeProject = useMemo(
    () => props.projects.find((project) => project.project_id === props.activeProjectId) || null,
    [props.activeProjectId, props.projects],
  );
  const taskProgressById = useMemo(
    () => new Map(props.tasks.map((task) => [task.task_id, deriveTaskProgress(task)])),
    [props.tasks],
  );

  function toggleSection(key: SectionKey) {
    setCollapsed((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <aside className="h-full overflow-auto bg-slate-50/80 p-5">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Research Workbench</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">研究工作台</div>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          项目是长期研究空间，任务是一次具体调研，Collection 用来沉淀可复用论文集合。列表较多时可以折叠每个区块。
        </p>
      </div>

      <CollapsibleSection
        title="项目概览"
        subtitle={activeProject?.name}
        collapsed={collapsed.overview}
        onToggle={() => toggleSection("overview")}
      >
        {props.dashboard ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MetricCard label="任务数" value={String(props.dashboard.task_count)} />
              <MetricCard label="Collections" value={String(props.dashboard.collection_count)} />
              <MetricCard label="论文数" value={String(props.dashboard.paper_count)} />
              <MetricCard label="已保存" value={String(props.dashboard.saved_paper_count)} />
            </div>
            {props.dashboard.recent_runs.length ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">最近运行</div>
                <div className="mt-2 space-y-2">
                  {props.dashboard.recent_runs.slice(0, 3).map((item) => (
                    <div key={`${item.task_id}:${item.run_id}`} className="rounded-xl bg-white px-3 py-2">
                      <div className="line-clamp-2 text-sm font-medium text-slate-900">{item.topic}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {modeLabel(item.mode)} · {autoStatusLabel(item.auto_status)} · {formatDateTime(item.updated_at)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">正在读取项目概览...</div>
        )}
      </CollapsibleSection>

      <CollapsibleSection title="新建研究任务" collapsed={collapsed.create} onToggle={() => toggleSection("create")}>
        <textarea
          className="h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="例如：围绕具身智能中的 world model、视觉语言动作模型和数据效率做一轮调研"
        />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <select className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm" value={mode} onChange={(event) => setMode(event.target.value as TaskMode)}>
            <option value="gpt_step">GPT Step</option>
            <option value="openclaw_auto">OpenClaw Auto</option>
          </select>
          <select
            className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
            value={backend}
            onChange={(event) => setBackend(event.target.value as Backend)}
            disabled={mode === "openclaw_auto"}
          >
            <option value="gpt">GPT API</option>
            <option value="openclaw">OpenClaw</option>
          </select>
        </div>
        <input
          className="mt-3 w-full rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="模型名，例如 gpt-5.4"
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
      </CollapsibleSection>

      <CollapsibleSection title="项目列表" collapsed={collapsed.projects} onToggle={() => toggleSection("projects")}>
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="输入新的项目名"
          />
          <SmallButton
            tone="solid"
            disabled={!projectName.trim()}
            onClick={() => {
              props.onCreateProject({ name: projectName, description: "" });
              setProjectName("");
            }}
            data-testid="create-project-button"
          >
            创建
          </SmallButton>
        </div>
        <div className="mt-3 space-y-2">
          {props.projects.map((project) => (
            <button
              key={project.project_id}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                project.project_id === props.activeProjectId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50 hover:border-slate-300"
              }`}
              onClick={() => props.onSelectProject(project.project_id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="line-clamp-1 text-sm font-medium">{project.name}</div>
                {project.is_default ? <Badge tone="blue">默认</Badge> : null}
              </div>
              <div className={`mt-1 text-xs ${project.project_id === props.activeProjectId ? "text-slate-300" : "text-slate-500"}`}>
                任务 {project.task_count} · Collections {project.collection_count}
              </div>
            </button>
          ))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Collections"
        subtitle={activeProject?.name}
        collapsed={collapsed.collections}
        onToggle={() => toggleSection("collections")}
      >
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            placeholder="输入 Collection 名称"
          />
          <SmallButton
            tone="solid"
            disabled={!collectionName.trim() || !props.activeProjectId}
            onClick={() => {
              props.onCreateCollection({ name: collectionName, description: "" });
              setCollectionName("");
            }}
            data-testid="create-collection-button"
          >
            创建
          </SmallButton>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SmallButton data-testid="import-zotero-button" onClick={props.onImportZoteroFile}>
            导入 Zotero 文件
          </SmallButton>
          <Badge tone="green">本地导入导出可用</Badge>
          <Badge tone={props.zoteroConfig?.legacy_web_api_configured ? "blue" : "amber"}>
            {props.zoteroConfig?.legacy_web_api_configured ? "Web API 已配置" : "Web API 兼容模式未配置"}
          </Badge>
        </div>
        <div className="mt-2 text-xs leading-5 text-slate-500">
          支持导入 {props.zoteroConfig?.import_formats?.join(" / ") || "CSL JSON / BibTeX"}，默认导入当前项目。
        </div>
        <div className="mt-3 space-y-2">
          {props.collections.map((collection) => (
            <button
              key={collection.collection_id}
              className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
                collection.collection_id === props.activeCollectionId ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-300"
              }`}
              onClick={() => props.onSelectCollection(collection.collection_id)}
            >
              <div className="line-clamp-1 text-sm font-medium text-slate-900">{collection.name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {collection.item_count} 条 · {collection.source_type}
              </div>
            </button>
          ))}
          {!props.collections.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">当前项目还没有 collection。</div> : null}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="任务列表" subtitle={props.activeTask ? modeLabel(props.activeTask.mode) : "未选中任务"} collapsed={collapsed.tasks} onToggle={() => toggleSection("tasks")}>
        <div className="space-y-2">
          {props.tasks.map((task) => (
            <TaskListCard
              key={task.task_id}
              task={task}
              progress={taskProgressById.get(task.task_id) || null}
              active={task.task_id === props.activeTaskId}
              onClick={() => props.onSelectTask(task.task_id)}
            />
          ))}
          {!props.tasks.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">当前项目还没有研究任务。</div> : null}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="快捷动作" subtitle={props.activeTask ? props.activeTask.task_id : "未选中任务"} collapsed={collapsed.actions} onToggle={() => toggleSection("actions")}>
        <div className="text-xs leading-5 text-slate-500">动作结果会显示在画布顶部状态条；检索类任务完成后画布会随轮询自动更新。</div>
        <div className="mt-3 grid gap-2 text-sm">
          <SmallButton disabled={!props.activeTask} onClick={() => props.onQuickAction("plan")}>
            1. 规划方向
          </SmallButton>
          <SmallButton disabled={!props.activeTask} onClick={() => props.onQuickAction("search_first")}>
            2. 检索方向 1
          </SmallButton>
          <SmallButton disabled={!props.activeTask} onClick={() => props.onQuickAction("build_graph")}>
            3. 构建图谱
          </SmallButton>
          <SmallButton disabled={!props.activeTask} onClick={() => props.onQuickAction("build_fulltext")}>
            4. 处理全文
          </SmallButton>
          {props.activeTask?.mode === "openclaw_auto" ? (
            <SmallButton tone="solid" onClick={() => props.onQuickAction("auto_start")}>
              启动 OpenClaw Auto
            </SmallButton>
          ) : null}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Provider 状态" collapsed={collapsed.providers} onToggle={() => toggleSection("providers")}>
        <div className="flex flex-wrap gap-2">
          {props.config?.provider_status.map((item) => (
            <span key={`${item.role}-${item.key}`} title={item.detail || undefined}>
              <Badge tone={item.configured ? "green" : item.enabled ? "amber" : "slate"}>
                {item.key} · {item.role}
              </Badge>
            </span>
          ))}
        </div>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <p>Discovery: {props.config?.discovery_providers.join(" / ") || "-"}</p>
          <p>Citation: {props.config?.citation_providers.join(" / ") || "-"}</p>
          <p>GPT API Key 在 `.env` 中配置 `RESEARCH_GPT_API_KEY`。</p>
        </div>
      </CollapsibleSection>
    </aside>
  );
}

function CollapsibleSection(props: {
  title: string;
  subtitle?: string | null;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 first:mt-0">
      <button className="flex w-full items-center justify-between gap-3 text-left" onClick={props.onToggle}>
        <div>
          <div className="text-sm font-medium text-slate-900">{props.title}</div>
          {props.subtitle ? <div className="mt-0.5 line-clamp-1 text-xs text-slate-400">{props.subtitle}</div> : null}
        </div>
        <span className="rounded-full border border-slate-200 px-2 py-1 text-xs text-slate-500">{props.collapsed ? "展开" : "折叠"}</span>
      </button>
      {props.collapsed ? null : <div className="mt-3">{props.children}</div>}
    </section>
  );
}

function MetricCard(props: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs text-slate-500">{props.label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{props.value}</div>
    </div>
  );
}

function TaskListCard(props: { task: TaskSummary; progress: ReturnType<typeof deriveTaskProgress>; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`w-full rounded-2xl border px-3 py-3 text-left transition ${
        props.active ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 bg-slate-50 hover:border-slate-300"
      }`}
      onClick={props.onClick}
    >
      <div className="line-clamp-2 text-sm font-medium">{props.task.topic}</div>
      <div className={`mt-1 text-xs ${props.active ? "text-slate-300" : "text-slate-500"}`}>
        {modeLabel(props.task.mode)} · 状态 {props.task.status} · {autoStatusLabel(props.task.auto_status)}
      </div>
      <div className={`mt-1 text-[11px] ${props.active ? "text-slate-400" : "text-slate-400"}`}>
        {backendLabel(props.task.llm_backend)}
        {props.task.llm_model ? ` / ${props.task.llm_model}` : ""}
      </div>
      {props.progress ? (
        <div className={`mt-2 flex items-center gap-2 text-[11px] ${props.active ? "text-slate-200" : "text-slate-500"}`}>
          <span className={`rounded-full border px-2 py-0.5 font-medium ${props.active ? "border-slate-700 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-600"}`}>
            {props.progress.percent}%
          </span>
          <span className="line-clamp-1">{props.progress.currentLabel}</span>
        </div>
      ) : null}
    </button>
  );
}
