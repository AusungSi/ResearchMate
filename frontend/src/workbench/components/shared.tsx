import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "slate" | "blue" | "green" | "violet" | "amber" | "rose" | "solid";

const badgeToneClass: Record<Exclude<Tone, "solid">, string> = {
  slate: "border-slate-200 bg-slate-50 text-slate-600",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
};

const buttonToneClass: Record<Tone, string> = {
  slate: "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
  blue: "border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100",
  violet: "border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100",
  amber: "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100",
  rose: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
  solid: "border-slate-900 bg-slate-900 text-white hover:bg-slate-800 hover:border-slate-800",
};

export function Badge(props: { tone?: Exclude<Tone, "solid">; children: ReactNode }) {
  const tone = props.tone || "slate";
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${badgeToneClass[tone]}`}>{props.children}</span>;
}

export function SmallButton(props: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone }) {
  const { className = "", tone = "slate", type = "button", ...rest } = props;
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center rounded-xl border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 ${buttonToneClass[tone]} ${className}`.trim()}
      {...rest}
    />
  );
}

export function SectionTitle(props: {
  eyebrow?: string | null;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        {props.eyebrow ? <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{props.eyebrow}</div> : null}
        <div className="mt-1 text-base font-semibold leading-6 text-slate-900">{props.title}</div>
        {props.description ? <div className="mt-1 text-sm leading-6 text-slate-500">{props.description}</div> : null}
      </div>
      {props.aside ? <div className="shrink-0">{props.aside}</div> : null}
    </div>
  );
}

export function MarkdownText(props: { text?: string | null; className?: string }) {
  const text = (props.text || "").trim();
  if (!text) {
    return <div className={props.className} />;
  }
  return <div className={props.className} dangerouslySetInnerHTML={{ __html: markdownToHtml(text) }} />;
}

function markdownToHtml(source: string) {
  const normalized = source.replace(/\r\n/g, "\n");
  const blocks = normalized.split(/```/);
  return blocks
    .map((block, index) => {
      if (index % 2 === 1) {
        return `<pre class="overflow-x-auto rounded-2xl bg-slate-950/95 p-3 text-xs leading-6 text-slate-100"><code>${escapeHtml(block.trim())}</code></pre>`;
      }
      return renderMarkdownBlock(block);
    })
    .join("");
}

function renderMarkdownBlock(block: string) {
  const lines = block.split("\n");
  const parts: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    parts.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length || !listType) return;
    parts.push(`<${listType} class="ml-5 space-y-1">${listItems.join("")}</${listType}>`);
    listItems = [];
    listType = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1].length);
      parts.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const ordered = line.match(/^(\d+)\.\s+(.*)$/);
    if (ordered) {
      flushParagraph();
      if (listType && listType !== "ol") flushList();
      listType = "ol";
      listItems.push(`<li>${renderInline(ordered[2])}</li>`);
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.*)$/);
    if (unordered) {
      flushParagraph();
      if (listType && listType !== "ul") flushList();
      listType = "ul";
      listItems.push(`<li>${renderInline(unordered[1])}</li>`);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return parts.join("");
}

function renderInline(text: string) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer" class="text-blue-600 underline underline-offset-2">$1</a>');
  return html;
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
