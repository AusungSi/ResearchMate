import { useEffect, useMemo, useState } from "react";
import type { ChatItem } from "../types";
import { formatDateTime } from "../utils";
import { MarkdownText, SectionTitle, SmallButton } from "./shared";

type ChatTargetOption = {
  id: string;
  label: string;
  type?: string | null;
};

type Props = {
  disabled: boolean;
  nodeOptions: ChatTargetOption[];
  activeNodeId: string;
  activeNodeLabel?: string | null;
  activeNodeType?: string | null;
  history: ChatItem[];
  question: string;
  busy?: boolean;
  onQuestionChange: (value: string) => void;
  onSelectNode: (nodeId: string) => void;
  onSend: (question: string, threadId?: string) => void;
  onSaveAnswer: (kind: "note" | "question" | "reference" | "report", item: ChatItem) => void;
};

const DEFAULT_QUESTIONS = [
  "请总结这个节点的核心价值。",
  "这个节点下一步最值得补什么证据？",
  "它和当前研究任务的关系是什么？",
];

function quickQuestionsForNodeType(nodeType?: string | null) {
  if (nodeType === "paper") {
    return [
      "这篇论文解决什么问题？",
      "核心方法是什么？",
      "关键证据和实验结论是什么？",
      "有哪些局限和风险？",
      "它和当前任务的关系是什么？",
    ];
  }
  if (nodeType === "direction") {
    return ["这个方向的核心价值是什么？", "下一步最值得补哪些论文？", "这个方向和当前主题的关系是什么？"];
  }
  if (nodeType === "round") {
    return ["这一轮探索的目标是什么？", "当前候选方向各自的利弊是什么？", "下一轮应该如何收敛？"];
  }
  if (nodeType === "checkpoint") {
    return ["这个 checkpoint 已经确认了什么？", "系统建议的下一步是什么？", "我应该如何给 guidance？"];
  }
  if (nodeType === "report") {
    return ["这份阶段报告最重要的结论是什么？", "还有哪些空白没有补齐？", "下一步最值得继续扩展什么？"];
  }
  if (nodeType === "question") {
    return ["请回答这个问题节点。", "这个问题应该连接到哪些论文或方向？", "这个问题下一步该怎么验证？"];
  }
  return DEFAULT_QUESTIONS;
}

export function ContextChatPanel(props: Props) {
  const [forceNewThread, setForceNewThread] = useState(false);
  const threadId = forceNewThread ? undefined : props.history.at(-1)?.thread_id;
  const quickQuestions = useMemo(() => quickQuestionsForNodeType(props.activeNodeType), [props.activeNodeType]);

  useEffect(() => {
    setForceNewThread(false);
  }, [props.activeNodeId]);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle
        eyebrow="聊天"
        title="研究对话"
        description={
          props.disabled
            ? "请先选择任务。聊天不会自动绑定节点，你可以在下面手动指定要围绕哪个节点提问。"
            : "聊天区不再跟随当前选中节点自动切换。你可以手动选择聊天对象，再围绕该节点持续追问。"
        }
      />

      <div className="mt-4">
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">聊天对象</label>
        <select
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none"
          value={props.activeNodeId}
          disabled={props.disabled}
          onChange={(event) => props.onSelectNode(event.target.value)}
        >
          <option value="">请选择一个节点</option>
          {props.nodeOptions.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
        <div className="mt-2 text-xs text-slate-500">
          {props.activeNodeId ? `当前聊天对象：${props.activeNodeLabel || props.activeNodeId}` : "还没有选定聊天对象。"}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {quickQuestions.map((item) => (
          <button
            key={item}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600 transition hover:border-slate-300 hover:bg-white"
            disabled={props.disabled || !props.activeNodeId}
            onClick={() => props.onQuestionChange(item)}
          >
            {item}
          </button>
        ))}
        <button
          className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-xs text-slate-500 transition hover:border-slate-400"
          disabled={props.disabled || !props.activeNodeId}
          onClick={() => setForceNewThread(true)}
        >
          新建 thread
        </button>
      </div>

      <div className="mt-4 max-h-72 space-y-3 overflow-auto pr-1">
        {props.history.map((item, index) => (
          <div key={`${item.created_at}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>提问</span>
              <span>{formatDateTime(item.created_at)}</span>
            </div>
            <div className="mt-1 text-sm text-slate-800">{item.question}</div>
            <div className="mt-3 text-xs font-medium text-slate-500">回答</div>
            <MarkdownText
              className="prose prose-sm mt-2 max-w-none text-sm leading-6 text-slate-700 prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-slate-900 prose-p:my-2 prose-li:my-1 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5"
              text={item.answer}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <SmallButton onClick={() => props.onSaveAnswer("note", item)}>保存为笔记节点</SmallButton>
              <SmallButton onClick={() => props.onSaveAnswer("report", item)}>保存为报告节点</SmallButton>
              <SmallButton onClick={() => props.onSaveAnswer("question", item)}>保存为问题节点</SmallButton>
              <SmallButton onClick={() => props.onSaveAnswer("reference", item)}>保存为参考节点</SmallButton>
            </div>
          </div>
        ))}
        {!props.history.length ? (
          <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">
            {props.activeNodeId ? "这里会显示当前聊天对象的问答历史。" : "先选择一个节点，再开始提问。"}
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex gap-2">
        <textarea
          className="h-24 flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-3 text-sm outline-none"
          value={props.question}
          onChange={(event) => props.onQuestionChange(event.target.value)}
          placeholder={props.activeNodeId ? "围绕当前聊天对象输入一个更具体的问题..." : "请先在上方选择聊天对象"}
          disabled={props.disabled || !props.activeNodeId}
        />
        <div className="flex shrink-0 flex-col gap-2">
          <SmallButton
            tone="solid"
            disabled={props.disabled || !props.activeNodeId || !props.question.trim() || props.busy}
            onClick={() => {
              props.onSend(props.question, threadId);
              props.onQuestionChange("");
              setForceNewThread(false);
            }}
          >
            提问
          </SmallButton>
        </div>
      </div>
    </div>
  );
}
