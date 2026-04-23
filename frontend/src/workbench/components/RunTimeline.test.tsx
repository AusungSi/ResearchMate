import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunTimeline } from "./RunTimeline";

describe("RunTimeline", () => {
  it("renders grouped events and allows guidance submission", () => {
    const onGuidance = vi.fn();

    render(
      <RunTimeline
        mode="openclaw_auto"
        autoStatus="awaiting_guidance"
        runId="run-1"
        summary={{
          total: 2,
          latest_seq: 2,
          phases: [],
          phase_groups: [],
          latest_checkpoint: null,
          latest_report: null,
          latest_report_excerpt: null,
          guidance_history: [],
          step_cards: [],
          artifacts: [],
        }}
        events={[
          {
            task_id: "R-1",
            run_id: "run-1",
            event_type: "progress",
            seq: 1,
            created_at: "2026-04-18T00:00:00Z",
            payload: { phase: "start", message: "auto research started" },
          },
          {
            task_id: "R-1",
            run_id: "run-1",
            event_type: "checkpoint",
            seq: 2,
            created_at: "2026-04-18T00:01:00Z",
            payload: { title: "Initial research map", summary: "awaiting guidance" },
          },
        ]}
        onGuidance={onGuidance}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("Run Log")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/checkpoint guidance/i), { target: { value: "please focus on citation graph" } });
    fireEvent.click(screen.getByRole("button", { name: /guidance/i }));
    expect(onGuidance).toHaveBeenCalledWith("please focus on citation graph");
  });

  it("renders step details as filtered Chinese natural language instead of raw JSON", () => {
    render(
      <RunTimeline
        mode="gpt_step"
        autoStatus="idle"
        runId="step-R-1"
        summary={{
          total: 1,
          latest_seq: 1,
          phases: [],
          phase_groups: [],
          latest_checkpoint: null,
          latest_report: null,
          latest_report_excerpt: null,
          guidance_history: [],
          step_cards: [
            {
              key: "citation_graph_completed",
              title: "图谱构建完成",
              status: "done",
              seq: 1,
              details: {
                view: "tree",
                node_count: 12,
                edge_count: 19,
                round_id: null,
                provider_errors: { openalex: "timeout" },
              },
              result_refs: {},
            },
          ],
          artifacts: [],
        }}
        events={[
          {
            task_id: "R-1",
            run_id: "step-R-1",
            event_type: "progress",
            seq: 1,
            created_at: "2026-04-18T00:00:00Z",
            payload: {
              kind: "gpt_step",
              step: "citation_graph_completed",
              title: "图谱构建完成",
              message: "已生成 12 个节点、19 条连线。",
              details: {
                view: "tree",
                node_count: 12,
                edge_count: 19,
                round_id: null,
              },
            },
          },
        ]}
        onGuidance={vi.fn()}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getAllByText("视图：树状图").length).toBeGreaterThan(0);
    expect(screen.getAllByText("节点数：12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("连线数：19").length).toBeGreaterThan(0);
    expect(screen.getByText("来源异常：OpenAlex（timeout）")).toBeInTheDocument();
    expect(screen.queryByText(/round_id/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/node_count/i)).not.toBeInTheDocument();
  });
});
