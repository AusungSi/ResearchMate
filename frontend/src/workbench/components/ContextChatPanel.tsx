import { useMemo, useRef } from "react";
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

const GENERIC_SUGGESTIONS = ["请总结当前任务的核心判断。", "下一步最值得补什么证据？", "请给我一个更可执行的研究建议。"];

function suggestionsForTypes(types: string[]) {
  if (!types.length) return [];
  if (types.every((type) => type === "paper")) {
    return ["这些论文分别解决什么问题？", "它们的核心方法和证据有什么差别？", "基于这些论文，当前任务下一步应该怎么推进？"];
  }
  if (types.includes("direction")) {
    return ["这个方向的研究价值是什么？", "继续检索时最该补哪类论文？", "它和当前任务主线是什么关系？"];
  }
  if (types.includes("round")) {
    return ["这一轮探索已经覆盖了什么？", "下一轮最值得收敛到哪里？", "这里还缺哪些关键证据？"];
  }
  return GENERIC_SUGGESTIONS;
}

export function ContextChatPanel(props: Props) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeThread = props.threads.find((item) => item.thread_id === props.activeThreadId) || null;
  const contextMap = useMemo(() => new Map(props.nodeOptions.map((item) => [item.id, item])), [props.nodeOptions]);
  const selectedTypes = useMemo(
    () => props.contextNodeIds.map((id) => String(contextMap.get(id)?.type || "")).filter(Boolean),
    [contextMap, props.contextNodeIds],
  );
  const suggestionChips = useMemo(() => suggestionsForTypes(selectedTypes), [selectedTypes]);
  const selectableNodes = useMemo(
    () => props.nodeOptions.filter((item) => !props.contextNodeIds.includes(item.id)),
    [props.contextNodeIds, props.nodeOptions],
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-sm font-semibold text-white">AI</span>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Research Chat</div>
                <div className="mt-1 line-clamp-1 text-base font-semibold text-slate-900">{activeThread?.title || "新对话"}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {props.taskTitle || "当前任务"}
                  {props.contextNodeIds.length ? ` · 已引用 ${props.contextNodeIds.length} 个节点` : ""}
                  {props.attachments.length ? ` · 已附加 ${props.attachments.length} 个文件` : ""}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="chat-thread-select"
              className="max-w-[220px] rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 outline-none"
              disabled={props.disabled || !props.threads.length}
              value={props.activeThreadId}
              onChange={(event) => props.onSelectThread(event.target.value)}
            >
              {!props.threads.length ? <option value="">暂无对话</option> : null}
              {props.threads.map((thread) => (
                <option key={thread.thread_id} value={thread.thread_id}>
                  {thread.title}
                </option>
              ))}
            </select>
            <SmallButton tone="solid" disabled={props.disabled} onClick={props.onNewThread}>
              新建对话
            </SmallButton>
          </div>
        </div>

        {props.contextNodeIds.length || props.attachments.length || props.uploadingNames.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {props.contextNodeIds.map((nodeId) => (
              <button
                key={nodeId}
                className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700"
                onClick={() => props.onRemoveContextNode(nodeId)}
              >
                <span className="max-w-[220px] truncate">{contextMap.get(nodeId)?.label || nodeId}</span>
                <span className="text-emerald-500">×</span>
              </button>
            ))}
            {props.attachments.map((item) => (
              <button
                key={item.attachment_id}
                className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700"
                onClick={() => props.onRemoveAttachment(item.attachment_id)}
              >
                <span className="max-w-[220px] truncate">{item.filename}</span>
                <span className="text-blue-500">×</span>
              </button>
            ))}
            {props.uploadingNames.map((name) => (
              <span key={name} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-xs text-slate-500">
                <span className="max-w-[180px] truncate">{name}</span>
                <span className="animate-pulse">上传中</span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-5 py-6">
        <div className="mx-auto flex max-w-[760px] flex-col gap-5">
          {props.messages.map((item) => (
            <div key={`${item.id}-${item.created_at}`} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[92%] rounded-[24px] px-4 py-3 shadow-sm ${
                  item.role === "user" ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800"
                }`}
              >
                <div className={`text-[11px] ${item.role === "user" ? "text-slate-300" : "text-slate-400"}`}>{formatDateTime(item.created_at)}</div>
                {item.role === "assistant" ? (
                  <MarkdownText
                    className="prose prose-sm mt-2 max-w-none text-sm leading-7 text-slate-700 prose-headings:mb-2 prose-headings:mt-4 prose-p:my-2 prose-li:my-1 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5"
                    text={item.content}
                  />
                ) : (
                  <div className="mt-2 whitespace-pre-wrap text-sm leading-7 text-white">{item.content}</div>
                )}

                {item.role === "assistant" ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <SmallButton onClick={() => props.onSaveAnswer("note", item)}>保存为笔记</SmallButton>
                    <SmallButton onClick={() => props.onSaveAnswer("report", item)}>保存为报告</SmallButton>
                  </div>
                ) : null}
              </div>
            </div>
          ))}

          {props.streaming ? (
            <div className="flex justify-start">
              <div className="max-w-[92%] rounded-[24px] rounded-bl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="text-[11px] text-slate-400">正在思考</div>
                <div className="mt-3 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
                  <span className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" />
                  <span className="ml-1 inline-block h-4 w-[2px] animate-pulse bg-slate-300" />
                </div>
              </div>
            </div>
          ) : null}

          {!props.messages.length && !props.streaming ? (
            <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/80 px-5 py-10 text-center text-sm text-slate-500">
              从当前任务开始一轮连续研究对话。
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-5 py-4">
        <div className="mx-auto max-w-[760px]">
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

          <div className="rounded-[30px] border border-slate-200 bg-slate-50 p-3 shadow-inner">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-lg text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
                disabled={props.disabled || props.busy}
                onClick={() => fileInputRef.current?.click()}
              >
                +
              </button>
              <select
                className="rounded-full border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 outline-none"
                value=""
                disabled={props.disabled || props.busy || !selectableNodes.length}
                onChange={(event) => {
                  const nodeId = event.target.value;
                  if (nodeId) {
                    props.onAddContextNode(nodeId);
                  }
                }}
              >
                <option value="">添加上下文节点</option>
                {selectableNodes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="text-xs text-slate-500">支持 PDF / TXT / MD / JSON / BIB / CSLJSON</div>
            </div>

            <div className="flex items-end gap-3 rounded-[24px] border border-slate-200 bg-white px-3 py-3">
              <textarea
                className="min-h-[92px] flex-1 resize-none bg-transparent px-1 text-sm leading-7 text-slate-800 outline-none"
                value={props.draft}
                disabled={props.disabled || props.busy}
                onChange={(event) => props.onDraftChange(event.target.value)}
                placeholder="围绕任务、节点上下文和上传附件继续追问，或让它帮你比较方法、提取证据、总结当前判断。"
              />
              <button
                className="inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={props.disabled || props.busy || !props.draft.trim()}
                onClick={props.onSend}
              >
                {props.busy ? "发送中" : "发送"}
              </button>
            </div>
          </div>
        </div>
      </div>

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
