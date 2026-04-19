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
          latest_checkpoint: null,
          latest_report: null,
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
            payload: { title: "Initial research map", summary: "等待引导" },
          },
        ]}
        onGuidance={onGuidance}
        onContinue={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText("自动研究时间线")).toBeInTheDocument();
    expect(screen.getByText("Checkpoint")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/Checkpoint 引导/), { target: { value: "请更关注 citation graph" } });
    fireEvent.click(screen.getByText("提交引导"));
    expect(onGuidance).toHaveBeenCalledWith("请更关注 citation graph");
  });
});
