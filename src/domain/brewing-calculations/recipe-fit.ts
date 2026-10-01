import type { RecipeDocument } from "../model/recipe.ts";
import { extractPotentialPoints, sgToPoints } from "./gravity.ts";
import { calculateIbu } from "./ibu.ts";
import { calculateRecipeMetrics } from "./recipe-metrics.ts";
import { round } from "./units.ts";

/**
 * Fitting: the assistant chooses the structure of a recipe (which malts and hops, their shares and
 * times); these functions compute the amounts. Both go through `calculateRecipeMetrics`, so a fitted
 * recipe agrees with every other number in the app. `recipe.targets` is never changed.
 */

export interface FitGrainBillOptions {
  /** Fermentables that keep their amount (e.g. a sugar addition). */
  fixedIds?: string[];
}

export interface FitGrainBillResult {
  recipe: RecipeDocument;
  /** Common multiplier applied to the scalable fermentables (before rounding). */
  factor: number;
  /** OG from `calculateRecipeMetrics` after rounding. */
  og: number;
}

/**
 * Scales all non-fixed fermentables by one common factor so the estimated OG hits `targetOg`.
 * Gravity points are linear in fermentable mass, so the factor is exact; only the rounding to
 * 0.001 kg leaves a residual. Percentages among the scaled fermentables are preserved.
 */
export function fitGrainBillToOg(recipe: RecipeDocument, targetOg: number, options: FitGrainBillOptions = {}): FitGrainBillResult {
  if (!(targetOg > 1)) throw new RangeError("targetOg must be above 1");
  const fixed = new Set(options.fixedIds ?? []);
  const scalable = recipe.fermentables.filter((f) => !fixed.has(f.id));
  if (scalable.length === 0) throw new RangeError("no fermentables to scale");

  const efficiency = recipe.efficiencyPct / 100;
  const pointsL = (items: RecipeDocument["fermentables"]) => {
    const { mashed, unmashed } = extractPotentialPoints(items);
    return mashed * efficiency + unmashed;
  };
  const scalablePoints = pointsL(scalable);
  if (scalablePoints <= 0) throw new RangeError("scalable fermentables have no extract");
  const fixedPoints = pointsL(recipe.fermentables.filter((f) => fixed.has(f.id)));
  const wantedPoints = sgToPoints(targetOg) * recipe.batchSizeL;
  if (fixedPoints >= wantedPoints) throw new RangeError("fixed fermentables alone reach the target OG");

  const factor = (wantedPoints - fixedPoints) / scalablePoints;
  const fitted: RecipeDocument = {
    ...recipe,
    fermentables: recipe.fermentables.map((f) => {
      if (fixed.has(f.id)) return { ...f };
      const amountKg = round(f.amountKg * factor, 3);
      if (amountKg <= 0) throw new RangeError(`${f.name} rounds to zero`);
      return { ...f, amountKg };
    }),
  };
  return { recipe: fitted, factor, og: calculateRecipeMetrics(fitted).og as number };
}

export interface FitHopsOptions {
  /** Hop additions allowed to change; defaults to every addition that contributes IBU. */
  adjustIds?: string[];
}

export interface FitHopsResult {
  recipe: RecipeDocument;
  /** Common multiplier applied to the adjustable additions (before rounding). */
  factor: number;
  /** IBU from `calculateRecipeMetrics` after rounding. */
  ibu: number;
}

/**
 * Scales the adjustable hop additions by one common factor so the Tinseth IBU hits `targetIbu`.
 * Contributions are computed as `calculateRecipeMetrics` does (recipe volume, boil gravity = the
 * recipe's estimated OG). Additions that give no IBU (dry hop, mash) stay untouched. Removing hops
 * is an editing decision, so `targetIbu` must be positive.
 */
export function fitHopsToIbu(recipe: RecipeDocument, targetIbu: number, options: FitHopsOptions = {}): FitHopsResult {
  if (!(targetIbu > 0)) throw new RangeError("targetIbu must be positive");
  const og = calculateRecipeMetrics(recipe).og;
  if (og === null) throw new RangeError("recipe has no fermentables, so there is no gravity to calculate IBU from");

  const { total, contributions } = calculateIbu({ hops: recipe.hops, volumeL: recipe.batchSizeL, boilGravity: og });
  const allowed = options.adjustIds === undefined ? null : new Set(options.adjustIds);
  const missingAlpha = contributions.filter((c) => c.missingAlpha && allowed?.has(c.id));
  if (missingAlpha.length > 0) throw new RangeError("an adjustable hop addition has no alpha acid");

  const adjustable = new Set(contributions.filter((c) => c.ibu > 0 && (allowed === null || allowed.has(c.id))).map((c) => c.id));
  if (adjustable.size === 0) throw new RangeError("no adjustable hop addition contributes IBU");
  const adjustableIbu = contributions.filter((c) => adjustable.has(c.id)).reduce((sum, c) => sum + c.ibu, 0);
  const fixedIbu = total - adjustableIbu;
  if (fixedIbu >= targetIbu) throw new RangeError("fixed hop additions alone reach the target IBU");

  const factor = (targetIbu - fixedIbu) / adjustableIbu;
  const fitted: RecipeDocument = {
    ...recipe,
    hops: recipe.hops.map((h) => {
      if (!adjustable.has(h.id)) return { ...h };
      const amountG = round(h.amountG * factor, 1);
      if (amountG <= 0) throw new RangeError(`${h.name} rounds to zero`);
      return { ...h, amountG };
    }),
  };
  return { recipe: fitted, factor, ibu: calculateRecipeMetrics(fitted).ibu as number };
}
