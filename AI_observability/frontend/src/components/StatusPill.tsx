import { Activity, CircleHelp, Clock3, ShieldAlert, ShieldCheck } from "lucide-react";
import type { HealthState, IncidentStatus, Severity } from "../api/contracts";

type StatusValue = HealthState | IncidentStatus | Severity | "running" | "paused" | "completed" | "failed" | "ready" | "not_configured" | "approved" | "rejected" | "detected";

const icons: Record<string, typeof ShieldCheck> = {
  healthy: ShieldCheck,
  ready: ShieldCheck,
  approved: ShieldCheck,
  resolved: ShieldCheck,
  completed: ShieldCheck,
  critical: ShieldAlert,
  rejected: ShieldAlert,
  error: ShieldAlert,
  degraded: Activity,
  warning: Activity,
  waiting: Clock3,
  not_configured: Clock3,
  paused: Clock3,
  running: Activity,
  unknown: CircleHelp,
};

export function StatusPill({ value }: { value: StatusValue }) {
  const Icon = icons[value] ?? CircleHelp;
  return (
    <span className={`status-pill status-${value}`} aria-label={`Status: ${value}`}>
      <Icon size={13} aria-hidden="true" />
      <span>{value.replaceAll("_", " ")}</span>
    </span>
  );
}
