import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";

describe("ProjectSidebar", () => {
  it("renders collapsible sections, local Zotero entry and creation actions", () => {
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
            name: "Default Project",
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
            name: "Default Project",
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
            project_name: "Default Project",
            topic: "Embodied AI",
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
            name: "Core Papers",
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
        onSelectProject={vi.fn()}
        onSelectTask={vi.fn()}
        onSelectCollection={vi.fn()}
        onCreateProject={onCreateProject}
        onCreateCollection={onCreateCollection}
        onCreateTask={vi.fn()}
        onQuickAction={vi.fn()}
        onImportZoteroFile={onImportZoteroFile}
      />,
    );

    expect(screen.getByText("Research Workbench")).toBeInTheDocument();
    expect(screen.getByText("项目列表")).toBeInTheDocument();
    expect(screen.getByText("任务列表")).toBeInTheDocument();
    expect(screen.getByTestId("import-zotero-button")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /BibTeX/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("import-zotero-button"));
    expect(onImportZoteroFile).toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("输入新的项目名"), { target: { value: "Project A" } });
    fireEvent.click(screen.getByTestId("create-project-button"));
    expect(onCreateProject).toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("输入 Collection 名称"), { target: { value: "Collection A" } });
    fireEvent.click(screen.getByTestId("create-collection-button"));
    expect(onCreateCollection).toHaveBeenCalled();

    fireEvent.click(screen.getAllByText("折叠")[0]);
    expect(screen.getAllByText("展开").length).toBeGreaterThan(0);
  });
});
