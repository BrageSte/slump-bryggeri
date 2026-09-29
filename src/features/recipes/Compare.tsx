import type { ReactNode } from "react";

/** One row of a before → after comparison: label, old value, new value with its unit. */
export function Compare({ label, before, after, unit }: { label: string; before: ReactNode; after: ReactNode; unit?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3 py-2">
      <span className="text-small text-muted">{label}</span>
      <span className="tabular text-right text-muted">{before}</span>
      <span className="text-muted">→</span>
      <span className="tabular text-right text-section font-bold">
        {after}
        {unit && <span className="ml-1 text-small text-muted">{unit}</span>}
      </span>
    </div>
  );
}
