import type { Fermentable } from "../model/recipe.ts";
import { KG_PER_POUND, LITERS_PER_US_GALLON } from "./units.ts";

/** Gravity points: 1.061 → 61. */
export function sgToPoints(sg: number): number {
  return (sg - 1) * 1000;
}

export function pointsToSg(points: number): number {
  return 1 + points / 1000;
}

/** Degrees Plato → specific gravity (standard ASBC-derived approximation). */
export function platoToSg(plato: number): number {
  return 1 + plato / (258.6 - (plato / 258.2) * 227.1);
}

/** Specific gravity → degrees Plato (ASBC cubic). */
export function sgToPlato(sg: number): number {
  return -616.868 + 1111.14 * sg - 630.272 * sg ** 2 + 135.997 * sg ** 3;
}

/**
 * Refractometer reading (°Brix) of unfermented wort → SG.
 * `wcf` is the wort correction factor of the instrument (calibration value; 1.0 = no correction).
 */
export function brixToSg(brix: number, wcf = 1): number {
  if (wcf <= 0) throw new RangeError("wcf must be positive");
  return platoToSg(brix / wcf);
}

export function sgToBrix(sg: number, wcf = 1): number {
  return sgToPlato(sg) * wcf;
}

/**
 * Final gravity from refractometer readings once fermentation has started (alcohol skews
 * the reading). Sean Terrill's cubic (2011), inputs corrected by the wort correction factor.
 */
export function refractometerFinalGravity(input: { originalBrix: number; finalBrix: number; wcf?: number }): number {
  const wcf = input.wcf ?? 1;
  const ri = input.originalBrix / wcf;
  const rf = input.finalBrix / wcf;
  return (
    1 -
    0.0044993 * ri +
    0.011774 * rf +
    0.00027581 * ri ** 2 -
    0.0012717 * rf ** 2 -
    0.00000728 * ri ** 3 +
    0.000063293 * rf ** 3
  );
}

/** Reverse the final-gravity refractometer formula when original Brix is known. */
export function refractometerBrixFromFinalGravity(input: { originalBrix: number; finalSg: number; wcf?: number }): number | null {
  const wcf = input.wcf ?? 1;
  if (wcf <= 0) return null;
  let low = 0;
  let high = 40 * wcf;
  const lowestGravity = refractometerFinalGravity({ originalBrix: input.originalBrix, finalBrix: low, wcf });
  const highestGravity = refractometerFinalGravity({ originalBrix: input.originalBrix, finalBrix: high, wcf });
  if (input.finalSg < lowestGravity || input.finalSg > highestGravity) return null;
  for (let i = 0; i < 64; i += 1) {
    const middle = (low + high) / 2;
    const gravity = refractometerFinalGravity({ originalBrix: input.originalBrix, finalBrix: middle, wcf });
    if (gravity < input.finalSg) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

/** Extract potential of sucrose, 46.214 ppg, expressed as gravity points · L / kg. */
export const SUCROSE_POINTS_L_PER_KG = (46.214 * LITERS_PER_US_GALLON) / KG_PER_POUND;

/** Used when a fermentable has no yield specified. */
export const DEFAULT_YIELD_PCT = 75;

type GravityFermentable = Pick<Fermentable, "amountKg" | "type" | "yieldPct">;

/** Only mashed fermentables are subject to mash/brewhouse efficiency; sugars and extracts give 100 %. */
export function isMashed(fermentable: Pick<Fermentable, "type">): boolean {
  return fermentable.type === "grain" || fermentable.type === "adjunct";
}

/** Total available extract in gravity points · L, before efficiency. */
export function extractPotentialPoints(fermentables: GravityFermentable[]): { mashed: number; unmashed: number } {
  let mashed = 0;
  let unmashed = 0;
  for (const f of fermentables) {
    const points = f.amountKg * ((f.yieldPct ?? DEFAULT_YIELD_PCT) / 100) * SUCROSE_POINTS_L_PER_KG;
    if (isMashed(f)) mashed += points;
    else unmashed += points;
  }
  return { mashed, unmashed };
}

/** Estimated original gravity for a grain bill dissolved into `volumeL` at a brewhouse efficiency. */
export function calculateGravityEstimate(input: {
  fermentables: GravityFermentable[];
  volumeL: number;
  efficiencyPct: number;
}): number {
  if (input.volumeL <= 0) throw new RangeError("volumeL must be positive");
  const { mashed, unmashed } = extractPotentialPoints(input.fermentables);
  const points = (mashed * (input.efficiencyPct / 100) + unmashed) / input.volumeL;
  return pointsToSg(points);
}

/**
 * Measured brewhouse efficiency (%) — how much of the grain bill's potential ended up
 * in `volumeL` of wort at gravity `sg`.
 */
export function calculateEfficiency(input: { fermentables: GravityFermentable[]; sg: number; volumeL: number }): number {
  const { mashed, unmashed } = extractPotentialPoints(input.fermentables);
  if (mashed <= 0) throw new RangeError("grain bill has no mashed fermentables");
  const measuredPoints = sgToPoints(input.sg) * input.volumeL;
  return ((measuredPoints - unmashed) / mashed) * 100;
}

/** Share of each fermentable in the grain bill by weight (%). */
export function grainBillPercentages<T extends Pick<Fermentable, "amountKg">>(fermentables: T[]): number[] {
  const total = fermentables.reduce((sum, f) => sum + f.amountKg, 0);
  if (total === 0) return fermentables.map(() => 0);
  return fermentables.map((f) => (f.amountKg / total) * 100);
}
