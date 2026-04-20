import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";

describe("ProjectSidebar", () => {
  it("renders local zotero entry and export options", () => {
    const onCreateProject = vi.fn();
    const onCreateCollection = vi.fn();
    const onImportZoteroFile = vi.fn();

    render(
      <ProjectSidebar
        config={{
          default_mode: "gpt_step",
          default_backend: "gpt",
          default_gpt_model: "gpt-5.4",
          default_openclaw_model: "main",
          openclaw_enabled: true,
          available_modes: ["gpt_step", "openclaw_auto"],
          available_backends: ["gpt", "openclaw"],
          discovery_providers: ["semantic_scholar", "arxiv", "openalex"],
          citation_providers: ["semantic_scholar", "openalex", "crossref"],
          provider_status: [],
          layout_defaults: {},
          default_canvas_ui: {
            left_sidebar_collapsed: false,
            right_sidebar_collapsed: false,
            left_sidebar_width: 320,
            right_sidebar_width: 420,
            show_minimap: false,
            layout_mode: "elk_layered",
          },
        }}
        dashboard={{
          project: {
            project_id: "project-default",
            name: "默认项目",
            description: "",
            is_default: true,
            task_count: 1,
            collection_count: 1,
            created_at: "2026-04-18T00:00:00Z",
            updated_at: "2026-04-18T00:00:00Z",
          },
          task_count: 1,
          collection_count: 1,
          paper_count: 8,
          saved_paper_count: 3,
          recent_tasks: [],
          recent_runs: [],
          provider_status: [],
          recent_exports: [],
          recent_collections: [],
        }}
        currentExports={[]}
        zoteroConfig={{
          enabled: true,
          mode: "local_default",
          import_formats: ["csljson", "bib"],
          export_targets: ["task", "collection"],
          legacy_web_api_enabled: true,
          legacy_web_api_configured: false,
          has_api_key: false,
        }}
        projects={[
          {
            project_id: "project-default",
            name: "默认项目",
            description: "",
            is_default: true,
            task_count: 1,
            collection_count: 1,
            created_at: "2026-04-18T00:00:00Z",
            updated_at: "2026-04-18T00:00:00Z",
          },
        ]}
        tasks={[
          {
            task_id: "R-1",
            project_id: "project-default",
            project_name: "默认项目",
            topic: "具身智能调研",
            status: "done",
            mode: "gpt_step",
            llm_backend: "gpt",
            llm_model: "gpt-5.4",
            auto_status: "idle",
            latest_run_id: "step-R-1",
            directions: [],
            graph_stats: {},
          },
        ]}
        collections={[
          {
            collection_id: "collection-1",
            project_id: "project-default",
            name: "核心论文集合",
            description: "",
            source_type: "manual",
            source_ref: null,
            summary_text: null,
            item_count: 2,
            items: [],
            offset: 0,
            limit: 50,
            has_more: false,
            created_at: "2026-04-18T00:00:00Z",
            updated_at: "2026-04-18T00:00:00Z",
          },
        ]}
        activeProjectId="project-default"
        activeTaskId="R-1"
        activeCollectionId="collection-1"
        activeTask={null}
        actionStatus={null}
        onSelectProject={vi.fn()}
        onSelectTask={vi.fn()}
        onSelectCollection={vi.fn()}
        onCreateProject={onCreateProject}
        onCreateCollection={onCreateCollection}
        onCreateTask={vi.fn()}
        onQuickAction={vi.fn()}
        onImportZoteroFile={onImportZoteroFile}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByText("研究工作台")).toBeInTheDocument();
    expect(screen.getByText("导入 Zotero 文件")).toBeInTheDocument();
    expect(screen.getByText("本地导入导出可用")).toBeInTheDocument();
    expect(screen.getByText("导出 CSL JSON")).toBeInTheDocument();

    fireEvent.click(screen.getByText("导入 Zotero 文件"));
    expect(onImportZoteroFile).toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("输入新的项目名"), { target: { value: "新项目" } });
    fireEvent.click(screen.getAllByText("创建")[0]);
    expect(onCreateProject).toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("输入 Collection 名称"), { target: { value: "Collection A" } });
    fireEvent.click(screen.getAllByText("创建")[1]);
    expect(onCreateCollection).toHaveBeenCalled();
  });
});
