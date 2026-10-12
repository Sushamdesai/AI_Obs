from __future__ import annotations

from collections import deque
from datetime import UTC, datetime

from shared.contracts import LineageEdge, LineageGraph, LineageNode


class LineageService:
    """Bounded graph operations that remain safe for cyclic or malformed input graphs."""

    def __init__(self, graph: LineageGraph) -> None:
        self.graph = graph.model_copy(deep=True)
        self.nodes = {node.node_id: node for node in self.graph.nodes}
        if len(self.nodes) != len(self.graph.nodes):
            raise ValueError("Lineage graph contains duplicate node IDs.")
        self.outgoing: dict[str, set[str]] = {node_id: set() for node_id in self.nodes}
        self.incoming: dict[str, set[str]] = {node_id: set() for node_id in self.nodes}
        for edge in self.graph.edges:
            if edge.source_node_id not in self.nodes or edge.target_node_id not in self.nodes:
                raise ValueError("Lineage graph contains an edge with a missing endpoint.")
            self.outgoing[edge.source_node_id].add(edge.target_node_id)
            self.incoming[edge.target_node_id].add(edge.source_node_id)

    def get_upstream(self, node_id: str) -> list[LineageNode]:
        return self._traverse(node_id, self.incoming)

    def get_downstream(self, node_id: str) -> list[LineageNode]:
        return self._traverse(node_id, self.outgoing)

    def get_lineage_graph(self, anchor: str | None = None) -> LineageGraph:
        if anchor is None:
            return self.graph.model_copy(deep=True)
        self._require_node(anchor)
        related = {anchor}
        related.update(node.node_id for node in self.get_upstream(anchor))
        related.update(node.node_id for node in self.get_downstream(anchor))
        nodes = [node.model_copy(deep=True) for node in self.graph.nodes if node.node_id in related]
        edges = [
            edge.model_copy(deep=True)
            for edge in self.graph.edges
            if edge.source_node_id in related and edge.target_node_id in related
        ]
        return LineageGraph(
            nodes=nodes,
            edges=edges,
            line_of_business=self.graph.line_of_business,
            generated_at=datetime.now(UTC),
        )

    def get_paths(
        self,
        source: str,
        target: str,
        *,
        max_paths: int = 100,
        max_depth: int | None = None,
    ) -> list[list[str]]:
        self._require_node(source)
        self._require_node(target)
        if max_paths < 1 or max_paths > 1000:
            raise ValueError("max_paths must be between 1 and 1000.")
        depth_limit = max_depth if max_depth is not None else min(len(self.nodes), 500)
        if depth_limit < 1:
            raise ValueError("max_depth must be at least 1.")
        if source == target:
            return [[source]]
        paths: list[list[str]] = []
        stack: list[tuple[str, list[str]]] = [(source, [source])]
        expansions = 0
        while stack and len(paths) < max_paths:
            current, path = stack.pop()
            if len(path) - 1 >= depth_limit:
                continue
            for next_node in sorted(self.outgoing[current], reverse=True):
                expansions += 1
                if expansions > 100_000:
                    raise ValueError("Path search exceeded the configured traversal work limit.")
                if next_node in path:
                    continue
                extended = [*path, next_node]
                if next_node == target:
                    paths.append(extended)
                else:
                    stack.append((next_node, extended))
                if len(paths) >= max_paths:
                    break
        return paths

    def calculate_blast_radius(self, node_id: str) -> list[LineageNode]:
        return self.get_downstream(node_id)

    def _traverse(self, node_id: str, adjacency: dict[str, set[str]]) -> list[LineageNode]:
        self._require_node(node_id)
        visited = {node_id}
        pending = deque(sorted(adjacency[node_id]))
        while pending:
            current = pending.popleft()
            if current in visited:
                continue
            visited.add(current)
            pending.extend(sorted(adjacency[current] - visited))
        return [
            self.nodes[key].model_copy(deep=True)
            for key in sorted(visited - {node_id})
        ]

    def _require_node(self, node_id: str) -> None:
        if node_id not in self.nodes:
            raise KeyError(f"Unknown lineage node: {node_id}")
