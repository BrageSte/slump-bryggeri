import { describe, expect, it } from "vitest";
import { calculateAdaptedWaterVolumes } from "../../src/domain/brew-day/adapt-water.ts";
import { buildBrewPlan } from "../../src/domain/brew-day/brew-plan.ts";
import { calculateWaterVolumes } from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { ProfileValues } from "../../src/domain/model/equipment-profile.ts";

const equipment: ProfileValues = {
  boil_off_l_per_h: 13.2,
  grain_absorption_l_per_kg: 0.8,
  mash_thickness_l_per_kg: 3,
  mash_dead_space_l: 0,
  pump_pipe_loss_l: 0,
  kettle_loss_l: 0,
  chiller_loss_l: 0,
  transfer_loss_l: 0,
  cooling_shrinkage_pct: 4,
};

const sugar = { id: "f-sugar", name: "Dextrose", type: "sugar" as const, amountKg: 1, yieldPct: 100 };
const withSugar = { ...sunsetIpaRecipe, fermentables: [...sunsetIpaRecipe.fermentables, sugar] };

describe("adapted recipe water volumes", () => {
  it("agree with the brew-day plan when the recipe contains sugar", () => {
    const water = calculateAdaptedWaterVolumes(withSugar, equipment);
    const plan = buildBrewPlan({ recipe: withSugar, equipment }).summary;
    expect(water).not.toBeNull();
    expect(water!.mashWaterL).toBeCloseTo(plan.strikeVolumeL!.value, 6);
    expect(water!.spargeWaterL).toBeCloseTo(plan.spargeVolumeL!.value, 6);
    expect(water!.preBoilVolumeL).toBeCloseTo(plan.preBoilVolumeL!.value, 6);
    expect(water!.postBoilVolumeL).toBeCloseTo(plan.postBoilVolumeL!.value, 6);
  });

  it("does not count sugar as mashed grain", () => {
    const base = calculateAdaptedWaterVolumes(sunsetIpaRecipe, equipment)!;
    const result = calculateAdaptedWaterVolumes(withSugar, equipment)!;
    expect(result.mashWaterL).toBeCloseTo(base.mashWaterL, 6);
    expect(result.spargeWaterL).toBeCloseTo(base.spargeWaterL, 6);
    expect(result.totalWaterL).toBeCloseTo(base.totalWaterL, 6);

    // Old behaviour (all fermentables as grain): +0.8 L absorption and +3 L mash water for 1 kg sugar.
    const legacy = calculateWaterVolumes({
      batchVolumeL: withSugar.batchSizeL,
      grainKg: withSugar.fermentables.reduce((sum, f) => sum + f.amountKg, 0),
      boilTimeMin: withSugar.boilTimeMin,
      boilOffLPerH: 13.2,
      grainAbsorptionLPerKg: 0.8,
      mashThicknessLPerKg: 3,
      coolingShrinkagePct: 4,
    });
    expect(legacy.totalWaterL - result.totalWaterL).toBeCloseTo(0.8, 6);
    expect(legacy.mashWaterL - result.mashWaterL).toBeCloseTo(3, 6);
  });

  it("returns null without mashed grain or boil-off", () => {
    expect(calculateAdaptedWaterVolumes({ ...withSugar, fermentables: [sugar] }, equipment)).toBeNull();
    expect(calculateAdaptedWaterVolumes(withSugar, {})).toBeNull();
  });
});
