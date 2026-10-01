import { z } from "zod";
import type { BrewStage } from "./brewing.ts";

/**
 * Water chemistry vocabulary and schemas: ions, water profiles with their source, the planned
 * water in a recipe, the salts and acids a brewer adds, and where in the brew a pH was taken.
 *
 * Four kinds of value are kept apart everywhere (`WaterValueBasis`): what the source reports,
 * what we calculate from it, what a recipe or guideline aims for, and what was measured in a brew.
 * The canonical Slump profile lives in `src/domain/water/slump-water.ts`; arithmetic in
 * `src/domain/brewing-calculations/water-chemistry.ts`.
 */

// ---------------------------------------------------------------------------
// Ions
// ---------------------------------------------------------------------------

export const ionKeys = ["ca", "mg", "na", "cl", "so4", "hco3"] as const;
export type IonKey = (typeof ionKeys)[number];

export const ionInfo: Record<IonKey, { symbol: string; name: string }> = {
  ca: { symbol: "Ca", name: "Kalsium" },
  mg: { symbol: "Mg", name: "Magnesium" },
  na: { symbol: "Na", name: "Natrium" },
  cl: { symbol: "Cl", name: "Klorid" },
  so4: { symbol: "SO₄", name: "Sulfat" },
  hco3: { symbol: "HCO₃", name: "Bikarbonat" },
};

const mgPerL = z.number().min(0).max(5000);

/** Ion concentrations in mg/L (= ppm for drinking water). */
export const ionConcentrationsSchema = z.object({ ca: mgPerL, mg: mgPerL, na: mgPerL, cl: mgPerL, so4: mgPerL, hco3: mgPerL });
export type IonConcentrations = z.infer<typeof ionConcentrationsSchema>;

/** A planned profile may state only the ions the brewer cares about. */
export const partialIonConcentrationsSchema = ionConcentrationsSchema.partial();
export type PartialIonConcentrations = z.infer<typeof partialIonConcentrationsSchema>;

// ---------------------------------------------------------------------------
// The four kinds of value
// ---------------------------------------------------------------------------

export const waterValueBases = ["reported", "calculated", "target", "measured"] as const;
export type WaterValueBasis = (typeof waterValueBases)[number];

export const waterValueBasisLabels: Record<WaterValueBasis, string> = {
  reported: "Oppgitt (kilde)",
  calculated: "Beregnet",
  target: "Mål / anbefaling",
  measured: "Målt i brygget",
};

// ---------------------------------------------------------------------------
// Water profile and its source
// ---------------------------------------------------------------------------

export const waterSourceKinds = ["supplier_report", "lab_analysis", "brewer_estimate"] as const;
export type WaterSourceKind = (typeof waterSourceKinds)[number];

export const waterSourceKindLabels: Record<WaterSourceKind, string> = {
  supplier_report: "Vannverkets oppgitte verdier",
  lab_analysis: "Laboratorieanalyse",
  brewer_estimate: "Brygger sitt anslag",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Dato må være ÅÅÅÅ-MM-DD");

/** Where a profile's numbers came from, so it can be re-verified and updated later. */
export const waterSourceSchema = z.object({
  kind: z.enum(waterSourceKinds),
  organization: z.string().trim().min(1).max(120),
  /** The page or document the numbers were read from. */
  title: z.string().trim().min(1).max(200),
  url: z.url().refine((value) => value.startsWith("https://"), "Kilden må ha en https-lenke"),
  /** The day we read the numbers from the source. */
  retrievedAt: isoDate,
  /** Analysis or publication date when the source states one; null when it does not. */
  publishedAt: isoDate.nullable(),
  /** HTTP `Last-Modified` of the page at retrieval. It dates the page, not the analysis. */
  lastModifiedAt: isoDate.nullable(),
  note: z.string().trim().max(1000).optional(),
});
export type WaterSource = z.infer<typeof waterSourceSchema>;

/** A published parameter the app does not calculate with (iron, potassium, colour, heavy metals ...), kept as the source prints it. */
export const reportedParameterSchema = z.object({
  /** The name as the source prints it, e.g. "Jern" or "Tot.org.karbon". */
  name: z.string().trim().min(1).max(80),
  value: z.number().finite(),
  /** The unit as printed; null when the source prints none. */
  unit: z.string().trim().min(1).max(40).nullable(),
  /** The source's limit or action level, verbatim ("0,2", "Akseptabel for abonnenten"); null when it prints none. */
  limit: z.string().trim().min(1).max(80).nullable(),
});
export type ReportedParameter = z.infer<typeof reportedParameterSchema>;

/** Who confirmed that this is the water the brewery actually uses, and when. */
export const confirmedUseSchema = z.object({
  confirmedBy: z.string().trim().min(1).max(80),
  confirmedAt: isoDate,
  note: z.string().trim().max(300).optional(),
});
export type ConfirmedUse = z.infer<typeof confirmedUseSchema>;

/**
 * A source-water profile. `ions`, `alkalinityMmolL`, `hardnessDh`, `ph` and `otherReported` are exactly as the
 * source publishes them (basis "reported"); everything derived from them is computed on demand and never stored here.
 * Together they hold every parameter the source prints for this water; the ones the app calculates with are typed,
 * the rest are in `otherReported`, so no value is written twice.
 */
export const waterProfileSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{2,63}$/, "Ugyldig profil-id"),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  ions: ionConcentrationsSchema,
  /** Total alkalinity as published, mmol/L. */
  alkalinityMmolL: z.number().min(0).max(50).optional(),
  /** Total hardness as published, °dH. */
  hardnessDh: z.number().min(0).max(100).optional(),
  /** pH of the water as delivered. */
  ph: z.number().min(0).max(14).optional(),
  /** Every other parameter the source prints for this water. May be empty (a source that prints only the ions). */
  otherReported: z.array(reportedParameterSchema).max(100),
  /** Set when the brewery has confirmed this is the water it uses; absent while that is only assumed. */
  confirmedUse: confirmedUseSchema.nullable().optional(),
  source: waterSourceSchema,
  /** Limits of the numbers a brewer should know about. */
  caveats: z.array(z.string().trim().min(1).max(600)).max(10),
});
export type WaterProfile = z.infer<typeof waterProfileSchema>;

// ---------------------------------------------------------------------------
// Planned water in a recipe
// ---------------------------------------------------------------------------

/**
 * What a recipe plans for its brewing water. The mash pH target stays in `recipe.targets`.
 * Salts and acids are planned as ordinary `miscs` carrying a `waterAgent`.
 */
export const recipeWaterPlanSchema = z.object({
  /** Planned ion concentrations (mg/L) in the total brewing water after additions: a plan, not a measurement. */
  target: partialIonConcentrationsSchema.optional(),
  /** Short name of the intent, e.g. "Kloridfremhevet" or "Myk og nøytral". */
  profileName: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type RecipeWaterPlan = z.infer<typeof recipeWaterPlanSchema>;

// ---------------------------------------------------------------------------
// Salts and acids
// ---------------------------------------------------------------------------

/** Atoms/ions per formula unit; `hydrationWater` is the number of crystal-water molecules. */
export interface SaltComposition {
  ca?: number;
  mg?: number;
  na?: number;
  cl?: number;
  so4?: number;
  hco3?: number;
  hydrationWater?: number;
}

export interface WaterAgentBase {
  id: string;
  label: string;
  /** Short name for lists and the log. */
  shortLabel: string;
}

export interface SaltAgent extends WaterAgentBase {
  kind: "salt";
  composition: SaltComposition;
}

export interface AcidAgent extends WaterAgentBase {
  kind: "acid";
  /** Concentrations (% w/w) the product is commonly sold at; the brewer states the one used. */
  typicalStrengthsPct: readonly number[];
}

export type WaterAgent = SaltAgent | AcidAgent;

/**
 * The salts and acids Slump can record. Chalk and slaked lime are left out on purpose: they dissolve
 * poorly and their effect depends on the water's CO₂, so they are logged as plain additions.
 * Acidulated malt is a grain: it is planned as a fermentable and shows up through the grain bill.
 */
export const waterAgents = [
  { id: "gypsum", kind: "salt", label: "Gips (kalsiumsulfat, CaSO₄·2H₂O)", shortLabel: "Gips", composition: { ca: 1, so4: 1, hydrationWater: 2 } },
  { id: "calcium_chloride_dihydrate", kind: "salt", label: "Kalsiumklorid, dihydrat (CaCl₂·2H₂O)", shortLabel: "Kalsiumklorid (dihydrat)", composition: { ca: 1, cl: 2, hydrationWater: 2 } },
  { id: "calcium_chloride_anhydrous", kind: "salt", label: "Kalsiumklorid, vannfri (CaCl₂)", shortLabel: "Kalsiumklorid (vannfri)", composition: { ca: 1, cl: 2 } },
  { id: "epsom_salt", kind: "salt", label: "Epsomsalt (magnesiumsulfat, MgSO₄·7H₂O)", shortLabel: "Epsomsalt", composition: { mg: 1, so4: 1, hydrationWater: 7 } },
  { id: "table_salt", kind: "salt", label: "Bordsalt (natriumklorid, NaCl)", shortLabel: "Bordsalt", composition: { na: 1, cl: 1 } },
  { id: "baking_soda", kind: "salt", label: "Natron (natriumbikarbonat, NaHCO₃)", shortLabel: "Natron", composition: { na: 1, hco3: 1 } },
  { id: "lactic_acid", kind: "acid", label: "Melkesyre", shortLabel: "Melkesyre", typicalStrengthsPct: [80, 88, 90] },
  { id: "phosphoric_acid", kind: "acid", label: "Fosforsyre", shortLabel: "Fosforsyre", typicalStrengthsPct: [10, 75, 85] },
] as const satisfies readonly WaterAgent[];

export type WaterAgentId = (typeof waterAgents)[number]["id"];
export const waterAgentIds = waterAgents.map((agent) => agent.id) as [WaterAgentId, ...WaterAgentId[]];
export const waterAgentIdSchema = z.enum(waterAgentIds);

export function getWaterAgent(id: string | undefined | null): WaterAgent | undefined {
  return waterAgents.find((agent) => agent.id === id);
}

export function isSaltAgent(agent: WaterAgent | undefined): agent is SaltAgent {
  return agent?.kind === "salt";
}

export function isAcidAgent(agent: WaterAgent | undefined): agent is AcidAgent {
  return agent?.kind === "acid";
}

// ---------------------------------------------------------------------------
// pH sample points
// ---------------------------------------------------------------------------

/**
 * Where in the process a pH reading was taken. Stored without a schema change: the brew stage and the
 * measurement label already carry it (see `classifyPhSamplePoint` in `src/domain/water/ph.ts`).
 */
export const phSamplePoints = ["mash", "pre_boil", "post_boil", "fermentation", "final"] as const;
export type PhSamplePoint = (typeof phSamplePoints)[number];

export const phSamplePointLabels: Record<PhSamplePoint, string> = {
  mash: "Mesk",
  pre_boil: "Før kok",
  post_boil: "Etter kok",
  fermentation: "Under gjæring",
  final: "Ferdig øl",
};

/** Label written on the measurement when the point is not implied by the stage. */
export const phSamplePointMeasurementLabels: Record<PhSamplePoint, string> = {
  mash: "Mesk-pH",
  pre_boil: "pH før kok",
  post_boil: "pH etter kok",
  fermentation: "pH under gjæring",
  final: "Slutt-pH",
};

/** The point a pH reading in this stage means when nothing else is said; null when the stage is ambiguous. */
export const phSamplePointByStage: Record<BrewStage, PhSamplePoint | null> = {
  mash: "mash",
  // The wort is in the kettle but not yet boiling (state.ts reads lauter-stage readings as pre-boil too).
  lauter: "pre_boil",
  // A reading during the boil can be either; the brewer says which.
  boil: null,
  whirlpool: "post_boil",
  cooling: "post_boil",
  fermentation: "fermentation",
  // Conditioning can mean anything from a week-two check to the finished beer.
  conditioning: null,
  packaging: "final",
};
