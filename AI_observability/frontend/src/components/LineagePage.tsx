import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CircleAlert,
  Crosshair,
  GitBranch,
  Minus,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useIncidents, useLineage } from "../api/queries";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import type { HealthState, LineageEdge, LineageNode } from "../api/contracts";
import { getConnectedNodeIds, getIncidentNodeIds, getLineageHealthColor, getLineageNodeKind, layoutLineageGraph, lineageHealthColors, lineageNodeKinds } from "../lineage/graph";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";
import { StatusPill } from "./StatusPill";

const healthFilters: Array<HealthState | "all"> = ["all", "healthy", "degraded", "critical", "waiting", "unknown"];
const nodeTypes: LineageNode["node_type"][] = [
  "source", "ingestion", "schema", "quality_check", "pipeline", "job",
  "dataset", "transformation", "feature", "data_product", "ai_product", "report",
];

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function LineagePage() {
  const graphQuery = useLineage();
  const incidentQuery = useIncidents();
  const { lineOfBusiness, setLineOfBusiness } = useLineOfBusiness();
  const [searchParams, setSearchParams] = useSearchParams();
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerX: number; pointerY: number; viewBox: ViewBox } | null>(null);
  const lastLayoutRef = useRef<{ width: number; height: number } | null>(null);
  const [search, setSearch] = useState(searchParams.get("anchor") ?? "");
  const [anchorId, setAnchorId] = useState(searchParams.get("anchor") ?? "");
  const [selectedId, setSelectedId] = useState(searchParams.get("anchor") ?? "");
  const [healthFilter, setHealthFilter] = useState<HealthState | "all">("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [incidentId, setIncidentId] = useState("");
  const [pathMode, setPathMode] = useState<"both" | "upstream" | "downstream">("both");
  const [viewBox, setViewBox] = useState<ViewBox | null>(null);
  const [zoom, setZoom] = useState(1);
  const graph = graphQuery.data;

  const layout = useMemo(() => graph ? layoutLineageGraph(graph) : null, [graph]);
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((node) => [node.node_id, node])), [graph]);
  const edges = layout?.edges ?? [];
  const nodeIds = useMemo(() => new Set(graph?.nodes.map((node) => node.node_id) ?? []), [graph]);
  const connectedIds = anchorId && graph
    ? getConnectedNodeIds(anchorId, edges, pathMode)
    : new Set<string>();
  const incidentMap = useMemo(
    () => graph
      ? getIncidentNodeIds(graph, (incidentQuery.data ?? []).filter((incident) =>
        ["open", "acknowledged", "investigating"].includes(incident.status),
      ))
      : new Map<string, number>(),
    [graph, incidentQuery.data],
  );
  const selectedIncident = incidentQuery.data?.find((incident) =>
    incident.incident_id === incidentId && ["open", "acknowledged", "investigating"].includes(incident.status),
  );
  const incidentRootIds = useMemo(() => {
    if (!graph || !selectedIncident) return new Set<string>();
    const mapped = getIncidentNodeIds(graph, [selectedIncident]);
    return new Set(mapped.keys());
  }, [graph, selectedIncident]);
  const incidentPathIds = useMemo(() => {
    if (!graph || incidentRootIds.size === 0) return new Set<string>();
    const path = new Set<string>();
    for (const rootId of incidentRootIds) {
      for (const downstreamId of getConnectedNodeIds(rootId, edges, "downstream")) path.add(downstreamId);
    }
    return path;
  }, [graph, edges, incidentRootIds]);
  const filteredNodes = (graph?.nodes ?? []).filter((node) =>
    (healthFilter === "all" || node.health === healthFilter) &&
    (typeFilter === "all" || node.node_type === typeFilter) &&
    node.line_of_business === lineOfBusiness,
  );
  const filteredIds = new Set(filteredNodes.map((node) => node.node_id));
  const filteredEdges = edges.filter((edge) => filteredIds.has(edge.source_node_id) && filteredIds.has(edge.target_node_id));
  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined;

  useEffect(() => {
    if (!layout) return;
    const previous = lastLayoutRef.current;
    if (!previous || previous.width !== layout.width || previous.height !== layout.height) {
      setViewBox({ x: 0, y: 0, width: layout.width, height: layout.height });
      setZoom(1);
      lastLayoutRef.current = { width: layout.width, height: layout.height };
    }
  }, [layout]);

  useEffect(() => {
    const requestedAnchor = searchParams.get("anchor");
    const linkedNode = graph?.nodes.find((node) => node.node_id === requestedAnchor);
    if (!searchParams.has("line_of_business") && linkedNode && linkedNode.line_of_business !== lineOfBusiness) {
      setLineOfBusiness(linkedNode.line_of_business);
      return;
    }
    if (!graph || !searchParams.get("anchor")) return;
    const incomingAnchor = searchParams.get("anchor") ?? "";
    if (nodeIds.has(incomingAnchor)) {
      setAnchorId(incomingAnchor);
      setSelectedId(incomingAnchor);
      setSearch(incomingAnchor);
    }
  }, [graph, lineOfBusiness, searchParams, nodeIds, setLineOfBusiness]);

  const searchNode = () => {
    const value = search.trim();
    const match = graph?.nodes.find((node) =>
      node.node_id.toLowerCase() === value.toLowerCase() ||
      node.label.toLowerCase().includes(value.toLowerCase()),
    );
    if (!match) return;
    setAnchorId(match.node_id);
    setSelectedId(match.node_id);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("anchor", match.node_id);
    setSearchParams(nextParams, { replace: true });
  };

  const fitGraph = () => {
    if (!layout) return;
    setViewBox({ x: 0, y: 0, width: layout.width, height: layout.height });
    setZoom(1);
  };

  const changeZoom = useCallback((factor: number, clientX?: number, clientY?: number) => {
    if (!layout || !viewBox || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    const nextZoom = Math.max(0.35, Math.min(2.5, zoom * factor));
    const ratioX = clientX == null ? 0.5 : (clientX - bounds.left) / bounds.width;
    const ratioY = clientY == null ? 0.5 : (clientY - bounds.top) / bounds.height;
    const width = layout.width / nextZoom;
    const height = layout.height / nextZoom;
    const anchorX = viewBox.x + ratioX * viewBox.width;
    const anchorY = viewBox.y + ratioY * viewBox.height;
    setViewBox({ x: anchorX - ratioX * width, y: anchorY - ratioY * height, width, height });
    setZoom(nextZoom);
  }, [layout, viewBox, zoom]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      changeZoom(event.deltaY < 0 ? 1.12 : 0.89, event.clientX, event.clientY);
    };
    svg.addEventListener("wheel", handleWheel, { passive: false });
    return () => svg.removeEventListener("wheel", handleWheel);
  }, [changeZoom]);

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[data-lineage-node]")) return;
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, viewBox: viewBox ?? { x: 0, y: 0, width: 1, height: 1 } };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragRef.current || !stageRef.current) return;
    const bounds = stageRef.current.getBoundingClientRect();
    const deltaX = (event.clientX - dragRef.current.pointerX) * dragRef.current.viewBox.width / bounds.width;
    const deltaY = (event.clientY - dragRef.current.pointerY) * dragRef.current.viewBox.height / bounds.height;
    setViewBox({
      ...dragRef.current.viewBox,
      x: dragRef.current.viewBox.x - deltaX,
      y: dragRef.current.viewBox.y - deltaY,
    });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="page-stack lineage-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">HERO EXPERIENCE · DEPENDENCY INTELLIGENCE</p>
          <h1>Live Data Lineage</h1>
          <p className="intro-copy">Trace source signals through quality gates and transformations to the insurance products that depend on them.</p>
        </div>
        <div className="lineage-graph-meta">
          {graph && <span>{graph.nodes.length} nodes · {graph.edges.length} dependencies</span>}
          {graph?.generated_at && <time dateTime={graph.generated_at}>Graph updated {formatGraphTime(graph.generated_at)}</time>}
        </div>
      </div>

      {graphQuery.isLoading && <LoadingNotice label="Loading canonical lineage graph from FastAPI…" />}
      {graphQuery.isError && <ErrorNotice message="The lineage graph could not be loaded. Check the FastAPI connection and retry." />}
      {incidentQuery.isError && <div className="inline-warning"><CircleAlert size={15} />Incident markers are unavailable because incident data could not be loaded.</div>}
      {graphQuery.data && graphQuery.data.nodes.length === 0 && <EmptyNotice message="The backend returned an empty lineage graph." />}

      {graph && graph.nodes.length > 0 && layout && viewBox && (
        <>
          <section className="lineage-toolbar" aria-label="Lineage graph controls">
            <form className="lineage-search" onSubmit={(event) => { event.preventDefault(); searchNode(); }}>
              <Search size={15} aria-hidden="true" />
              <input
                aria-label="Search or anchor lineage node"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a node or enter a node ID"
              />
              <button type="submit">Anchor</button>
            </form>
            <div className="lineage-filters">
              <label><span>Status</span><select aria-label="Filter by health status" value={healthFilter} onChange={(event) => setHealthFilter(event.target.value as HealthState | "all")}>
                {healthFilters.map((value) => <option value={value} key={value}>{value === "all" ? "All health" : value}</option>)}
              </select></label>
              <label><span>Node type</span><select aria-label="Filter by node type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
                <option value="all">All types</option>
                {nodeTypes.map((value) => <option value={value} key={value}>{lineageNodeKinds[value].label}</option>)}
              </select></label>
              <span className="lineage-domain-context">Line of business · {formatDomain(lineOfBusiness)}</span>
              <label><span>Active incident</span><select aria-label="Highlight incident impact" value={incidentId} onChange={(event) => setIncidentId(event.target.value)}>
                <option value="">No incident selected</option>
                {(incidentQuery.data ?? []).filter((incident) => ["open", "acknowledged", "investigating"].includes(incident.status)).map((incident) => (
                  <option value={incident.incident_id} key={incident.incident_id}>{incident.title}</option>
                ))}
              </select></label>
            </div>
          </section>

          <section className="lineage-legend" aria-label="Health legend">
            <div className="health-legend">
              <span className="eyebrow">BACKEND HEALTH</span>
              {healthFilters.filter((value): value is HealthState => value !== "all").map((health) => (
                <span key={health}><i style={{ background: getLineageHealthColor(health) }} />{health}</span>
              ))}
            </div>
            <div className="lineage-path-legend">
              <span><i className="legend-incident" />Active incident</span>
              <span><i className="legend-path" />Selected path</span>
              <span>{filteredNodes.length} / {graph.nodes.length} nodes shown</span>
            </div>
          </section>

          <section className="lineage-workspace">
            <div className="lineage-canvas-wrap" ref={stageRef}>
              <div className="lineage-canvas-label"><GitBranch size={14} /> LEFT-TO-RIGHT DATA FLOW <span>Drag to pan · scroll to zoom</span></div>
              {filteredNodes.length === 0 ? (
                <EmptyNotice message="No graph nodes match the current filters." />
              ) : (
                <svg
                  ref={svgRef}
                  className="lineage-svg"
                  role="group"
                  aria-label="Interactive directed data lineage graph"
                  preserveAspectRatio="xMinYMin meet"
                  viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerUp}
                >
                  <defs>
                    <marker id="lineage-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L8,4 L0,8 z" fill="#4b6075" />
                    </marker>
                    <marker id="lineage-arrow-active" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="strokeWidth">
                      <path d="M0,0 L8,4 L0,8 z" fill="#64d8b4" />
                    </marker>
                  </defs>
                  <g className="lineage-edges">
                    {filteredEdges.map((edge) => {
                      const source = layout.positions.get(edge.source_node_id);
                      const target = layout.positions.get(edge.target_node_id);
                      if (!source || !target) return null;
                      const highlighted = connectedIds.has(edge.source_node_id) && connectedIds.has(edge.target_node_id) ||
                        incidentPathIds.has(edge.source_node_id) && incidentPathIds.has(edge.target_node_id);
                      const isDimmed = (anchorId || incidentId) && !highlighted &&
                        !(incidentRootIds.has(edge.source_node_id) && incidentRootIds.has(edge.target_node_id));
                      const startX = source.x + layout.nodeWidth;
                      const startY = source.y + layout.nodeHeight / 2;
                      const endX = target.x;
                      const endY = target.y + layout.nodeHeight / 2;
                      const curve = Math.max(36, (endX - startX) * 0.46);
                      return (
                        <path
                          key={`${edge.source_node_id}:${edge.target_node_id}:${edge.relationship}`}
                          d={`M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`}
                          className={`lineage-edge ${highlighted ? "lineage-edge-highlighted" : ""} ${isDimmed ? "lineage-edge-dimmed" : ""}`}
                          markerEnd={highlighted ? "url(#lineage-arrow-active)" : "url(#lineage-arrow)"}
                          data-edge-source={edge.source_node_id}
                          data-edge-target={edge.target_node_id}
                        />
                      );
                    })}
                  </g>
                  <g className="lineage-nodes">
                    {filteredNodes.map((node) => {
                      const position = layout.positions.get(node.node_id);
                      if (!position) return null;
                      const incidentCount = incidentMap.get(node.node_id) ?? 0;
                      const isSelected = selectedId === node.node_id;
                      const isConnected = connectedIds.has(node.node_id);
                      const isIncidentPath = incidentPathIds.has(node.node_id) || incidentRootIds.has(node.node_id);
                      const dimmed = Boolean(anchorId || incidentId) && !isConnected && !isIncidentPath && !isSelected;
                      const colors = lineageHealthColors[node.health] ?? lineageHealthColors.unknown;
                      return (
                        <g
                          key={node.node_id}
                          data-lineage-node={node.node_id}
                          className={`lineage-node ${isSelected ? "lineage-node-selected" : ""} ${isConnected ? "lineage-node-connected" : ""} ${isIncidentPath ? "lineage-node-impacted" : ""} ${dimmed ? "lineage-node-dimmed" : ""}`}
                          transform={`translate(${position.x} ${position.y})`}
                          tabIndex={0}
                          role="button"
                          aria-label={`${node.label}, ${getLineageNodeKind(node.node_type)}, ${node.health}${incidentCount ? `, ${incidentCount} active incident${incidentCount === 1 ? "" : "s"}` : ""}`}
                          onClick={() => { setSelectedId(node.node_id); setAnchorId(node.node_id); setPathMode("both"); }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              setSelectedId(node.node_id);
                              setAnchorId(node.node_id);
                              setPathMode("both");
                            }
                          }}
                        >
                          <rect width={layout.nodeWidth} height={layout.nodeHeight} rx="12" fill={colors.fill} stroke={colors.stroke} strokeWidth={isSelected ? 3 : 1.5} />
                          <rect x="10" y="11" width="36" height="18" rx="5" fill="rgba(4,12,20,.28)" />
                          <text x="28" y="23.5" className="lineage-node-kind" textAnchor="middle">{lineageNodeKinds[node.node_type]?.shortLabel ?? "NODE"}</text>
                          <text x="56" y="24" className="lineage-node-name">{truncate(node.label, 20)}</text>
                          <text x="13" y="51" className="lineage-node-id">{truncate(node.node_id, 25)}</text>
                          <circle cx={layout.nodeWidth - 13} cy="14" r="5" fill={colors.stroke} />
                          <text x="13" y="67" className="lineage-node-health">{node.health.toUpperCase()}</text>
                          {incidentCount > 0 && (
                            <g className="lineage-incident-marker">
                              <circle cx={layout.nodeWidth - 16} cy={layout.nodeHeight - 14} r="11" />
                              <text x={layout.nodeWidth - 16} y={layout.nodeHeight - 10}>{incidentCount}</text>
                              <title>{incidentCount} active incident{incidentCount === 1 ? "" : "s"}</title>
                            </g>
                          )}
                        </g>
                      );
                    })}
                  </g>
                </svg>
              )}
              <div className="lineage-zoom-controls" aria-label="Zoom controls">
                <button aria-label="Zoom in" onClick={() => changeZoom(1.2)}><Plus size={15} /></button>
                <span>{Math.round(zoom * 100)}%</span>
                <button aria-label="Zoom out" onClick={() => changeZoom(0.84)}><Minus size={15} /></button>
                <button aria-label="Fit graph" onClick={fitGraph}><Crosshair size={15} /><span>Fit</span></button>
              </div>
            </div>

            {selectedNode && (
              <NodeDetails
                node={selectedNode}
                edges={edges}
                nodeById={nodeById}
                incidentCount={incidentMap.get(selectedNode.node_id) ?? 0}
                onClose={() => setSelectedId("")}
                onDirection={(direction) => { setAnchorId(selectedNode.node_id); setPathMode(direction); }}
              />
            )}
          </section>
          <div className="lineage-footer">
            <span>Node health and dependency edges are from the backend lineage contract.</span>
            {selectedIncident && <span><CircleAlert size={13} /> Highlighting impact from: {selectedIncident.title}</span>}
            <Link to="/incidents">Open Incident Center <ArrowRight size={14} /></Link>
          </div>
        </>
      )}
    </div>
  );
}

function NodeDetails({
  node,
  edges,
  nodeById,
  incidentCount,
  onClose,
  onDirection,
}: {
  node: LineageNode;
  edges: LineageEdge[];
  nodeById: Map<string, LineageNode>;
  incidentCount: number;
  onClose: () => void;
  onDirection: (direction: "upstream" | "downstream") => void;
}) {
  const upstream = edges.filter((edge) => edge.target_node_id === node.node_id).map((edge) => nodeById.get(edge.source_node_id)).filter((value): value is LineageNode => Boolean(value));
  const downstream = edges.filter((edge) => edge.source_node_id === node.node_id).map((edge) => nodeById.get(edge.target_node_id)).filter((value): value is LineageNode => Boolean(value));
  return (
    <aside className="lineage-detail-drawer" aria-label={`${node.label} node details`}>
      <div className="lineage-detail-head">
        <div><p className="eyebrow">LINEAGE NODE</p><h2>{node.label}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close node details"><X size={16} /></button>
      </div>
      <StatusPill value={node.health} />
      <dl className="lineage-detail-fields">
        <div><dt>Node ID</dt><dd>{node.node_id}</dd></div>
        <div><dt>Type</dt><dd>{getLineageNodeKind(node.node_type)}</dd></div>
        <div><dt>Line of business</dt><dd>{formatDomain(node.line_of_business)}</dd></div>
        <div><dt>Active incidents</dt><dd>{incidentCount || "None reported"}</dd></div>
      </dl>
      <div className="lineage-neighbor-actions">
        <button onClick={() => onDirection("upstream")} disabled={upstream.length === 0}><ArrowLeft size={14} /> Highlight upstream</button>
        <button onClick={() => onDirection("downstream")} disabled={downstream.length === 0}><ArrowRight size={14} /> Highlight downstream</button>
      </div>
      <div className="lineage-neighbors">
        <h3><ArrowUp size={13} /> Upstream · {upstream.length}</h3>
        {upstream.length ? upstream.map((neighbor) => <button key={neighbor.node_id} onClick={() => onDirection("upstream")}>{neighbor.label}</button>) : <p>No upstream nodes in this graph.</p>}
        <h3><ArrowDown size={13} /> Downstream · {downstream.length}</h3>
        {downstream.length ? downstream.map((neighbor) => <button key={neighbor.node_id} onClick={() => onDirection("downstream")}>{neighbor.label}</button>) : <p>No downstream nodes in this graph.</p>}
      </div>
      {Object.keys(node.metadata).length > 0 && (
        <details className="lineage-metadata"><summary>Backend metadata</summary><pre>{JSON.stringify(node.metadata, null, 2)}</pre></details>
      )}
    </aside>
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function formatDomain(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatGraphTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "time unavailable"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}
