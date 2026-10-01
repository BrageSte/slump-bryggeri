import { ionKeys, type IonConcentrations, type IonKey, type PartialIonConcentrations, type SaltComposition } from "../model/water.ts";

/**
 * Water chemistry arithmetic: what follows from an ion profile and from dissolving salts in it.
 * Everything here is stoichiometry or a textbook definition; nothing predicts mash pH (that depends
 * on the grain bill and needs measured data, see docs/water.md). Concentrations are mg/L.
 */

// Standard atomic masses, g/mol.
const H = 1.008;
const C = 12.011;
const O = 15.999;
const NA = 22.99;
const MG = 24.305;
const S = 32.06;
const CL = 35.45;
const CA = 40.078;

/** Molar mass of each ion, g/mol. */
export const ionMolarMass: Record<IonKey, number> = {
  ca: CA,
  mg: MG,
  na: NA,
  cl: CL,
  so4: S + 4 * O,
  hco3: H + C + 3 * O,
};

const CACO3_MOLAR_MASS = CA + C + 3 * O;
const WATER_MOLAR_MASS = 2 * H + O;
/** Equivalent weight of CaCO3 (it carries two charges), g/eq. */
const CACO3_EQUIVALENT_MASS = CACO3_MOLAR_MASS / 2;
/** One German degree of hardness is 10 mg/L CaO. */
const MMOL_PER_DEGREE_DH = 10 / (CA + O);

/** Alkalinity in mmol/L (= meq/L) when bicarbonate is the only alkalinity species, as in water with pH between 6 and 9. */
export function alkalinityMmolFromBicarbonate(hco3MgL: number): number {
  return hco3MgL / ionMolarMass.hco3;
}

/** The same alkalinity expressed as mg/L CaCO3, the unit mash-pH rules of thumb use. */
export function alkalinityAsCaCO3FromBicarbonate(hco3MgL: number): number {
  return alkalinityMmolFromBicarbonate(hco3MgL) * CACO3_EQUIVALENT_MASS;
}

/** Calcium plus magnesium in mmol/L. */
export function hardnessMmol(input: { ca: number; mg: number }): number {
  return input.ca / ionMolarMass.ca + input.mg / ionMolarMass.mg;
}

/** Total hardness in German degrees (°dH). */
export function hardnessDegreesDh(input: { ca: number; mg: number }): number {
  return hardnessMmol(input) / MMOL_PER_DEGREE_DH;
}

/**
 * Residual alkalinity (Kolbach) in mg/L as CaCO3: the alkalinity left after calcium and magnesium
 * have reacted with malt phosphates. A rule-of-thumb index of how much the water pushes mash pH up,
 * not a pH prediction.
 */
export function residualAlkalinityAsCaCO3(input: { ca: number; mg: number; hco3: number }): number {
  const caAsCaCO3 = input.ca * (CACO3_MOLAR_MASS / ionMolarMass.ca);
  const mgAsCaCO3 = input.mg * (CACO3_MOLAR_MASS / ionMolarMass.mg);
  return alkalinityAsCaCO3FromBicarbonate(input.hco3) - (caAsCaCO3 / 3.5 + mgAsCaCO3 / 7);
}

/**
 * Sulfate to chloride ratio (SO₄:Cl). High reads dry and hop-forward, low reads round and malty.
 * Null without chloride, where the ratio is undefined.
 */
export function sulfateToChlorideRatio(input: { so4: number; cl: number }): number | null {
  return input.cl > 0 ? input.so4 / input.cl : null;
}

export interface SaltMassFractions {
  molarMassGPerMol: number;
  /** Mass fraction of each ion in the dry-weighed salt, e.g. 0.2328 Ca in gypsum dihydrate. */
  ions: Partial<Record<IonKey, number>>;
}

/** Mass fractions of the ions in a salt, from its formula (crystal water included in the molar mass). */
export function saltMassFractions(composition: SaltComposition): SaltMassFractions {
  const ions: Partial<Record<IonKey, number>> = {};
  let molarMass = (composition.hydrationWater ?? 0) * WATER_MOLAR_MASS;
  for (const key of ionKeys) molarMass += (composition[key] ?? 0) * ionMolarMass[key];
  if (molarMass <= 0) throw new RangeError("A salt needs at least one ion");
  for (const key of ionKeys) {
    const count = composition[key];
    if (count) ions[key] = (count * ionMolarMass[key]) / molarMass;
  }
  return { molarMassGPerMol: molarMass, ions };
}

/** mg/L added to each ion by dissolving `grams` of a salt in `waterVolumeL`. */
export function saltIonIncrease(composition: SaltComposition, grams: number, waterVolumeL: number): PartialIonConcentrations {
  if (waterVolumeL <= 0) throw new RangeError("waterVolumeL must be positive");
  if (grams < 0) throw new RangeError("grams cannot be negative");
  const increase: PartialIonConcentrations = {};
  for (const [key, fraction] of Object.entries(saltMassFractions(composition).ions) as [IonKey, number][]) {
    increase[key] = (fraction * grams * 1000) / waterVolumeL;
  }
  return increase;
}

/** The ion profile after dissolving the salts in `waterVolumeL` of the source water. */
export function addSaltsToWater(
  source: IonConcentrations,
  salts: { composition: SaltComposition; grams: number }[],
  waterVolumeL: number,
): IonConcentrations {
  const result: IonConcentrations = { ...source };
  for (const salt of salts) {
    for (const [key, value] of Object.entries(saltIonIncrease(salt.composition, salt.grams, waterVolumeL)) as [IonKey, number][]) {
      result[key] += value;
    }
  }
  return result;
}

export interface WaterDerivedValues {
  alkalinityMmolL: number;
  alkalinityAsCaCO3MgL: number;
  hardnessMmolL: number;
  hardnessDh: number;
  residualAlkalinityAsCaCO3MgL: number;
  sulfateToChlorideRatio: number | null;
}

/** Everything that follows from an ion profile. */
export function deriveWaterValues(ions: IonConcentrations): WaterDerivedValues {
  return {
    alkalinityMmolL: alkalinityMmolFromBicarbonate(ions.hco3),
    alkalinityAsCaCO3MgL: alkalinityAsCaCO3FromBicarbonate(ions.hco3),
    hardnessMmolL: hardnessMmol(ions),
    hardnessDh: hardnessDegreesDh(ions),
    residualAlkalinityAsCaCO3MgL: residualAlkalinityAsCaCO3(ions),
    sulfateToChlorideRatio: sulfateToChlorideRatio(ions),
  };
}
