import { calculateWaterVolumes, mashedGrainKg, type WaterVolumeResult } from "../brewing-calculations/index.ts";
import { profileValue, type ProfileValues } from "../model/equipment-profile.ts";
import type { Fermentable } from "../model/recipe.ts";

/**
 * Water volumes for a recipe adapted to a brewery's equipment (used by "Tilpass til
 * bryggeriet"). Uses `mashedGrainKg` (grain + adjunct only) rather than the total fermentables
 * weight, so sugars/extracts don't inflate the mash/sparge split — this must agree with
 * `buildBrewPlan`, which uses the same function for the brew-day plan of the same batch.
 */
export function calculateAdaptedWaterVolumes(
  recipe: { batchSizeL: number; boilTimeMin: number; fermentables: Pick<Fermentable, "amountKg" | "type">[] },
  values: ProfileValues,
): WaterVolumeResult | null {
  const boilOff = profileValue(values, "boil_off_l_per_h");
  const grainKg = mashedGrainKg(recipe);
  if (grainKg <= 0 || boilOff === undefined) return null;
  return calculateWaterVolumes({
    batchVolumeL: recipe.batchSizeL,
    grainKg,
    boilTimeMin: recipe.boilTimeMin,
    boilOffLPerH: boilOff,
    grainAbsorptionLPerKg: profileValue(values, "grain_absorption_l_per_kg") ?? 0.8,
    mashThicknessLPerKg: profileValue(values, "mash_thickness_l_per_kg") ?? 3,
    mashDeadSpaceL: profileValue(values, "mash_dead_space_l"),
    pumpPipeLossL: profileValue(values, "pump_pipe_loss_l"),
    kettleLossL: profileValue(values, "kettle_loss_l"),
    chillerLossL: profileValue(values, "chiller_loss_l"),
    transferLossL: profileValue(values, "transfer_loss_l"),
    coolingShrinkagePct: profileValue(values, "cooling_shrinkage_pct"),
  });
}
