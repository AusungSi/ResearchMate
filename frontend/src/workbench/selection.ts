import type { Node } from "@xyflow/react";
import type { FlowNodeData } from "./types";
import { isPaperNode } from "./utils";

export function getSelectedPaperIds(nodes: Array<Node<FlowNodeData>>, selectedNodeIds: string[]) {
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const paperIds: string[] = [];

  for (const nodeId of selectedNodeIds) {
    if (seen.has(nodeId)) continue;
    seen.add(nodeId);
    const node = nodeMap.get(nodeId);
    if (!isPaperNode(node ? node : nodeId)) continue;
    paperIds.push(nodeId);
  }

  return paperIds;
}

export function buildCollectionItems(taskId: string, paperIds: string[]) {
  return paperIds.map((paperId) => ({ task_id: taskId, paper_id: paperId }));
}
