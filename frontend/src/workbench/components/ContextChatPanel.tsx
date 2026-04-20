import { useMemo, useState } from "react";
import type { ChatItem } from "../types";
import { formatDateTime } from "../utils";
import { SectionTitle, SmallButton } from "./shared";

type Props = {
  disabled: boolean;
  history: ChatItem[];
  onSend: (question: string, threadId?: string) => void;
  onSaveAnswer: (kind: "note" | "question" | "reference" | "report", item: ChatItem) => void;
};

export function ContextChatPanel(props: Props) {
  const [question, setQuestion] = useState("");
  const [forceNewThread, setForceNewThread] = useState(false);
  const threadId = forceNewThread ? undefined : props.history[0]?.thread_id;
  const quickQuestions = useMemo(() => ["这个节点为什么重要？", "请总结这个节点", "下一步还需要补什么证据？"], []);

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle
        eyebrow="Context Chat"
        title="上下文问答"
        description="这里只围绕当前节点的上下文提问，不接管整条研究流程。回答可以直接保存成笔记、问题、参考或报告节点。"
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
          新建线程
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
        {!props.history.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">选中一个节点后，就可以围绕它继续追问。</div> : null}
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="flex-1 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="围绕当前节点提出一个问题..."
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
