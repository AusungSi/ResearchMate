import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickActionBar } from "./QuickActionBar";

afterEach(() => {
  cleanup();
});

describe("QuickActionBar", () => {
  it("renders compact actions without the old helper copy", () => {
    const { container } = render(
      <QuickActionBar
        selectedPaperCount={0}
        hiddenNodeCount={0}
        onAddNote={vi.fn()}
        onAddQuestion={vi.fn()}
        onAddReference={vi.fn()}
        onAddGroup={vi.fn()}
        onSaveCanvas={vi.fn()}
        onAddToCollection={vi.fn()}
        onCreateStudyFromSelection={vi.fn()}
        onCompareSelection={vi.fn()}
        onRestoreHiddenNodes={vi.fn()}
      />,
    );

    expect(screen.queryByText("快捷动作")).not.toBeInTheDocument();
    expect(screen.queryByText(/左键可拖动画布/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "恢复隐藏节点" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "添加笔记" }).className).not.toContain("min-w-[7.5rem]");
    expect(container.firstChild).toHaveClass("left-20");
  });

  it("enables restore action when hidden nodes exist", () => {
    const onRestoreHiddenNodes = vi.fn();

    render(
      <QuickActionBar
        selectedPaperCount={2}
        hiddenNodeCount={3}
        onAddNote={vi.fn()}
        onAddQuestion={vi.fn()}
        onAddReference={vi.fn()}
        onAddGroup={vi.fn()}
        onSaveCanvas={vi.fn()}
        onAddToCollection={vi.fn()}
        onCreateStudyFromSelection={vi.fn()}
        onCompareSelection={vi.fn()}
        onRestoreHiddenNodes={onRestoreHiddenNodes}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "恢复隐藏节点" }));
    expect(onRestoreHiddenNodes).toHaveBeenCalledTimes(1);
  });
});
