import { calculateMashTemperatureAdjustment } from "../brewing-calculations/water.ts";
import type { ProfileValues } from "../model/equipment-profile.ts";
import type { RecipeDocument } from "../model/recipe.ts";
import type { BrewStage } from "../model/brewing.ts";
import { buildBrewPlan } from "./brew-plan.ts";
import { deriveBrewDayState, type BrewDayLogEntry } from "./state.ts";

export interface MashTemperatureSuggestion {
  direction: "raise" | "lower";
  currentC: number;
  targetC: number;
  additionTempC: number;
  additionL: number;
  mashWaterL: number;
  mashWaterSource: "recipe" | "calculated";
  grainKg: number;
}

export type MashAdjustmentReason =
  | "not_mash_stage"
  | "missing_mash_target"
  | "no_reading"
  | "reading_within_target"
  | "reading_overlaps_target"
  | "no_mash_water"
  | "no_mashed_grain"
  | "calculation_not_possible";

export type MashAdjustmentResult =
  | MashTemperatureSuggestion
  | { reason: MashAdjustmentReason }
  /** Water was logged after the latest reading: stir and measure again before suggesting more. */
  | { reason: "awaiting_new_reading"; waterAddedAt: number; waterAddedL: number };

export interface MashAdjustmentInput {
  recipe: RecipeDocument;
  equipment: ProfileValues;
  log: readonly BrewDayLogEntry[];
  stage: BrewStage | null;
  stageStartedAt: number | null;
  now: number;
  /** Defaults to 95 °C when raising and 10 °C when lowering. */
  additionTempC?: number;
}

/**
 * Suggests a deterministic mash temperature correction from the active mash reading,
 * recipe snapshot and batch equipment snapshot. Tun heat loss is intentionally excluded.
 */
export function suggestMashTemperatureAdjustment(input: MashAdjustmentInput): MashAdjustmentResult {
  if (input.stage !== "mash") return { reason: "not_mash_stage" };

  const state = deriveBrewDayState({
    recipe: input.recipe,
    stage: input.stage,
    stageStartedAt: input.stageStartedAt,
    log: [...input.log],
    now: input.now,
  });
  const target = state.targets.find((item) => item.key === "mash-temp");
  if (!target || target.target.kind !== "value") return { reason: "missing_mash_target" };
  if (!target.actual) return { reason: "no_reading" };
  if (target.status === "ok") return { reason: "reading_within_target" };
  if (target.status !== "low" && target.status !== "high") return { reason: "reading_overlaps_target" };

  // Water already added during this mash counts as mash water; water added after the latest
  // reading means the reading is stale, so never suggest adding more on top of it.
  const mashStart = state.stageStartedAt ?? 0;
  const waterAdded = input.log
    .filter((entry) => entry.type === "water_added" && entry.occurredAt >= mashStart && typeof entry.data?.volumeL === "number")
    .map((entry) => ({ at: entry.occurredAt, volumeL: entry.data!.volumeL as number }));
  const afterReading = waterAdded.filter((entry) => entry.at > target.actual!.occurredAt);
  if (afterReading.length > 0) {
    return {
      reason: "awaiting_new_reading",
      waterAddedAt: Math.max(...afterReading.map((entry) => entry.at)),
      waterAddedL: afterReading.reduce((sum, entry) => sum + entry.volumeL, 0),
    };
  }
  const addedBeforeReadingL = waterAdded.reduce((sum, entry) => sum + entry.volumeL, 0);

  const firstMashInfusion = input.recipe.mashSteps[0]?.infusionL;
  let mashWaterL: number | undefined;
  let mashWaterSource: MashTemperatureSuggestion["mashWaterSource"] | undefined;
  if (firstMashInfusion !== undefined) {
    mashWaterL = firstMashInfusion;
    mashWaterSource = "recipe";
  } else {
    const planned = buildBrewPlan({ recipe: input.recipe, equipment: input.equipment }).summary.strikeVolumeL;
    if (planned) {
      mashWaterL = planned.value;
      mashWaterSource = planned.source;
    }
  }
  if (mashWaterL === undefined || !Number.isFinite(mashWaterL) || mashWaterL <= 0 || !mashWaterSource) {
    return { reason: "no_mash_water" };
  }
  mashWaterL += addedBeforeReadingL;

  const grainKg = input.recipe.fermentables
    .filter((fermentable) => fermentable.type === "grain" || fermentable.type === "adjunct")
    .reduce((sum, fermentable) => sum + fermentable.amountKg, 0);
  if (grainKg <= 0) return { reason: "no_mashed_grain" };

  const direction = target.status === "low" ? "raise" : "lower";
  const targetC = target.target.value;
  const additionTempC = input.additionTempC ?? (direction === "raise" ? 95 : 10);
  const adjustment = calculateMashTemperatureAdjustment({
    mashWaterL,
    grainKg,
    currentTempC: target.actual.value,
    targetTempC: targetC,
    additionTempC,
  });
  if (!adjustment || !Number.isFinite(adjustment.additionL) || adjustment.additionL <= 0) {
    return { reason: "calculation_not_possible" };
  }

  return {
    direction,
    currentC: target.actual.value,
    targetC,
    additionTempC,
    additionL: adjustment.additionL,
    mashWaterL,
    mashWaterSource,
    grainKg,
  };
}
