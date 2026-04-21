import { useEffect, useMemo, useState } from "react";
import type { ChatItem } from "../types";
import { formatDateTime } from "../utils";
import { SectionTitle, SmallButton } from "./shared";

type Props = {
  disabled: boolean;
  nodeId?: string;
  nodeLabel?: string | null;
  nodeType?: string | null;
  history: ChatItem[];
  onSend: (question: string, threadId?: string) => void;
  onSaveAnswer: (kind: "note" | "question" | "reference" | "report", item: ChatItem) => void;
};

const DEFAULT_QUESTIONS = ["请总结这个节点的核心价值。", "这个节点下一步应该补什么证据？", "它和当前研究主题有什么关系？"];

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
    return ["这个 checkpoint 已经确认了什么？", "系统建议的下一步是什么？", "我应该如何给出 guidance？"];
  }
  if (nodeType === "report") {
    return ["这份阶段报告最重要的结论是什么？", "还有哪些空白没有补齐？", "下一步最值得继续扩展什么？"];
  }
  if (nodeType === "question") {
    return ["请回答这个问题节点。", "这个问题应该连接到哪些论文或方向？", "这个问题的下一步验证方式是什么？"];
  }
  return DEFAULT_QUESTIONS;
}

export function ContextChatPanel(props: Props) {
  const [question, setQuestion] = useState("");
  const [forceNewThread, setForceNewThread] = useState(false);
  const threadId = forceNewThread ? undefined : props.history[0]?.thread_id;
  const quickQuestions = useMemo(() => quickQuestionsForNodeType(props.nodeType), [props.nodeType]);

  useEffect(() => {
    setQuestion("");
    setForceNewThread(false);
  }, [props.nodeId]);

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle
        eyebrow="Context Chat"
        title="节点问答"
        description={
          props.disabled
            ? "选中一个节点后，这里会围绕该节点上下文提问。"
            : `当前围绕「${props.nodeLabel || "所选节点"}」提问，回答会同步写回 question 节点卡片。`
        }
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {quickQuestions.map((item) => (
          <button
            key={item}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600"
            disabled={props.disabled}
            onClick={() => setQuestion(item)}
          >
            {item}
          </button>
        ))}
        <button
          className="rounded-full border border-dashed border-slate-300 bg-white px-3 py-1 text-xs text-slate-500"
          disabled={props.disabled}
          onClick={() => setForceNewThread(true)}
        >
          新建 thread
        </button>
      </div>

      <div className="mt-3 max-h-64 space-y-3 overflow-auto pr-1">
        {props.history.map((item, index) => (
          <div key={`${item.created_at}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>提问</span>
              <span>{formatDateTime(item.created_at)}</span>
            </div>
            <div className="mt-1 text-sm text-slate-800">{item.question}</div>
            <div className="mt-2 text-xs font-medium text-slate-500">回答</div>
            <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.answer}</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <SmallButton onClick={() => props.onSaveAnswer("note", item)}>保存为笔记节点</SmallButton>
              <SmallButton onClick={() => props.onSaveAnswer("report", item)}>保存为报告节点</SmallButton>
              <SmallButton onClick={() => props.onSaveAnswer("question", item)}>保存为问题节点</SmallButton>
              <SmallButton onClick={() => props.onSaveAnswer("reference", item)}>保存为参考节点</SmallButton>
            </div>
          </div>
        ))}
        {!props.history.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">这里会显示当前节点的问答历史。</div> : null}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="围绕当前节点输入一个更具体的问题..."
          disabled={props.disabled}
        />
        <SmallButton
          tone="solid"
          disabled={props.disabled || !question.trim()}
          onClick={() => {
            props.onSend(question, threadId);
            setQuestion("");
            setForceNewThread(false);
          }}
        >
          提问
        </SmallButton>
      </div>
    </div>
  );
}
