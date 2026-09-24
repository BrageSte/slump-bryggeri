/**
 * Amount of a hop lot needed to deliver the same alpha acids as the recipe specified.
 * Example: recipe 50 g @ 14 %, lot on hand 12.8 % → 54.7 g.
 */
export function calculateHopAdjustment(input: { amountG: number; recipeAlphaPct: number; actualAlphaPct: number }): {
  amountG: number;
  deltaG: number;
  factor: number;
} {
  if (input.actualAlphaPct <= 0) throw new RangeError("actualAlphaPct must be positive");
  const factor = input.recipeAlphaPct / input.actualAlphaPct;
  const amountG = input.amountG * factor;
  return { amountG, deltaG: amountG - input.amountG, factor };
}

/** Dry hop dose in g/L. */
export function dryHopDose(amountG: number, volumeL: number): number {
  if (volumeL <= 0) throw new RangeError("volumeL must be positive");
  return amountG / volumeL;
}
