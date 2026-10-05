import {
  emptyRecipe,
  type Culture,
  type Fermentable,
  type FermentationStep,
  type HopAddition,
  type MashStep,
  type Misc,
  type RecipeDocument,
} from "../model/recipe.ts";
import { getWaterAgent, isSaltAgent, type IonConcentrations, type PartialIonConcentrations, type WaterAgentId } from "../model/water.ts";
import { calculateIbu } from "./ibu.ts";
import { fitGrainBillToOg, fitHopsToIbu } from "./recipe-fit.ts";
import { calculateRecipeMetrics, DEFAULT_ATTENUATION_PCT, type RecipeMetrics } from "./recipe-metrics.ts";
import { round } from "./units.ts";
import { solveSaltAdditions, type SaltOption, type SaltSolution } from "./water-chemistry.ts";

/**
 * Recipe design: the assistant (or anyone) chooses the *structure* of a recipe: which malts in what share, which
 * hops, when and how the bitterness is split, mash and fermentation steps. This module computes every *amount*
 * (kg of malt, g of hops, g of salt) so the draft agrees with the rest of the app. Built on `fitGrainBillToOg`,
 * `fitHopsToIbu` and `solveSaltAdditions`; the numbers are checked through `calculateRecipeMetrics`.
 */

export type FermentableSpec = Pick<Fermentable, "name" | "type" | "colorEbc" | "yieldPct" | "producer"> & {
  /** Share of the total fermentable mass, %. The shares must add up to 100. */
  sharePct: number;
};

export type HopSpec = Pick<HopAddition, "name" | "use" | "alphaPct" | "timeMin" | "temperatureC" | "dayOfFermentation" | "form"> & {
  /** Boil, first wort and whirlpool additions: this addition's share of the target IBU, %. The shares must add up to 100. */
  ibuSharePct?: number;
  /** Mash and dry hop additions (no bitterness): grams per litre of batch. */
  gramsPerL?: number;
};

export type CultureSpec = Omit<Culture, "id">;
/** Water salts and acids are not specified here: salts come from `applyWaterPlan`. */
export type MiscSpec = Omit<Misc, "id" | "waterAgent" | "acidStrengthPct">;
export type MashStepSpec = Omit<MashStep, "id">;
export type FermentationStepSpec = Omit<FermentationStep, "id">;

export interface RecipeDesignSpec {
  name: string;
  style?: string;
  description?: string;
  notes?: string;
  batchSizeL: number;
  efficiencyPct: number;
  boilTimeMin: number;
  carbonationVols?: number;
  /** `og` is fitted exactly (the grain bill is scaled to it) and `ibu` too; the others are compared with the result. */
  targets: NonNullable<RecipeDocument["targets"]> & { og: number };
  fermentables: FermentableSpec[];
  hops: HopSpec[];
  cultures?: CultureSpec[];
  miscs?: MiscSpec[];
  mashSteps: MashStepSpec[];
  fermentationSteps: FermentationStepSpec[];
  /** The planned water; the salts that reach it are added by `applyWaterPlan`. */
  water?: RecipeDocument["water"];
}

export type ComparedMetric = "og" | "fg" | "abvPct" | "ibu" | "colorEbc";

export interface TargetComparison {
  metric: ComparedMetric;
  target: number;
  calculated: number | null;
  /** calculated − target, rounded as the metric is shown. */
  difference: number | null;
  withinTolerance: boolean;
}

export interface RecipeDesign {
  recipe: RecipeDocument;
  metrics: RecipeMetrics;
  /** Every target the spec gave, next to what the ingredients produce. */
  comparison: TargetComparison[];
  /** Assumptions behind the numbers that the reader should be told. */
  notes: string[];
}

/** Tolerances for "close enough" when a target cannot be fitted (colour, FG, ABV) and for fit rounding (OG, IBU). */
export const designTolerance = {
  og: 0.001,
  fg: 0.003,
  abvPct: 0.3,
  ibu: 1,
  colorEbc: (target: number) => Math.max(2, target * 0.1),
} as const;

const SHARE_SUM_TOLERANCE = 0.5;
const IBU_USES = new Set<HopAddition["use"]>(["boil", "first_wort", "whirlpool"]);
const isBittering = (hop: Pick<HopSpec, "use">) => IBU_USES.has(hop.use);

function checkShares(label: string, values: number[]): void {
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 100) > SHARE_SUM_TOLERANCE) throw new RangeError(`${label} must add up to 100 %, but they add up to ${round(sum, 2)} %.`);
}

function validate(spec: RecipeDesignSpec): void {
  if (!(spec.targets.og > 1)) throw new RangeError("targets.og must be above 1");
  if (spec.fermentables.length === 0) throw new RangeError("At least one fermentable is needed.");
  checkShares("The fermentable shares", spec.fermentables.map((f) => f.sharePct));

  const bittering = spec.hops.filter(isBittering);
  for (const hop of spec.hops) {
    if (isBittering(hop)) {
      if (hop.gramsPerL !== undefined) throw new RangeError(`${hop.name}: gramsPerL only applies to mash and dry hop additions; give ibuSharePct for ${hop.use}.`);
      if (hop.ibuSharePct === undefined || !(hop.ibuSharePct > 0)) throw new RangeError(`${hop.name}: a ${hop.use} addition needs ibuSharePct.`);
      if (hop.alphaPct === undefined) throw new RangeError(`${hop.name}: a ${hop.use} addition needs alphaPct.`);
      if (hop.timeMin === undefined) throw new RangeError(`${hop.name}: a ${hop.use} addition needs timeMin.`);
    } else {
      if (hop.ibuSharePct !== undefined) throw new RangeError(`${hop.name}: ibuSharePct only applies to boil, first wort and whirlpool additions.`);
      if (hop.gramsPerL === undefined || !(hop.gramsPerL > 0)) throw new RangeError(`${hop.name}: a ${hop.use} addition needs gramsPerL.`);
    }
  }
  if (bittering.length > 0) {
    if (spec.targets.ibu === undefined || !(spec.targets.ibu > 0)) throw new RangeError("targets.ibu is needed when the recipe has boil, first wort or whirlpool hops.");
    checkShares("The ibuSharePct values", bittering.map((h) => h.ibuSharePct!));
  } else if (spec.targets.ibu !== undefined && spec.targets.ibu > 0) {
    throw new RangeError("targets.ibu has no hop addition to reach it: add a boil, first wort or whirlpool addition, or leave the IBU target out.");
  }
}

/** Dry hop grams: whole grams from 10 g, otherwise 0.1 g. */
function dosage(grams: number): number {
  return grams >= 10 ? round(grams, 0) : round(grams, 1);
}

function compare(spec: RecipeDesignSpec, metrics: RecipeMetrics): TargetComparison[] {
  const rows: [ComparedMetric, number | undefined, number | null, number, (target: number) => number][] = [
    ["og", spec.targets.og, metrics.og, 4, () => designTolerance.og],
    ["fg", spec.targets.fg, metrics.fg, 4, () => designTolerance.fg],
    ["abvPct", spec.targets.abvPct, metrics.abvPct, 1, () => designTolerance.abvPct],
    ["ibu", spec.targets.ibu, metrics.ibu, 1, () => designTolerance.ibu],
    ["colorEbc", spec.targets.colorEbc, metrics.colorEbc, 1, designTolerance.colorEbc],
  ];
  return rows.flatMap(([metric, target, calculated, decimals, tolerance]) => {
    if (target === undefined) return [];
    const difference = calculated === null ? null : round(calculated - target, decimals);
    return [{ metric, target, calculated: calculated === null ? null : round(calculated, decimals), difference, withinTolerance: difference !== null && Math.abs(calculated! - target) <= tolerance(target) }];
  });
}

/**
 * Builds a complete recipe from a structure and targets. OG is hit by scaling the whole grain bill with one factor
 * (the shares stay as given), bitterness by splitting the target IBU over the boil, first wort and whirlpool additions
 * by their `ibuSharePct`, and dry hops by `gramsPerL`. Throws a `RangeError` with a plain message when the spec
 * is inconsistent or a target cannot be reached.
 */
export function designRecipe(spec: RecipeDesignSpec): RecipeDesign {
  validate(spec);

  const initial = emptyRecipe({
    name: spec.name,
    style: spec.style,
    description: spec.description,
    notes: spec.notes,
    batchSizeL: spec.batchSizeL,
    efficiencyPct: spec.efficiencyPct,
    boilTimeMin: spec.boilTimeMin,
    carbonationVols: spec.carbonationVols,
    targets: { ...spec.targets },
    fermentables: spec.fermentables.map((f, index) => ({
      id: `f-${index + 1}`,
      name: f.name,
      type: f.type,
      // Any positive start works: the fit scales every amount by one factor, so only the shares survive.
      amountKg: f.sharePct / 100,
      ...(f.colorEbc !== undefined && { colorEbc: f.colorEbc }),
      ...(f.yieldPct !== undefined && { yieldPct: f.yieldPct }),
      ...(f.producer !== undefined && { producer: f.producer }),
    })),
    cultures: (spec.cultures ?? []).map((c, index) => ({ ...c, id: `c-${index + 1}` })),
    miscs: (spec.miscs ?? []).map((m, index) => ({ ...m, id: `m-${index + 1}` })),
    mashSteps: spec.mashSteps.map((s, index) => ({ ...s, id: `ms-${index + 1}` })),
    fermentationSteps: spec.fermentationSteps.map((s, index) => ({ ...s, id: `fs-${index + 1}` })),
    ...(spec.water !== undefined && { water: spec.water }),
  });

  const { recipe: withGrain } = fitGrainBillToOg(initial, spec.targets.og);
  const og = calculateRecipeMetrics(withGrain).og as number;

  // Bitterness: IBU per gram of each addition (linear in the amount), then grams that give each its share.
  const bittering = spec.hops.map((h, index) => ({ hop: h, id: `h-${index + 1}` })).filter(({ hop }) => isBittering(hop));
  const perGram = new Map(
    calculateIbu({
      hops: bittering.map(({ hop, id }) => ({ id, amountG: 1, alphaPct: hop.alphaPct, use: hop.use, timeMin: hop.timeMin, temperatureC: hop.temperatureC })),
      volumeL: spec.batchSizeL,
      boilGravity: og,
    }).contributions.map((c) => [c.id, c.ibu] as const),
  );
  const hops: HopAddition[] = spec.hops.map((h, index) => {
    const id = `h-${index + 1}`;
    const { ibuSharePct, gramsPerL, ...rest } = h;
    let amountG: number;
    if (isBittering(h)) {
      const ibuPerGram = perGram.get(id) ?? 0;
      if (!(ibuPerGram > 0)) throw new RangeError(`${h.name} (${h.use}, ${h.timeMin} min) gives no bitterness. Give it a longer time or an alpha acid value above 0.`);
      amountG = round((spec.targets.ibu! * (ibuSharePct! / 100)) / ibuPerGram, 1);
    } else {
      amountG = dosage(gramsPerL! * spec.batchSizeL);
    }
    if (!(amountG > 0)) throw new RangeError(`${h.name} comes out at 0 g: the share or dosage is too small for this batch size.`);
    return { ...rest, id, amountG };
  });

  let recipe: RecipeDocument = { ...withGrain, hops };
  // Rounding to 0.1 g moves the total slightly; one common factor brings it back to the target.
  if (bittering.length > 0) recipe = fitHopsToIbu(recipe, spec.targets.ibu!).recipe;

  const metrics = calculateRecipeMetrics(recipe);
  const notes: string[] = [];
  if (recipe.cultures.every((c) => c.attenuationPct === undefined)) {
    notes.push(`No yeast states its attenuation, so FG and ABV assume ${DEFAULT_ATTENUATION_PCT} % apparent attenuation.`);
  }
  return { recipe, metrics, comparison: compare(spec, metrics), notes };
}

// ---------------------------------------------------------------------------
// Brewing water
// ---------------------------------------------------------------------------

/** The salts a brewery stocks by default (the same four the recipe editor offers). */
export const standardSaltIds: readonly WaterAgentId[] = ["gypsum", "calcium_chloride_dihydrate", "epsom_salt", "table_salt"];

export interface WaterPlanResult {
  recipe: RecipeDocument;
  solution: SaltSolution;
  /** The salts that were added, in grams. */
  salts: { id: WaterAgentId; name: string; grams: number }[];
}

/**
 * Adds the salts that bring the source water closest to `recipe.water.target` (see `solveSaltAdditions`) as ordinary
 * «Andre tilsetninger» rows marked with their `waterAgent`. Earlier rows for the same salts are replaced. Acid is not
 * dosed. `totalWaterL` is the mash plus sparge water the salts are dissolved in.
 */
export function applyWaterPlan(recipe: RecipeDocument, input: { source: IonConcentrations; totalWaterL: number }): WaterPlanResult {
  const target: PartialIonConcentrations = recipe.water?.target ?? {};
  const options = standardSaltIds.flatMap((id): SaltOption[] => {
    const agent = getWaterAgent(id);
    return isSaltAgent(agent) ? [{ id, composition: agent.composition }] : [];
  });
  const solution = solveSaltAdditions({ source: input.source, target, waterVolumeL: input.totalWaterL, salts: options });

  const added = solution.salts.flatMap((salt) => {
    const agent = getWaterAgent(salt.id);
    return salt.grams > 0 && agent ? [{ id: salt.id as WaterAgentId, name: agent.shortLabel, grams: round(salt.grams, 1) }] : [];
  });
  const kept = recipe.miscs.filter((misc) => !(misc.waterAgent && standardSaltIds.includes(misc.waterAgent)));
  const rows: Misc[] = added.map((salt) => ({ id: `salt-${salt.id}`, name: salt.name, amount: salt.grams, unit: "g", use: "mash", waterAgent: salt.id }));
  return { recipe: { ...recipe, miscs: [...kept, ...rows] }, solution, salts: added };
}
