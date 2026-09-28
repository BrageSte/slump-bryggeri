import { describe, expect, it } from "vitest";
import {
  calculateBoilOff,
  calculateGravityEstimate,
  calculateMashTemperatureAdjustment,
  calculateObservedBoilOff,
  calculateRecipeMetrics,
  calculateRecipeScaling,
  calculateStrikeTemperature,
  calculateTemperatureOffset,
  calculateWaterVolumes,
  summarizeCalibrationObservations,
} from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";

describe("strike temperature", () => {
  it("reproduces the spec example: 67 °C target, 19 °C grain, +2.6 °C system → 74.6 °C", () => {
    const result = calculateStrikeTemperature({
      targetMashTempC: 67,
      grainTempC: 19,
      mashThicknessLPerKg: 3.936,
      systemOffsetC: 2.6,
    });
    expect(result.baseStrikeTempC).toBeCloseTo(72.0, 1);
    expect(result.strikeTempC).toBeCloseTo(74.6, 1);
  });

  it("follows Palmer's formula", () => {
    const result = calculateStrikeTemperature({ targetMashTempC: 67, grainTempC: 19, mashThicknessLPerKg: 3 });
    expect(result.strikeTempC).toBeCloseTo(73.56, 2);
  });
});

describe("volumes", () => {
  it("computes boil-off (Sunset IPA: 75.7 L → 62.5 L in 60 min ≈ 13.2 L/h)", () => {
    const result = calculateBoilOff({ preBoilVolumeL: 75.7, boilOffLPerH: 13.2, boilTimeMin: 60 });
    expect(result.postBoilVolumeL).toBeCloseTo(62.5, 1);
  });

  it("reproduces the Sunset IPA volumes from 60 L into the fermenters", () => {
    const result = calculateWaterVolumes({
      batchVolumeL: 60,
      grainKg: 19.82,
      boilTimeMin: 60,
      boilOffLPerH: 13.2,
      grainAbsorptionLPerKg: 0.8,
      mashThicknessLPerKg: 3,
      coolingShrinkagePct: 4,
    });
    expect(result.postBoilVolumeL).toBeCloseTo(62.5, 1);
    expect(result.preBoilVolumeL).toBeCloseTo(75.7, 1);
    expect(result.totalWaterL).toBeCloseTo(91.56, 1);
    expect(result.mashWaterL + result.spargeWaterL).toBeCloseTo(result.totalWaterL, 6);
  });
});

describe("calibration suggestions", () => {
  it("reproduces the spec example (−2.6, −2.4, −2.7 vs current −3.0)", () => {
    const observations = [
      calculateTemperatureOffset({ fromC: 72.0, toC: 69.4 }),
      calculateTemperatureOffset({ fromC: 71.5, toC: 69.1 }),
      calculateTemperatureOffset({ fromC: 72.0, toC: 69.3 }),
    ];
    const summary = summarizeCalibrationObservations(observations, { current: -3.0 });
    expect(summary?.mean).toBeCloseTo(-2.567, 3);
    expect(summary?.suggested).toBe(-2.6);
    expect(summary?.changeFromCurrent).toBe(0.4);
  });

  it("does not suggest anything from too few observations", () => {
    expect(summarizeCalibrationObservations([-2.6, -2.4])?.suggested).toBeNull();
    expect(summarizeCalibrationObservations([])).toBeNull();
  });
});

describe("recipe scaling", () => {
  it("scales Sunset IPA from 60 L to 72 L at the same efficiency", () => {
    const { recipe, volumeFactor } = calculateRecipeScaling(sunsetIpaRecipe, { batchSizeL: 72 });
    expect(volumeFactor).toBeCloseTo(1.2, 6);
    expect(recipe.fermentables[0]?.amountKg).toBeCloseTo(17.76, 3);
    expect(recipe.hops[0]?.amountG).toBe(78);
    // Whole packages round up: 2 → 2.4 → 3, 1 → 1.2 → 2
    expect(recipe.cultures.map((c) => c.amount)).toEqual([3, 2]);
    expect(recipe.hops.map((h) => h.id)).toEqual(sunsetIpaRecipe.hops.map((h) => h.id));
  });

  it("corrects mashed fermentables for a different brewhouse efficiency and preserves OG", () => {
    const { recipe, mashedFactor } = calculateRecipeScaling(sunsetIpaRecipe, { batchSizeL: 72, efficiencyPct: 75 });
    expect(mashedFactor).toBeCloseTo(0.96, 6);
    const og = (r: typeof recipe) =>
      calculateGravityEstimate({ fermentables: r.fermentables, volumeL: r.batchSizeL, efficiencyPct: r.efficiencyPct });
    expect(og(recipe)).toBeCloseTo(og(sunsetIpaRecipe), 3);
  });

  it("does not mutate the source recipe", () => {
    const before = JSON.stringify(sunsetIpaRecipe);
    calculateRecipeScaling(sunsetIpaRecipe, { batchSizeL: 20 });
    expect(JSON.stringify(sunsetIpaRecipe)).toBe(before);
  });
});

describe("recipe metrics", () => {
  it("estimates the Sunset IPA numbers recorded in the log", () => {
    const metrics = calculateRecipeMetrics(sunsetIpaRecipe);
    expect(metrics.og).toBeCloseTo(1.061, 3);
    expect(metrics.abvPct).toBeCloseTo(6.0, 1);
    expect(metrics.totalFermentablesKg).toBeCloseTo(19.82, 6);
    expect(metrics.totalHopsG).toBeCloseTo(283.5 + 220 + 147, 6);
    expect(metrics.hopsMissingAlpha).toHaveLength(0);
  });
});

describe("mash temperature adjustment", () => {
  it("reproduces BeerSmith Mash Adjust: 18.93 L, 4.54 kg, 65.6 → 67.8 °C with 100 °C water ≈ 1.41 L", () => {
    const result = calculateMashTemperatureAdjustment({
      mashWaterL: 18.93,
      grainKg: 4.54,
      currentTempC: 65.6,
      targetTempC: 67.8,
      additionTempC: 100,
    });
    // BeerSmith rounds to 1.41 L; the heat balance gives 1.417 L.
    expect(result?.additionL).toBeCloseTo(1.41, 1);
    expect(Math.abs((result?.additionL ?? 0) - 1.41)).toBeLessThan(0.02);
  });

  it("includes the mash tun when its mass and specific heat are known", () => {
    const bare = calculateMashTemperatureAdjustment({ mashWaterL: 37.3, grainKg: 14.3, currentTempC: 63, targetTempC: 64.4, additionTempC: 95 });
    const withTun = calculateMashTemperatureAdjustment({
      mashWaterL: 37.3,
      grainKg: 14.3,
      currentTempC: 63,
      targetTempC: 64.4,
      additionTempC: 95,
      tunMassKg: 10,
      tunSpecificHeat: 0.15,
    });
    expect(withTun!.additionL).toBeGreaterThan(bare!.additionL);
  });

  it("cools with cold water and refuses impossible additions", () => {
    const cool = calculateMashTemperatureAdjustment({ mashWaterL: 20, grainKg: 5, currentTempC: 70, targetTempC: 67, additionTempC: 10 });
    expect(cool?.additionL).toBeGreaterThan(0);
    expect(calculateMashTemperatureAdjustment({ mashWaterL: 20, grainKg: 5, currentTempC: 65, targetTempC: 67, additionTempC: 60 })).toBeNull();
  });
});

describe("observed boil-off", () => {
  it("inverts calculateBoilOff (Sunset IPA: 75.7 L → 62.5 L in 60 min = 13.2 L/h)", () => {
    expect(calculateObservedBoilOff({ preBoilVolumeL: 75.7, postBoilVolumeL: 62.5, boilTimeMin: 60 })).toBeCloseTo(13.2, 6);
    expect(calculateObservedBoilOff({ preBoilVolumeL: 102.5, postBoilVolumeL: 95, boilTimeMin: 90 })).toBeCloseTo(5, 6);
  });
});
