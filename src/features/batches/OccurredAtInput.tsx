import { TextInput } from "../../design-system/index.ts";
import { toDateTimeLocal } from "../../lib/format.ts";

/**
 * "Tidspunkt: nå · endre" on every log form, so something can be logged after the fact.
 * `value` is a datetime-local string, or null for "now".
 */
export function OccurredAtInput({ value, onChange }: { value: string | null; onChange: (value: string | null) => void }) {
  if (value === null) {
    return (
      <button type="button" onClick={() => onChange(toDateTimeLocal(Date.now()))} className="min-h-11 text-small text-muted underline underline-offset-4">
        Tidspunkt: nå · endre
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-small">
      <label className="flex min-w-0 flex-1 items-center gap-2">
        <span className="font-semibold">Tidspunkt</span>
        <TextInput type="datetime-local" required max={toDateTimeLocal(Date.now())} value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
      <button type="button" onClick={() => onChange(null)} className="min-h-11 px-2 text-muted underline underline-offset-4">
        Nå
      </button>
    </div>
  );
}

/** The timestamp to send to the API; undefined lets the server use "now". */
export function occurredAtOf(value: string | null): number | undefined {
  if (!value) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}
