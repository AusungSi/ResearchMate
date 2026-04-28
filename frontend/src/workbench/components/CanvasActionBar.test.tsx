import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CanvasActionBar } from "./CanvasActionBar";

describe("CanvasActionBar", () => {
  it("shows collection entry for a single paper", () => {
    render(
      <CanvasActionBar
        selectionLabel="已选节点 · Paper"
        multiPaper={false}
        singleNodeType="paper"
        canDeleteOrHide
        onAddToCollection={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "加入 Collection" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "对比文献" })).not.toBeInTheDocument();
  });

  it("shows collection and compare actions for multiple papers", () => {
    render(
      <CanvasActionBar
        selectionLabel="已选 2 篇论文"
        multiPaper
        singleNodeType={null}
        canDeleteOrHide={false}
        onAddToCollection={vi.fn()}
        onCompareSelection={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "加入 Collection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "对比文献" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "派生任务" })).not.toBeInTheDocument();
  });
});
