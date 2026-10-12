import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Database,
  Pause,
  Play,
  RotateCcw,
  Timer,
  Zap,
} from "lucide-react";
import { apiSend } from "../api/client";
import {
  queryKeys,
  useEvents,
  useHealth,
  useSimulatorStatus,
  useSources,
} from "../api/queries";
import type {
  ObservabilityEvent,
  SimulatorCycleRequest,
  SimulatorCycleResponse,
} from "../api/contracts";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import { EmptyNotice, ErrorNotice, LoadingNotice } from "./Notice";
import { StatusPill } from "./StatusPill";
import { useDialogFocus } from "./useDialogFocus";

const sourceDefinitions = [
  { id: "claims", name: "Claims", mode: "Transactional batch" },
  { id: "policies", name: "Policy", mode: "Transactional batch" },
  { id: "customers", name: "Customer CRM", mode: "CRM synthetic feed" },
  { id: "payments", name: "Payments", mode: "Transactional batch" },
  { id: "bureau", name: "Bureau", mode: "File landing feed" },
  { id: "telematics", name: "Telematics", mode: "Event stream" },
] as const;

const scenarios = [
  {
    id: "CLAIMS_QUALITY_FAILURE",
    title: "Claims Quality Failure",
    target: "Claims",
    description: "Generates claims with controlled missing or invalid policy references.",
  },
  {
    id: "SCHEMA_DRIFT",
    title: "Schema Drift",
    target: "Claims",
    description: "Changes the synthetic claims source field in the next bounded cycle.",
  },
  {
    id: "TELEMATICS_VOLUME_DROP",
    title: "Telematics Volume Drop",
    target: "Telematics",
    description: "Reduces the synthetic telematics batch volume.",
  },
  {
    id: "FRESHNESS_VIOLATION",
    title: "Freshness Violation",
    target: "Payments",
    description: "Exercises the synthetic payments freshness scenario.",
  },
  {
    id: "PII_PROCESSING_FAILURE",
    title: "PII Processing Failure",
    target: "Processing stage",
    description: "Exercises a safe synthetic masking/processing failure without real PII.",
  },
  {
    id: "PIPELINE_DELAY",
    title: "Pipeline Delay",
    target: "Processing stage",
    description: "Adds a controlled processing delay to the synthetic cycle.",
  },
] as const;

type ActionNotice = { kind: "success" | "error"; message: string };

export function SimulatorPage() {
  const queryClient = useQueryClient();
  const { lineOfBusiness } = useLineOfBusiness();
  const healthQuery = useHealth();
  const sourcesQuery = useSources();
  const eventsQuery = useEvents();
  const simulatorQuery = useSimulatorStatus();
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [pendingScenario, setPendingScenario] = useState<(typeof scenarios)[number] | null>(null);
  const dismissScenarioConfirmation = () => setPendingScenario(null);
  const confirmationDialogRef = useDialogFocus<HTMLElement>(
    Boolean(pendingScenario),
    dismissScenarioConfirmation,
  );
  const currentCycle = simulatorQuery.data?.last_cycles.at(-1);
  const latestEventsBySource = useMemo(() => latestEventsBySourceId(eventsQuery.data ?? []), [eventsQuery.data]);
  const isMotorSimulatorContext = lineOfBusiness === "motor";
  const demoEnabled = Boolean(isMotorSimulatorContext && healthQuery.data?.demo_mode && simulatorQuery.data?.enabled);
  const isLoading = healthQuery.isLoading || sourcesQuery.isLoading || eventsQuery.isLoading || simulatorQuery.isLoading;

  const runCycle = async (actionId: string, failureScenarios: string[]) => {
    setActiveAction(actionId);
    setNotice(null);
    try {
      const body: SimulatorCycleRequest = { cycles: 1, failure_scenarios: failureScenarios };
      const result = await apiSend<SimulatorCycleResponse>("POST", "/simulator/cycles", body);
      await queryClient.invalidateQueries({ queryKey: queryKeys.simulator });
      if (failureScenarios.length) {
        setNotice({
          kind: "success",
          message: "Scenario injection requested. The backend accepted it for a bounded synthetic cycle. Health, lineage, and incidents will change only when subsequent observability API results report detector evidence.",
        });
      } else {
        const runId = result.cycles[0]?.run_id;
        setNotice({
          kind: "success",
          message: `Synthetic cycle request completed${runId ? ` (${runId})` : ""}. Health and incident status continue to come only from the observability APIs.`,
        });
      }
    } catch (error) {
      setNotice({
        kind: "error",
        message: error instanceof Error ? error.message : "The simulator request failed.",
      });
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div className="page-stack simulator-page">
      <section className="page-heading">
        <div>
          <p className="eyebrow">ISOLATED DEMONSTRATION WORKSPACE</p>
          <h1>Demo Control Center</h1>
          <p>Operate bounded synthetic source cycles and request controlled failure scenarios. This console is separate from normal observability views.</p>
        </div>
        <span className="simulator-demo-badge"><Database size={15} /> SYNTHETIC DEMO DATA ONLY</span>
      </section>

      <div className="simulator-safety-banner">
        <AlertTriangle size={17} />
        <p>Actions are sent to <code>POST /api/v1/simulator/cycles</code>. The browser never edits health, lineage, incident, or DAG state. Those views update only from their ordinary APIs after synthetic processing and detection.</p>
      </div>
      {!isMotorSimulatorContext && (
        <div className="simulator-inline-warning" role="status">
          The displayed source fixtures and simulator controls are Motor Insurance only. Simulator actions are disabled until the shared line-of-business context is set to Motor.
        </div>
      )}

      {notice && (
        <div className={`simulator-action-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          {notice.kind === "success" ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{notice.message}</span>
        </div>
      )}
      {pendingScenario && (
        <div className="simulator-confirm-backdrop">
          <section
            className="simulator-confirm-dialog"
            ref={confirmationDialogRef}
            role="alertdialog"
            aria-modal="true"
            tabIndex={-1}
            aria-labelledby="simulator-confirm-title"
            aria-describedby="simulator-confirm-description"
          >
            <span className="simulator-confirm-icon"><AlertTriangle size={18} /></span>
            <div>
              <p className="eyebrow">SYNTHETIC DATA CHANGE</p>
              <h2 id="simulator-confirm-title">Confirm {pendingScenario.title}</h2>
              <p id="simulator-confirm-description">
                This sends a request to run one bounded synthetic cycle with this scenario. It can change generated demo data; health and incident views will update only from backend observability results.
              </p>
            </div>
            <div className="simulator-confirm-actions">
              <button type="button" className="simulator-cancel-button" onClick={() => setPendingScenario(null)}>Cancel</button>
              <button
                type="button"
                className="simulator-confirm-button"
                onClick={() => {
                  const scenario = pendingScenario;
                  setPendingScenario(null);
                  void runCycle(scenario.id, [scenario.id]);
                }}
              >
                Confirm scenario injection
              </button>
            </div>
          </section>
        </div>
      )}

      {isLoading && <LoadingNotice label="Loading simulator status and source evidence…" />}
      {healthQuery.isError && <ErrorNotice message="Demo mode status could not be loaded. Simulator actions are disabled until the backend confirms demo mode." />}
      {simulatorQuery.isError && <ErrorNotice message="Simulator status could not be loaded. No source run state or cycle metadata will be inferred." />}
      {(sourcesQuery.isError || eventsQuery.isError) && (
        <ErrorNotice message="Source or event evidence could not be loaded. Simulator actions may still be available, but source updates will remain unknown." />
      )}

      <section className="simulator-control-card" aria-labelledby="simulator-controls-heading">
        <div className="simulator-section-heading">
          <div>
            <p className="eyebrow">BACKEND-CONTROLLED CYCLES</p>
            <h2 id="simulator-controls-heading">Source simulators</h2>
            <p>The current API runs bounded cycles on request; it does not expose a continuous worker, pause/resume, or reset control.</p>
          </div>
          <button
            type="button"
            className="primary-button simulator-start-button"
            disabled={!demoEnabled || isLoading || activeAction !== null}
            onClick={() => void runCycle("all", [])}
            title="Runs one bounded cycle for all six synthetic sources."
          >
            <Play size={15} />{activeAction === "all" ? "Running cycle…" : "Start All · one bounded cycle"}
          </button>
        </div>

        <div className="simulator-action-grid">
          <div className="simulator-action-placeholder">
            <Pause size={15} />
            <span><strong>Pause / Resume</strong><small>Not exposed by the simulator API</small></span>
            <StatusPill value="not_configured" />
          </div>
          <div className="simulator-action-placeholder">
            <RotateCcw size={15} />
            <span><strong>Reset Demo</strong><small>No reset endpoint is available; no reset is simulated.</small></span>
            <button type="button" disabled aria-label="Reset demo unavailable">Unavailable</button>
          </div>
          <div className="simulator-action-placeholder">
            <Timer size={15} />
            <span><strong>Generation interval</strong><small>Not exposed by the simulator status API</small></span>
            <span className="simulator-not-reported">NOT REPORTED</span>
          </div>
        </div>

        {simulatorQuery.data && !simulatorQuery.data.enabled && (
          <div className="simulator-inline-warning" role="status">The backend reports simulator controls are disabled.</div>
        )}
        {healthQuery.data && !healthQuery.data.demo_mode && (
          <div className="simulator-inline-warning" role="status">The backend is not in demo mode. Simulator actions are disabled.</div>
        )}
      </section>

      <section className="simulator-source-section" aria-labelledby="synthetic-sources-heading">
        <div className="simulator-section-heading compact">
          <div>
            <p className="eyebrow">SIX MOTOR INSURANCE FEEDS</p>
            <h2 id="synthetic-sources-heading">Synthetic source status</h2>
          </div>
          {currentCycle && <span className="simulator-current-cycle">Latest completed cycle <code>{currentCycle.run_id}</code></span>}
        </div>
        {sourcesQuery.data && sourcesQuery.data.length === 0 && <EmptyNotice message="The backend has not registered any synthetic sources yet." />}
        <div className="simulator-source-grid">
          {sourceDefinitions.map((definition) => {
            const source = sourcesQuery.data?.find((item) => item.source_id === definition.id);
            const event = latestEventsBySource.get(definition.id);
            const recordCount = currentCycle?.source_counts[definition.id];
            return (
              <article className="simulator-source-card" key={definition.id}>
                <header>
                  <span className="simulator-source-icon"><Database size={16} /></span>
                  <div><h3>{source?.name ?? definition.name}</h3><span>{source?.source_type ?? definition.mode}</span></div>
                  <StatusPill value="waiting" />
                </header>
                <p className="simulator-source-state">WAITING <span>· no continuously running worker is reported</span></p>
                <dl>
                  <div><dt>Latest batch</dt><dd>{recordCount === undefined ? "No cycle reported" : `${recordCount.toLocaleString()} synthetic records`}</dd></div>
                  <div><dt>Latest run</dt><dd>{currentCycle?.run_id ?? "—"}</dd></div>
                  <div><dt>Last observed update</dt><dd>{event ? formatTimestamp(event.occurred_at) : "No source event reported"}</dd></div>
                </dl>
                {!source && sourcesQuery.isSuccess && <p className="simulator-source-missing">Source record is not present in the backend response.</p>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="simulator-scenario-section" aria-labelledby="scenario-controls-heading">
        <div className="simulator-section-heading compact">
          <div>
            <p className="eyebrow">CONTROLLED DATA / PROCESSING CHANGES</p>
            <h2 id="scenario-controls-heading">Request a scenario injection</h2>
            <p>Each selection requests one bounded synthetic cycle with that scenario. Acknowledgement is not a claim that an incident has been detected.</p>
          </div>
          <span className="simulator-injection-label"><Zap size={14} /> Backend request only</span>
        </div>
        <div className="simulator-scenario-grid">
          {scenarios.map((scenario) => (
            <article className="simulator-scenario-card" key={scenario.id}>
              <div className="simulator-scenario-title"><h3>{scenario.title}</h3><span>{scenario.target}</span></div>
              <p>{scenario.description}</p>
              <button
                type="button"
                className="secondary-button"
                aria-label={`Request ${scenario.title} injection`}
                disabled={!demoEnabled || isLoading || activeAction !== null}
                onClick={() => {
                  setNotice(null);
                  setPendingScenario(scenario);
                }}
              >
                <Zap size={14} />{activeAction === scenario.id ? "Requesting…" : "Request injection"}
              </button>
            </article>
          ))}
        </div>
      </section>

      <p className="simulator-footnote"><Clock3 size={13} /> No pause/resume, reset, persistent worker state, or generation interval is currently provided by the documented API.</p>
    </div>
  );
}

function latestEventsBySourceId(events: ObservabilityEvent[]): Map<string, ObservabilityEvent> {
  const latest = new Map<string, ObservabilityEvent>();
  for (const event of events) {
    if (!event.source_id) continue;
    const previous = latest.get(event.source_id);
    if (!previous || event.occurred_at > previous.occurred_at) latest.set(event.source_id, event);
  }
  return latest;
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? "Unknown time" : new Date(timestamp).toLocaleString();
}
