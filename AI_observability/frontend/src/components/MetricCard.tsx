import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  note,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  note: string;
  icon: LucideIcon;
  tone?: "default" | "warning" | "critical";
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-icon"><Icon size={17} aria-hidden="true" /></div>
      <p className="eyebrow">{label}</p>
      <strong>{value}</strong>
      <span>{note}</span>
    </article>
  );
}
