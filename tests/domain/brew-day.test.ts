import { describe, expect, it } from "vitest";
import { deriveBrewDayState, followingStage, type BrewDayLogEntry } from "../../src/domain/brew-day/state.ts";
import { sunsetIpaBrewLog, sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { commonPhStripIntervals, type BrewStage } from "../../src/domain/model/brewing.ts";

const MIN = 60_000;
const DAY = 86_400_000;
const t0 = Date.parse("2026-09-23T10:00:00+02:00");

function entry(partial: Partial<BrewDayLogEntry> & { occurredAt: number; stage: BrewStage }): BrewDayLogEntry {
  return { type: "measurement", data: null, measurement: null, ...partial };
}

const sunsetLog: BrewDayLogEntry[] = sunsetIpaBrewLog.map((e) => ({
  type: e.type,
  stage: e.stage,
  occurredAt: Date.parse(e.at),
  data: e.ingredient ? { ...e.ingredient } : null,
  measurement: e.measurement ? { kind: e.measurement.kind, value: e.measurement.value } : null,
}));

describe("deriveBrewDayState", () => {
  it("asks to start mashing for a planned batch", () => {
    const state = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: null, stageStartedAt: null, log: [], now: t0 });
    expect(state.nextAction).toEqual({ kind: "start_stage", stage: "mash", label: "Start mesking" });
  });

  it("shows the mash rest countdown, target vs measured and the transfer as next step (wireframe 35)", () => {
    const state = deriveBrewDayState({
      recipe: sunsetIpaRecipe,
      stage: "mash",
      stageStartedAt: t0,
      log: [entry({ stage: "mash", occurredAt: t0 + 11 * MIN, measurement: { kind: "temperature", value: 66.8 } })],
      now: t0 + 28 * MIN,
    });
    expect(state.step?.remainingMin).toBeCloseTo(32, 6);
    const temp = state.targets.find((t) => t.key === "mash-temp");
    expect(temp?.target).toEqual({ kind: "value", value: 66.5 });
    expect(temp?.actual?.value).toBe(66.8);
    expect(temp?.status).toBe("ok");
    const ph = state.targets.find((t) => t.key === "mash-ph");
    expect(ph?.target).toEqual({ kind: "range", min: 5.2, max: 5.4 });
    expect(ph?.status).toBe("missing");
    expect(state.nextAction).toMatchObject({ kind: "start_stage", stage: "lauter", label: "Start overføring" });
  });

  it("flags readings outside the target", () => {
    const state = deriveBrewDayState({
      recipe: sunsetIpaRecipe,
      stage: "mash",
      stageStartedAt: t0,
      log: [entry({ stage: "mash", occurredAt: t0 + MIN, measurement: { kind: "ph", value: 5.9 } })],
      now: t0 + 5 * MIN,
    });
    expect(state.targets.find((t) => t.key === "mash-ph")?.status).toBe("high");
  });

  it("classifies pH-strip intervals against the target", () => {
    const stateFor = (valueMin: number, valueMax: number) =>
      deriveBrewDayState({
        recipe: sunsetIpaRecipe,
        stage: "mash",
        stageStartedAt: t0,
        log: [entry({ stage: "mash", occurredAt: t0 + MIN, measurement: { kind: "ph", value: (valueMin + valueMax) / 2, valueMin, valueMax } })],
        now: t0 + 5 * MIN,
      }).targets.find((target) => target.key === "mash-ph")?.status;

    expect(stateFor(5.25, 5.35)).toBe("ok");
    expect(stateFor(5.3, 5.5)).toBe("uncertain");
    expect(stateFor(5.6, 5.8)).toBe("high");
    expect(stateFor(4.8, 5.1)).toBe("low");
  });

  it("offers pH-strip intervals from 5.0–5.2 through 6.0–6.2", () => {
    expect(commonPhStripIntervals).toHaveLength(11);
    expect(commonPhStripIntervals[0]).toEqual({ min: 5, max: 5.2 });
    expect(commonPhStripIntervals.at(-1)).toEqual({ min: 6, max: 6.2 });
  });

  it("ignores readings from an earlier run of the same stage", () => {
    const state = deriveBrewDayState({
      recipe: sunsetIpaRecipe,
      stage: "mash",
      stageStartedAt: t0 + 10 * MIN,
      log: [entry({ stage: "mash", occurredAt: t0, measurement: { kind: "temperature", value: 60 } })],
      now: t0 + 20 * MIN,
    });
    expect(state.targets.find((t) => t.key === "mash-temp")?.status).toBe("missing");
  });

  it("prompts the 60 min hop addition at the start of the boil", () => {
    const boilStart = t0 + 120 * MIN;
    const state = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "boil", stageStartedAt: boilStart, log: [], now: boilStart });
    expect(state.additions).toHaveLength(1);
    expect(state.additions[0]).toMatchObject({ ingredientId: "h-simcoe-60", status: "due", amount: 65 });
    expect(state.nextAction).toMatchObject({ kind: "add_ingredient", inMin: 0 });
    expect(state.step).toMatchObject({ totalMin: 60, remainingMin: 60 });
  });

  it("counts down to upcoming boil additions", () => {
    const recipe = {
      ...sunsetIpaRecipe,
      hops: [...sunsetIpaRecipe.hops, { id: "late", name: "Citra", amountG: 25, alphaPct: 13, use: "boil" as const, timeMin: 10 }],
    };
    const boilStart = t0;
    const state = deriveBrewDayState({
      recipe,
      stage: "boil",
      stageStartedAt: boilStart,
      log: [entry({ type: "ingredient_added", stage: "boil", occurredAt: boilStart, data: { ingredientId: "h-simcoe-60" } })],
      now: boilStart + 30 * MIN,
    });
    expect(state.additions.map((a) => a.status)).toEqual(["done", "upcoming"]);
    expect(state.nextAction).toMatchObject({ kind: "add_ingredient", inMin: 20, addition: { ingredientId: "late" } });
  });

  it("moves on to the whirlpool once boil additions are logged, and skips it when unused", () => {
    const log = [entry({ type: "ingredient_added", stage: "boil", occurredAt: t0, data: { ingredientId: "h-simcoe-60" } })];
    const state = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "boil", stageStartedAt: t0, log, now: t0 + 61 * MIN });
    expect(state.nextAction).toMatchObject({ kind: "start_stage", stage: "whirlpool" });

    const noWhirlpool = { ...sunsetIpaRecipe, hops: sunsetIpaRecipe.hops.filter((h) => h.use !== "whirlpool") };
    expect(followingStage(noWhirlpool, "boil")).toBe("cooling");
    expect(followingStage(sunsetIpaRecipe, "boil")).toBe("whirlpool");
  });

  it("flags the 82 °C whirlpool against the 80 °C plan", () => {
    const start = Date.parse("2026-09-23T13:05:00+02:00");
    const state = deriveBrewDayState({
      recipe: sunsetIpaRecipe,
      stage: "whirlpool",
      stageStartedAt: start,
      log: sunsetLog,
      now: start + 10 * MIN,
    });
    expect(state.targets.find((t) => t.key === "whirlpool-temp")).toMatchObject({ status: "high", actual: { value: 82 } });
    expect(state.additions.every((a) => a.status === "done")).toBe(true);
    expect(state.step?.remainingMin).toBeCloseTo(10, 6);
  });

  it("derives OG from the post-boil Brix reading during cooling", () => {
    const start = Date.parse("2026-09-23T13:25:00+02:00");
    const log = sunsetLog.filter((e) => e.occurredAt <= start);
    const state = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "cooling", stageStartedAt: start, log, now: start + 5 * MIN });
    const og = state.targets.find((t) => t.key === "og");
    expect(og?.actual).toMatchObject({ value: 1.061, derivedFrom: "brix" });
    expect(og?.status).toBe("ok");
    expect(state.nextAction).toMatchObject({ kind: "start_stage", stage: "fermentation", label: "Gjær tilsatt" });
  });

  it("offers to start fermentation once every planned yeast is registered", () => {
    const start = Date.parse("2026-09-23T13:25:00+02:00");
    const pitched = sunsetIpaRecipe.cultures.map((culture) => ({
      type: "yeast_pitched",
      stage: "cooling" as const,
      occurredAt: start + MIN,
      data: { ingredientId: culture.id },
      measurement: null,
    }));
    const log = [...sunsetLog.filter((e) => e.occurredAt <= start), ...pitched];
    const state = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "cooling", stageStartedAt: start, log, now: start + 5 * MIN });
    expect(state.nextAction).toMatchObject({ kind: "start_stage", stage: "fermentation", label: "Start gjæring" });
  });

  it("asks for a gravity reading on fermentation day 0 after replaying the whole log", () => {
    const pitch = Date.parse("2026-09-23T14:30:00+02:00");
    const state = deriveBrewDayState({
      recipe: sunsetIpaRecipe,
      stage: "fermentation",
      stageStartedAt: pitch,
      log: sunsetLog,
      now: pitch + 3 * 60 * MIN,
    });
    expect(state.fermentationDay).toBe(0);
    expect(state.step?.label).toBe("Dag 0");
    expect(state.targets.find((t) => t.key === "ferm-temp")?.target).toEqual({ kind: "value", value: 18 });
    expect(state.nextAction).toEqual({ kind: "log_measurement", measurementKind: "sg", label: "Mål SG" });
  });

  it("prompts the dry hop on day 4 and uses the alcohol-corrected refractometer reading", () => {
    const pitch = Date.parse("2026-09-23T14:30:00+02:00");
    const now = pitch + 4 * DAY + 60 * MIN;
    const log = [
      ...sunsetLog,
      entry({ stage: "fermentation", occurredAt: now - 30 * MIN, measurement: { kind: "brix", value: 9.5 } }),
    ];
    const state = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "fermentation", stageStartedAt: pitch, log, now });
    expect(state.fermentationDay).toBe(4);
    expect(state.step?.label).toBe("Dag 3–5");
    expect(state.additions.filter((a) => a.status === "due")).toHaveLength(5);
    expect(state.nextAction).toMatchObject({ kind: "add_ingredient", addition: { variant: "Tropical" } });
    const fg = state.targets.find((t) => t.key === "fg");
    expect(fg?.actual?.derivedFrom).toBe("brix");
    // 15.0 → 9.5 °Bx corrected ≈ 1.021 (Terrill), inside the 1.020–1.025 dry-hop window in the plan
    expect(fg?.actual?.value).toBeGreaterThan(1.019);
    expect(fg?.actual?.value).toBeLessThan(1.025);
  });

  it("offers to finish the batch in the packaging stage and nothing once completed", () => {
    const packaging = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "packaging", stageStartedAt: t0, log: [], now: t0 });
    expect(packaging.nextAction).toEqual({ kind: "complete", label: "Avslutt batch" });
    const done = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "packaging", stageStartedAt: t0, log: [], now: t0, completed: true });
    expect(done.nextAction).toBeNull();
  });
});
