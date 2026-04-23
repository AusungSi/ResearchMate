import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TaskProgressViewModel } from "../progress";
import { TaskProgress } from "./TaskProgress";

const progress: TaskProgressViewModel = {
  mode: "gpt_step",
  headline: "当前阶段：检索与探索",
  currentLabel: "检索与探索",
  summary: "正在推进论文检索。",
  percent: 50,
  completedCount: 2,
  totalCount: 5,
  badgeLabel: "进行中",
  badgeTone: "blue",
  stages: [
    { key: "create", label: "任务创建", state: "done", hint: "任务已初始化。" },
    { key: "plan", label: "方向规划", state: "done", hint: "方向已生成。" },
    { key: "search", label: "检索与探索", state: "current", hint: "正在检索。" },
    { key: "graph", label: "图谱构建", state: "pending", hint: "等待开始。" },
    { key: "fulltext", label: "全文处理", state: "pending", hint: "等待开始。" },
  ],
};

describe("TaskProgress", () => {
  it("collapses into a compact chip and can be expanded again", () => {
    render(<TaskProgress progress={progress} />);

    fireEvent.click(screen.getByRole("button", { name: "展开 Task Progress" }));
    expect(screen.getByText("当前阶段：检索与探索")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "隐藏 Task Progress" }));

    expect(screen.queryByText("当前阶段：检索与探索")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "展开 Task Progress" })).toHaveTextContent("Task Progress");

    fireEvent.click(screen.getByRole("button", { name: "展开 Task Progress" }));
    expect(screen.getByText("当前阶段：检索与探索")).toBeInTheDocument();
  });
});
