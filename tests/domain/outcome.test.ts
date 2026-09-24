import { describe, expect, it } from "vitest";
import { calculateEfficiency } from "../../src/domain/brewing-calculations/index.ts";
import { brewhouseNumbers, resultNumbers } from "../../src/domain/brew-day/outcome.ts";
import type { BrewDayLogEntry } from "../../src/domain/brew-day/state.ts";
import { sunsetIpaBrewLog, sunsetIpaRecipe, sunsetIpaSplits } from "../../src/domain/fixtures/sunset-ipa.ts";

const splits = sunsetIpaSplits.map((s) => ({ id: `split-${s.key}` }));
const sunsetLog: BrewDayLogEntry[] = sunsetIpaBrewLog.map((e) => ({
  type: e.type,
  stage: e.stage,
  splitId: e.split ? `split-${e.split}` : null,
  occurredAt: Date.parse(e.at),
  data: e.ingredient ? { ...e.ingredient } : null,
  measurement: e.measurement ? { kind: e.measurement.kind, value: e.measurement.value } : null,
}));

describe("brewhouseNumbers", () => {
  it("measures the Sunset IPA brew day from its own readings", () => {
    const numbers = brewhouseNumbers({ recipe: sunsetIpaRecipe, log: sunsetLog, splits });
    expect(numbers).toMatchObject({ preBoilVolumeL: 75.7, postBoilVolumeL: 62.5, fermenterVolumeL: 60, og: { sg: 1.061, source: "brix" }, missing: [] });
    // (75.7 − 62.5) L over the planned 60 min boil
    expect(numbers.boilOffLPerHour).toBeCloseTo(13.2, 6);
    // 38 L + 22 L at 1.061 from the 19.82 kg grain bill; the recipe's 60 % was back-calculated from the same numbers.
    expect(numbers.efficiencyPct).toBeCloseTo(calculateEfficiency({ fermentables: sunsetIpaRecipe.fermentables, sg: 1.061, volumeL: 60 }), 6);
    expect(numbers.efficiencyPct).toBeGreaterThan(58);
    expect(numbers.efficiencyPct).toBeLessThan(62);
  });

  it("says what is missing instead of guessing", () => {
    expect(brewhouseNumbers({ recipe: sunsetIpaRecipe, log: [], splits })).toEqual({
      preBoilVolumeL: null,
      postBoilVolumeL: null,
      fermenterVolumeL: null,
      og: null,
      boilOffLPerHour: null,
      efficiencyPct: null,
      missing: ["volum før kok", "volum etter kok", "volum til gjæring", "OG"],
    });
  });

  it("does not add up fermenter volume when one variant has no reading", () => {
    const log = sunsetLog.filter((e) => !(e.splitId === "split-pine" && e.measurement?.kind === "volume"));
    const numbers = brewhouseNumbers({ recipe: sunsetIpaRecipe, log, splits });
    expect(numbers.fermenterVolumeL).toBeNull();
    expect(numbers.efficiencyPct).toBeNull();
    expect(numbers.missing).toEqual(["volum til gjæring"]);
  });
});

describe("resultNumbers", () => {
  it("computes ABV and apparent attenuation from OG and FG", () => {
    const numbers = resultNumbers(1.061, 1.012);
    expect(numbers.abvPct).toBeCloseTo(6.43, 2); // (1.061 − 1.012) × 131.25
    expect(numbers.attenuationPct).toBeCloseTo(80.33, 2);
  });

  it("has nothing to say without both gravities, or with an FG at or above the OG", () => {
    expect(resultNumbers(1.061, null)).toEqual({ abvPct: null, attenuationPct: null });
    expect(resultNumbers(null, 1.012)).toEqual({ abvPct: null, attenuationPct: null });
    expect(resultNumbers(1.05, 1.05)).toEqual({ abvPct: null, attenuationPct: null });
  });
});
