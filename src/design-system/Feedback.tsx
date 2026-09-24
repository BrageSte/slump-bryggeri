import type { ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./Icon.tsx";

export function Spinner({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-2", className)} aria-hidden="true" />;
}

/** Full-area loading placeholder with an accessible label. */
export function LoadingState({ label = "Laster …", rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" aria-label={label} className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-card" />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function EmptyState({
  icon = "box",
  title,
  children,
  action,
}: {
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-border px-6 py-10 text-center">
      <span className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary-strong">
        <Icon name={icon} />
      </span>
      <h2 className="text-section font-semibold">{title}</h2>
      {children && <div className="mt-1 max-w-sm text-small text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : "Noe gikk galt.";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-card border border-danger/40 bg-danger-soft p-4 text-danger">
      <Icon name="alert" className="mt-0.5 shrink-0" />
      <div className="flex-1">
        <p className="font-semibold">Kunne ikke laste</p>
        <p className="text-small">{message}</p>
        {onRetry && (
          <button type="button" onClick={onRetry} className="mt-2 min-h-11 font-semibold underline underline-offset-4">
            Prøv igjen
          </button>
        )}
      </div>
    </div>
  );
}

export function InlineError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="flex items-center gap-1.5 text-small text-danger">
      <Icon name="alert" size={16} />
      {children}
    </p>
  );
}
