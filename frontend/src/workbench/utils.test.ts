import { describe, expect, it } from "vitest";
import { buildCanvasPayload, defaultCanvasUi, derivePaperPdfUrl, mergeCanvasWithGraph } from "./utils";
import type { CanvasResponse, GraphResponse, RunEvent } from "./types";

describe("mergeCanvasWithGraph", () => {
  it("keeps manual canvas nodes and durable event nodes when canonical graph already exists", () => {
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
    expect(merged.nodes.some((node) => node.id === "checkpoint:ckpt-1" && !node.data?.isManual)).toBe(true);
    expect(merged.nodes.some((node) => node.id === "report:run-1" && !node.data?.isManual)).toBe(true);
    expect(merged.edges.some((edge) => edge.source === "topic:R-1" && edge.target === "checkpoint:ckpt-1")).toBe(true);
    expect(merged.viewport.zoom).toBe(1.2);
    expect(merged.ui.layout_mode).toBe("elk_layered");
  });

  it("preserves saved system paper preview snapshots when canonical graph is temporarily absent", () => {
    const canvas: CanvasResponse = {
      task_id: "R-2",
      nodes: [
        {
          id: "paper:demo",
          type: "paper",
          position: { x: 400, y: 160 },
          data: {
            id: "paper:demo",
            type: "paper",
            label: "Demo paper",
            card_summary: "问题：demo\n方法：model\n结论：stable",
            preview_kind: "figure",
            preview_url: "/api/v1/research/tasks/R-2/papers/paper%3Ademo/asset?kind=figure&disposition=inline",
            visual_status: "available",
            summary_source: "fulltext",
            summary_status: "done",
          },
          hidden: false,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      ui: defaultCanvasUi(),
    };

    const merged = mergeCanvasWithGraph(undefined, canvas);
    const paper = merged.nodes.find((node) => node.id === "paper:demo");

    expect(paper?.data?.type).toBe("paper");
    expect(paper?.data?.preview_kind).toBe("figure");
    expect(paper?.data?.preview_url).toContain("kind=figure");
    expect(paper?.data?.visual_status).toBe("available");
    expect(paper?.data?.isManual).toBeUndefined();
  });

  it("persists manual edges and system node display snapshots", () => {
    const payload = buildCanvasPayload(
      "R-3",
      [
        {
          id: "topic:R-3",
          type: "cardNode",
          position: { x: 10, y: 20 },
          data: {
            id: "topic:R-3",
            type: "topic",
            label: "Topic",
            summary: "canonical",
            userNote: "focus here",
            preview_url: "/preview.svg",
          },
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
          id: "graph:topic:R-3:paper:1:tree",
          source: "topic:R-3",
          target: "paper:1",
          type: "smoothstep",
          data: { kind: "graph" },
        } as never,
        {
          id: "manual-edge",
          source: "topic:R-3",
          target: "note:abc",
          type: "smoothstep",
          data: { kind: "manual", label: "my link" },
        } as never,
      ],
      { x: 0, y: 0, zoom: 1 },
      defaultCanvasUi(),
    );

    expect(payload.nodes).toHaveLength(2);
    expect(payload.nodes[0].data).toMatchObject({
      id: "topic:R-3",
      type: "topic",
      label: "Topic",
      summary: "canonical",
      userNote: "focus here",
      preview_url: "/preview.svg",
    });
    expect(payload.nodes[0].data).not.toMatchObject({ isManual: true });
    expect(payload.nodes[1].data).toMatchObject({ isManual: true, label: "Manual note" });
    expect(payload.edges).toHaveLength(1);
    expect(payload.edges[0].id).toBe("manual-edge");
  });
});

describe("derivePaperPdfUrl", () => {
  it("prefers asset meta URLs when available", () => {
    const url = derivePaperPdfUrl(
      {
        task_id: "R-1",
        paper_id: "paper:1",
        items: [{ kind: "pdf", status: "available", open_url: "/api/pdf/1" }],
      },
      { url: "https://arxiv.org/abs/2501.00001" },
    );

    expect(url).toBe("/api/pdf/1");
  });

  it("derives a direct arxiv PDF URL from the paper URL when no asset exists", () => {
    const url = derivePaperPdfUrl(null, { url: "http://arxiv.org/abs/2501.00001v2" });

    expect(url).toBe("https://arxiv.org/pdf/2501.00001v2.pdf");
  });
});
