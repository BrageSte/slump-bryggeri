import type { ProfileParameterKey, ProfileValues } from "../model/equipment-profile.ts";
import type { BsmxRecipeImport } from "./bsmx.ts";

export interface ProfileSuggestion {
  /** BeerSmith's equipment name, shown as the source of every suggested value. */
  sourceName: string;
  /** Date attached to the BeerSmith recipe (when last brewed or created). */
  sourceDate?: string;
  values: Partial<Record<ProfileParameterKey, number>>;
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

function mostCommon(values: (number | undefined)[]): number | undefined {
  const counts = new Map<number, number>();
  for (const value of values) if (value !== undefined) counts.set(round(value, 1), (counts.get(round(value, 1)) ?? 0) + 1);
  let best: number | undefined;
  for (const [value, count] of counts) if (best === undefined || count > (counts.get(best) ?? 0)) best = value;
  return best;
}

/**
 * Maps BeerSmith's stated equipment values onto Slump's calibration keys, as a suggestion for a
 * new profile version that an admin reviews. Only values BeerSmith states are used; mash thickness
 * comes from BeerSmith's own water plan (strike water ÷ mashed grain) of the given recipes.
 * Never applied automatically (B11).
 */
export function suggestProfileFromBsmx(
  imports: readonly Pick<BsmxRecipeImport, "recipe" | "equipment" | "waterPlan" | "sourceDate">[],
): ProfileSuggestion | null {
  const withEquipment = imports.filter((item) => item.equipment !== null);
  // The most recent recipe reflects the brewery as it is now.
  const latest = [...withEquipment].sort((a, b) => (b.sourceDate ?? "").localeCompare(a.sourceDate ?? ""))[0];
  if (!latest?.equipment) return null;
  const { name, stated } = latest.equipment;
  const sameEquipment = withEquipment.filter((item) => item.equipment?.name === name);

  const values: ProfileSuggestion["values"] = {};
  const set = (key: ProfileParameterKey, value: number | undefined, decimals = 2) => {
    if (value !== undefined && Number.isFinite(value)) values[key] = round(value, decimals);
  };
  set("brewhouse_efficiency_pct", stated.efficiencyPct, 0);
  // Batch volume is scaled per recipe in BeerSmith; the brewery's usual size is the most common one.
  set("batch_volume_l", mostCommon(sameEquipment.map((item) => item.equipment?.stated.batchVolumeL)) ?? stated.batchVolumeL, 1);
  set("mash_tun_volume_l", stated.mashTunVolumeL, 1);
  set("mash_dead_space_l", stated.mashTunDeadspaceL);
  set("kettle_loss_l", stated.trubLossL);
  set("fermentation_loss_l", stated.fermenterLossL);
  set("boil_off_l_per_h", stated.boilOffLPerHour);
  set("cooling_shrinkage_pct", stated.coolingShrinkagePct, 1);

  // Mash thickness from the recipes brewed on this same equipment.
  const thicknesses = sameEquipment.flatMap((item) => {
    const grainKg = item.recipe.fermentables
      .filter((f) => f.type === "grain" || f.type === "adjunct")
      .reduce((sum, f) => sum + f.amountKg, 0);
    const mashWaterL = item.waterPlan.mashWaterL;
    return mashWaterL !== undefined && grainKg > 0 ? [mashWaterL / grainKg] : [];
  });
  if (thicknesses.length > 0) set("mash_thickness_l_per_kg", thicknesses.reduce((a, b) => a + b, 0) / thicknesses.length);

  return Object.keys(values).length > 0
    ? { sourceName: name, ...(latest.sourceDate && { sourceDate: latest.sourceDate }), values }
    : null;
}

const equipmentComparisonParameters = [
  { key: "boil_off_l_per_h", label: "fordampning", unit: "L/t" },
  { key: "batch_volume_l", label: "batchvolum", unit: "L" },
  { key: "mash_tun_volume_l", label: "meskekar", unit: "L" },
] as const satisfies readonly { key: ProfileParameterKey; label: string; unit: string }[];

const fiveYearsMs = 5 * 365.25 * 24 * 60 * 60 * 1000;
const formatComparisonValue = (value: number) => value.toLocaleString("nb-NO", { maximumFractionDigits: 1 });

/**
 * Returns a review warning when BeerSmith differs materially from today's active profile,
 * or its recipe date is more than five years old. `now` keeps the comparison deterministic.
 */
export function compareBsmxEquipmentWithProfile(
  suggestion: ProfileSuggestion,
  activeProfile: ProfileValues,
  now: number,
): string | null {
  const materialDifference = equipmentComparisonParameters
    .map((parameter) => ({
      ...parameter,
      suggested: suggestion.values[parameter.key],
      active: activeProfile[parameter.key],
    }))
    .filter(({ suggested, active }) => {
      if (suggested === undefined || active === undefined || !Number.isFinite(suggested) || !Number.isFinite(active)) return false;
      const relativeDifference = active === 0
        ? (suggested === 0 ? 0 : Number.POSITIVE_INFINITY)
        : Math.abs(suggested - active) / Math.abs(active);
      return relativeDifference > 0.15;
    });

  const sourceTimestamp = suggestion.sourceDate ? Date.parse(suggestion.sourceDate) : Number.NaN;
  const sourceIsOld = Number.isFinite(sourceTimestamp) && now - sourceTimestamp > fiveYearsMs;
  if (materialDifference.length === 0 && !sourceIsOld) return null;

  const difference = materialDifference[0];
  const sourceYear = Number.isFinite(sourceTimestamp) ? new Date(sourceTimestamp).getUTCFullYear() : null;
  if (difference) {
    const example = ` (f.eks. ${formatComparisonValue(difference.suggested!)} mot ${formatComparisonValue(difference.active!)} ${difference.unit} ${difference.label})`;
    const dateNote = sourceIsOld && sourceYear !== null ? ` BeerSmith-oppskriften er datert ${sourceYear}.` : "";
    return `Utstyret «${suggestion.sourceName}» ser ut til å være et annet anlegg enn dagens profil${example}.${dateNote} Sjekk før du lagrer.`;
  }

  return `BeerSmith-utstyret «${suggestion.sourceName}» er datert ${sourceYear}, mer enn fem år tilbake, og kan beskrive et annet anlegg enn dagens profil. Sjekk før du lagrer.`;
}
