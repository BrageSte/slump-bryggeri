import { deriveWaterValues, type WaterDerivedValues } from "../brewing-calculations/water-chemistry.ts";
import { ionInfo, ionKeys, type IonKey, type WaterProfile, type WaterValueBasis } from "../model/water.ts";
import { describeSulfateToChlorideRatio, ionGuidanceFor, isBelowTypical } from "./guidance.ts";

/**
 * Turns a source-water profile into labelled rows, each tagged with how we know the value:
 * "reported" (the source's own number) or "calculated" (ours, from the reported ions).
 * Targets and measured values come from the recipe and the log; see `batch-water.ts`.
 */

export interface WaterValueRow {
  key: string;
  label: string;
  value: number;
  unit: string;
  decimals: number;
  basis: WaterValueBasis;
  /** How a calculated value was reached, or a limit of a reported one. */
  note?: string;
  /** The source's own limit or action level for a reported value, verbatim. Not a brewing target. */
  limit?: string;
}

/** A published figure next to the same quantity recomputed from the published ions. */
export interface ReportedVersusCalculated {
  key: "alkalinity" | "hardness";
  label: string;
  unit: string;
  reported: number;
  calculated: number;
  /** True when they differ by no more than the rounding of the reported figure. */
  withinRounding: boolean;
}

export type HardnessClass = "very_soft" | "soft" | "harder";

export const hardnessClassLabels: Record<HardnessClass, string> = {
  very_soft: "Svært bløtt",
  soft: "Bløtt",
  harder: "Middels hardt eller hardere",
};

/** 0–4 °dH is the classic "very soft" band (ABV itself calls its water soft, below 4 °dH); 4–8 soft. */
export function classifyHardness(hardnessDh: number): HardnessClass {
  if (hardnessDh < 4) return "very_soft";
  if (hardnessDh < 8) return "soft";
  return "harder";
}

function decimalsOf(value: number): number {
  return String(value).split(".")[1]?.length ?? 0;
}

function row(partial: Omit<WaterValueRow, "basis" | "decimals"> & { basis: WaterValueBasis; decimals?: number }): WaterValueRow {
  return { decimals: decimalsOf(partial.value), ...partial };
}

/** A limit printed as a plain number ("0,2", "50"), or null for text like "Akseptabel for abonnenten". */
export function numericLimit(limit: string | null | undefined): number | null {
  if (limit === null || limit === undefined) return null;
  const cleaned = limit.trim().replace(",", ".");
  return /^\d+(\.\d+)?$/.test(cleaned) ? Number(cleaned) : null;
}

export interface SourceWaterDescription {
  reported: WaterValueRow[];
  /** The other parameters the source prints (iron, potassium, colour, heavy metals ...), as printed. */
  other: WaterValueRow[];
  /** How many of `other` have a numeric limit, and whether every one of those is below it. */
  limits: { checked: number; allBelow: boolean };
  calculated: WaterValueRow[];
  derived: WaterDerivedValues;
  checks: ReportedVersusCalculated[];
  hardnessClass: HardnessClass;
  /** Ions below the lowest level where any source reports a flavour or pH effect. */
  belowGuidance: IonKey[];
  /** True when every ion with a guidance window sits below it: the water is a blank slate. */
  lowMineral: boolean;
  ratioText: string;
}

export function describeSourceWater(profile: WaterProfile): SourceWaterDescription {
  const derived = deriveWaterValues(profile.ions);

  const reported: WaterValueRow[] = ionKeys.map((key) =>
    row({ key, label: `${ionInfo[key].name} (${ionInfo[key].symbol})`, value: profile.ions[key], unit: "mg/L", basis: "reported" }),
  );
  if (profile.alkalinityMmolL !== undefined) reported.push(row({ key: "alkalinity", label: "Alkalitet", value: profile.alkalinityMmolL, unit: "mmol/L", basis: "reported" }));
  if (profile.hardnessDh !== undefined) reported.push(row({ key: "hardness", label: "Hardhet", value: profile.hardnessDh, unit: "°dH", basis: "reported" }));
  if (profile.ph !== undefined) reported.push(row({ key: "ph", label: "pH i vannet", value: profile.ph, unit: "", basis: "reported", note: "Råvannets pH sier lite om mesk-pH; se docs/water.md." }));

  // A profile frozen into a batch before this field existed has none.
  const otherReported = profile.otherReported ?? [];
  const other: WaterValueRow[] = otherReported.map((parameter) =>
    row({
      key: `other:${parameter.name}`,
      label: parameter.name,
      value: parameter.value,
      unit: parameter.unit ?? "",
      basis: "reported",
      ...(parameter.limit === null ? {} : { limit: parameter.limit }),
    }),
  );
  const numericLimits = otherReported.flatMap((parameter) => {
    const limit = numericLimit(parameter.limit);
    return limit === null ? [] : [{ value: parameter.value, limit }];
  });

  const calculated: WaterValueRow[] = [
    row({ key: "alkalinity_caco3", label: "Alkalitet som CaCO₃", value: derived.alkalinityAsCaCO3MgL, unit: "mg/L", decimals: 1, basis: "calculated", note: "Fra bikarbonat" }),
    row({ key: "hardness_dh", label: "Hardhet", value: derived.hardnessDh, unit: "°dH", decimals: 2, basis: "calculated", note: "Fra kalsium og magnesium" }),
    row({ key: "residual_alkalinity", label: "Restalkalitet (RA) som CaCO₃", value: derived.residualAlkalinityAsCaCO3MgL, unit: "mg/L", decimals: 1, basis: "calculated", note: "Kolbach: alkalitet − Ca/3,5 − Mg/7. En indeks, ikke en pH-prediksjon." }),
  ];
  if (derived.sulfateToChlorideRatio !== null) {
    calculated.push(row({ key: "so4_cl_ratio", label: "Sulfat:klorid", value: derived.sulfateToChlorideRatio, unit: "", decimals: 2, basis: "calculated" }));
  }

  const checks: ReportedVersusCalculated[] = [];
  const compare = (key: ReportedVersusCalculated["key"], label: string, unit: string, reportedValue: number | undefined, calculatedValue: number) => {
    if (reportedValue === undefined) return;
    const rounding = 0.5 * 10 ** -decimalsOf(reportedValue);
    checks.push({ key, label, unit, reported: reportedValue, calculated: calculatedValue, withinRounding: Math.abs(reportedValue - calculatedValue) <= rounding });
  };
  compare("alkalinity", "Alkalitet", "mmol/L", profile.alkalinityMmolL, derived.alkalinityMmolL);
  compare("hardness", "Hardhet", "°dH", profile.hardnessDh, derived.hardnessDh);

  const belowGuidance = ionKeys.filter((key) => isBelowTypical(key, profile.ions[key]));
  // Sodium has no lower bound (0 mg/L is fine), so it cannot be "below"; bicarbonate has no window at all.
  const windowed = ionKeys.filter((key) => (ionGuidanceFor(key).typical?.min ?? 0) > 0);

  return {
    reported,
    other,
    limits: { checked: numericLimits.length, allBelow: numericLimits.every((entry) => entry.value < entry.limit) },
    calculated,
    derived,
    checks,
    hardnessClass: classifyHardness(profile.hardnessDh ?? derived.hardnessDh),
    belowGuidance,
    lowMineral: windowed.every((key) => belowGuidance.includes(key)),
    ratioText: describeSulfateToChlorideRatio(derived.sulfateToChlorideRatio, profile.ions),
  };
}
