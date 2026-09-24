import type { Fermentable } from "../model/recipe.ts";
import { kgToPounds, litersToUsGallons } from "./units.ts";

export function ebcToSrm(ebc: number): number {
  return ebc / 1.97;
}

export function srmToEbc(srm: number): number {
  return srm * 1.97;
}

/** Malt colour EBC → degrees Lovibond (common conversion). */
export function ebcToLovibond(ebc: number): number {
  return (ebcToSrm(ebc) + 0.76) / 1.3546;
}

/** Beer colour (EBC) via malt colour units and the Morey equation. */
export function calculateColorEbc(input: {
  fermentables: Pick<Fermentable, "amountKg" | "colorEbc">[];
  volumeL: number;
}): number {
  if (input.volumeL <= 0) throw new RangeError("volumeL must be positive");
  const gallons = litersToUsGallons(input.volumeL);
  const mcu = input.fermentables.reduce(
    (sum, f) => sum + (kgToPounds(f.amountKg) * ebcToLovibond(f.colorEbc ?? 0)) / gallons,
    0,
  );
  const srm = 1.4922 * mcu ** 0.6859;
  return srmToEbc(srm);
}
