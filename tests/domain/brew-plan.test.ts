import { describe, expect, it } from "vitest";
import { brewPlanPhaseStatus, buildBrewPlan, registeredIngredientIds } from "../../src/domain/brew-day/brew-plan.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { emptyRecipe } from "../../src/domain/model/recipe.ts";

const phase = (plan: ReturnType<typeof buildBrewPlan>, key: string) => plan.phases.find((p) => p.key === key);

describe("brew plan overview", () => {
  it("shows every phase of the Sunset IPA at once", () => {
    const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: {} });
    expect(plan.phases.map((p) => p.key)).toEqual(["water", "mash", "lauter", "boil", "whirlpool", "cooling", "fermentation"]);
    expect(plan.summary).toMatchObject({ mashTemperatureC: 66.5, mashDurationMin: 60, spargeTemperatureC: { value: 77.5, source: "recipe" }, boilTimeMin: 60, pitchTemperatureC: 18 });
    expect(plan.summary.grainKg).toBeCloseTo(19.82, 2);
    expect(phase(plan, "boil")?.items[1]).toMatchObject({ title: "Simcoe T90", timing: "60 min", amount: { value: 65, unit: "g" } });
    expect(phase(plan, "whirlpool")?.items[0]).toMatchObject({ title: "Citra T90", temperatureC: { value: 80, source: "recipe" }, durationMin: 20 });
    expect(phase(plan, "fermentation")?.items.some((item) => item.timing === "Dag 4" && item.variant === "Tropical")).toBe(true);
    expect(phase(plan, "cooling")?.items.filter((item) => item.addition?.eventType === "yeast_pitched")).toHaveLength(2);
  });

  it("uses documented assumptions when profile values are missing", () => {
    const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: {} });
    expect(plan.summary.strikeTemperatureC?.source).toBe("assumed");
    expect(plan.summary.strikeTemperatureC?.value).toBeCloseTo(73.13, 2);
    expect(plan.summary.strikeVolumeL?.source).toBe("assumed");
    expect(plan.summary.strikeVolumeL?.value).toBeCloseTo(59.46, 2);
    expect(plan.summary.spargeVolumeL?.source).toBe("assumed");
    expect(plan.summary.preBoilVolumeL).toMatchObject({ source: "assumed" });
    expect(plan.summary.assumptions.map((assumption) => assumption.key)).toEqual(expect.arrayContaining([
      "boil_off_l_per_h",
      "grain_absorption_l_per_kg",
      "mash_thickness_l_per_kg",
      "cooling_shrinkage_pct",
      "mash_dead_space_l",
    ]));
    expect(plan.summary.assumptions.find((assumption) => assumption.key === "boil_off_l_per_h")).toMatchObject({
      value: 5,
      measureToReplace: "Mål volum før og etter kok, så regnes fordampningen ut.",
    });
  });

  it("uses a calibrated profile without changing the water calculation", () => {
    const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: { boil_off_l_per_h: 13.2, mash_thickness_l_per_kg: 3 } });
    expect(plan.summary.strikeVolumeL).toMatchObject({ source: "assumed" });
    expect(plan.summary.strikeVolumeL?.value).toBeCloseTo(59.46, 2);
    expect(phase(plan, "water")?.items.map((item) => item.id)).toEqual(["water:strike", "water:sparge", "water:total"]);

    const calibrated = buildBrewPlan({
      recipe: sunsetIpaRecipe,
      equipment: {
        boil_off_l_per_h: 13.2,
        grain_absorption_l_per_kg: 0.8,
        mash_thickness_l_per_kg: 3,
        mash_dead_space_l: 0,
        pump_pipe_loss_l: 0,
        kettle_loss_l: 0,
        chiller_loss_l: 0,
        transfer_loss_l: 0,
        cooling_shrinkage_pct: 4,
        grain_temperature_c: 18,
        strike_temp_offset_c: 0,
      },
    });
    expect(calibrated.summary).toMatchObject({ waterVolumesUseAssumptions: false, assumptions: [] });
    expect(calibrated.summary.strikeVolumeL).toMatchObject({ value: 59.46, source: "calculated" });
    expect(calibrated.summary.spargeVolumeL?.value).toBeCloseTo(plan.summary.spargeVolumeL!.value, 6);
    expect(calibrated.summary.preBoilVolumeL?.value).toBeCloseTo(75.7, 1);
    expect(calibrated.summary.preBoilSg?.value).toBeCloseTo(1.048, 3);
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

  it("keeps stored default values assumed and explicitly calibrated values calculated", () => {
    const values = {
      boil_off_l_per_h: 5,
      grain_absorption_l_per_kg: 0.8,
      mash_thickness_l_per_kg: 3,
      mash_dead_space_l: 0,
      pump_pipe_loss_l: 0,
      kettle_loss_l: 0,
      chiller_loss_l: 0,
      transfer_loss_l: 0,
      cooling_shrinkage_pct: 4,
      grain_temperature_c: 18,
      strike_temp_offset_c: 0,
    };
    const keys = Object.keys(values) as (keyof typeof values)[];
    const defaultSources = Object.fromEntries(keys.map((key) => [key, "default"])) as Record<keyof typeof values, "default">;
    const calibratedSources = Object.fromEntries(keys.map((key) => [key, "calibration"])) as Record<keyof typeof values, "calibration">;
    const standard = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: values, equipmentSources: defaultSources });
    const calibrated = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: values, equipmentSources: calibratedSources });

    expect(standard.summary.strikeVolumeL?.source).toBe("assumed");
    expect(standard.summary.assumptions.map((assumption) => assumption.key)).toContain("boil_off_l_per_h");
    expect(calibrated.summary.strikeVolumeL?.source).toBe("calculated");
    expect(calibrated.summary.assumptions).toEqual([]);
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
