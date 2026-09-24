import { useState, type FormEvent } from "react";
import type { Alarm, AlarmKind, BrewTimer } from "../../domain/brew-day/alarms.ts";
import { Button, Card, Field, Icon, InlineError, parseDecimal, SectionLabel, TextInput } from "../../design-system/index.ts";
import { formatDuration } from "../../lib/format.ts";

const QUICK_MINUTES = [5, 10, 15, 20, 30, 60];

const kindLabels: Record<AlarmKind, string> = {
  timer: "Timer",
  stage: "Tiden er ute",
  addition_soon: "Snart",
  addition: "Tilsetning",
};

/**
 * The alarm on top of the brew-day screen: the oldest unacknowledged one first. A due addition
 * is registered with one tap at the planned amount; the additions list is where the amount can
 * be changed first.
 */
export function AlarmBanner({
  alarms,
  onAcknowledge,
  onRegister,
  registering,
}: {
  alarms: Alarm[];
  onAcknowledge: (key: string) => void;
  onRegister: (alarm: Alarm) => void;
  registering: boolean;
}) {
  const alarm = alarms[0];
  if (!alarm) return null;
  return (
    // Bottom of the screen, above the navigation: thumb-reachable at the kettle and clear of toasts.
    <div role="alert" className="fixed inset-x-0 bottom-20 z-40 px-3 md:bottom-4 md:left-64 print:hidden">
      <div className="mx-auto max-w-3xl rounded-card border-2 border-accent bg-accent-soft p-4 shadow-lg">
        <p className="flex items-center gap-2 text-caption font-semibold tracking-wide text-muted uppercase">
          <Icon name={alarm.kind === "timer" ? "clock" : "alert"} size={16} />
          {kindLabels[alarm.kind]}
          {alarms.length > 1 ? ` · ${alarms.length - 1} til` : ""}
        </p>
        <p className="mt-1 text-section font-bold">{alarm.title}</p>
        {alarm.detail && <p className="text-small text-muted">{alarm.detail}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {alarm.kind === "addition" && alarm.addition && (
            <Button variant="primary" loading={registering} onClick={() => onRegister(alarm)}>
              Registrer tilsatt
            </Button>
          )}
          <Button onClick={() => onAcknowledge(alarm.key)}>Kvitter</Button>
        </div>
      </div>
    </div>
  );
}

function countdown(ms: number): string {
  if (ms <= 0) return "Ferdig";
  const totalSeconds = Math.ceil(ms / 1000);
  if (totalSeconds >= 3600) return formatDuration(totalSeconds / 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Shared timers: everyone in the brewery sees the same countdown (the log is polled). */
export function TimerCard({
  timers,
  now,
  onStart,
  onCancel,
  busy,
  error,
  soundOn,
  onSoundChange,
}: {
  timers: BrewTimer[];
  now: number;
  onStart: (label: string, durationMin: number) => void;
  onCancel: (timerId: string) => void;
  busy: boolean;
  error?: string;
  soundOn: boolean;
  onSoundChange: (on: boolean) => void;
}) {
  const [custom, setCustom] = useState(false);
  const [label, setLabel] = useState("");
  const [minutes, setMinutes] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseDecimal(minutes);
    if (value === undefined || Number.isNaN(value) || value <= 0 || value > 2880) return setValidation("Skriv inn minutter (opptil to døgn).");
    setValidation(null);
    onStart(label.trim() || `${minutes.trim()} min`, value);
    setLabel("");
    setMinutes("");
    setCustom(false);
  }

  return (
    <Card>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Timere</SectionLabel>
        <Button size="sm" variant="ghost" aria-pressed={soundOn} onClick={() => onSoundChange(!soundOn)}>
          Lyd {soundOn ? "på" : "av"}
        </Button>
      </div>

      {timers.length > 0 && (
        <ul className="mt-2 divide-y divide-border">
          {timers.map((timer) => (
            <li key={timer.id} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{timer.label}</p>
                <p className="text-small text-muted">{formatDuration(timer.durationMin)}</p>
              </div>
              <p className={timer.dueAt <= now ? "tabular font-bold text-warning" : "tabular text-section font-bold"} aria-live="off">
                {countdown(timer.dueAt - now)}
              </p>
              <Button size="sm" variant="ghost" onClick={() => onCancel(timer.id)} disabled={busy} aria-label={`Stopp ${timer.label}`}>
                Stopp
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {QUICK_MINUTES.map((value) => (
          <Button key={value} size="sm" onClick={() => onStart(`${value} min`, value)} disabled={busy}>
            {value} min
          </Button>
        ))}
      </div>
      {custom ? (
        <form onSubmit={submit} className="mt-3 grid grid-cols-[1fr_6rem] items-end gap-2">
          <Field label="Hva">{(p) => <TextInput {...p} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Whirlpool-hvile" maxLength={80} />}</Field>
          <Field label="Minutter">
            {(p) => <TextInput {...p} required inputMode="decimal" value={minutes} onChange={(e) => setMinutes(e.target.value)} className="tabular" />}
          </Field>
          <Button type="submit" variant="primary" className="col-span-2" loading={busy}>
            Start timer
          </Button>
        </form>
      ) : (
        <Button variant="ghost" block className="mt-2" onClick={() => setCustom(true)}>
          Egendefinert …
        </Button>
      )}
      {(validation || error) && (
        <div className="mt-2">
          <InlineError>{validation ?? error}</InlineError>
        </div>
      )}
    </Card>
  );
}
