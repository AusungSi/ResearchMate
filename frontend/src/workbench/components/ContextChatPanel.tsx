import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ChatAttachment, ChatMessage, ChatThread } from "../types";
import { formatDateTime } from "../utils";
import { MarkdownText, SmallButton } from "./shared";

type ChatTargetOption = {
  id: string;
  label: string;
  type?: string | null;
};

type Props = {
  disabled: boolean;
  taskTitle?: string | null;
  threads: ChatThread[];
  activeThreadId: string;
  messages: ChatMessage[];
  nodeOptions: ChatTargetOption[];
  contextNodeIds: string[];
  attachments: ChatAttachment[];
  uploadingNames: string[];
  draft: string;
  busy?: boolean;
  streaming?: boolean;
  error?: string | null;
  onDraftChange: (value: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewThread: () => void;
  onSend: () => void;
  onUploadFiles: (files: FileList) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onAddContextNode: (nodeId: string) => void;
  onRemoveContextNode: (nodeId: string) => void;
  onUseSuggestion: (question: string) => void;
  onSaveAnswer: (kind: "note" | "report", item: ChatMessage) => void;
};

const GENERIC_SUGGESTIONS = [
  "请总结当前判断",
  "下一步最值得补什么证据？",
  "请给我一个更可执行的研究建议",
];

function suggestionsForTypes(types: string[]) {
  if (!types.length) return [];
  if (types.every((type) => type === "paper")) {
    return [
      "这些论文分别解决什么问题？",
      "它们的方法和证据差异在哪里？",
      "基于这些论文，下一步该怎么推进？",
    ];
  }
  if (types.includes("direction")) {
    return [
      "这个方向的核心价值是什么？",
      "继续检索时最该补哪类论文？",
      "它和当前任务主线是什么关系？",
    ];
  }
  if (types.includes("round")) {
    return [
      "这一轮探索已经覆盖了什么？",
      "下一轮最值得收敛到哪里？",
      "这里还缺哪些关键证据？",
    ];
  }
  return GENERIC_SUGGESTIONS;
}

function ChatIcon(props: {
  name: "sparkles" | "history" | "compose" | "more" | "plus" | "link" | "send" | "close" | "search" | "pin" | "clear";
  className?: string;
}) {
  const base = "h-4 w-4";
  const className = props.className ? `${base} ${props.className}` : base;

  if (props.name === "sparkles") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z" />
        <path d="m19 14 .8 1.8L22 17l-2.2 1.2L19 20l-.8-1.8L16 17l2.2-1.2Z" />
      </svg>
    );
  }
  if (props.name === "history") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <path d="M3 3v6h6" />
        <path d="M12 7v5l3 3" />
      </svg>
    );
  }
  if (props.name === "compose") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }
  if (props.name === "more") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <circle cx="5" cy="12" r="1.5" />
        <circle cx="12" cy="12" r="1.5" />
        <circle cx="19" cy="12" r="1.5" />
      </svg>
    );
  }
  if (props.name === "plus") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    );
  }
  if (props.name === "link") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L10 4" />
        <path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L14 20" />
      </svg>
    );
  }
  if (props.name === "send") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </svg>
    );
  }
  if (props.name === "search") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
    );
  }
  if (props.name === "pin") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m12 17 4 4" />
        <path d="m16 8 4-4" />
        <path d="M8.5 3.5a2.1 2.1 0 0 1 3 0l9 9a2.1 2.1 0 0 1 0 3l-2 2a2.1 2.1 0 0 1-3 0l-9-9a2.1 2.1 0 0 1 0-3Z" />
      </svg>
    );
  }
  if (props.name === "clear") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="m19 6-1 14H6L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function ToolButton(props: { title: string; onClick?: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
      title={props.title}
      onClick={props.onClick}
      disabled={props.disabled}
    >
      {props.children}
    </button>
  );
}

function MetaChip(props: { label: string; tone?: "slate" | "emerald" | "blue"; onRemove?: () => void }) {
  const toneClass =
    props.tone === "emerald"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : props.tone === "blue"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : "border-slate-200 bg-slate-50 text-slate-700";
  return (
    <div className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${toneClass}`}>
      <span className="truncate">{props.label}</span>
      {props.onRemove ? (
        <button className="rounded-full text-current/70 transition hover:text-current" onClick={props.onRemove}>
          <ChatIcon name="close" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function MessageBubble(props: { item: ChatMessage; onSaveAnswer: (kind: "note" | "report", item: ChatMessage) => void }) {
  const isUser = props.item.role === "user";
  const isStreamingAssistant = !isUser && props.item.status === "streaming" && !props.item.content.trim();

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser ? (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
          <ChatIcon name="sparkles" className="h-[15px] w-[15px]" />
        </div>
      ) : null}

      <div className={`flex max-w-[84%] flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[11px] font-medium text-slate-500">{isUser ? "You" : "ResearchMate"}</span>
          {!isUser ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">context aware</span> : null}
          <span className="text-[10px] text-slate-400">{formatDateTime(props.item.created_at)}</span>
        </div>

        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
            isUser ? "rounded-tr-md bg-slate-900 text-white" : "rounded-tl-md border border-slate-200 bg-white text-slate-700"
          }`}
        >
          {isUser ? <div className="whitespace-pre-wrap">{props.item.content}</div> : null}
          {!isUser && isStreamingAssistant ? (
            <div>
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-400">thinking</div>
              <div className="mt-2 flex items-center gap-2">
                <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
                <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
                <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" />
              </div>
            </div>
          ) : null}
          {!isUser && !isStreamingAssistant ? (
            <MarkdownText
              className="prose prose-sm max-w-none text-sm leading-7 text-slate-700 prose-headings:mb-2 prose-headings:mt-4 prose-p:my-2 prose-li:my-1 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5"
              text={props.item.content}
            />
          ) : null}
        </div>

        {!isUser && props.item.status !== "streaming" ? (
          <div className="mt-1 flex flex-wrap gap-2 px-1">
            <SmallButton onClick={() => props.onSaveAnswer("note", props.item)}>保存为笔记</SmallButton>
            <SmallButton onClick={() => props.onSaveAnswer("report", props.item)}>保存为报告</SmallButton>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ContextChatPanel(props: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const nodePickerRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const activeThread = props.threads.find((item) => item.thread_id === props.activeThreadId) || null;
  const contextMap = useMemo(() => new Map(props.nodeOptions.map((item) => [item.id, item])), [props.nodeOptions]);
  const selectedTypes = useMemo(
    () => props.contextNodeIds.map((id) => String(contextMap.get(id)?.type || "")).filter(Boolean),
    [contextMap, props.contextNodeIds],
  );
  const suggestionChips = useMemo(() => suggestionsForTypes(selectedTypes), [selectedTypes]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [nodePickerOpen, setNodePickerOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [nodeQuery, setNodeQuery] = useState("");

  const filteredThreads = useMemo(() => {
    const keyword = historyQuery.trim().toLowerCase();
    if (!keyword) return props.threads;
    return props.threads.filter((item) => `${item.title} ${item.latest_preview || ""}`.toLowerCase().includes(keyword));
  }, [historyQuery, props.threads]);

  const selectableNodes = useMemo(() => {
    const keyword = nodeQuery.trim().toLowerCase();
    return props.nodeOptions
      .filter((item) => !props.contextNodeIds.includes(item.id))
      .filter((item) => !keyword || `${item.label} ${item.type || ""}`.toLowerCase().includes(keyword));
  }, [nodeQuery, props.contextNodeIds, props.nodeOptions]);

  const contextSummary = useMemo(() => {
    const contextCount = props.contextNodeIds.length;
    const fileCount = props.attachments.length + props.uploadingNames.length;
    const parts: string[] = [];
    if (contextCount) parts.push(`${contextCount} 个上下文节点`);
    if (fileCount) parts.push(`${fileCount} 个附件`);
    return parts.length ? parts.join(" · ") : "Task-level chat";
  }, [props.attachments.length, props.contextNodeIds.length, props.uploadingNames.length]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [props.messages]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (historyOpen && historyRef.current && !historyRef.current.contains(target)) {
        setHistoryOpen(false);
      }
      if (menuOpen && menuRef.current && !menuRef.current.contains(target)) {
        setMenuOpen(false);
      }
      if (nodePickerOpen && nodePickerRef.current && !nodePickerRef.current.contains(target)) {
        setNodePickerOpen(false);
      }
    }
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [historyOpen, menuOpen, nodePickerOpen]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[32px] border border-slate-200/90 bg-slate-50 shadow-[0_24px_60px_rgba(15,23,42,0.10)]">
      <header className="relative border-b border-slate-200/80 bg-white/92 px-4 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
              <ChatIcon name="sparkles" className="h-[17px] w-[17px]" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{activeThread?.title || "新对话"}</div>
              <div className="truncate text-[11px] text-slate-400">
                {props.taskTitle || "Workspace context"} · {contextSummary}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 rounded-2xl border border-slate-200 bg-slate-50/80 p-1">
            <div ref={historyRef} className="relative">
              <ToolButton
                title="历史对话"
                onClick={() => {
                  setHistoryOpen((current) => !current);
                  setMenuOpen(false);
                  setNodePickerOpen(false);
                }}
              >
                <ChatIcon name="history" className="h-[17px] w-[17px]" />
              </ToolButton>

              {historyOpen ? (
                <div className="absolute right-0 top-[46px] z-30 w-[340px] rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.16)]">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">History</div>
                  <div className="relative">
                    <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                      <ChatIcon name="search" className="h-3.5 w-3.5" />
                    </div>
                    <input
                      value={historyQuery}
                      onChange={(event) => setHistoryQuery(event.target.value)}
                      placeholder="搜索历史对话"
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-slate-300"
                    />
                  </div>
                  <div className="mt-3 max-h-[320px] space-y-1 overflow-auto pr-1">
                    {filteredThreads.map((thread) => (
                      <button
                        key={thread.thread_id}
                        className={`block w-full rounded-2xl px-3 py-2.5 text-left transition ${
                          thread.thread_id === props.activeThreadId ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                        }`}
                        onClick={() => {
                          props.onSelectThread(thread.thread_id);
                          setHistoryOpen(false);
                        }}
                      >
                        <div className="truncate text-sm font-medium">{thread.title}</div>
                        <div className={`mt-1 line-clamp-2 text-xs ${thread.thread_id === props.activeThreadId ? "text-slate-300" : "text-slate-400"}`}>
                          {thread.latest_preview || "暂无消息"}
                        </div>
                      </button>
                    ))}
                    {!filteredThreads.length ? <div className="px-3 py-6 text-center text-sm text-slate-400">没有匹配的历史对话</div> : null}
                  </div>
                </div>
              ) : null}
            </div>

            <ToolButton
              title="新建对话"
              onClick={() => {
                setHistoryOpen(false);
                setMenuOpen(false);
                setNodePickerOpen(false);
                props.onNewThread();
              }}
            >
              <ChatIcon name="compose" className="h-[17px] w-[17px]" />
            </ToolButton>

            <div ref={menuRef} className="relative">
              <ToolButton
                title="更多操作"
                onClick={() => {
                  setMenuOpen((current) => !current);
                  setHistoryOpen(false);
                  setNodePickerOpen(false);
                }}
              >
                <ChatIcon name="more" className="h-[17px] w-[17px]" />
              </ToolButton>

              {menuOpen ? (
                <div className="absolute right-0 top-[46px] z-30 min-w-[210px] rounded-3xl border border-slate-200 bg-white p-2 shadow-[0_20px_50px_rgba(15,23,42,0.16)]">
                  <button
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    disabled={props.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      fileInputRef.current?.click();
                    }}
                  >
                    <ChatIcon name="plus" className="h-4 w-4" />
                    上传文件
                  </button>
                  <button
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50"
                    disabled={props.disabled}
                    onClick={() => {
                      setMenuOpen(false);
                      setNodePickerOpen(true);
                    }}
                  >
                    <ChatIcon name="pin" className="h-4 w-4" />
                    管理上下文节点
                  </button>
                  <button
                    className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm text-slate-700 transition hover:bg-slate-50 disabled:text-slate-300"
                    disabled={props.disabled || (!props.contextNodeIds.length && !props.attachments.length)}
                    onClick={() => {
                      setMenuOpen(false);
                      props.contextNodeIds.forEach((nodeId) => props.onRemoveContextNode(nodeId));
                      props.attachments.forEach((item) => props.onRemoveAttachment(item.attachment_id));
                    }}
                  >
                    <ChatIcon name="clear" className="h-4 w-4" />
                    清空当前上下文
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] px-4 py-5">
        <div className="space-y-5">
          {props.messages.map((item) => (
            <MessageBubble key={`${item.id}-${item.created_at}`} item={item} onSaveAnswer={props.onSaveAnswer} />
          ))}

          {!props.messages.length ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white/90 px-5 py-12 text-center text-sm text-slate-500 shadow-sm">
              发送文本、上传文件，或关联节点后继续围绕当前研究任务提问。
            </div>
          ) : null}

          <div ref={messageEndRef} />
        </div>
      </main>

      <section className="border-t border-slate-200 bg-white px-4 py-4">
        {(props.contextNodeIds.length > 0 || props.attachments.length > 0 || props.uploadingNames.length > 0) && (
          <div className="mb-3 space-y-2">
            {props.contextNodeIds.length > 0 ? (
              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">Context nodes</div>
                <div className="flex flex-wrap gap-2">
                  {props.contextNodeIds.map((nodeId) => (
                    <MetaChip key={nodeId} label={contextMap.get(nodeId)?.label || nodeId} tone="emerald" onRemove={() => props.onRemoveContextNode(nodeId)} />
                  ))}
                </div>
              </div>
            ) : null}
            {props.attachments.length > 0 || props.uploadingNames.length > 0 ? (
              <div>
                <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-slate-400">Attached files</div>
                <div className="flex flex-wrap gap-2">
                  {props.attachments.map((item) => (
                    <MetaChip key={item.attachment_id} label={item.filename} tone="blue" onRemove={() => props.onRemoveAttachment(item.attachment_id)} />
                  ))}
                  {props.uploadingNames.map((name) => (
                    <MetaChip key={name} label={`${name} · 上传中`} tone="blue" />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {props.error ? <div className="mb-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{props.error}</div> : null}

        {suggestionChips.length ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {suggestionChips.map((item) => (
              <button
                key={item}
                className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-white"
                disabled={props.disabled || props.busy}
                onClick={() => props.onUseSuggestion(item)}
              >
                {item}
              </button>
            ))}
          </div>
        ) : null}

        <div ref={nodePickerRef} className="relative rounded-[28px] border border-slate-200 bg-white p-2 shadow-sm focus-within:border-slate-300 focus-within:ring-4 focus-within:ring-slate-100">
          <textarea
            value={props.draft}
            disabled={props.disabled || props.busy}
            onChange={(event) => props.onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!props.disabled && !props.busy && props.draft.trim()) {
                  props.onSend();
                }
              }
            }}
            className="min-h-[102px] w-full resize-none rounded-2xl border-0 bg-transparent px-3 py-3 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
            placeholder="Ask AI, upload files, or link selected nodes..."
          />

          {nodePickerOpen ? (
            <div className="absolute bottom-[78px] left-3 z-30 w-[336px] rounded-3xl border border-slate-200 bg-white p-3 shadow-[0_20px_50px_rgba(15,23,42,0.16)]">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Add context</div>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">
                  <ChatIcon name="search" className="h-3.5 w-3.5" />
                </div>
                <input
                  value={nodeQuery}
                  onChange={(event) => setNodeQuery(event.target.value)}
                  placeholder="搜索节点并加入上下文"
                  className="w-full rounded-2xl border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm text-slate-700 outline-none focus:border-slate-300"
                />
              </div>
              <div className="mt-3 max-h-[280px] space-y-1 overflow-auto pr-1">
                {selectableNodes.map((item) => (
                  <button
                    key={item.id}
                    className="block w-full rounded-2xl bg-slate-50 px-3 py-2.5 text-left transition hover:bg-slate-100"
                    onClick={() => {
                      props.onAddContextNode(item.id);
                      setNodeQuery("");
                    }}
                  >
                    <div className="truncate text-sm font-medium text-slate-700">{item.label}</div>
                    <div className="mt-1 text-xs text-slate-400">{item.type || "node"}</div>
                  </button>
                ))}
                {!selectableNodes.length ? <div className="px-3 py-6 text-center text-sm text-slate-400">没有可添加的节点</div> : null}
              </div>
            </div>
          ) : null}

          <div className="flex items-center justify-between border-t border-slate-100 px-2 pt-2">
            <div className="flex items-center gap-1">
              <ToolButton title="上传本地文件" disabled={props.disabled || props.busy} onClick={() => fileInputRef.current?.click()}>
                <ChatIcon name="plus" className="h-[17px] w-[17px]" />
              </ToolButton>
              <ToolButton
                title="关联节点上下文"
                disabled={props.disabled || props.busy}
                onClick={() => {
                  setNodePickerOpen((current) => !current);
                  setHistoryOpen(false);
                  setMenuOpen(false);
                }}
              >
                <ChatIcon name="link" className="h-[17px] w-[17px]" />
              </ToolButton>
            </div>

            <button
              className="inline-flex h-9 items-center justify-center rounded-xl bg-slate-900 px-3 text-xs font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={props.disabled || props.busy || !props.draft.trim()}
              onClick={props.onSend}
            >
              {props.busy ? "发送中" : "发送"}
              <ChatIcon name="send" className="ml-2 h-[15px] w-[15px]" />
            </button>
          </div>
        </div>
      </section>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.txt,.md,.json,.bib,.csljson"
        onChange={(event) => {
          const files = event.target.files;
          if (files?.length) {
            props.onUploadFiles(files);
          }
          event.currentTarget.value = "";
        }}
      />
    </div>
  );
}
