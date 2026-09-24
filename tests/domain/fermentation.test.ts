import { describe, expect, it } from "vitest";
import {
  apparentAttenuationSoFar,
  buildFermentationSeries,
  fermentationDayOf,
  plannedFermentationTemperature,
} from "../../src/domain/brew-day/fermentation.ts";
import type { BrewDayLogEntry } from "../../src/domain/brew-day/state.ts";
import { sunsetIpaBrewLog, sunsetIpaRecipe, sunsetIpaSplits } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BrewStage, MeasurementKind } from "../../src/domain/model/brewing.ts";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const splits = sunsetIpaSplits.map((s) => ({ id: `split-${s.key}`, name: s.name }));
const splitId = (key: string | undefined) => (key ? `split-${key}` : null);

const sunsetLog: BrewDayLogEntry[] = sunsetIpaBrewLog.map((e) => ({
  type: e.type,
  stage: e.stage,
  splitId: splitId(e.split),
  occurredAt: Date.parse(e.at),
  data: e.ingredient ? { ...e.ingredient } : null,
  measurement: e.measurement ? { kind: e.measurement.kind, value: e.measurement.value } : null,
}));
const pitchTropical = Date.parse("2026-09-23T14:30:00+02:00");
const pitchPine = Date.parse("2026-09-23T14:31:00+02:00");

function reading(kind: MeasurementKind, value: number, at: number, split: string | null, stage: BrewStage = "fermentation"): BrewDayLogEntry {
  return { type: "measurement", stage, splitId: split, occurredAt: at, data: null, measurement: { kind, value } };
}

describe("buildFermentationSeries", () => {
  it("gives each Sunset variant the OG from the post-boil Brix and its own pitch time, with no invented readings", () => {
    const variants = buildFermentationSeries({ log: sunsetLog, splits });
    expect(variants.map((v) => v.name)).toEqual(["Sunset Tropical", "Sunset Pine"]);
    for (const variant of variants) {
      // 15.0 °Bx after the boil ≈ SG 1.061 (WCF 1.00), marked as derived from Brix.
      expect(variant.og).toMatchObject({ sg: 1.061, source: "brix" });
      expect(variant.gravity).toEqual([]);
      expect(variant.temperature).toEqual([]);
      expect(variant.pressure).toEqual([]);
    }
    expect(variants[0]?.pitchedAt).toBe(pitchTropical);
    expect(variants[1]?.pitchedAt).toBe(pitchPine);
  });

  it("keeps each fermenter's readings apart and corrects refractometer readings for alcohol", () => {
    const log = [
      ...sunsetLog,
      reading("sg", 1.03, pitchTropical + 2 * DAY, "split-tropical"),
      reading("temperature", 19.5, pitchTropical + 2 * DAY, "split-tropical"),
      reading("brix", 9.5, pitchPine + 4 * DAY, "split-pine"),
    ];
    const [tropical, pine] = buildFermentationSeries({ log, splits });

    expect(tropical?.gravity).toEqual([{ at: pitchTropical + 2 * DAY, sg: 1.03, source: "sg" }]);
    expect(tropical?.temperature).toEqual([{ at: pitchTropical + 2 * DAY, value: 19.5 }]);
    // (1.061 − 1.030) / 0.061 ≈ 50.8 %
    expect(apparentAttenuationSoFar(tropical!.og, tropical!.gravity.at(-1)!)).toBeCloseTo(50.82, 1);

    // 15.0 → 9.5 °Bx, Terrill-corrected ≈ 1.021: inside the 1.020–1.025 dry-hop window in the plan.
    expect(pine?.gravity).toHaveLength(1);
    expect(pine?.gravity[0]?.source).toBe("brix");
    expect(pine?.gravity[0]?.sg).toBeGreaterThan(1.019);
    expect(pine?.gravity[0]?.sg).toBeLessThan(1.025);
    expect(pine?.temperature).toEqual([]);
  });

  it("does not turn a fermenting Brix reading into SG without a Brix reading from before fermentation", () => {
    const log = [
      reading("sg", 1.058, pitchTropical - HOUR, null, "cooling"),
      reading("brix", 8.1, pitchTropical + 3 * DAY, null),
    ];
    const [batch] = buildFermentationSeries({ log, splits: [] });
    expect(batch).toMatchObject({ splitId: null, name: "Hele batchen", og: { sg: 1.058, source: "sg" }, gravity: [], uncorrectedBrix: 1 });
  });

  it("shows readings logged for the whole batch as their own row when the batch is split", () => {
    const log = [...sunsetLog, reading("temperature", 18.2, pitchTropical + HOUR, null)];
    const variants = buildFermentationSeries({ log, splits });
    expect(variants.map((v) => v.name)).toEqual(["Sunset Tropical", "Sunset Pine", "Hele batchen"]);
    expect(variants[2]?.temperature).toEqual([{ at: pitchTropical + HOUR, value: 18.2 }]);
    expect(variants[0]?.temperature).toEqual([]);
  });

  it("ignores gravity from before the boil when finding the OG", () => {
    const log = [reading("sg", 1.048, pitchTropical - 3 * HOUR, null, "lauter"), reading("sg", 1.062, pitchTropical - HOUR, null, "cooling")];
    expect(buildFermentationSeries({ log, splits: [] })[0]?.og?.sg).toBe(1.062);
    expect(buildFermentationSeries({ log: log.slice(0, 1), splits: [] })[0]?.og).toBeNull();
  });
});

describe("fermentation helpers", () => {
  it("counts whole days since pitching", () => {
    expect(fermentationDayOf(pitchTropical, pitchTropical + 3 * HOUR)).toBe(0);
    expect(fermentationDayOf(pitchTropical, pitchTropical + 4 * DAY + HOUR)).toBe(4);
    expect(fermentationDayOf(null, pitchTropical)).toBeNull();
  });

  it("reads the planned temperature from the fermentation plan", () => {
    expect(plannedFermentationTemperature(sunsetIpaRecipe, 0)).toEqual({ kind: "value", value: 18 });
    expect(plannedFermentationTemperature(sunsetIpaRecipe, 1)).toEqual({ kind: "range", min: 18, max: 19 });
    expect(plannedFermentationTemperature(sunsetIpaRecipe, 4)).toEqual({ kind: "range", min: 20, max: 21 });
  });

  it("has no attenuation without an OG above 1.000", () => {
    expect(apparentAttenuationSoFar(null, { at: 0, sg: 1.01, source: "sg" })).toBeNull();
    expect(apparentAttenuationSoFar({ at: 0, sg: 1.05, source: "sg" }, null)).toBeNull();
  });
});
