import React, { useState } from "react";

const files = [
  { name: "auth-service.ts", type: "TS" },
  { name: "login-flow.md", type: "MD" },
  { name: "api-schema.json", type: "JSON" },
];

const messages = [
  {
    role: "assistant",
    title: "AI Assistant",
    content:
      "我可以读取你附加的文件、当前上下文和输入内容，然后给出代码建议、重构方案或解释说明。",
  },
  {
    role: "user",
    title: "You",
    content: "请帮我基于当前登录流程，检查是否有边界情况遗漏。",
  },
  {
    role: "assistant",
    title: "AI Assistant",
    content:
      "可以。我会优先检查 token 过期、网络失败、重复提交、OAuth 回调失败以及表单校验状态同步问题。",
  },
];

function Icon({ name, size = 16, className = "" }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
  };

  const paths = {
    paperclip: (
      <>
        <path d="M21.44 11.05 12.25 20.24a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
      </>
    ),
    send: (
      <>
        <path d="m22 2-7 20-4-9-9-4Z" />
        <path d="M22 2 11 13" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </>
    ),
    x: (
      <>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
        <path d="M14 2v6h6" />
      </>
    ),
    sparkles: (
      <>
        <path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8Z" />
        <path d="m19 14 .8 1.8L22 17l-2.2 1.2L19 20l-.8-1.8L16 17l2.2-1.2Z" />
      </>
    ),
    more: (
      <>
        <circle cx="12" cy="12" r="1" />
        <circle cx="19" cy="12" r="1" />
        <circle cx="5" cy="12" r="1" />
      </>
    ),
    enter: (
      <>
        <path d="M9 10 4 15l5 5" />
        <path d="M20 4v7a4 4 0 0 1-4 4H4" />
      </>
    ),
    image: (
      <>
        <rect width="18" height="18" x="3" y="3" rx="2" />
        <circle cx="9" cy="9" r="2" />
        <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
      </>
    ),
    cpu: (
      <>
        <rect width="14" height="14" x="5" y="5" rx="2" />
        <path d="M9 9h6v6H9z" />
        <path d="M9 1v4" />
        <path d="M15 1v4" />
        <path d="M9 19v4" />
        <path d="M15 19v4" />
        <path d="M1 9h4" />
        <path d="M1 15h4" />
        <path d="M19 9h4" />
        <path d="M19 15h4" />
      </>
    ),
  };

  return <svg {...common}>{paths[name]}</svg>;
}

function Button({ children, className = "", variant = "default", ...props }) {
  const base =
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition focus-visible:outline-none";
  const styles =
    variant === "ghost"
      ? "bg-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-900"
      : "bg-slate-900 text-white shadow-sm hover:bg-slate-800";

  return (
    <button className={`${base} ${styles} ${className}`} {...props}>
      {children}
    </button>
  );
}

function AttachmentChip({ file }) {
  return (
    <div className="group inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
      <Icon name="file" size={13} />
      <span className="max-w-[120px] truncate font-medium text-slate-700">
        {file.name}
      </span>
      <span className="text-[10px] text-slate-400">{file.type}</span>
      <button className="rounded-full p-0.5 text-slate-300 transition hover:bg-slate-200 hover:text-slate-600">
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

function MessageBubble({ item }) {
  const isUser = item.role === "user";

  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
      {!isUser && (
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white shadow-sm">
          <Icon name="sparkles" size={15} />
        </div>
      )}

      <div className={`max-w-[82%] ${isUser ? "items-end" : "items-start"} flex flex-col gap-1`}>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[11px] font-medium text-slate-500">{item.title}</span>
          {!isUser && (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              context aware
            </span>
          )}
        </div>

        <div
          className={`rounded-2xl px-4 py-3 text-sm leading-6 shadow-sm ${
            isUser
              ? "rounded-tr-md bg-slate-900 text-white"
              : "rounded-tl-md border border-slate-200 bg-white text-slate-700"
          }`}
        >
          {item.content}
        </div>
      </div>
    </div>
  );
}

export default function IdeAiChatMockup() {
  const [text, setText] = useState("帮我根据这些文件生成一个实现方案...");

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-[440px] overflow-hidden rounded-3xl border border-slate-200 bg-slate-50 shadow-xl shadow-slate-200/70">
        <div className="flex h-[760px] flex-col">
          <header className="border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                  <Icon name="cpu" size={17} />
                </div>
                <div>
                  <h1 className="text-sm font-semibold text-slate-900">AI Chat</h1>
                  <p className="text-xs text-slate-400">Workspace context</p>
                </div>
              </div>

              <Button variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-700">
                <Icon name="more" size={17} />
              </Button>
            </div>
          </header>

          <main className="flex-1 space-y-5 overflow-y-auto px-4 py-5">
            {messages.map((item, index) => (
              <MessageBubble key={index} item={item} />
            ))}
          </main>

          <section className="border-t border-slate-200 bg-white p-4">
            {files.length > 0 && (
              <div className="mb-2">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-slate-400">
                    Attached files ({files.length})
                  </span>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {files.map((file) => (
                    <AttachmentChip key={file.name} file={file} />
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm focus-within:border-slate-300 focus-within:ring-4 focus-within:ring-slate-100">
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[96px] w-full resize-none rounded-2xl border-0 bg-transparent px-3 py-3 text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400"
                placeholder="Ask AI, attach files, or reference selected code..."
              />

              <div className="flex items-center justify-between border-t border-slate-100 px-2 pt-2">
                <div className="flex items-center gap-1">
                  <Button variant="ghost" className="h-9 w-9 p-0">
                    <Icon name="paperclip" size={17} />
                  </Button>
                  <Button variant="ghost" className="h-9 w-9 p-0">
                    <Icon name="image" size={17} />
                  </Button>
                  <Button variant="ghost" className="h-9 px-3 text-xs">
                    <Icon name="plus" size={15} className="mr-1" />
                    Context
                  </Button>
                </div>

                <div className="flex items-center gap-2">
                  <div className="hidden items-center gap-1 rounded-lg bg-slate-50 px-2 py-1 text-[11px] text-slate-400 sm:flex">
                    <Icon name="enter" size={12} />
                    Enter
                  </div>
                  <Button className="h-9 px-3 text-xs">
                    Send
                    <Icon name="send" size={15} className="ml-2" />
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}