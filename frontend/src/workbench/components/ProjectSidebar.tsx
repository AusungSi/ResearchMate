import logoUrl from "../../../../docs/design/logo.png";

export type SidebarEntry = "overview" | "project" | "task" | "collection" | "import";

type Props = {
  activeEntry: SidebarEntry | null;
  projectCount: number;
  taskCount: number;
  collectionCount: number;
  onOpenEntry: (entry: SidebarEntry) => void;
};

const entries: Array<{
  key: SidebarEntry;
  label: string;
  count?: keyof Pick<Props, "projectCount" | "taskCount" | "collectionCount">;
}> = [
  { key: "overview", label: "总览" },
  { key: "project", label: "项目", count: "projectCount" },
  { key: "task", label: "任务", count: "taskCount" },
  { key: "collection", label: "Collection", count: "collectionCount" },
  { key: "import", label: "导入" },
];

export function ProjectSidebar(props: Props) {
  return (
    <aside className="flex h-full flex-col items-center gap-4 bg-slate-50/90 px-3 py-4">
      <img src={logoUrl} alt="ResearchMate logo" className="h-12 w-12 rounded-2xl object-contain" />

      <div className="flex w-full flex-1 flex-col items-center gap-2">
        {entries.map((entry) => {
          const active = props.activeEntry === entry.key;
          const count = entry.count ? props[entry.count] : null;
          return (
            <button
              key={entry.key}
              aria-label={`open-${entry.key}-sheet`}
              className={`relative flex h-10 w-full items-center justify-center rounded-full border px-3 text-[12px] font-semibold transition ${
                active
                  ? "border-slate-900 bg-slate-900 text-white shadow-[0_12px_28px_rgba(15,23,42,0.16)]"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              }`}
              title={entry.label}
              onClick={() => props.onOpenEntry(entry.key)}
            >
              <span className="truncate">{entry.label}</span>
              {typeof count === "number" ? (
                <span className={`absolute -right-1 -top-1 min-w-5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${active ? "bg-white text-slate-900" : "bg-slate-100 text-slate-500"}`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </aside>
  );
}
