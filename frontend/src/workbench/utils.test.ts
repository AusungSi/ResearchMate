import { describe, expect, it } from "vitest";
import { buildCanvasPayload, defaultCanvasUi, mergeCanvasWithGraph } from "./utils";
import type { CanvasResponse, GraphResponse, RunEvent } from "./types";

describe("mergeCanvasWithGraph", () => {
  it("keeps manual canvas nodes and adds OpenClaw checkpoint/report nodes from events", () => {
    const graph: GraphResponse = {
      task_id: "R-1",
      status: "done",
      view: "tree",
      nodes: [{ id: "topic:R-1", type: "topic", label: "Research topic" }],
      edges: [],
    };
    const canvas: CanvasResponse = {
      task_id: "R-1",
      nodes: [
        {
          id: "note:test",
          type: "note",
          position: { x: 600, y: 300 },
          data: { label: "My note" },
          hidden: false,
        },
      ],
      edges: [],
      viewport: { x: 10, y: 20, zoom: 1.2 },
      ui: defaultCanvasUi(),
    };
    const events: RunEvent[] = [
      {
        task_id: "R-1",
        run_id: "run-1",
        event_type: "checkpoint",
        seq: 1,
        created_at: "2026-04-18T00:00:00Z",
        payload: {
          checkpoint_id: "ckpt-1",
          title: "Initial research map",
          summary: "等待下一步引导",
        },
      },
      {
        task_id: "R-1",
        run_id: "run-1",
        event_type: "report_chunk",
        seq: 2,
        created_at: "2026-04-18T00:01:00Z",
        payload: {
          title: "Stage report",
          content: "阶段报告内容",
        },
      },
    ];

    const merged = mergeCanvasWithGraph(graph, canvas, events);

    expect(merged.nodes.some((node) => node.id === "topic:R-1")).toBe(true);
    expect(merged.nodes.some((node) => node.id === "note:test" && node.data?.isManual)).toBe(true);
    expect(merged.nodes.some((node) => node.id === "checkpoint:ckpt-1")).toBe(true);
    expect(merged.nodes.some((node) => node.id === "report:run-1")).toBe(true);
    expect(merged.edges.some((edge) => edge.source === "topic:R-1" && edge.target === "checkpoint:ckpt-1")).toBe(true);
    expect(merged.viewport.zoom).toBe(1.2);
    expect(merged.ui.layout_mode).toBe("elk_layered");
  });

  it("only persists manual edges and lightweight system node data", () => {
    const payload = buildCanvasPayload(
      "R-2",
      [
        {
          id: "topic:R-2",
          type: "cardNode",
          position: { x: 10, y: 20 },
          data: { id: "topic:R-2", type: "topic", label: "Topic", summary: "canonical", userNote: "focus here" },
        } as never,
        {
          id: "note:abc",
          type: "cardNode",
          position: { x: 40, y: 60 },
          data: { id: "note:abc", type: "note", label: "Manual note", summary: "hello", isManual: true },
        } as never,
      ],
      [
        {
          id: "graph:topic:R-2:paper:1:tree",
          source: "topic:R-2",
          target: "paper:1",
          type: "smoothstep",
          data: { kind: "graph" },
        } as never,
        {
          id: "manual-edge",
          source: "topic:R-2",
          target: "note:abc",
          type: "smoothstep",
          data: { kind: "manual", label: "my link" },
        } as never,
      ],
      { x: 0, y: 0, zoom: 1 },
      defaultCanvasUi(),
    );

    expect(payload.nodes).toHaveLength(2);
    expect(payload.nodes[0].data).toEqual({ userNote: "focus here" });
    expect(payload.nodes[1].data).toMatchObject({ isManual: true, label: "Manual note" });
    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0].id).toBe("manual-edge");
  });
});
