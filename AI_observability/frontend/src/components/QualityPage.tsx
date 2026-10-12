import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  GitBranch,
  Search,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import { Link } from "react-router-dom";
import { apiConfig } from "../api/config";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import {
  useDatasets,
  useEvents,
  useIncidents,
  useLineage,
  useQuality,
  useSlaStatuses,
} from "../api/queries";
import type { Dataset, ObservabilityEvent, QualityResult } from "../api/contracts";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";
import { MetricCard } from "./MetricCard";
import { StatusPill } from "./StatusPill";

export function QualityPage() {
  const { lineOfBusiness } = useLineOfBusiness();
  const qualityQuery = useQuality();
  const eventsQuery = useEvents();
  const datasetsQuery = useDatasets();
  const slasQuery = useSlaStatuses();
  const incidentsQuery = useIncidents();
  const lineageQuery = useLineage();
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState("all");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");

  const lineDatasets = useMemo(
    () => (datasetsQuery.data ?? []).filter((dataset) => dataset.line_of_business === lineOfBusiness),
    [datasetsQuery.data, lineOfBusiness],
  );
  const datasetIds = useMemo(() => new Set(lineDatasets.map((dataset) => dataset.dataset_id)), [lineDatasets]);
  const datasetsById = useMemo(
    () => new Map(lineDatasets.map((dataset) => [dataset.dataset_id, dataset])),
    [lineDatasets],
  );
  const qualityResults = (qualityQuery.data ?? []).filter((result) => datasetIds.has(result.dataset_id));
  const events = (eventsQuery.data ?? []).filter((event) => event.line_of_business === lineOfBusiness);
  const slas = (slasQuery.data ?? []).filter((sla) => datasetIds.has(sla.dataset_id));
  const lineIncidents = (incidentsQuery.data ?? []).filter((incident) => incident.line_of_business === lineOfBusiness);
  const lineNodeIds = new Set((lineageQuery.data?.nodes ?? [])
    .filter((node) => node.line_of_business === lineOfBusiness)
    .map((node) => node.node_id));
  const failedChecks = qualityResults.filter((result) => !result.passed);
  const detectedEvents = events.filter((event) => event.status === "detected");
  const atRiskSlas = slas.filter((sla) =>
    sla.state !== "healthy" ||
    (sla.current_freshness_seconds != null && sla.current_freshness_seconds > sla.target_freshness_seconds),
  );
  const normalizedSearch = search.trim().toLowerCase();
  const visibleQuality = qualityResults
    .filter((result) => resultFilter === "all" || (resultFilter === "failed" ? !result.passed : result.passed))
    .filter((result) => {
      const dataset = datasetsById.get(result.dataset_id);
      return !normalizedSearch ||
        result.dataset_id.toLowerCase().includes(normalizedSearch) ||
        (dataset?.name ?? "").toLowerCase().includes(normalizedSearch) ||
        result.message.toLowerCase().includes(normalizedSearch);
    })
    .slice()
    .sort((left, right) => right.evaluated_at.localeCompare(left.evaluated_at));
  const eventTypes = [...new Set(events.map((event) => event.event_type))].sort();
  const visibleEvents = events
    .filter((event) => eventTypeFilter === "all" || event.event_type === eventTypeFilter)
    .filter((event) => !normalizedSearch ||
      event.event_type.toLowerCase().includes(normalizedSearch) ||
      event.message.toLowerCase().includes(normalizedSearch) ||
      (event.dataset_id ?? "").toLowerCase().includes(normalizedSearch) ||
      (event.source_id ?? "").toLowerCase().includes(normalizedSearch))
    .slice()
    .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at));
  const loading = [qualityQuery, eventsQuery, datasetsQuery, slasQuery, incidentsQuery, lineageQuery]
    .some((query) => query.isLoading);
  const apiErrors = [
    qualityQuery.isError && "quality checks",
    eventsQuery.isError && "observability events",
    datasetsQuery.isError && "datasets",
    slasQuery.isError && "freshness records",
    incidentsQuery.isError && "incidents",
    lineageQuery.isError && "lineage",
  ].filter(Boolean);
  const passRate = qualityResults.length
    ? Math.round(qualityResults.filter((result) => result.passed).length / qualityResults.length * 100)
    : null;

  return (
    <div className="page-stack quality-page">
      <div className="page-intro">
        <div>
          <p className="eyebrow">DETERMINISTIC DATA OBSERVABILITY</p>
          <h1>Data Quality &amp; Observability</h1>
          <p className="intro-copy">Review backend quality checks, freshness commitments, and detector events. Scores and states are never calculated from browser-side business data.</p>
        </div>
        <div className="updated-meta"><span className="live-dot live-dot-on" />Refreshes every {Math.round(apiConfig.refreshIntervalMs / 1000)} seconds</div>
      </div>

      {loading && <LoadingNotice label="Loading quality checks and observability evidence from FastAPI…" />}
      {apiErrors.length > 0 && (
        <ErrorNotice message={`Some observability resources could not be loaded: ${apiErrors.join(", ")}. Their values are omitted rather than inferred.`} />
      )}

      <section className="metric-grid quality-metric-grid" aria-label="Data quality summary">
        <MetricCard
          label="Quality checks"
          value={qualityQuery.isError ? "Unavailable" : qualityResults.length}
          note={qualityQuery.isError ? "API request failed" : "Backend-evaluated results"}
          icon={ShieldCheck}
          tone={qualityQuery.isError ? "critical" : "default"}
        />
        <MetricCard
          label="Passing checks"
          value={qualityQuery.isError ? "Unavailable" : qualityResults.filter((result) => result.passed).length}
          note="From the quality API"
          icon={CheckCircle2}
        />
        <MetricCard
          label="Failed checks"
          value={qualityQuery.isError ? "Unavailable" : failedChecks.length}
          note="Requires review when present"
          icon={TriangleAlert}
          tone={failedChecks.length ? "critical" : "default"}
        />
        <MetricCard
          label="Detected events"
          value={eventsQuery.isError ? "Unavailable" : detectedEvents.length}
          note={eventsQuery.isError ? "API request failed" : "Detector-reported, all event types"}
          icon={Activity}
          tone={detectedEvents.length ? "warning" : "default"}
        />
        <MetricCard
          label="Freshness at risk"
          value={slasQuery.isError ? "Unavailable" : atRiskSlas.length}
          note="Backend SLA state / observed target"
          icon={Clock3}
          tone={atRiskSlas.length ? "warning" : "default"}
        />
      </section>

      {qualityQuery.data && qualityResults.length === 0 && (
        <EmptyNotice message="The backend has not returned quality check results yet. No score is synthesized in the frontend." />
      )}

      <section className="panel quality-check-panel" aria-labelledby="quality-checks-heading">
        <header className="quality-section-header">
          <div>
            <p className="eyebrow">DATA QUALITY ENGINE OUTPUT</p>
            <h2 id="quality-checks-heading">Quality check results</h2>
            <p>{passRate === null ? "No backend quality score is available." : `${passRate}% of returned checks passed · computed from backend pass/fail results.`}</p>
          </div>
          <div className="quality-filter-row">
            <label>
              <span className="sr-only">Filter quality results</span>
              <select aria-label="Filter quality results" value={resultFilter} onChange={(event) => setResultFilter(event.target.value)}>
                <option value="all">All results</option>
                <option value="failed">Failed</option>
                <option value="passed">Passed</option>
              </select>
            </label>
            <label className="quality-search">
              <Search size={13} aria-hidden="true" />
              <span className="sr-only">Search observability records</span>
              <input aria-label="Search observability records" placeholder="Search dataset or evidence" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
          </div>
        </header>
        {qualityQuery.isError && <ErrorNotice message="Quality checks could not be loaded. Check the FastAPI quality endpoint." />}
        {qualityQuery.data && visibleQuality.length === 0 && qualityResults.length > 0 && (
          <EmptyNotice message="No quality checks match the current search and result filters." />
        )}
        {visibleQuality.length > 0 && (
          <div className="quality-table-wrap">
            <table className="quality-table">
              <thead>
                <tr><th scope="col">Dataset</th><th scope="col">Result</th><th scope="col">Score</th><th scope="col">Failed rows</th><th scope="col">Last evaluated</th><th scope="col">Evidence</th></tr>
              </thead>
              <tbody>
                {visibleQuality.map((result) => (
                  <QualityRow key={result.check_id} result={result} dataset={datasetsById.get(result.dataset_id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {qualityQuery.data && qualityResults.length > 0 && (
          <p className="quality-data-note">Scores and failed-record counts are returned by the deterministic backend quality engine.</p>
        )}
      </section>

      <section className="quality-lower-grid">
        <article className="panel quality-freshness-panel">
          <header className="quality-section-header">
            <div><p className="eyebrow">FRESHNESS ENGINE</p><h2>Dataset freshness</h2></div>
            <Clock3 size={17} aria-hidden="true" />
          </header>
          {slasQuery.isError && <ErrorNotice message="Freshness SLA records could not be loaded." />}
          {slasQuery.data && slas.length === 0 && <EmptyNotice message="No freshness SLA records are reported." />}
          {slas.length > 0 && (
            <div className="quality-freshness-list">
              {slas.slice().sort((left, right) => {
                const leftRisk = left.state === "healthy" ? 0 : 1;
                const rightRisk = right.state === "healthy" ? 0 : 1;
                return rightRisk - leftRisk ||
                  (right.current_freshness_seconds ?? -1) - (left.current_freshness_seconds ?? -1);
              }).slice(0, 12).map((sla) => {
                const dataset = datasetsById.get(sla.dataset_id);
                const exceeded = sla.current_freshness_seconds != null &&
                  sla.current_freshness_seconds > sla.target_freshness_seconds;
                return (
                  <div className="quality-freshness-row" key={sla.sla_id}>
                    <div className="quality-freshness-copy">
                      <Link to={`/datasets?dataset_id=${encodeURIComponent(sla.dataset_id)}`}>{dataset?.name ?? sla.dataset_id}</Link>
                      <small>
                        {sla.current_freshness_seconds == null
                          ? "Observed age not reported"
                          : `Age ${formatDuration(sla.current_freshness_seconds)} · target ${formatDuration(sla.target_freshness_seconds)}`}
                      </small>
                    </div>
                    <StatusPill value={exceeded && sla.state === "healthy" ? "degraded" : sla.state} />
                  </div>
                );
              })}
            </div>
          )}
          <Link className="quality-section-link" to="/sla"><Clock3 size={13} /> View SLA &amp; Data Products</Link>
        </article>

        <article className="panel quality-events-panel">
          <header className="quality-section-header">
            <div><p className="eyebrow">OBSERVABILITY EVENT STREAM</p><h2>Detector evidence</h2></div>
            <label>
              <span className="sr-only">Filter event type</span>
              <select aria-label="Filter event type" value={eventTypeFilter} onChange={(event) => setEventTypeFilter(event.target.value)}>
                <option value="all">All event types</option>
                {eventTypes.map((type) => <option key={type} value={type}>{formatLabel(type)}</option>)}
              </select>
            </label>
          </header>
          {eventsQuery.isError && <ErrorNotice message="Observability events could not be loaded." />}
          {eventsQuery.data && events.length === 0 && <EmptyNotice message="No observability events have been reported." />}
          {events.length > 0 && visibleEvents.length === 0 && <EmptyNotice message="No events match the current search and type filter." />}
          {visibleEvents.length > 0 && (
            <div className="quality-event-list">
              {visibleEvents.slice(0, 20).map((event) => (
                <EventRow
                  key={event.event_id}
                  event={event}
                  incidents={lineIncidents}
                  lineageNodeIds={lineNodeIds}
                />
              ))}
            </div>
          )}
          <Link className="quality-section-link" to="/incidents"><AlertTriangle size={13} /> Review Incident Intelligence</Link>
        </article>
      </section>
    </div>
  );
}

function QualityRow({ result, dataset }: { result: QualityResult; dataset?: Dataset }) {
  return (
    <tr>
      <td>
        <Link className="quality-dataset-link" to={`/datasets?dataset_id=${encodeURIComponent(result.dataset_id)}`}>
          <strong>{dataset?.name ?? result.dataset_id}</strong><small>{result.dataset_id}</small>
        </Link>
      </td>
      <td><StatusPill value={result.passed ? "healthy" : "critical"} /></td>
      <td>{Math.round(result.score * 100)}%</td>
      <td>{result.failed_records.toLocaleString()}</td>
      <td><time dateTime={result.evaluated_at}>{formatTimestamp(result.evaluated_at)}</time></td>
      <td><span className="quality-result-message">{result.message}</span></td>
    </tr>
  );
}

function EventRow({
  event,
  incidents,
  lineageNodeIds,
}: {
  event: ObservabilityEvent;
  incidents: ReturnType<typeof useIncidents>["data"];
  lineageNodeIds: Set<string>;
}) {
  const incident = incidents?.find((item) =>
    item.evidence.some((evidence) => evidence.event_id === event.event_id),
  );
  const lineageAnchor = event.dataset_id && lineageNodeIds.has(event.dataset_id)
    ? event.dataset_id
    : event.source_id && lineageNodeIds.has(`source.${event.source_id}`)
      ? `source.${event.source_id}`
      : null;
  return (
    <article className="quality-event-row">
      <span className={`quality-event-severity severity-${event.severity}`} aria-hidden="true" />
      <div className="quality-event-main">
        <div className="quality-event-title">
          <strong>{formatLabel(event.event_type)}</strong>
          <StatusPill value={event.status} />
          <StatusPill value={event.severity} />
        </div>
        <p>{event.message}</p>
        <div className="quality-event-meta">
          <time dateTime={event.occurred_at}>{formatTimestamp(event.occurred_at)}</time>
          {event.dataset_id && <Link to={`/datasets?dataset_id=${encodeURIComponent(event.dataset_id)}`}>{event.dataset_id}</Link>}
          {incident && (
            <Link
              to={`/incidents?incident_id=${encodeURIComponent(incident.incident_id)}#event-${encodeURIComponent(event.event_id)}`}
              aria-label={`Incident · ${incident.title}`}
            >
              Incident details
            </Link>
          )}
          {lineageAnchor && <Link to={`/lineage?anchor=${encodeURIComponent(lineageAnchor)}`}><GitBranch size={12} /> Lineage</Link>}
        </div>
      </div>
      <code className="quality-event-id">{event.event_id.slice(0, 8)}</code>
    </article>
  );
}

function formatTimestamp(value: string): string {
  const time = Date.parse(value);
  return Number.isNaN(time) ? "Unknown time" : new Date(time).toLocaleString();
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
