import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunTimeline } from "./RunTimeline";

const summary = {
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
  active_node_ids: [],
  active_edges: [],
  running_label: "start",
};

describe("RunTimeline", () => {
  it("merges provider summary into run status and allows guidance submission", () => {
    const onGuidance = vi.fn();

    render(
      <RunTimeline
        mode="openclaw_auto"
        autoStatus="awaiting_guidance"
        runId="run-1"
        summary={summary}
        providerStatus={[
          { key: "gpt", role: "chat", enabled: true, configured: true },
          { key: "openclaw", role: "agent", enabled: true, configured: false },
        ]}
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
        onStart={vi.fn()}
        onGuidance={onGuidance}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("运行状态")).toBeInTheDocument();
    expect(screen.getByText("Provider 摘要")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/checkpoint guidance/i), { target: { value: "please focus on citation graph" } });
    fireEvent.click(screen.getByRole("button", { name: /提交 guidance/i }));
    expect(onGuidance).toHaveBeenCalledWith("please focus on citation graph");
  });

  it("keeps raw logs collapsed by default but opens error groups", () => {
    render(
      <RunTimeline
        mode="gpt_step"
        autoStatus=""
        runId="run-2"
        summary={{ ...summary, running_label: "paper_summary" }}
        providerStatus={[]}
        events={[
          {
            task_id: "R-1",
            run_id: "run-2",
            event_type: "progress",
            seq: 1,
            created_at: "2026-04-18T00:00:00Z",
            payload: { step: "plan_completed", message: "hidden until expanded" },
          },
          {
            task_id: "R-1",
            run_id: "run-2",
            event_type: "error",
            seq: 2,
            created_at: "2026-04-18T00:01:00Z",
            payload: { step: "paper_summary", message: "visible error" },
          },
        ]}
        onStart={vi.fn()}
        onGuidance={vi.fn()}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("visible error")).toBeVisible();
    expect(screen.getByText("hidden until expanded")).not.toBeVisible();
  });
});
