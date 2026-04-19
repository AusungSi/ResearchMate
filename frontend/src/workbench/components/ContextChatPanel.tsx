import { useMemo, useState } from "react";
import type { ChatItem } from "../types";
import { SectionTitle, SmallButton } from "./shared";

export function ContextChatPanel(props: {
  disabled: boolean;
  history: ChatItem[];
  onSend: (question: string, threadId?: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const threadId = props.history[0]?.thread_id;
  const quickQuestions = useMemo(
    () => ["这个节点为什么重要？", "请总结这个节点", "下一步应该继续看什么？"],
    [],
  );

  return (
    <div className="mt-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <SectionTitle eyebrow="Context Chat" title="上下文问答" description="只围绕当前节点上下文提问，不接管整条研究流程。" />

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
      </div>

      <div className="mt-3 max-h-56 space-y-3 overflow-auto pr-1">
        {props.history.map((item, index) => (
          <div key={`${item.created_at}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">问题</div>
            <div className="mt-1 text-sm text-slate-800">{item.question}</div>
            <div className="mt-2 text-xs font-medium text-slate-500">回答</div>
            <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.answer}</div>
          </div>
        ))}
        {!props.history.length ? <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">选中一个节点后，就可以围绕这个节点提问。</div> : null}
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
          }}
        >
          提问
        </SmallButton>
      </div>
    </div>
  );
}
