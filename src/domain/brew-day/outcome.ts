import { calculateAbv, calculateApparentAttenuation, calculateBoilOffRate, calculateEfficiency } from "../brewing-calculations/index.ts";
import type { BrewStage } from "../model/brewing.ts";
import type { RecipeDocument } from "../model/recipe.ts";
import { findOriginalGravity, type GravityPoint } from "./fermentation.ts";
import type { BrewDayLogEntry } from "./state.ts";

/**
 * Actual numbers for a finished batch, computed only from the brewery's own readings. Anything
 * that is not logged is null and listed in `missing`, so the UI can say what the number needs.
 */

export interface ResultNumbers {
  abvPct: number | null;
  attenuationPct: number | null;
}

/** ABV and apparent attenuation for one result, when both OG and FG are known. */
export function resultNumbers(og: number | null, fg: number | null): ResultNumbers {
  if (og === null || fg === null || og <= 1 || fg >= og) return { abvPct: null, attenuationPct: null };
  return { abvPct: calculateAbv(og, fg), attenuationPct: calculateApparentAttenuation(og, fg) };
}

export interface BrewhouseNumbers {
  preBoilVolumeL: number | null;
  postBoilVolumeL: number | null;
  /** Everything that went into the fermenters: one reading per variant, or one for the batch. */
  fermenterVolumeL: number | null;
  og: GravityPoint | null;
  boilOffLPerHour: number | null;
  efficiencyPct: number | null;
  /** What is needed but not logged, as Norwegian UI labels. */
  missing: string[];
}

const volumeIn = (log: BrewDayLogEntry[], stages: BrewStage[], splitId: string | null) =>
  log.findLast((e) => e.measurement?.kind === "volume" && e.stage !== null && stages.includes(e.stage) && (e.splitId ?? null) === splitId);

export function brewhouseNumbers(input: {
  recipe: RecipeDocument;
  log: BrewDayLogEntry[];
  splits: { id: string }[];
  wcf?: number;
}): BrewhouseNumbers {
  const log = [...input.log].sort((a, b) => a.occurredAt - b.occurredAt);
  const missing: string[] = [];

  // Pre-boil: the last volume while lautering. Post-boil: the last volume in the boil or whirlpool after it.
  const preBoil = volumeIn(log, ["lauter"], null);
  const postBoil = volumeIn(log, ["boil", "whirlpool"], null);
  const preBoilVolumeL = preBoil?.measurement?.value ?? null;
  const postBoilVolumeL = postBoil && (!preBoil || postBoil.occurredAt > preBoil.occurredAt) ? (postBoil.measurement?.value ?? null) : null;
  if (preBoilVolumeL === null) missing.push("volum før kok");
  if (postBoilVolumeL === null) missing.push("volum etter kok");
  const boilOffLPerHour =
    preBoilVolumeL !== null && postBoilVolumeL !== null && input.recipe.boilTimeMin > 0
      ? calculateBoilOffRate({ preBoilVolumeL, postBoilVolumeL, boilTimeMin: input.recipe.boilTimeMin })
      : null;

  const intoFermenters: BrewStage[] = ["cooling", "fermentation"];
  const splitVolumes = input.splits.map((split) => volumeIn(log, intoFermenters, split.id)?.measurement?.value ?? null);
  const batchVolume = volumeIn(log, intoFermenters, null)?.measurement?.value ?? null;
  const fermenterVolumeL =
    input.splits.length > 0 && splitVolumes.every((v) => v !== null)
      ? (splitVolumes as number[]).reduce((sum, v) => sum + v, 0)
      : batchVolume;
  if (fermenterVolumeL === null) missing.push("volum til gjæring");

  const og = findOriginalGravity(log, null, input.wcf ?? 1);
  if (og === null) missing.push("OG");
  let efficiencyPct: number | null = null;
  if (og !== null && fermenterVolumeL !== null) {
    try {
      efficiencyPct = calculateEfficiency({ fermentables: input.recipe.fermentables, sg: og.sg, volumeL: fermenterVolumeL });
    } catch {
      // A recipe without mashed fermentables has no brewhouse efficiency.
      efficiencyPct = null;
    }
  }

  return { preBoilVolumeL, postBoilVolumeL, fermenterVolumeL, og, boilOffLPerHour, efficiencyPct, missing };
}
