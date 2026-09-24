import type { ReactNode } from "react";
import { Link } from "react-router";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";

export function Card({
  children,
  className,
  highlight = false,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  /** Tinted card for the single most important thing on a screen (e.g. NESTE). */
  highlight?: boolean;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag
      className={cx(
        "rounded-card border p-4 md:p-5",
        highlight ? "border-primary-strong/30 bg-primary-soft" : "border-border bg-surface",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** Caption-styled heading used to label areas on a screen (AKTIVT BRYGG, NESTE, LOGG …). */
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("text-caption font-semibold tracking-[.08em] text-muted uppercase", className)}>{children}</h2>;
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("space-y-3", className)}>
      <div className="flex min-h-8 items-center justify-between gap-3">
        <SectionLabel>{title}</SectionLabel>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageHeader({
  title,
  subtitle,
  back,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  back?: string;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-5 flex items-start gap-2">
      {back && (
        <Link
          to={back}
          aria-label="Tilbake"
          className="-ml-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-text hover:bg-surface-2"
        >
          <Icon name="chevronLeft" />
        </Link>
      )}
      <div className="min-w-0 flex-1 pt-1.5">
        {eyebrow && <div className="mb-1">{eyebrow}</div>}
        <h1 className="text-title font-bold tracking-tight text-balance">{title}</h1>
        {subtitle && <p className="mt-1 text-small text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </header>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-md bg-surface-2 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cx(
            "min-h-10 rounded-sm px-3 text-small font-semibold transition",
            option.value === value ? "bg-surface text-text shadow-sm" : "text-muted hover:text-text",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Tappable list row linking somewhere, with a chevron. */
export function ListLink({
  to,
  title,
  subtitle,
  trailing,
  icon,
}: {
  to: string;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <Link to={to} className="flex min-h-14 items-center gap-3 px-4 py-3 transition hover:bg-surface-2">
      {icon}
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold">{title}</div>
        {subtitle && <div className="truncate text-small text-muted">{subtitle}</div>}
      </div>
      {trailing}
      <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
    </Link>
  );
}

export function ListCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("divide-y divide-border overflow-hidden rounded-card border border-border bg-surface", className)}>
      {children}
    </div>
  );
}
