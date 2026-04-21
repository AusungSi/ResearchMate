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
});
