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
  onSelectionChange: (selection: { nodes: Array<Node<FlowNodeData>>; edges: Array<Edge> }) => void;
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
      onSelectionChange={(selection) => props.onSelectionChange({ nodes: selection.nodes as Array<Node<FlowNodeData>>, edges: selection.edges })}
      onInit={(instance) => {
        props.flowRef.current = instance;
      }}
      defaultEdgeOptions={edgeVisual}
      connectionLineStyle={{ stroke: "#64748b", strokeWidth: 2.5 }}
      onlyRenderVisibleElements
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      multiSelectionKeyCode={["Meta", "Control", "Shift"]}
      panOnDrag={[1, 2]}
      zoomOnScroll
      fitView={false}
      deleteKeyCode={["Backspace", "Delete"]}
      minZoom={0.25}
      maxZoom={1.6}
    >
      <Background color="#d8e0ea" gap={28} />
      {props.showMiniMap ? <MiniMap pannable zoomable position="bottom-right" style={{ bottom: 24, right: 24, width: 164, height: 112 }} /> : null}
      <Controls position="bottom-left" style={{ bottom: 24, left: 24 }} />
    </ReactFlow>
  );
}

export function buildManualConnection(connection: Connection, edges: Array<Edge>) {
  return addEdge({ ...connection, ...edgeVisual, data: { kind: "manual" } }, edges);
}
