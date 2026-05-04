import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Edge, Node, ReactFlowProps } from "@xyflow/react";
import type { FlowNodeData } from "../types";
import { ResearchCanvas } from "./ResearchCanvas";

const { reactFlowSpy } = vi.hoisted(() => ({
  reactFlowSpy: vi.fn(),
}));
const { miniMapSpy } = vi.hoisted(() => ({
  miniMapSpy: vi.fn(),
}));

vi.mock("@xyflow/react", () => ({
  ReactFlow: (props: ReactFlowProps<Node<FlowNodeData>, Edge>) => {
    reactFlowSpy(props);
    return <div data-testid="react-flow">{props.children}</div>;
  },
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  Handle: () => null,
  MarkerType: { ArrowClosed: "arrowclosed" },
  MiniMap: (props: Record<string, unknown>) => {
    miniMapSpy(props);
    return <div data-testid="minimap" />;
  },
  Position: { Left: "left", Right: "right" },
  SelectionMode: { Partial: "partial" },
  addEdge: vi.fn(),
}));

describe("ResearchCanvas", () => {
  it("uses the current canvas interaction defaults", () => {
    render(
      <ResearchCanvas
        nodes={[]}
        edges={[]}
        showMiniMap
        flowRef={{ current: null }}
        onNodesChange={vi.fn()}
        onEdgesChange={vi.fn()}
        onConnect={vi.fn()}
        onNodeClick={vi.fn()}
        onPaneClick={vi.fn()}
        onMoveStart={vi.fn()}
        onMoveEnd={vi.fn()}
        onNodeDragStart={vi.fn()}
        onNodeDragStop={vi.fn()}
        onSelectionChange={vi.fn()}
        onNodesDelete={vi.fn()}
        onEdgesDelete={vi.fn()}
      />,
    );

    const props = reactFlowSpy.mock.calls.at(-1)?.[0] as ReactFlowProps<Node<FlowNodeData>, Edge>;
    expect(props.panOnDrag).toEqual([1, 2]);
    expect(props.selectionOnDrag).toBe(true);
    expect(props.multiSelectionKeyCode).toEqual(["Meta", "Control", "Shift"]);
    expect(miniMapSpy.mock.calls.at(-1)?.[0]).toMatchObject({ style: { bottom: 24, right: 24 } });
  });
});
