import type { HealthState, LineageEdge, LineageGraph, LineageNode } from "../api/contracts";

export const lineageHealthColors: Record<HealthState, { fill: string; stroke: string; text: string }> = {
  healthy: { fill: "#15392f", stroke: "#55c69e", text: "#a7ebd0" },
  degraded: { fill: "#3b3020", stroke: "#e3b956", text: "#f3d58f" },
  critical: { fill: "#40252c", stroke: "#f16f79", text: "#ffb0b4" },
  waiting: { fill: "#252f3d", stroke: "#91a3b9", text: "#c5d0dd" },
  unknown: { fill: "#252a32", stroke: "#778392", text: "#bdc5cf" },
};

export const lineageNodeKinds: Record<LineageNode["node_type"], { label: string; shortLabel: string }> = {
  source: { label: "Source", shortLabel: "SRC" },
  ingestion: { label: "Ingestion", shortLabel: "ING" },
  quality_check: { label: "Quality check", shortLabel: "QLT" },
  schema: { label: "Schema", shortLabel: "SCH" },
  pipeline: { label: "Pipeline", shortLabel: "PIPE" },
  job: { label: "Job", shortLabel: "JOB" },
  dataset: { label: "Dataset", shortLabel: "DATA" },
  transformation: { label: "Transformation", shortLabel: "XFORM" },
  feature: { label: "Feature", shortLabel: "FEAT" },
  data_product: { label: "Data product", shortLabel: "PROD" },
  ai_product: { label: "AI product", shortLabel: "AI" },
  report: { label: "Report", shortLabel: "RPT" },
};

export function getLineageHealthColor(health: HealthState): string {
  return lineageHealthColors[health].stroke;
}

export function getLineageNodeKind(nodeType: LineageNode["node_type"]): string {
  return lineageNodeKinds[nodeType].label;
}

export function layoutLineageGraph(
  graph: Pick<LineageGraph, "nodes" | "edges">,
  options: { nodeWidth?: number; nodeHeight?: number; horizontalGap?: number; verticalGap?: number } = {},
) {
  const nodeWidth = options.nodeWidth ?? 188;
  const nodeHeight = options.nodeHeight ?? 76;
  const horizontalGap = options.horizontalGap ?? 108;
  const verticalGap = options.verticalGap ?? 32;
  const nodeIds = new Set(graph.nodes.map((node) => node.node_id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source_node_id) && nodeIds.has(edge.target_node_id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map(graph.nodes.map((node) => [node.node_id, 0]));

  for (const edge of edges) {
    outgoing.set(edge.source_node_id, [...(outgoing.get(edge.source_node_id) ?? []), edge.target_node_id]);
    indegree.set(edge.target_node_id, (indegree.get(edge.target_node_id) ?? 0) + 1);
  }

  const ranks = new Map(graph.nodes.map((node) => [node.node_id, 0]));
  const queue = graph.nodes.filter((node) => indegree.get(node.node_id) === 0).map((node) => node.node_id);
  const visited = new Set<string>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    visited.add(nodeId);
    for (const target of outgoing.get(nodeId) ?? []) {
      ranks.set(target, Math.max(ranks.get(target) ?? 0, (ranks.get(nodeId) ?? 0) + 1));
      const remaining = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, remaining);
      if (remaining === 0) queue.push(target);
    }
  }

  let residualRank = Math.max(0, ...ranks.values()) + 1;
  for (const node of graph.nodes) {
    if (!visited.has(node.node_id)) {
      ranks.set(node.node_id, residualRank);
      residualRank += 1;
    }
  }

  const columns = new Map<number, LineageNode[]>();
  for (const node of graph.nodes) {
    const rank = ranks.get(node.node_id) ?? 0;
    columns.set(rank, [...(columns.get(rank) ?? []), node]);
  }

  const positions = new Map<string, { x: number; y: number; rank: number }>();
  let maximumColumnHeight = 0;
  for (const [rank, nodes] of columns) {
    const columnHeight = nodes.length * nodeHeight + Math.max(0, nodes.length - 1) * verticalGap;
    maximumColumnHeight = Math.max(maximumColumnHeight, columnHeight);
    const top = Math.max(24, columnHeight / 2);
    nodes.forEach((node, index) => {
      positions.set(node.node_id, {
        x: 28 + rank * (nodeWidth + horizontalGap),
        y: top + index * (nodeHeight + verticalGap),
        rank,
      });
    });
  }

  const maximumRank = Math.max(0, ...ranks.values());
  return {
    positions,
    edges,
    nodeWidth,
    nodeHeight,
    width: 56 + (maximumRank + 1) * nodeWidth + maximumRank * horizontalGap,
    height: Math.max(176, maximumColumnHeight + 48),
  };
}

export function getConnectedNodeIds(anchorId: string, edges: LineageEdge[], direction: "upstream" | "downstream" | "both" = "both") {
  const visited = new Set<string>([anchorId]);
  const pending = [anchorId];
  while (pending.length) {
    const current = pending.pop();
    if (!current) continue;
    for (const edge of edges) {
      const next = direction === "upstream"
        ? edge.target_node_id === current ? edge.source_node_id : null
        : direction === "downstream"
          ? edge.source_node_id === current ? edge.target_node_id : null
          : edge.source_node_id === current
            ? edge.target_node_id
            : edge.target_node_id === current
              ? edge.source_node_id
              : null;
      if (next && !visited.has(next)) {
        visited.add(next);
        pending.push(next);
      }
    }
  }
  return visited;
}

export function getIncidentNodeIds(graph: LineageGraph, incidents: Array<{ correlated_node_ids: string[]; evidence: Array<{ source_id?: string | null; dataset_id?: string | null; pipeline_id?: string | null }> }>) {
  const nodeIds = new Set(graph.nodes.map((node) => node.node_id));
  const incidentsByNode = new Map<string, number>();
  for (const incident of incidents) {
    const related = new Set(incident.correlated_node_ids.filter((nodeId) => nodeIds.has(nodeId)));
    for (const event of incident.evidence) {
      if (event.source_id) {
        for (const candidate of [`source.${event.source_id}`, event.source_id]) {
          if (nodeIds.has(candidate)) related.add(candidate);
        }
      }
      for (const candidate of [event.dataset_id, event.pipeline_id]) {
        if (candidate && nodeIds.has(candidate)) related.add(candidate);
      }
    }
    for (const nodeId of related) incidentsByNode.set(nodeId, (incidentsByNode.get(nodeId) ?? 0) + 1);
  }
  return incidentsByNode;
}
