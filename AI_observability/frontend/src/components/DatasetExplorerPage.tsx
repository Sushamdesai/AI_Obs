import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Boxes, CircleAlert, Database, GitBranch, Search, ShieldCheck } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { apiConfig } from "../api/config";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import { useDatasetDetail, useDatasetPreview, useDatasets, useIncidents } from "../api/queries";
import type { Dataset, LineageNode } from "../api/contracts";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";
import { StatusPill } from "./StatusPill";

const previewLimit = 10;
const sensitiveKeyParts = ["name", "email", "phone", "address", "token", "secret", "ssn"];
export function DatasetExplorerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { lineOfBusiness, setLineOfBusiness } = useLineOfBusiness();
  const datasetsQuery = useDatasets();
  const incidentsQuery = useIncidents();
  const [search, setSearch] = useState("");
  const [layerFilter, setLayerFilter] = useState("all");
  const selectedId = searchParams.get("dataset_id") ?? "";
  const detailQuery = useDatasetDetail(selectedId);
  const previewQuery = useDatasetPreview(selectedId, previewLimit);
  const datasets = datasetsQuery.data ?? [];
  const lineDatasets = datasets.filter((dataset) => dataset.line_of_business === lineOfBusiness);
  const visibleDatasets = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return lineDatasets.filter((dataset) =>
      (layerFilter === "all" || dataset.layer === layerFilter) &&
      (!normalizedSearch ||
        dataset.dataset_id.toLowerCase().includes(normalizedSearch) ||
        dataset.name.toLowerCase().includes(normalizedSearch) ||
        dataset.description.toLowerCase().includes(normalizedSearch)),
    );
  }, [layerFilter, lineDatasets, search]);

  useEffect(() => {
    if (!searchParams.has("line_of_business")) {
      const linkedDataset = datasets.find((dataset) => dataset.dataset_id === selectedId);
      if (linkedDataset && linkedDataset.line_of_business !== lineOfBusiness) {
        setLineOfBusiness(linkedDataset.line_of_business);
        return;
      }
    }
    if (lineDatasets.length === 0 || lineDatasets.some((dataset) => dataset.dataset_id === selectedId)) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("dataset_id", lineDatasets[0].dataset_id);
    setSearchParams(nextParams, { replace: true });
  }, [datasets, lineDatasets, lineOfBusiness, searchParams, selectedId, setLineOfBusiness, setSearchParams]);

  const activeIncidents = (incidentsQuery.data ?? []).filter((incident) =>
    ["open", "acknowledged", "investigating"].includes(incident.status) &&
    incident.line_of_business === lineOfBusiness &&
    (incident.correlated_node_ids.includes(selectedId) ||
      incident.evidence.some((event) => event.dataset_id === selectedId)),
  );
  const detail = detailQuery.data;
  const schema = detail?.schema_versions
    .slice()
    .sort((left, right) => right.observed_at.localeCompare(left.observed_at))[0];
  const filteredPreviewRecords = (previewQuery.data?.records ?? []).map((record) =>
    Object.fromEntries(Object.entries(record).filter(([key]) =>
      !sensitiveKeyParts.some((part) => key.toLowerCase().includes(part)),
    )),
  );
  const failedCoreQueries = [datasetsQuery, detailQuery].filter((query) => query.isError).length;

  const selectDataset = (dataset: Dataset) => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("dataset_id", dataset.dataset_id);
    setSearchParams(nextParams);
  };

  return (
    <div className="page-stack">
      <div className="page-intro">
        <div>
          <p className="eyebrow">DATA ESTATE · {formatLabel(lineOfBusiness).toUpperCase()} INSURANCE</p>
          <h1>Dataset Explorer</h1>
          <p className="intro-copy">Trace each synthetic dataset from its observed health signals through lineage, consumers, and a bounded safe preview.</p>
        </div>
        <div className="updated-meta"><span className="live-dot live-dot-on" />Refreshing every {Math.round(apiConfig.refreshIntervalMs / 1000)} seconds</div>
      </div>

      {datasetsQuery.isLoading && <LoadingNotice label="Loading the backend dataset catalog…" />}
      {datasetsQuery.isError && <ErrorNotice message="The dataset catalog could not be loaded. Check the FastAPI connection and retry." />}
      {failedCoreQueries > 1 && <div className="inline-warning"><CircleAlert size={15} /><span>Dataset detail is temporarily unavailable; catalog search remains usable.</span></div>}
      {datasetsQuery.isSuccess && datasets.length === 0 && <EmptyNotice message="The backend has not registered any datasets yet." />}

      {datasets.length > 0 && (
        <section className="dataset-explorer-layout" aria-label="Dataset catalog and selected dataset details">
          <aside className="panel dataset-catalog">
            <div className="dataset-catalog-heading">
              <div>
                <p className="eyebrow">CATALOG</p>
                <h2>{lineDatasets.length} datasets</h2>
              </div>
              <Boxes size={18} aria-hidden="true" />
            </div>
            <label className="dataset-search">
              <Search size={14} aria-hidden="true" />
              <span className="sr-only">Search datasets</span>
              <input aria-label="Search datasets" placeholder="Search name or ID" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <div className="dataset-filter-grid">
              <label>
                <span>Layer</span>
                <select aria-label="Filter by layer" value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)}>
                  <option value="all">All layers</option>
                  <option value="bronze">Bronze</option>
                  <option value="silver">Silver</option>
                  <option value="gold">Gold</option>
                  <option value="feature">Feature</option>
                </select>
              </label>
              <div className="dataset-domain-context"><span>Line of business</span><strong>{formatLabel(lineOfBusiness)}</strong></div>
            </div>
            <div className="dataset-list" aria-label="Datasets">
              {visibleDatasets.map((dataset) => (
                <button
                  className={`dataset-list-item${selectedId === dataset.dataset_id ? " dataset-list-item-selected" : ""}`}
                  key={dataset.dataset_id}
                  onClick={() => selectDataset(dataset)}
                  aria-pressed={selectedId === dataset.dataset_id}
                >
                  <span className="dataset-list-icon"><Database size={15} aria-hidden="true" /></span>
                  <span className="dataset-list-copy">
                    <strong>{dataset.name}</strong>
                    <small>{dataset.dataset_id} · {formatLabel(dataset.layer)}</small>
                  </span>
                  {selectedId === dataset.dataset_id && detail?.health && <StatusPill value={detail.health.state} />}
                </button>
              ))}
              {visibleDatasets.length === 0 && <EmptyNotice message="No datasets match these search and filter values." />}
            </div>
          </aside>

          <main className="dataset-detail-column" aria-label="Selected dataset details">
            {!selectedId && <EmptyNotice message="Select a dataset to inspect its backend details." />}
            {selectedId && !datasetsQuery.isLoading && lineDatasets.length === 0 && <EmptyNotice message={`No datasets are registered for ${formatLabel(lineOfBusiness)}.`} />}
            {selectedId && lineDatasets.length > 0 && !lineDatasets.some((dataset) => dataset.dataset_id === selectedId) && <LoadingNotice label={`Selecting a ${formatLabel(lineOfBusiness)} dataset…`} />}
            {selectedId && detailQuery.isLoading && <LoadingNotice label="Loading dataset health, lineage, and schema…" />}
            {selectedId && detailQuery.isError && <ErrorNotice message={`Dataset details are unavailable for ${selectedId}. The dataset may have been removed or the API may be offline.`} />}
            {selectedId && detail && detail.dataset.line_of_business === lineOfBusiness && (
              <>
                <section className="panel dataset-overview">
                  <div className="dataset-overview-heading">
                    <div className="dataset-title-group">
                      <span className="dataset-large-icon"><Database size={20} /></span>
                      <div>
                        <p className="eyebrow">{formatLabel(detail.dataset.layer)} DATASET · {formatLabel(detail.dataset.line_of_business)}</p>
                        <h2>{detail.dataset.name}</h2>
                        <code>{detail.dataset.dataset_id}</code>
                      </div>
                    </div>
                    <StatusPill value={detail.health?.state ?? "unknown"} />
                  </div>
                  {detail.dataset.description && <p className="dataset-description">{detail.dataset.description}</p>}
                  <div className="dataset-stats-grid">
                    <DetailStat label="Rows in latest batch" value={formatCount(detail.row_count)} icon={<Database size={15} />} />
                    <DetailStat label="Quality score" value={detail.quality ? formatPercent(detail.quality.score) : "Not reported"} icon={<ShieldCheck size={15} />} />
                    <DetailStat label="Freshness age" value={detail.health?.freshness_seconds == null ? "Not reported" : formatDuration(detail.health.freshness_seconds)} icon={<CircleAlert size={15} />} />
                    <DetailStat label="Schema version" value={schema?.version ?? detail.dataset.schema_version ?? "Not reported"} icon={<Boxes size={15} />} />
                  </div>
                </section>

                <section className="dataset-connection-row" aria-label="Provider status">
                  <div className="panel dataset-connection-card">
                    <div className="dataset-section-title"><span className="dataset-section-icon"><Database size={15} /></span><h3>Provider identity</h3></div>
                    <strong>Not reported by this API</strong>
                    <p>The dataset contract is provider-neutral; Local vs Databricks identity is not exposed.</p>
                  </div>
                  <div className="panel dataset-connection-card">
                    <div className="dataset-section-title"><span className="dataset-section-icon"><ShieldCheck size={15} /></span><h3>Provider connectivity</h3></div>
                    <StatusPill value={detail.platform === "ready" ? "ready" : detail.platform === "not_configured" ? "not_configured" : "unknown"} />
                    <p>{detail.platform === "ready" ? "Backend reports the data platform is ready." : detail.platform === "not_configured" ? "Backend reports no data platform is configured." : `Backend status: ${detail.platform || "not reported"}.`}</p>
                  </div>
                  <div className="panel dataset-connection-card">
                    <div className="dataset-section-title"><span className="dataset-section-icon"><Boxes size={15} /></span><h3>Last pipeline run</h3></div>
                    {detail.last_run ? (
                      <>
                        <strong>{detail.last_run.run_id}</strong>
                        <p>{formatLabel(detail.last_run.status)} · {detail.last_run.completed_at ? formatDate(detail.last_run.completed_at) : `Started ${formatDate(detail.last_run.started_at)}`}</p>
                        <small>{formatCount(detail.last_run.records_in)} in · {formatCount(detail.last_run.records_out)} out · {formatCount(detail.last_run.records_failed)} rejected</small>
                      </>
                    ) : <p>No pipeline run has been reported for this dataset.</p>}
                  </div>
                </section>

                <section className="dataset-two-column">
                  <article className="panel dataset-info-panel">
                    <div className="dataset-panel-heading"><div><p className="eyebrow">DEPENDENCY GRAPH</p><h3>Lineage & consumers</h3></div><GitBranch size={17} /></div>
                    <NodeList label="Upstream" icon={<ArrowUpRight size={14} />} nodes={detail.upstream} empty="No upstream nodes reported." />
                    <NodeList label="Downstream" icon={<ArrowDownRight size={14} />} nodes={detail.downstream} empty="No downstream nodes reported." />
                    <NodeList label="Data product consumers" icon={<Boxes size={14} />} nodes={detail.consumers} empty="No data product consumers reported." />
                    <Link className="dataset-action-link" to={`/lineage?anchor=${encodeURIComponent(detail.dataset.dataset_id)}`}>Open in lineage <GitBranch size={14} /></Link>
                  </article>

                  <article className="panel dataset-info-panel">
                    <div className="dataset-panel-heading"><div><p className="eyebrow">ACTIVE INVESTIGATIONS</p><h3>Incidents</h3></div><CircleAlert size={17} /></div>
                    {incidentsQuery.isError && <p className="dataset-muted">Incident records could not be refreshed.</p>}
                    {activeIncidents.length === 0 && !incidentsQuery.isError && <p className="dataset-muted">No active incidents are linked to this dataset.</p>}
                    {activeIncidents.map((incident) => (
                      <Link key={incident.incident_id} className="dataset-incident" to={`/incidents?incident_id=${encodeURIComponent(incident.incident_id)}`}>
                        <StatusPill value={incident.severity} />
                        <span><strong>{incident.title}</strong><small>{formatLabel(incident.status)} · {formatDate(incident.started_at)}</small></span>
                      </Link>
                    ))}
                    <Link className="dataset-action-link" to={`/quality?dataset_id=${encodeURIComponent(detail.dataset.dataset_id)}`}>Inspect quality signals <ShieldCheck size={14} /></Link>
                    <Link className="dataset-action-link" to={`/incidents?dataset_id=${encodeURIComponent(detail.dataset.dataset_id)}`}>Open Incident Center <CircleAlert size={14} /></Link>
                  </article>
                </section>

                <section className="dataset-two-column">
                  <article className="panel dataset-info-panel">
                    <div className="dataset-panel-heading"><div><p className="eyebrow">CONTRACT HISTORY</p><h3>Schema & quality</h3></div><ShieldCheck size={17} /></div>
                    <div className="dataset-schema-meta">
                      <span>Last health observation</span>
                      <strong>{detail.health?.observed_at ? formatDate(detail.health.observed_at) : detail.quality?.evaluated_at ? formatDate(detail.quality.evaluated_at) : "Not reported"}</strong>
                    </div>
                    {detail.quality && <p className="dataset-quality-message">{detail.quality.message || (detail.quality.passed ? "Quality checks passed." : "Quality checks failed.")}</p>}
                    {!schema && <p className="dataset-muted">No schema history is available.</p>}
                    {schema && (
                      <div className="dataset-schema-table-wrap">
                        <table className="dataset-schema-table">
                          <caption>Schema {schema.version} · {formatDate(schema.observed_at)}</caption>
                          <thead><tr><th scope="col">Field</th><th scope="col">Type</th></tr></thead>
                          <tbody>{Object.entries(schema.fields).map(([field, type]) => <tr key={field}><td>{field}</td><td>{type}</td></tr>)}</tbody>
                        </table>
                      </div>
                    )}
                  </article>

                  <article className="panel dataset-info-panel dataset-preview-panel">
                    <div className="dataset-panel-heading"><div><p className="eyebrow">BOUNDED API PREVIEW</p><h3>Synthetic records</h3></div><Database size={17} /></div>
                    {previewQuery.isLoading && <LoadingNotice label={`Requesting up to ${previewLimit} safe preview records…`} />}
                    {previewQuery.isError && <ErrorNotice message="The backend did not provide a safe preview for this dataset." />}
                    {previewQuery.data && (
                      <>
                        <p className="dataset-muted">{previewQuery.data.returned_count} of {formatCount(previewQuery.data.row_count)} rows returned{previewQuery.data.truncated ? " · truncated" : ""}</p>
                        {filteredPreviewRecords.length > 0 ? (
                          <div className="dataset-preview-scroll">
                            {filteredPreviewRecords.map((record, index) => (
                              <pre key={String(record.record_id ?? index)}>{JSON.stringify(record, null, 2)}</pre>
                            ))}
                          </div>
                        ) : <EmptyNotice message="The API returned no preview records for this dataset." />}
                        <p className="dataset-preview-note">Preview is limited to {previewLimit} records and displays only backend-returned fields.</p>
                      </>
                    )}
                  </article>
                </section>
              </>
            )}
          </main>
        </section>
      )}
    </div>
  );
}

function DetailStat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="dataset-stat">
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function NodeList({ label, icon, nodes, empty }: { label: string; icon: ReactNode; nodes: LineageNode[]; empty: string }) {
  return (
    <div className="dataset-node-group">
      <h4>{icon}{label}<span>{nodes.length}</span></h4>
      {nodes.length > 0 ? (
        <ul>{nodes.map((node) => (
          <li key={node.node_id}>
            <Link to={`/lineage?anchor=${encodeURIComponent(node.node_id)}`}>{node.label}</Link>
            <StatusPill value={node.health ?? "unknown"} />
          </li>
        ))}</ul>
      ) : <p className="dataset-muted">{empty}</p>}
    </div>
  );
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Not reported";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}
