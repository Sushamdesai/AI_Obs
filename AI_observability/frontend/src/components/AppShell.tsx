import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  Bot,
  Boxes,
  ChevronDown,
  CircleHelp,
  Database,
  GitBranch,
  LayoutDashboard,
  Menu,
  Radio,
  ShieldCheck,
  Siren,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import { useDatasets, useHealth, useIncidents, useLineage, useSources } from "../api/queries";
import { apiConfig } from "../api/config";
import { useLineOfBusiness } from "../LineOfBusinessContext";
import { AskAIPanel } from "./AskAIPanel";
import { StatusPill } from "./StatusPill";

const navigation = [
  { label: "Command Center", path: "/", icon: LayoutDashboard, group: "Workspace" },
  { label: "Data Sources", path: "/sources", icon: Database, group: "Workspace" },
  { label: "Live Data Lineage", path: "/lineage", icon: GitBranch, group: "Workspace" },
  { label: "Dataset Explorer", path: "/datasets", icon: Boxes, group: "Workspace" },
  { label: "Data Quality", path: "/quality", icon: ShieldCheck, group: "Observe" },
  { label: "Incident Intelligence", path: "/incidents", icon: Siren, group: "Observe" },
  { label: "Agentic AI Center", path: "/agent-center", icon: Bot, group: "Intelligence" },
  { label: "SLA & Data Products", path: "/sla", icon: Timer, group: "Intelligence" },
  { label: "Ask Your Platform AI", path: "/ask-ai", icon: Sparkles, group: "Intelligence" },
  { label: "Demo Simulator", path: "/simulator", icon: Radio, group: "Tools" },
];

const pageTitles = new Map(navigation.map((item) => [item.path, item.label]));

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealth();
  const sources = useSources();
  const datasets = useDatasets();
  const incidents = useIncidents();
  const lineage = useLineage();
  const { lineOfBusiness, setLineOfBusiness } = useLineOfBusiness();
  const location = useLocation();
  const title = pageTitles.get(location.pathname) ?? "InsuraObserve AI";
  const pageTitle = location.pathname === "/agents" ? "Agentic AI Center" : title;
  const isApiLive = health.isSuccess && !health.isError && health.data.status !== "critical";
  const availableLines = [...new Set([
    ...(sources.data ?? []).map((source) => source.line_of_business),
    ...(datasets.data ?? []).map((dataset) => dataset.line_of_business),
    ...(incidents.data ?? []).map((incident) => incident.line_of_business),
    ...(lineage.data?.nodes ?? []).map((node) => node.line_of_business),
  ])].sort();
  const lineOptions = [...new Set([lineOfBusiness, ...availableLines])].sort();
  const businessName = formatLineOfBusiness(lineOfBusiness);

  return (
    <div className="app-frame">
      {mobileOpen && <button className="mobile-scrim" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark"><Activity size={19} strokeWidth={2.5} /></div>
          <div>
            <strong>InsuraObserve</strong>
            <span>AI · DATA INTELLIGENCE</span>
          </div>
          <button className="icon-button mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation">
            <X size={18} />
          </button>
        </div>
        <div className="workspace-picker">
          <div className="workspace-avatar">{businessName.slice(0, 1)}</div>
          <div><strong>{businessName} Insurance</strong><span>Workspace</span></div>
          <ChevronDown size={15} />
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          {["Workspace", "Observe", "Intelligence", "Tools"].map((group) => (
            <div className="nav-group" key={group}>
              <p className="nav-heading">{group}</p>
              {navigation.filter((item) => item.group === group).map(({ label, path, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  end={path === "/"}
                  className={({ isActive }) => `nav-link ${isActive ? "nav-link-active" : ""}`}
                  onClick={() => setMobileOpen(false)}
                >
                  <Icon size={17} strokeWidth={1.8} />
                  <span>{label}</span>
                  {path === "/incidents" && health.data && (
                    <span className="nav-count">{health.data.demo_mode ? "AI" : ""}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className={`api-status ${isApiLive ? "api-online" : ""}`}>
            <span className="api-dot" />
            <span>{health.isFetching ? "Refreshing API" : isApiLive ? "API connected" : "API unavailable"}</span>
            <span className="api-env">{apiConfig.mockMode ? "MOCK" : "LIVE"}</span>
          </div>
          <div className="provider-mini">
            <span>{health.isError ? "Last known provider status · connection stale" : "Provider status"}</span>
            {health.data ? (
              <div className="provider-list">
                {Object.entries(health.data.providers).map(([name, value]) => (
                  <div key={name}><span>{name.replace("_", " ")}</span><StatusPill value={value === "ready" ? "healthy" : "waiting"} /></div>
                ))}
              </div>
            ) : (
              <p>{health.isLoading ? "Checking configured adapters…" : "Health endpoint is not responding."}</p>
            )}
          </div>
          <div className="sidebar-foot"><CircleHelp size={14} /> Evidence-first observability</div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button mobile-menu" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
              <Menu size={19} />
            </button>
            <div className="breadcrumbs"><span>{businessName} Insurance</span><span>/</span><strong>{pageTitle}</strong></div>
          </div>
          <div className="topbar-right">
            <label className="topbar-lob">
              <span>Line of business</span>
              <select
                aria-label="Line of business"
                value={lineOfBusiness}
                onChange={(event) => setLineOfBusiness(event.target.value)}
              >
                {lineOptions.map((line) => <option key={line} value={line}>{formatLineOfBusiness(line)}</option>)}
              </select>
            </label>
            <div className="live-indicator">
              <span className={`live-dot ${isApiLive ? "live-dot-on" : ""}`} />
              <span>{health.isFetching ? "Syncing" : isApiLive ? "Live data" : "Connection stale"}</span>
            </div>
            <span className="topbar-divider" />
            <div className="environment-tag"><span />{health.data?.demo_mode ? "DEMO ENVIRONMENT" : "API ENVIRONMENT"}</div>
            <AskAIPanel />
          </div>
        </header>
        <main className="page-content"><Outlet /></main>
        <footer className="app-footer">
          <span>InsuraObserve AI</span>
          <span>{businessName} insurance · Synthetic data only</span>
          <span>Evidence before inference</span>
        </footer>
      </div>
    </div>
  );
}

function formatLineOfBusiness(value: string) {
  return value.split(/[_\s-]+/).filter(Boolean).map((word) =>
    word.charAt(0).toUpperCase() + word.slice(1),
  ).join(" ");
}
