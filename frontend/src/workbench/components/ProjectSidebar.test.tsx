import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";

describe("ProjectSidebar", () => {
  it("renders projects and collections and can trigger create actions", () => {
    const onCreateProject = vi.fn();
    const onCreateCollection = vi.fn();

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
        zoteroConfig={{ enabled: true, has_api_key: true }}
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
            topic: "研究任务",
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
            name: "我的集合",
            description: "",
            source_type: "manual",
            source_ref: null,
            summary_text: null,
            item_count: 2,
            items: [],
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
        onImportZotero={vi.fn()}
      />,
    );

    expect(screen.getByText("研究工作台")).toBeInTheDocument();
    expect(screen.getAllByText("默认项目").length).toBeGreaterThan(0);
    expect(screen.getByText("我的集合")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("新建项目名称"), { target: { value: "新项目" } });
    fireEvent.click(screen.getAllByText("新建")[0]);
    expect(onCreateProject).toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("新建 collection"), { target: { value: "集合 A" } });
    fireEvent.click(screen.getAllByText("新建")[1]);
    expect(onCreateCollection).toHaveBeenCalled();
  });
});
