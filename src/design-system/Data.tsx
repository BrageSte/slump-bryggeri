import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "accent";

const tones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-muted",
  primary: "bg-primary-soft text-primary-strong",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  accent: "bg-accent-soft text-warning",
};

/** Status pill. Always carries text (and optionally an icon) — never colour alone. */
export function StatusChip({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: IconName; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-semibold whitespace-nowrap", tones[tone], className)}>
      {icon && <Icon name={icon} size={14} strokeWidth={2.4} />}
      {children}
    </span>
  );
}

/** A number with its unit. `display` is the 40/44 brew-day size (spec §28). */
export function Measurement({
  value,
  unit,
  size = "section",
  className,
}: {
  value: ReactNode;
  unit?: string | null;
  size?: "display" | "title" | "section" | "body";
  className?: string;
}) {
  const sizeClass = { display: "text-display", title: "text-title", section: "text-section", body: "text-body" }[size];
  return (
    <span className={cx("tabular font-bold tracking-tight whitespace-nowrap", sizeClass, className)}>
      {value}
      {unit ? <span className="ml-1 text-[0.55em] font-semibold text-muted">{unit}</span> : null}
    </span>
  );
}

export function MetricCard({ label, value, unit, hint }: { label: string; value: ReactNode; unit?: string | null; hint?: ReactNode }) {
  return (
    <div className="rounded-md bg-surface-2 px-3 py-2.5">
      <div className="text-caption font-semibold tracking-wide text-muted uppercase">{label}</div>
      <Measurement value={value} unit={unit} size="section" />
      {hint && <div className="text-caption text-muted">{hint}</div>}
    </div>
  );
}

export type TargetStatus = "ok" | "low" | "high" | "uncertain" | "missing";

const statusPresentation: Record<TargetStatus, { tone: Tone; icon: IconName; label: string }> = {
  ok: { tone: "success", icon: "check", label: "OK" },
  low: { tone: "warning", icon: "arrowDown", label: "Lav" },
  high: { tone: "warning", icon: "arrowUp", label: "Høy" },
  uncertain: { tone: "warning", icon: "alert", label: "Usikker" },
  missing: { tone: "neutral", icon: "clock", label: "Ikke målt" },
};

export function TargetStatusChip({ status }: { status: TargetStatus }) {
  const p = statusPresentation[status];
  return (
    <StatusChip tone={p.tone} icon={p.icon}>
      {p.label}
    </StatusChip>
  );
}

/** Target vs. measured value — the core brew-day comparison (spec §35, §55). */
export function TargetVsActual({
  label,
  target,
  actual,
  unit,
  status,
  detail,
  action,
}: {
  label: string;
  target: ReactNode;
  actual: ReactNode | null;
  unit?: string | null;
  status: TargetStatus;
  detail?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-small font-semibold text-muted">{label}</div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {actual === null ? (
            <span className="text-section font-semibold text-muted">–</span>
          ) : (
            <Measurement value={actual} unit={unit} size="title" />
          )}
          <TargetStatusChip status={status} />
        </div>
        <div className="text-small text-muted tabular">
          Mål {target}
          {unit && unit !== "SG" ? ` ${unit}` : ""}
          {detail ? <> · {detail}</> : null}
        </div>
      </div>
      {action}
    </div>
  );
}
