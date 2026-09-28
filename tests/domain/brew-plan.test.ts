import { describe, expect, it } from "vitest";
import { brewPlanPhaseStatus, buildBrewPlan, registeredIngredientIds } from "../../src/domain/brew-day/brew-plan.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { emptyRecipe } from "../../src/domain/model/recipe.ts";

const phase = (plan: ReturnType<typeof buildBrewPlan>, key: string) => plan.phases.find((p) => p.key === key);

describe("brew plan overview", () => {
  it("shows every phase of the Sunset IPA at once", () => {
    const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: {} });
    expect(plan.phases.map((p) => p.key)).toEqual(["water", "mash", "lauter", "boil", "whirlpool", "cooling", "fermentation"]);
    expect(plan.summary).toMatchObject({ mashTemperatureC: 66.5, mashDurationMin: 60, spargeTemperatureC: 77.5, boilTimeMin: 60, pitchTemperatureC: 18 });
    expect(plan.summary.grainKg).toBeCloseTo(19.82, 2);
    expect(phase(plan, "boil")?.items[1]).toMatchObject({ title: "Simcoe T90", timing: "60 min", amount: { value: 65, unit: "g" } });
    expect(phase(plan, "whirlpool")?.items[0]).toMatchObject({ title: "Citra T90", temperatureC: { value: 80, source: "recipe" }, durationMin: 20 });
    expect(phase(plan, "fermentation")?.items.some((item) => item.timing === "Dag 4" && item.variant === "Tropical")).toBe(true);
    expect(phase(plan, "cooling")?.items.filter((item) => item.addition?.eventType === "yeast_pitched")).toHaveLength(2);
  });

  it("marks strike temperature as calculated (Palmer: 66.5 °C, 18 °C grain, 3 L/kg → 73.13 °C) and flags missing boil-off", () => {
    const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: {} });
    expect(plan.summary.strikeTemperatureC?.source).toBe("calculated");
    expect(plan.summary.strikeTemperatureC?.value).toBeCloseTo(73.13, 2);
    expect(plan.summary.strikeVolumeL).toBeUndefined();
    expect(plan.summary.waterVolumesNeedBoilOff).toBe(true);
  });

  it("calculates water volumes from the equipment snapshot when boil-off is known", () => {
    const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: { boil_off_l_per_h: 13.2, mash_thickness_l_per_kg: 3 } });
    expect(plan.summary.waterVolumesNeedBoilOff).toBe(false);
    expect(plan.summary.strikeVolumeL).toMatchObject({ source: "calculated" });
    expect(plan.summary.strikeVolumeL?.value).toBeCloseTo(59.46, 2);
    expect(plan.summary.spargeVolumeL?.source).toBe("calculated");
    expect(phase(plan, "water")?.items.map((item) => item.id)).toEqual(["water:strike", "water:sparge", "water:total"]);
  });

  it("prefers the recipe's own strike water over the calculation", () => {
    const recipe = {
      ...sunsetIpaRecipe,
      mashSteps: [{ id: "m", name: "Mesk", temperatureC: 67.8, durationMin: 60, infusionL: 18.93, infusionTemperatureC: 74.2 }],
    };
    const plan = buildBrewPlan({ recipe, equipment: { boil_off_l_per_h: 5 } });
    expect(plan.summary.strikeVolumeL).toEqual({ value: 18.93, source: "recipe" });
    expect(plan.summary.strikeTemperatureC).toEqual({ value: 74.2, source: "recipe" });
  });

  it("marks registered additions as done", () => {
    const done = registeredIngredientIds([
      { type: "ingredient_added", data: { ingredientId: "h-simcoe-60" } },
      { type: "yeast_pitched", data: { ingredientId: "y-pine" } },
      { type: "comment", data: { ingredientId: "h-dry-t-citra" } },
    ]);
    const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: {}, doneIngredientIds: done });
    expect(phase(plan, "boil")?.items.find((item) => item.id === "hop:h-simcoe-60")?.done).toBe(true);
    expect(phase(plan, "cooling")?.items.find((item) => item.id === "culture:y-pine")?.done).toBe(true);
    expect(phase(plan, "fermentation")?.items.find((item) => item.id === "hop:h-dry-t-citra")?.done).toBe(false);
  });

  it("returns no made-up phases when the snapshot has no plan", () => {
    expect(buildBrewPlan({ recipe: emptyRecipe({ boilTimeMin: 0 }), equipment: {} }).phases).toEqual([]);
  });

  it("places phases relative to the current stage", () => {
    const water = { key: "water", stages: [] } as const;
    const fermentation = { key: "fermentation", stages: ["fermentation", "conditioning"] } as const;
    expect(brewPlanPhaseStatus(water, null)).toBe("current");
    expect(brewPlanPhaseStatus(water, "lauter")).toBe("current");
    expect(brewPlanPhaseStatus(water, "boil")).toBe("done");
    expect(brewPlanPhaseStatus(fermentation, "boil")).toBe("upcoming");
    expect(brewPlanPhaseStatus(fermentation, "conditioning")).toBe("current");
    expect(brewPlanPhaseStatus(fermentation, "packaging")).toBe("done");
  });
});
