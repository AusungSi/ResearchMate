import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProjectSidebar } from "./ProjectSidebar";

describe("ProjectSidebar", () => {
  it("renders the fixed five-button rail and opens center sheets", () => {
    const onOpenEntry = vi.fn();

    render(<ProjectSidebar activeEntry="task" projectCount={3} taskCount={6} collectionCount={2} onOpenEntry={onOpenEntry} />);

    expect(screen.getByAltText("ResearchMate logo")).toBeInTheDocument();
    expect(screen.queryByText("ResearchMate")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "open-overview-sheet" })).toHaveTextContent("总览");
    expect(screen.getByRole("button", { name: "open-project-sheet" })).toHaveTextContent("项目");
    expect(screen.getByRole("button", { name: "open-task-sheet" })).toHaveTextContent("任务");
    expect(screen.getByRole("button", { name: "open-collection-sheet" })).toHaveTextContent("Collection");
    expect(screen.getByRole("button", { name: "open-import-sheet" })).toHaveTextContent("导入");

    fireEvent.click(screen.getByRole("button", { name: "open-collection-sheet" }));
    expect(onOpenEntry).toHaveBeenCalledWith("collection");

    fireEvent.click(screen.getByRole("button", { name: "open-import-sheet" }));
    expect(onOpenEntry).toHaveBeenCalledWith("import");
  });
});
