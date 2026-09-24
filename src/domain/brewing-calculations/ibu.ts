import type { HopAddition } from "../model/recipe.ts";

/**
 * Tinseth utilization for a boil of `timeMin` minutes at `boilGravity`.
 * Glenn Tinseth (1997): bigness factor × boil time factor.
 */
export function tinsethUtilization(input: { boilGravity: number; timeMin: number }): number {
  const bigness = 1.65 * 0.000125 ** (input.boilGravity - 1);
  const timeFactor = (1 - Math.exp(-0.04 * input.timeMin)) / 4.15;
  return bigness * timeFactor;
}

/**
 * Isomerization rate at `temperatureC` relative to a rolling boil at 100 °C
 * (Arrhenius fit from Malowicki 2005). 1.0 at 100 °C, ≈ 0.27 at 82 °C.
 */
export function isomerizationRateFactor(temperatureC: number): number {
  const kelvin = temperatureC + 273.15;
  return Math.min(1, Math.exp(-9773 / kelvin + 9773 / 373.15));
}

export const DEFAULT_WHIRLPOOL_TEMPERATURE_C = 80;

type IbuHop = Pick<HopAddition, "id" | "amountG" | "alphaPct" | "use" | "timeMin" | "temperatureC">;

export interface IbuResult {
  total: number;
  contributions: { id: string; ibu: number; missingAlpha: boolean }[];
}

/**
 * Bitterness (IBU, Tinseth) for a list of hop additions into `volumeL` of wort.
 *
 * - boil / first wort: Tinseth with the addition's boil time.
 * - whirlpool: Tinseth for the steep time, scaled by the isomerization rate at the stand temperature.
 * - mash / dry hop: no isomerized bitterness.
 *
 * Simplification: post-flameout isomerization of boil additions is ignored.
 * Bittering additions without an alpha acid value contribute 0 and are flagged.
 */
export function calculateIbu(input: { hops: IbuHop[]; volumeL: number; boilGravity: number }): IbuResult {
  if (input.volumeL <= 0) throw new RangeError("volumeL must be positive");
  const contributions = input.hops.map((hop) => {
    const isomerizes = hop.use === "boil" || hop.use === "first_wort" || hop.use === "whirlpool";
    if (!isomerizes) return { id: hop.id, ibu: 0, missingAlpha: false };
    if (hop.alphaPct === undefined) return { id: hop.id, ibu: 0, missingAlpha: true };
    let utilization = 0;
    if (hop.use === "boil" || hop.use === "first_wort") {
      utilization = tinsethUtilization({ boilGravity: input.boilGravity, timeMin: hop.timeMin ?? 0 });
    } else if (hop.use === "whirlpool") {
      utilization =
        tinsethUtilization({ boilGravity: input.boilGravity, timeMin: hop.timeMin ?? 0 }) *
        isomerizationRateFactor(hop.temperatureC ?? DEFAULT_WHIRLPOOL_TEMPERATURE_C);
    }
    const alphaMgPerL = ((hop.alphaPct / 100) * hop.amountG * 1000) / input.volumeL;
    return { id: hop.id, ibu: utilization * alphaMgPerL, missingAlpha: false };
  });
  return { total: contributions.reduce((sum, c) => sum + c.ibu, 0), contributions };
}
