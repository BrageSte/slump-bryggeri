import type { BrewDayLogEntry, BrewDayState, PlannedAddition } from "./state.ts";

/**
 * Brew-day timers and alarms. Pure: the caller passes `now`, keeps track of which alarms this
 * device has acknowledged, and decides how to ring (sound, vibration, banner).
 *
 * Every alarm has a stable key, so an alarm fires once per device however often the screen
 * re-renders or the log refreshes. A registered addition or a cancelled timer never alarms.
 */

export interface BrewTimer {
  id: string;
  label: string;
  startedAt: number;
  durationMin: number;
  dueAt: number;
}

export type AlarmKind = "timer" | "stage" | "addition_soon" | "addition";

export interface Alarm {
  key: string;
  kind: AlarmKind;
  /** When it came (or comes) due. */
  at: number;
  title: string;
  detail: string | null;
  addition?: PlannedAddition;
  timerId?: string;
}

/** Heads-up before a planned addition is due. */
export const ADDITION_WARNING_MS = 60_000;

/** Timers that are running or have run out, and are not cancelled; oldest first. */
export function activeTimers(log: BrewDayLogEntry[]): BrewTimer[] {
  const cancelled = new Set(log.flatMap((e) => (e.type === "timer_cancelled" && typeof e.data?.timerId === "string" ? [e.data.timerId] : [])));
  return log
    .flatMap((e) => {
      if (e.type !== "timer_started" || !e.id || cancelled.has(e.id)) return [];
      const { label, durationMin, dueAt } = e.data ?? {};
      if (typeof label !== "string" || typeof durationMin !== "number" || typeof dueAt !== "number") return [];
      return [{ id: e.id, label, startedAt: e.occurredAt, durationMin, dueAt }];
    })
    .sort((a, b) => a.dueAt - b.dueAt);
}

export function dueAlarms(input: { state: BrewDayState; timers: BrewTimer[]; now: number }): Alarm[] {
  const { state, timers, now } = input;
  const alarms: Alarm[] = [];

  for (const timer of timers) {
    if (timer.dueAt <= now) {
      alarms.push({ key: `timer:${timer.id}`, kind: "timer", at: timer.dueAt, title: `${timer.label} er ferdig`, detail: null, timerId: timer.id });
    }
  }

  const timedStage = state.stage === "mash" || state.stage === "boil" || state.stage === "whirlpool";
  if (timedStage && state.step?.endsAt != null && state.step.endsAt <= now) {
    alarms.push({
      key: `stage:${state.stage}:${state.stageStartedAt}:${state.step.label}`,
      kind: "stage",
      at: state.step.endsAt,
      title: `${state.step.label}: tiden er ute`,
      detail: state.nextAction?.kind === "start_stage" ? `Neste: ${state.nextAction.label}` : null,
    });
  }

  if ((state.stage === "boil" || state.stage === "whirlpool") && state.stageStartedAt !== null) {
    for (const addition of state.additions) {
      if (addition.status === "done") continue;
      const dueAt = state.stageStartedAt + addition.dueAt * 60_000;
      const what = `${addition.amount.toLocaleString("nb-NO", { maximumFractionDigits: 1 })} ${addition.unit} ${addition.name}`;
      const detail = [addition.dueLabel, addition.variant].filter(Boolean).join(" · ");
      if (now >= dueAt) {
        alarms.push({ key: `addition:${addition.ingredientId}`, kind: "addition", at: dueAt, title: `Tilsett ${what}`, detail, addition });
      } else if (now >= dueAt - ADDITION_WARNING_MS && dueAt - state.stageStartedAt > ADDITION_WARNING_MS) {
        alarms.push({ key: `addition:${addition.ingredientId}:soon`, kind: "addition_soon", at: dueAt - ADDITION_WARNING_MS, title: `Om 1 min: ${what}`, detail, addition });
      }
    }
  }

  return alarms.sort((a, b) => a.at - b.at);
}
