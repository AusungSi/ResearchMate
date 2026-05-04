import { describe, expect, it } from "vitest";
import { deriveTaskProgress } from "./progress";
import type { RunEvent, RunSummary, TaskSummary } from "./types";

describe("deriveTaskProgress", () => {
  it("tracks the current GPT Step phase from queued step events", () => {
    const task: TaskSummary = {
      task_id: "R-1",
      topic: "Embodied AI",
      status: "searching",
      mode: "gpt_step",
      llm_backend: "gpt",
      llm_model: "gpt-5.4",
      auto_status: "idle",
      directions: [{ direction_index: 1, name: "World Model", papers_count: 12 }],
      papers_total: 12,
      rounds_total: 1,
      graph_stats: {},
      fulltext_stats: {},
    };
    const summary: RunSummary = {
      total: 4,
      latest_seq: 4,
      phases: [],
      phase_groups: [],
      latest_checkpoint: null,
      latest_report: null,
      latest_report_excerpt: null,
      guidance_history: [],
      artifacts: [],
      step_cards: [
        { key: "task_created", title: "Task created", status: "created", seq: 1, details: {}, result_refs: {} },
        { key: "plan_completed", title: "Plan completed", status: "done", seq: 2, details: {}, result_refs: {} },
        { key: "search_completed", title: "Search completed", status: "done", seq: 3, details: {}, result_refs: {} },
        { key: "graph_queued", title: "Graph queued", status: "queued", seq: 4, details: {}, result_refs: {} },
      ],
      active_node_ids: [],
      active_edges: [],
      running_label: null,
    };
    const events: RunEvent[] = [
      {
        task_id: "R-1",
        run_id: "step-R-1",
        event_type: "progress",
        seq: 4,
        created_at: "2026-04-22T00:00:00Z",
        payload: {
          kind: "gpt_step",
          step: "graph_queued",
          title: "Graph queued",
          message: "Preparing graph build",
          status: "queued",
        },
      },
    ];

    const progress = deriveTaskProgress(task, summary, events);

    expect(progress?.currentLabel).toBeTruthy();
    expect(progress?.badgeLabel).toBeTruthy();
    expect(progress?.percent).toBe(70);
    expect(progress?.stages.find((stage) => stage.key === "graph")?.state).toBe("current");
  });

  it("surfaces awaiting guidance for OpenClaw runs", () => {
    const task: TaskSummary = {
      task_id: "R-2",
      topic: "World Models",
      status: "done",
      mode: "openclaw_auto",
      llm_backend: "openclaw",
      llm_model: "main",
      auto_status: "awaiting_guidance",
      last_checkpoint_id: "ckpt-1",
      latest_run_id: "run-1",
      directions: [],
      graph_stats: {},
      fulltext_stats: {},
    };
    const summary: RunSummary = {
      total: 2,
      latest_seq: 2,
      phases: [],
      phase_groups: [],
      latest_checkpoint: {
        checkpoint_id: "ckpt-1",
        title: "Initial research map",
        summary: "Generated the first topic/direction map",
      },
      latest_report: null,
      latest_report_excerpt: null,
      guidance_history: [],
      artifacts: [],
      step_cards: [],
      active_node_ids: [],
      active_edges: [],
      running_label: null,
    };

    const progress = deriveTaskProgress(task, summary, []);

    expect(progress?.currentLabel).toBe("提交 Guidance");
    expect(progress?.badgeLabel).toBe("等待你的引导");
    expect(progress?.stages.find((stage) => stage.key === "guidance")?.state).toBe("current");
    expect(progress?.percent).toBe(70);
  });
});
