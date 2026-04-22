import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  SelectionMode,
  addEdge,
  type Connection,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import type { FlowNodeData } from "../types";
import { edgeVisual } from "../utils";
import { NodeCard } from "./NodeCard";

export function ResearchCanvas(props: {
  nodes: Array<Node<FlowNodeData>>;
  edges: Array<Edge>;
  showMiniMap: boolean;
  flowRef: React.MutableRefObject<ReactFlowInstance<Node<FlowNodeData>, Edge> | null>;
  onNodesChange: OnNodesChange<Node<FlowNodeData>>;
  onEdgesChange: OnEdgesChange<Edge>;
  onConnect: (connection: Connection) => void;
  onNodeClick: (nodeId: string) => void;
  onPaneClick: () => void;
  onMoveStart: () => void;
  onMoveEnd: (viewport: { x: number; y: number; zoom: number }) => void;
  onNodeDragStart: () => void;
  onNodeDragStop: () => void;
  onSelectionChange: () => void;
  onNodesDelete: (deleted: Array<Node<FlowNodeData>>) => void;
  onEdgesDelete: (deleted: Array<Edge>) => void;
}) {
  return (
    <ReactFlow
      nodes={props.nodes}
      edges={props.edges}
      nodeTypes={{ cardNode: NodeCard }}
      onNodesChange={props.onNodesChange}
      onEdgesChange={props.onEdgesChange}
      onNodeDragStart={props.onNodeDragStart}
      onNodeDragStop={props.onNodeDragStop}
      onNodesDelete={props.onNodesDelete}
      onEdgesDelete={props.onEdgesDelete}
      onConnect={(connection) => props.onConnect(connection)}
      onNodeClick={(_, node) => props.onNodeClick(node.id)}
      onPaneClick={props.onPaneClick}
      onMoveStart={props.onMoveStart}
      onMoveEnd={(_, viewport) => props.onMoveEnd(viewport)}
      onSelectionChange={props.onSelectionChange}
      onInit={(instance) => {
        props.flowRef.current = instance;
      }}
      defaultEdgeOptions={edgeVisual}
      connectionLineStyle={{ stroke: "#64748b", strokeWidth: 2.5 }}
      onlyRenderVisibleElements
      selectionOnDrag={false}
      selectionKeyCode={["Shift"]}
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode={["Meta", "Control", "Shift"]}
      panOnDrag
      zoomOnScroll
      fitView={false}
      deleteKeyCode={["Backspace", "Delete"]}
      minZoom={0.25}
      maxZoom={1.6}
    >
      <Background color="#d8e0ea" gap={28} />
      {props.showMiniMap ? <MiniMap pannable zoomable /> : null}
      <Controls />
    </ReactFlow>
  );
}

export function buildManualConnection(connection: Connection, edges: Array<Edge>) {
  return addEdge({ ...connection, ...edgeVisual, data: { kind: "manual" } }, edges);
}
