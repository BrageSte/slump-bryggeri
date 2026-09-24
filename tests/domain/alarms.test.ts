import { describe, expect, it } from "vitest";
import { activeTimers, dueAlarms, type BrewTimer } from "../../src/domain/brew-day/alarms.ts";
import { deriveBrewDayState, type BrewDayLogEntry } from "../../src/domain/brew-day/state.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { RecipeDocument } from "../../src/domain/model/recipe.ts";

const MIN = 60_000;
const boilStart = Date.parse("2026-10-10T12:00:00+02:00");

// Sunset with a 15 min Citra addition added, to exercise the heads-up before a mid-boil hop.
const recipe: RecipeDocument = {
  ...sunsetIpaRecipe,
  hops: [...sunsetIpaRecipe.hops, { id: "h-citra-15", name: "Citra", amountG: 30, use: "boil", timeMin: 15 }],
};

function boilState(log: BrewDayLogEntry[], now: number) {
  return deriveBrewDayState({ recipe, stage: "boil", stageStartedAt: boilStart, log, now });
}

const timerEvent = (id: string, label: string, durationMin: number, startedAt: number): BrewDayLogEntry => ({
  id,
  type: "timer_started",
  stage: "boil",
  occurredAt: startedAt,
  data: { label, durationMin, dueAt: startedAt + durationMin * MIN },
  measurement: null,
});

describe("dueAlarms", () => {
  it("rings for the 60 min hop as soon as the boil starts, and not before it is due for the 15 min hop", () => {
    const alarms = dueAlarms({ state: boilState([], boilStart + 10_000), timers: [], now: boilStart + 10_000 });
    expect(alarms.map((a) => a.key)).toEqual(["addition:h-simcoe-60"]);
    expect(alarms[0]).toMatchObject({ kind: "addition", title: "Tilsett 65 g Simcoe T90", at: boilStart });
  });

  it("gives a heads-up one minute before an addition and then rings when it is due", () => {
    const simcoeAdded: BrewDayLogEntry = {
      type: "ingredient_added",
      stage: "boil",
      occurredAt: boilStart + MIN,
      data: { ingredientKind: "hop", ingredientId: "h-simcoe-60", name: "Simcoe T90", amount: 65, unit: "g" },
      measurement: null,
    };
    const at = (minutes: number) => {
      const now = boilStart + minutes * MIN;
      return dueAlarms({ state: boilState([simcoeAdded], now), timers: [], now }).map((a) => a.key);
    };
    expect(at(43.9)).toEqual([]);
    expect(at(44.5)).toEqual(["addition:h-citra-15:soon"]);
    // When due, the heads-up is replaced by the alarm itself (a different key, so it rings once more).
    expect(at(45)).toEqual(["addition:h-citra-15"]);
  });

  it("never rings for an addition that is already registered", () => {
    const log: BrewDayLogEntry[] = ["h-simcoe-60", "h-citra-15"].map((id) => ({
      type: "ingredient_added",
      stage: "boil",
      occurredAt: boilStart + MIN,
      data: { ingredientKind: "hop", ingredientId: id, name: id, amount: 1, unit: "g" },
      measurement: null,
    }));
    const now = boilStart + 50 * MIN;
    expect(dueAlarms({ state: boilState(log, now), timers: [], now })).toEqual([]);
  });

  it("rings when the boil time is up, with a key that stays the same", () => {
    const log: BrewDayLogEntry[] = ["h-simcoe-60", "h-citra-15"].map((id) => ({
      type: "ingredient_added",
      stage: "boil",
      occurredAt: boilStart + MIN,
      data: { ingredientKind: "hop", ingredientId: id, name: id, amount: 1, unit: "g" },
      measurement: null,
    }));
    const at = (minutes: number) => {
      const now = boilStart + minutes * MIN;
      return dueAlarms({ state: boilState(log, now), timers: [], now });
    };
    expect(at(59.9)).toEqual([]);
    const [first] = at(60);
    const [later] = at(65);
    expect(first).toMatchObject({ kind: "stage", title: "Kok: tiden er ute", at: boilStart + 60 * MIN });
    expect(later?.key).toBe(first?.key);
  });

  it("rings for timers that have run out", () => {
    const timers: BrewTimer[] = [
      { id: "t1", label: "Whirlpool-hvile", startedAt: boilStart, durationMin: 20, dueAt: boilStart + 20 * MIN },
      { id: "t2", label: "Kjøling", startedAt: boilStart, durationMin: 45, dueAt: boilStart + 45 * MIN },
    ];
    const now = boilStart + 30 * MIN;
    const state = deriveBrewDayState({ recipe, stage: "cooling", stageStartedAt: boilStart, log: [], now });
    expect(dueAlarms({ state, timers, now })).toEqual([
      { key: "timer:t1", kind: "timer", at: boilStart + 20 * MIN, title: "Whirlpool-hvile er ferdig", detail: null, timerId: "t1" },
    ]);
  });
});

describe("activeTimers", () => {
  it("reads running timers from the log and leaves out cancelled ones", () => {
    const log: BrewDayLogEntry[] = [
      timerEvent("a", "Humle", 15, boilStart),
      timerEvent("b", "Whirlpool", 20, boilStart + 5 * MIN),
      { id: "c", type: "timer_cancelled", stage: "boil", occurredAt: boilStart + 6 * MIN, data: { timerId: "a" }, measurement: null },
    ];
    expect(activeTimers(log)).toEqual([{ id: "b", label: "Whirlpool", startedAt: boilStart + 5 * MIN, durationMin: 20, dueAt: boilStart + 25 * MIN }]);
  });

  it("ignores timer events with malformed data", () => {
    const log: BrewDayLogEntry[] = [{ id: "x", type: "timer_started", stage: "boil", occurredAt: boilStart, data: { label: "Uten tid" }, measurement: null }];
    expect(activeTimers(log)).toEqual([]);
  });
});
