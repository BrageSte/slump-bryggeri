import type { RecipeDocument } from "../model/recipe.ts";
import { isMashed } from "./gravity.ts";
import { round } from "./units.ts";

export interface ScaleRecipeOptions {
  /** New volume into the fermenter(s). */
  batchSizeL: number;
  /** Brewhouse efficiency of the target brewery. Defaults to the recipe's own efficiency. */
  efficiencyPct?: number;
}

export interface ScaleRecipeResult {
  recipe: RecipeDocument;
  /** Multiplier applied to volume-proportional ingredients (hops, cultures, miscs, sugars). */
  volumeFactor: number;
  /** Multiplier applied to mashed fermentables (volume × efficiency correction). */
  mashedFactor: number;
}

/**
 * Scales a recipe to a new batch size and brewhouse efficiency.
 *
 * - Mashed fermentables scale with volume and are corrected for efficiency so OG is preserved.
 * - Sugars/extracts, hops and miscs scale linearly with volume (preserves IBU at equal gravity).
 * - Cultures measured in whole packages are rounded up to whole packages.
 * - Ingredient ids are preserved so additions can be traced back to the original recipe.
 */
export function calculateRecipeScaling(recipe: RecipeDocument, options: ScaleRecipeOptions): ScaleRecipeResult {
  if (options.batchSizeL <= 0) throw new RangeError("batchSizeL must be positive");
  const efficiencyPct = options.efficiencyPct ?? recipe.efficiencyPct;
  const volumeFactor = options.batchSizeL / recipe.batchSizeL;
  const mashedFactor = volumeFactor * (recipe.efficiencyPct / efficiencyPct);

  const scaled: RecipeDocument = {
    ...recipe,
    batchSizeL: options.batchSizeL,
    efficiencyPct,
    fermentables: recipe.fermentables.map((f) => ({
      ...f,
      amountKg: round(f.amountKg * (isMashed(f) ? mashedFactor : volumeFactor), 3),
    })),
    hops: recipe.hops.map((h) => ({ ...h, amountG: round(h.amountG * volumeFactor, 1) })),
    miscs: recipe.miscs.map((m) => ({ ...m, amount: round(m.amount * volumeFactor, 2) })),
    cultures: recipe.cultures.map((c) => ({
      ...c,
      amount: c.unit === "pkg" ? Math.ceil(round(c.amount * volumeFactor, 2)) : round(c.amount * volumeFactor, 1),
    })),
  };
  return { recipe: scaled, volumeFactor, mashedFactor };
}
