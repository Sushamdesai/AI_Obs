import { useEffect } from "react";
import { AlertTriangle, ArrowRight, Boxes, Clock3, Database, GitBranch, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiConfig } from "../api/config";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import { useDatasets, useIncidents, useLineage, useSlaStatuses } from "../api/queries";
import type { HealthState, Incident, LineageEdge, LineageNode, SLAStatus } from "../api/contracts";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";
import { StatusPill } from "./StatusPill";

const productTypes = new Set(["data_product", "ai_product", "report"]);
const inputTypes = new Set(["dataset", "feature"]);
const activeIncidentStates = new Set(["open", "acknowledged", "investigating"]);

export function SlaProductsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { lineOfBusiness, setLineOfBusiness } = useLineOfBusiness();
  const lineageQuery = useLineage();
  const datasetsQuery = useDatasets();
  const slasQuery = useSlaStatuses();
  const incidentsQuery = useIncidents();
  const graph = lineageQuery.data;
  const datasets = datasetsQuery.data ?? [];
  const slas = slasQuery.data ?? [];
  const incidents = incidentsQuery.data ?? [];
  const lineNodes = (graph?.nodes ?? []).filter((node) => node.line_of_business === lineOfBusiness);
  const nodeById = new Map(lineNodes.map((node) => [node.node_id, node]));
  const lineNodeIds = new Set(nodeById.keys());
  const edges = (graph?.edges ?? []).filter((edge) =>
    lineNodeIds.has(edge.source_node_id) && lineNodeIds.has(edge.target_node_id),
  );
  const products = lineNodes.filter((node) => productTypes.has(node.node_type));
  const selectedProductId = searchParams.get("product_id");
  useEffect(() => {
    const linkedProduct = graph?.nodes.find((node) => node.node_id === selectedProductId);
    if (
      !searchParams.has("line_of_business") &&
      linkedProduct &&
      linkedProduct.line_of_business !== lineOfBusiness
    ) {
      setLineOfBusiness(linkedProduct.line_of_business);
    }
  }, [graph, lineOfBusiness, searchParams, selectedProductId, setLineOfBusiness]);
  const selectedProduct = products.find((node) => node.node_id === selectedProductId) ?? products[0];
  const datasetById = new Map(datasets.map((dataset) => [dataset.dataset_id, dataset]));
  const slaByDataset = new Map<string, SLAStatus[]>();
  for (const sla of slas) {
    const entries = slaByDataset.get(sla.dataset_id) ?? [];
    entries.push(sla);
    slaByDataset.set(sla.dataset_id, entries);
  }

  const productInputs = selectedProduct ? getProductInputs(selectedProduct.node_id, nodeById, edges) : [];
  const affectedIncidents = incidents.filter((incident) =>
    activeIncidentStates.has(incident.status) &&
    incident.line_of_business === lineOfBusiness &&
    isIncidentImpactingProduct(incident, selectedProduct?.node_id, edges),
  );
  const loadError = lineageQuery.isError || datasetsQuery.isError || slasQuery.isError;
  const isLoading = lineageQuery.isLoading || datasetsQuery.isLoading || slasQuery.isLoading;

  const selectProduct = (product: LineageNode) => {
    setLineOfBusiness(lineOfBusiness);
    const next = new URLSearchParams(searchParams);
    next.set("line_of_business", lineOfBusiness);
    next.set("product_id", product.node_id);
    setSearchParams(next);
  };

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">SERVICE COMMITMENTS · DATA PRODUCTS</p>
          <h1>SLA &amp; Data Products</h1>
          <p className="intro-copy">Understand which synthetic {formatLabel(lineOfBusiness)} Insurance products are ready, what they depend on, and whether their dataset freshness targets are being met.</p>
        </div>
        <div className="updated-meta"><span className="live-dot live-dot-on" />Refreshing every {Math.round(apiConfig.refreshIntervalMs / 1000)} seconds</div>
      </div>

      <section className="sla-product-toolbar panel">
        <div>
          <span className="eyebrow">LINE OF BUSINESS</span>
          <strong>{formatLabel(lineOfBusiness)}</strong>
          <small>Shared across screens · product health and dependencies come from backend lineage.</small>
        </div>
      </section>

      {isLoading && <LoadingNotice label="Loading backend products, lineage, and freshness SLAs…" />}
      {loadError && <ErrorNotice message="Some product, dataset, or SLA data could not be loaded. Available API-backed records are shown where possible." />}
      {incidentsQuery.isError && <div className="inline-warning"><AlertTriangle size={15} /><span>Active incident links are unavailable because the incident API did not respond.</span></div>}

      {!isLoading && !loadError && products.length === 0 && (
        <EmptyNotice message={`No data products are registered in the backend lineage graph for ${formatLabel(lineOfBusiness)}.`} />
      )}

      {products.length > 0 && (
        <>
          <section className="sla-product-layout" aria-label="Data product health and dependencies">
            <div className="sla-product-list">
              <div className="sla-section-heading">
                <div><p className="eyebrow">PUBLISHED PRODUCTS</p><h2>{products.length} lineage-backed products</h2></div>
                <Boxes size={17} />
              </div>
              {products.map((product) => {
                const inputs = getProductInputs(product.node_id, nodeById, edges);
                const incidentsForProduct = incidents.filter((incident) =>
                  activeIncidentStates.has(incident.status) &&
                  incident.line_of_business === lineOfBusiness &&
                  isIncidentImpactingProduct(incident, product.node_id, edges),
                );
                return (
                  <button
                    type="button"
                    key={product.node_id}
                    className={`sla-product-card${selectedProduct?.node_id === product.node_id ? " sla-product-card-selected" : ""}`}
                    onClick={() => selectProduct(product)}
                    aria-pressed={selectedProduct?.node_id === product.node_id}
                  >
                    <span className="sla-product-icon">{product.node_type === "ai_product" ? <ShieldCheck size={17} /> : <Boxes size={17} />}</span>
                    <span className="sla-product-card-content">
                      <strong>{product.label}</strong>
                      <small>{inputs.length} upstream dataset/feature dependencies · {incidentsForProduct.length} linked active incidents</small>
                    </span>
                    <StatusPill value={product.health} />
                  </button>
                );
              })}
            </div>

            {selectedProduct && (
              <article className="panel sla-product-detail" aria-label={`${selectedProduct.label} product details`}>
                <div className="sla-section-heading">
                  <div>
                    <p className="eyebrow">{selectedProduct.node_type.replaceAll("_", " ").toUpperCase()}</p>
                    <h2>{selectedProduct.label}</h2>
                  </div>
                  <StatusPill value={selectedProduct.health} />
                </div>
                <p className="sla-product-explanation">{explainProductHealth(selectedProduct.health, productInputs, nodeById, slaByDataset)}</p>
                <div className="sla-product-meta">
                  <span><GitBranch size={14} />Backend lineage readiness</span>
                  <span>Product-level deadline: not supplied by the API</span>
                </div>

                <div className="sla-dependency-heading">
                  <div><h3>Required datasets &amp; features</h3><small>Direct product inputs and transitive upstream dependencies</small></div>
                  <span>{productInputs.length} inputs</span>
                </div>
                {productInputs.length ? (
                  <div className="sla-dependency-list">
                    {productInputs.map((input) => {
                      const dataset = datasetById.get(input.node_id);
                      const inputSlas = slaByDataset.get(input.node_id) ?? [];
                      const isDirectInput = edges.some((edge) =>
                        edge.source_node_id === input.node_id && edge.target_node_id === selectedProduct.node_id,
                      );
                      return (
                        <div className="sla-dependency-row" key={input.node_id}>
                          <span className="sla-dependency-icon"><Database size={14} /></span>
                          <div className="sla-dependency-copy">
                            <strong>{dataset?.name ?? input.label}</strong>
                            <small>{input.node_id} · {dataset?.layer ? formatLabel(dataset.layer) : formatLabel(input.node_type)} · {isDirectInput ? "Direct input" : "Upstream dependency"}</small>
                            <span>{formatFreshnessSummary(inputSlas)}</span>
                          </div>
                          <StatusPill value={input.health} />
                          <Link
                            className="sla-dependency-link"
                            to={`/datasets?dataset_id=${encodeURIComponent(input.node_id)}`}
                            aria-label={`Open ${input.label} in Dataset Explorer`}
                          ><ArrowRight size={14} /></Link>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyNotice message="The lineage graph does not report dataset or feature inputs for this product." />
                )}

                <div className="sla-product-footer">
                  <Link to={`/lineage?anchor=${encodeURIComponent(selectedProduct.node_id)}`}><GitBranch size={14} />View product lineage</Link>
                  {datasetById.has(selectedProduct.node_id) && (
                    <Link to={`/datasets?dataset_id=${encodeURIComponent(selectedProduct.node_id)}`}><Database size={14} />Explore product dataset</Link>
                  )}
                </div>

                <section className="sla-linked-incidents" aria-label="Linked active incidents">
                  <div className="sla-dependency-heading">
                    <div><h3>Linked active incidents</h3><small>Incident evidence and lineage paths intersect this product</small></div>
                    <span>{affectedIncidents.length}</span>
                  </div>
                  {affectedIncidents.length ? affectedIncidents.map((incident) => (
                    <Link className="sla-linked-incident" key={incident.incident_id} to={`/incidents?incident_id=${encodeURIComponent(incident.incident_id)}`}>
                      <span><AlertTriangle size={14} /><strong>{incident.title}</strong></span>
                      <small>{incident.incident_id} · {incident.severity} · {incident.status}</small>
                      <ArrowRight size={14} />
                    </Link>
                  )) : <p className="sla-no-incidents">No active incident is linked to this product by current backend evidence and lineage.</p>}
                </section>
              </article>
            )}
          </section>

          <section className="panel sla-freshness-panel">
            <div className="sla-section-heading">
              <div><p className="eyebrow">DATASET FRESHNESS CONTRACTS</p><h2>Freshness SLA records</h2></div>
              <Clock3 size={17} />
            </div>
            <p className="sla-panel-copy">The current API reports dataset freshness targets and observed ages, not product completion predictions or explicit calendar deadlines.</p>
            {slasQuery.data && slasQuery.data.length > 0 ? (
              <div className="sla-record-grid">
                {slasQuery.data
                  .filter((sla) => datasets.some((dataset) => dataset.dataset_id === sla.dataset_id && dataset.line_of_business === lineOfBusiness))
                  .map((sla) => (
                    <FreshnessRecord
                      key={sla.sla_id}
                      sla={sla}
                      datasetName={datasetById.get(sla.dataset_id)?.name ?? sla.dataset_id}
                    />
                  ))}
                {slasQuery.data.filter((sla) =>
                  datasets.some((dataset) => dataset.dataset_id === sla.dataset_id && dataset.line_of_business === lineOfBusiness),
                ).length === 0 && <EmptyNotice message={`No freshness SLA records are available for ${formatLabel(lineOfBusiness)} datasets.`} />}
              </div>
            ) : (
              <EmptyNotice message="No dataset freshness SLA records are available from the backend." />
            )}
          </section>
        </>
      )}
    </div>
  );
}

function FreshnessRecord({ sla, datasetName }: { sla: SLAStatus; datasetName: string }) {
  const overTarget = sla.current_freshness_seconds != null
    ? Math.max(0, sla.current_freshness_seconds - sla.target_freshness_seconds)
    : null;
  const targetRemaining = sla.current_freshness_seconds != null
    ? Math.max(0, sla.target_freshness_seconds - sla.current_freshness_seconds)
    : null;
  const isAtRisk = sla.state !== "healthy" || (overTarget !== null && overTarget > 0);
  return (
    <article className={`sla-record${isAtRisk ? " sla-record-at-risk" : ""}`}>
      <div className="sla-record-heading"><strong>{datasetName}</strong><StatusPill value={sla.state} /></div>
      <div className="sla-record-values">
        <span><small>Target</small><strong>{formatDuration(sla.target_freshness_seconds)}</strong></span>
        <span><small>Observed age</small><strong>{sla.current_freshness_seconds == null ? "Not reported" : formatDuration(sla.current_freshness_seconds)}</strong></span>
      </div>
      <p>{overTarget === null
        ? "Remaining freshness budget: unavailable from the API."
        : overTarget > 0
          ? `Observed age exceeds target by ${formatDuration(overTarget)}.`
          : `Within target by ${formatDuration(targetRemaining ?? 0)}.`}</p>
      <Link to={`/datasets?dataset_id=${encodeURIComponent(sla.dataset_id)}`}>Open dataset<ArrowRight size={12} /></Link>
    </article>
  );
}

function getProductInputs(
  productId: string,
  nodes: Map<string, LineageNode>,
  edges: LineageEdge[],
): LineageNode[] {
  const visited = new Set<string>([productId]);
  const pending = [productId];
  const inputs = new Map<string, LineageNode>();
  while (pending.length) {
    const targetId = pending.pop();
    if (!targetId) continue;
    for (const edge of edges) {
      if (edge.target_node_id !== targetId || visited.has(edge.source_node_id)) continue;
      visited.add(edge.source_node_id);
      pending.push(edge.source_node_id);
      const source = nodes.get(edge.source_node_id);
      if (source && inputTypes.has(source.node_type)) inputs.set(source.node_id, source);
    }
  }
  return [...inputs.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function isIncidentImpactingProduct(
  incident: Incident,
  productId: string | undefined,
  edges: LineageEdge[],
): boolean {
  if (!productId) return false;
  const anchors = new Set([
    ...incident.correlated_node_ids,
    ...incident.evidence.flatMap((event) => event.dataset_id ? [event.dataset_id] : []),
  ]);
  const reached = new Set(anchors);
  const pending = [...anchors];
  while (pending.length) {
    const sourceId = pending.pop();
    if (!sourceId) continue;
    if (sourceId === productId) return true;
    for (const edge of edges) {
      if (edge.source_node_id === sourceId && !reached.has(edge.target_node_id)) {
        reached.add(edge.target_node_id);
        pending.push(edge.target_node_id);
      }
    }
  }
  return reached.has(productId);
}

function explainProductHealth(
  health: HealthState,
  inputs: LineageNode[],
  nodes: Map<string, LineageNode>,
  slaByDataset: Map<string, SLAStatus[]>,
): string {
  if (health === "unknown" || health === "waiting") {
    return `The backend reports this product as ${health}. Product readiness is not inferred from dependency conditions.`;
  }
  if (health === "healthy") {
    const nonHealthy = inputs.filter((input) => input.health !== "healthy");
    if (nonHealthy.length) {
      return `The backend reports this product as healthy. ${nonHealthy.length} upstream input(s) are not healthy, so product status is shown as reported and should be interpreted with those dependency states.`;
    }
    return "The backend reports this product as healthy. All lineage-reported dataset and feature inputs are currently healthy.";
  }
  const affected = inputs.filter((input) =>
    input.health === "degraded" || input.health === "critical" ||
    (slaByDataset.get(input.node_id) ?? []).some((sla) => sla.state !== "healthy"),
  );
  const names = affected.map((input) => nodes.get(input.node_id)?.label ?? input.label);
  return names.length
    ? `The backend reports this product as ${health}; ${names.join(", ")} has a degraded/critical health or freshness SLA record.`
    : `The backend reports this product as ${health}. Current lineage and freshness records do not identify a specific unhealthy input.`;
}

function formatFreshnessSummary(slas: SLAStatus[]): string {
  if (slas.length === 0) return "Freshness SLA: not reported";
  return slas.map((sla) => {
    const age = sla.current_freshness_seconds == null
      ? "age unavailable"
      : `${formatDuration(sla.current_freshness_seconds)} age / ${formatDuration(sla.target_freshness_seconds)} target`;
    return `${formatLabel(sla.state)} · ${age}`;
  }).join(" · ");
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Not reported";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(seconds % 3600 === 0 ? 0 : 1)}h`;
  return `${(seconds / 86400).toFixed(seconds % 86400 === 0 ? 0 : 1)}d`;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
