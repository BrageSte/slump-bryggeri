import type { RecipeDocument } from "../model/recipe.ts";
import { calculateAbv, estimateFinalGravity } from "./abv.ts";
import { calculateColorEbc } from "./color.ts";
import { calculateGravityEstimate, grainBillPercentages } from "./gravity.ts";
import { calculateIbu } from "./ibu.ts";

export const DEFAULT_ATTENUATION_PCT = 75;

export interface RecipeMetrics {
  og: number | null;
  fg: number | null;
  abvPct: number | null;
  ibu: number | null;
  colorEbc: number | null;
  totalFermentablesKg: number;
  totalHopsG: number;
  grainBillPct: number[];
  /** Hop additions without alpha acid — IBU is understated when this is non-empty. */
  hopsMissingAlpha: string[];
}

/**
 * Estimated metrics for a recipe. Explicit targets in `recipe.targets` are *not* used here —
 * this is what the numbers in the recipe actually produce, so the UI can show both.
 */
export function calculateRecipeMetrics(recipe: RecipeDocument): RecipeMetrics {
  const totalFermentablesKg = recipe.fermentables.reduce((sum, f) => sum + f.amountKg, 0);
  const og =
    recipe.fermentables.length > 0
      ? calculateGravityEstimate({
          fermentables: recipe.fermentables,
          volumeL: recipe.batchSizeL,
          efficiencyPct: recipe.efficiencyPct,
        })
      : null;

  const fg = og === null ? null : estimateFinalGravity(og, recipeAttenuationPct(recipe));

  const ibuResult =
    og === null || recipe.hops.length === 0
      ? null
      : calculateIbu({ hops: recipe.hops, volumeL: recipe.batchSizeL, boilGravity: og });

  return {
    og,
    fg,
    abvPct: og !== null && fg !== null ? calculateAbv(og, fg) : null,
    ibu: ibuResult?.total ?? (recipe.hops.length === 0 ? 0 : null),
    colorEbc:
      recipe.fermentables.length > 0
        ? calculateColorEbc({ fermentables: recipe.fermentables, volumeL: recipe.batchSizeL })
        : null,
    totalFermentablesKg,
    totalHopsG: recipe.hops.reduce((sum, h) => sum + h.amountG, 0),
    grainBillPct: grainBillPercentages(recipe.fermentables),
    hopsMissingAlpha: ibuResult?.contributions.filter((c) => c.missingAlpha).map((c) => c.id) ?? [],
  };
}

/** Mean apparent attenuation of the recipe's cultures, or a typical ale default. */
export function recipeAttenuationPct(recipe: RecipeDocument): number {
  const attenuations = recipe.cultures.flatMap((c) => (c.attenuationPct === undefined ? [] : [c.attenuationPct]));
  return attenuations.length > 0 ? attenuations.reduce((a, b) => a + b, 0) / attenuations.length : DEFAULT_ATTENUATION_PCT;
}

/** Planned gravities: explicit recipe targets win, otherwise estimates from the ingredients. */
export function expectedGravities(recipe: RecipeDocument): { og: number | null; fg: number | null } {
  const og = recipe.targets.og ?? calculateRecipeMetrics(recipe).og;
  const fg = recipe.targets.fg ?? (og === null ? null : estimateFinalGravity(og, recipeAttenuationPct(recipe)));
  return { og, fg };
}
