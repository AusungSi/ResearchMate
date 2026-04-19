import { useEffect, useMemo, useState } from "react";
import type {
  ActionStatus,
  Backend,
  CollectionSummary,
  ProjectSummary,
  TaskMode,
  TaskSummary,
  WorkbenchConfig,
  ZoteroConfig,
} from "../types";
import { autoStatusLabel, backendLabel, modeLabel } from "../utils";
import { Badge, SmallButton } from "./shared";

export function ProjectSidebar(props: {
  config?: WorkbenchConfig | null;
  zoteroConfig?: ZoteroConfig | null;
  projects: ProjectSummary[];
  tasks: TaskSummary[];
  collections: CollectionSummary[];
  activeProjectId: string;
  activeTaskId: string;
  activeCollectionId: string;
  activeTask: TaskSummary | null;
  actionStatus: ActionStatus | null;
  onSelectProject: (projectId: string) => void;
  onSelectTask: (taskId: string) => void;
  onSelectCollection: (collectionId: string) => void;
  onCreateProject: (payload: { name: string; description: string }) => void;
  onCreateCollection: (payload: { name: string; description: string }) => void;
  onCreateTask: (payload: { topic: string; mode: TaskMode; llm_backend: Backend; llm_model: string }) => void;
  onQuickAction: (action: "plan" | "search_first" | "build_graph" | "build_fulltext" | "auto_start") => void;
  onImportZotero: () => void;
}) {
  const [topic, setTopic] = useState("");
  const [projectName, setProjectName] = useState("");
  const [collectionName, setCollectionName] = useState("");
  const [mode, setMode] = useState<TaskMode>(props.config?.default_mode || "gpt_step");
  const [backend, setBackend] = useState<Backend>(props.config?.default_backend || "gpt");
  const [model, setModel] = useState(props.config?.default_gpt_model || "gpt-5.4");

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

  return (
    <aside className="h-full overflow-auto bg-slate-50/80 p-5">
      <div className="mb-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Research Workbench</div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">研究工作台</div>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          现在按「项目 → 任务 → Collection」组织研究。`GPT Step` 适合半自动推进，`OpenClaw Auto` 会在 Checkpoint 暂停等待你的引导。
        </p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-900">新建研究任务</div>
        <textarea
          className="mt-3 h-28 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm outline-none"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
          placeholder="输入你的研究主题，例如：多智能体论文调研系统的架构与交互设计"
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
          在当前项目下创建任务
        </button>
        {props.actionStatus ? (
          <div
            className={`mt-3 rounded-2xl px-3 py-2 text-xs ${
              props.actionStatus.tone === "success"
                ? "bg-emerald-50 text-emerald-700"
                : props.actionStatus.tone === "warning"
                  ? "bg-amber-50 text-amber-700"
                  : props.actionStatus.tone === "danger"
                    ? "bg-rose-50 text-rose-700"
                    : "bg-slate-50 text-slate-600"
            }`}
          >
            {props.actionStatus.text}
          </div>
        ) : null}
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-900">项目分组</div>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="新建项目名称"
          />
          <SmallButton
            tone="solid"
            disabled={!projectName.trim()}
            onClick={() => {
              props.onCreateProject({ name: projectName, description: "" });
              setProjectName("");
            }}
          >
            新建
          </SmallButton>
        </div>
        <div className="mt-3 space-y-2">
          {props.projects.map((project) => (
            <button
              key={project.project_id}
              className={`w-full rounded-2xl border px-3 py-3 text-left ${
                project.project_id === props.activeProjectId ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-slate-50"
              }`}
              onClick={() => props.onSelectProject(project.project_id)}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{project.name}</div>
                {project.is_default ? <Badge tone="blue">默认</Badge> : null}
              </div>
              <div className={`mt-1 text-xs ${project.project_id === props.activeProjectId ? "text-slate-300" : "text-slate-500"}`}>
                任务 {project.task_count} · Collections {project.collection_count}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-900">当前项目 Collections</div>
          {activeProject ? <div className="text-xs text-slate-400">{activeProject.name}</div> : null}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none"
            value={collectionName}
            onChange={(event) => setCollectionName(event.target.value)}
            placeholder="新建 collection"
          />
          <SmallButton
            tone="solid"
            disabled={!collectionName.trim() || !props.activeProjectId}
            onClick={() => {
              props.onCreateCollection({ name: collectionName, description: "" });
              setCollectionName("");
            }}
          >
            新建
          </SmallButton>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <SmallButton onClick={props.onImportZotero}>导入 Zotero</SmallButton>
          {props.zoteroConfig?.enabled ? <Badge tone="green">Zotero 已配置</Badge> : <Badge tone="amber">Zotero 未配置</Badge>}
        </div>
        <div className="mt-3 space-y-2">
          {props.collections.map((collection) => (
            <button
              key={collection.collection_id}
              className={`w-full rounded-2xl border px-3 py-3 text-left ${
                collection.collection_id === props.activeCollectionId ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-slate-50"
              }`}
              onClick={() => props.onSelectCollection(collection.collection_id)}
            >
              <div className="text-sm font-medium text-slate-900">{collection.name}</div>
              <div className="mt-1 text-xs text-slate-500">
                {collection.item_count} 篇 · {collection.source_type}
              </div>
            </button>
          ))}
          {!props.collections.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">这个项目下还没有 collection。</div> : null}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-900">任务列表</div>
          <div className="text-xs text-slate-400">{props.activeTask ? modeLabel(props.activeTask.mode) : "未选择任务"}</div>
        </div>
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
          {!props.tasks.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">当前项目下还没有任务。</div> : null}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-slate-900">快捷动作</div>
          <div className="text-xs text-slate-400">{props.activeTask ? props.activeTask.task_id : "未选中"}</div>
        </div>
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
              启动自动研究
            </SmallButton>
          ) : null}
        </div>
      </section>

      <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-4">
        <div className="text-sm font-medium text-slate-900">数据源与配置</div>
        <div className="mt-3 flex flex-wrap gap-2">
          {props.config?.provider_status.map((item) => (
            <Badge key={`${item.role}-${item.key}`} tone={item.configured ? "green" : item.enabled ? "amber" : "slate"}>
              {item.key} · {item.role}
            </Badge>
          ))}
        </div>
        <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
          <p>Discovery：{props.config?.discovery_providers.join(" / ") || "-"}</p>
          <p>Citation：{props.config?.citation_providers.join(" / ") || "-"}</p>
          <p>GPT 模式请在 `.env` 中填写 `RESEARCH_GPT_API_KEY`。</p>
          <p>OpenClaw 模式需要 `OPENCLAW_ENABLED=true` 以及本地 gateway 配置。</p>
        </div>
      </section>
    </aside>
  );
}
