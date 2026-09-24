import { describe, expect, it } from "vitest";
import { plannedStepsForStage } from "../../src/domain/brew-day/planned-steps.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { emptyRecipe } from "../../src/domain/model/recipe.ts";

describe("planned brew-day steps", () => {
  it("builds stage plans from the recipe snapshot", () => {
    expect(plannedStepsForStage(sunsetIpaRecipe, "mash")).toMatchObject([
      { title: "Mesk", targetC: 66.5, durationMin: 60, action: "measure_temperature" },
    ]);
    expect(plannedStepsForStage(sunsetIpaRecipe, "lauter")).toMatchObject([
      { title: "Skyllevann", targetC: 77.5, action: "measure_temperature" },
    ]);
    expect(plannedStepsForStage(sunsetIpaRecipe, "boil")).toMatchObject([
      { title: "Kok", durationMin: 60, action: "start_boil" },
      { title: "Simcoe T90", amount: { value: 65, unit: "g" }, offsetMin: 60, action: "add_ingredient" },
    ]);
    expect(plannedStepsForStage(sunsetIpaRecipe, "whirlpool")[0]).toMatchObject({ title: "Citra T90", targetC: 80, durationMin: 20 });
    expect(plannedStepsForStage(sunsetIpaRecipe, "fermentation").some((step) => step.fermentationDay === 4)).toBe(true);
  });

  it("returns no made-up steps when the snapshot has no plan", () => {
    const recipe = emptyRecipe({ boilTimeMin: 0 });
    expect(plannedStepsForStage(recipe, "mash")).toEqual([]);
    expect(plannedStepsForStage(recipe, "lauter")).toEqual([]);
    expect(plannedStepsForStage(recipe, "boil")).toEqual([]);
    expect(plannedStepsForStage(recipe, "whirlpool")).toEqual([]);
    expect(plannedStepsForStage(recipe, "fermentation")).toEqual([]);
  });
});
