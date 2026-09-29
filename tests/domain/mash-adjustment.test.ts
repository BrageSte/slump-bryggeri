import { describe, expect, it } from "vitest";
import { suggestMashTemperatureAdjustment } from "../../src/domain/brew-day/mash-adjustment.ts";
import type { BrewDayLogEntry } from "../../src/domain/brew-day/state.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { RecipeDocument } from "../../src/domain/model/recipe.ts";

const startedAt = Date.parse("2026-09-29T10:00:00Z");

function recipe(overrides: Partial<RecipeDocument> = {}): RecipeDocument {
  return {
    ...sunsetIpaRecipe,
    mashSteps: [{ ...sunsetIpaRecipe.mashSteps[0]!, name: "Mesk", temperatureC: 67.8, durationMin: 60, infusionL: 18.93 }],
    fermentables: [{ ...sunsetIpaRecipe.fermentables[0]!, type: "grain", amountKg: 4.54 }],
    ...overrides,
  };
}

function logTemperature(value: number): BrewDayLogEntry[] {
  return [{
    type: "measurement",
    stage: "mash",
    occurredAt: startedAt + 60_000,
    data: null,
    measurement: { kind: "temperature", value },
  }];
}

function suggest(options: {
  recipe?: RecipeDocument;
  log?: BrewDayLogEntry[];
  equipment?: Record<string, number>;
  additionTempC?: number;
} = {}) {
  return suggestMashTemperatureAdjustment({
    recipe: options.recipe ?? recipe(),
    equipment: options.equipment ?? {},
    log: options.log ?? logTemperature(65.6),
    stage: "mash",
    stageStartedAt: startedAt,
    now: startedAt + 2 * 60_000,
    additionTempC: options.additionTempC,
  });
}

describe("suggestMashTemperatureAdjustment", () => {
  it("matches the BeerSmith Mash Adjust reference using recipe mash water", () => {
    const result = suggest({ additionTempC: 100 });

    expect(result).toMatchObject({
      direction: "raise",
      currentC: 65.6,
      targetC: 67.8,
      additionTempC: 100,
      mashWaterL: 18.93,
      mashWaterSource: "recipe",
      grainKg: 4.54,
    });
    if (!("additionL" in result)) throw new Error("Expected a mash adjustment suggestion");
    expect(Math.abs(result.additionL - 1.41)).toBeLessThanOrEqual(0.02);
  });

  it("raises with 95 °C water by default", () => {
    const result = suggest();
    expect(result).toMatchObject({ direction: "raise", additionTempC: 95 });
  });

  it("lowers with 10 °C water by default", () => {
    const lowerRecipe = recipe({ mashSteps: [{ ...recipe().mashSteps[0]!, temperatureC: 64 }] });
    const result = suggest({ recipe: lowerRecipe, log: logTemperature(66.5) });
    expect(result).toMatchObject({ direction: "lower", currentC: 66.5, targetC: 64, additionTempC: 10 });
  });

  it("uses calculated mash water when the recipe does not state an infusion volume", () => {
    const missingRecipeWater = recipe({ mashSteps: [{ ...recipe().mashSteps[0]!, infusionL: undefined }] });
    const result = suggest({ recipe: missingRecipeWater, equipment: { boil_off_l_per_h: 5 } });
    expect(result).toMatchObject({ mashWaterSource: "calculated" });
  });

  it("does not suggest an adjustment when the reading is within the state target tolerance", () => {
    expect(suggest({ log: logTemperature(67.3) })).toEqual({ reason: "reading_within_target" });
  });

  it("returns a reason when there is no mash temperature reading", () => {
    expect(suggest({ log: [] })).toEqual({ reason: "no_reading" });
  });

  it("returns a reason when neither the recipe nor brew plan knows mash water", () => {
    const missingRecipeWater = recipe({ mashSteps: [{ ...recipe().mashSteps[0]!, infusionL: undefined }] });
    expect(suggest({ recipe: missingRecipeWater })).toEqual({ reason: "no_mash_water" });
  });

  it("returns a reason when the selected water temperature cannot move the mash toward target", () => {
    expect(suggest({ additionTempC: 10 })).toEqual({ reason: "calculation_not_possible" });
  });
});

describe("suggestMashTemperatureAdjustment after water was added", () => {
  const water = (at: number, volumeL: number): BrewDayLogEntry => ({
    type: "water_added",
    stage: "mash",
    occurredAt: at,
    data: { volumeL, temperatureC: 95, reason: "mash_adjust" },
    measurement: null,
  });

  it("waits for a new reading instead of suggesting more water on a stale one", () => {
    const result = suggest({ log: [...logTemperature(65.6), water(startedAt + 90_000, 1.4)] });
    expect(result).toEqual({ reason: "awaiting_new_reading", waterAddedAt: startedAt + 90_000, waterAddedL: 1.4 });
  });

  it("counts water added before the latest reading as mash water", () => {
    const later: BrewDayLogEntry = { ...logTemperature(66.9)[0]!, occurredAt: startedAt + 120_000 };
    const result = suggest({ log: [...logTemperature(65.6), water(startedAt + 90_000, 1.4), later] });
    expect(result).toMatchObject({ direction: "raise", currentC: 66.9, mashWaterL: 18.93 + 1.4 });
  });
});
