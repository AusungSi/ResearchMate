import { describe, expect, it } from "vitest";
import type { Node } from "@xyflow/react";
import type { FlowNodeData } from "./types";
import { buildCollectionItems, getSelectedPaperIds } from "./selection";

function makeNode(id: string, type: string): Node<FlowNodeData> {
  return {
    id,
    type: "cardNode",
    position: { x: 0, y: 0 },
    data: {
      id,
      type,
      label: id,
    },
  };
}

describe("selection helpers", () => {
  it("keeps only selected paper ids and preserves order", () => {
    const nodes = [
      makeNode("topic:R-1", "topic"),
      makeNode("paper:1", "paper"),
      makeNode("paper:2", "paper"),
      makeNode("note:1", "note"),
    ];

    expect(getSelectedPaperIds(nodes, ["topic:R-1", "paper:2", "paper:1", "note:1"])).toEqual(["paper:2", "paper:1"]);
  });

  it("dedupes repeated selected paper ids", () => {
    const nodes = [makeNode("paper:1", "paper"), makeNode("paper:2", "paper")];

    expect(getSelectedPaperIds(nodes, ["paper:1", "paper:1", "paper:2"])).toEqual(["paper:1", "paper:2"]);
  });

  it("builds collection payload items from task and paper ids", () => {
    expect(buildCollectionItems("R-1", ["paper:1", "paper:2"])).toEqual([
      { task_id: "R-1", paper_id: "paper:1" },
      { task_id: "R-1", paper_id: "paper:2" },
    ]);
  });
});
