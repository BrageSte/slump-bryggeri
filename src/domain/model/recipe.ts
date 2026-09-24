import { z } from "zod";

/**
 * Normalized recipe document — the internal representation every import adapter
 * (manual editor, BeerXML, BeerJSON, AI extraction …) converts into.
 *
 * Deliberately close in spirit to BeerJSON, but metric-only and flattened:
 * all amounts are SI/metric (kg, g, L, °C, minutes, days). Conversions from
 * imperial units happen in the import adapters, never here.
 *
 * Stored as JSON in `recipe_versions.data` and frozen into `batch_recipe_snapshots`.
 */

export const RECIPE_SCHEMA_VERSION = 1;

const itemId = z.string().min(1).max(64);
const name = z.string().trim().min(1, "Mangler navn").max(120);
const note = z.string().trim().max(1000).optional();

export const fermentableTypes = ["grain", "adjunct", "extract", "sugar", "other"] as const;
export const hopUses = ["mash", "first_wort", "boil", "whirlpool", "dry_hop"] as const;
export const hopForms = ["pellet", "whole", "cryo", "extract", "other"] as const;
export const cultureForms = ["dry", "liquid", "slurry", "other"] as const;
export const miscUses = ["mash", "boil", "whirlpool", "fermentation", "packaging", "other"] as const;

export const fermentableSchema = z.object({
  id: itemId,
  name,
  type: z.enum(fermentableTypes),
  amountKg: z.number().positive().max(1000),
  /** Colour in EBC. */
  colorEbc: z.number().min(0).max(4000).optional(),
  /** Extract potential as % of sucrose (fine grind, dry basis). Typical pale malt ≈ 80. */
  yieldPct: z.number().min(0).max(100).optional(),
  producer: z.string().trim().max(120).optional(),
  notes: note,
});

export const hopAdditionSchema = z.object({
  id: itemId,
  name,
  amountG: z.number().positive().max(100_000),
  alphaPct: z.number().min(0).max(30).optional(),
  use: z.enum(hopUses),
  /** Boil: minutes before end of boil. Whirlpool: steep duration. */
  timeMin: z.number().min(0).max(600).optional(),
  /** Whirlpool/hop stand temperature. */
  temperatureC: z.number().min(0).max(110).optional(),
  /** Dry hop: day of fermentation the addition is planned for. */
  dayOfFermentation: z.number().min(0).max(365).optional(),
  form: z.enum(hopForms).optional(),
  cropYear: z.number().int().min(1990).max(2100).optional(),
  /** Name of the fermentation variant this addition belongs to, when a batch is split. */
  variant: z.string().trim().max(60).optional(),
  notes: note,
});

export const cultureSchema = z.object({
  id: itemId,
  name,
  producer: z.string().trim().max(120).optional(),
  form: z.enum(cultureForms),
  amount: z.number().positive().max(100_000),
  /** pkg, g, ml or l. */
  unit: z.enum(["pkg", "g", "ml", "l"]),
  attenuationPct: z.number().min(0).max(100).optional(),
  variant: z.string().trim().max(60).optional(),
  notes: note,
});

export const miscSchema = z.object({
  id: itemId,
  name,
  amount: z.number().positive().max(100_000),
  unit: z.string().trim().min(1).max(20),
  use: z.enum(miscUses),
  /** Boil: minutes before end of boil. */
  timeMin: z.number().min(0).max(600).optional(),
  notes: note,
});

export const mashStepSchema = z.object({
  id: itemId,
  name,
  temperatureC: z.number().min(0).max(100),
  durationMin: z.number().min(0).max(600),
  notes: note,
});

export const fermentationStepSchema = z.object({
  id: itemId,
  name,
  temperatureC: z.number().min(-5).max(60).optional(),
  /** Upper bound when the plan is a range, e.g. 18–19 °C. */
  temperatureMaxC: z.number().min(-5).max(60).optional(),
  durationDays: z.number().min(0).max(365).optional(),
  notes: note,
});

export const recipeTargetsSchema = z.object({
  og: z.number().min(1).max(1.2).optional(),
  fg: z.number().min(0.98).max(1.1).optional(),
  // Calculated IBU is theoretical and can exceed what anyone can taste (BrewDog lists 1157).
  ibu: z.number().min(0).max(2000).optional(),
  // Freeze-concentrated beers (eisbock, BrewDog's The End of History) reach ~55 %.
  abvPct: z.number().min(0).max(70).optional(),
  colorEbc: z.number().min(0).max(4000).optional(),
  mashPhMin: z.number().min(3).max(8).optional(),
  mashPhMax: z.number().min(3).max(8).optional(),
});

export const recipeDocumentSchema = z.object({
  schemaVersion: z.literal(RECIPE_SCHEMA_VERSION),
  name,
  style: z.string().trim().max(120).optional(),
  description: z.string().trim().max(4000).optional(),
  author: z.string().trim().max(120).optional(),
  /** Volume into the fermenter(s). */
  batchSizeL: z.number().positive().max(10_000),
  boilTimeMin: z.number().min(0).max(600),
  /** Brewhouse efficiency the recipe was designed for. */
  efficiencyPct: z.number().min(1).max(100),
  spargeTemperatureC: z.number().min(0).max(100).optional(),
  fermentables: z.array(fermentableSchema).max(50),
  hops: z.array(hopAdditionSchema).max(100),
  cultures: z.array(cultureSchema).max(20),
  miscs: z.array(miscSchema).max(50),
  mashSteps: z.array(mashStepSchema).max(20),
  fermentationSteps: z.array(fermentationStepSchema).max(20),
  targets: recipeTargetsSchema,
  notes: z.string().trim().max(10_000).optional(),
});

export type RecipeDocument = z.infer<typeof recipeDocumentSchema>;
export type Fermentable = z.infer<typeof fermentableSchema>;
export type HopAddition = z.infer<typeof hopAdditionSchema>;
export type Culture = z.infer<typeof cultureSchema>;
export type Misc = z.infer<typeof miscSchema>;
export type MashStep = z.infer<typeof mashStepSchema>;
export type FermentationStep = z.infer<typeof fermentationStepSchema>;
export type FermentableType = (typeof fermentableTypes)[number];
export type HopUse = (typeof hopUses)[number];

export function emptyRecipe(overrides: Partial<RecipeDocument> = {}): RecipeDocument {
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    name: "",
    batchSizeL: 20,
    boilTimeMin: 60,
    efficiencyPct: 72,
    fermentables: [],
    hops: [],
    cultures: [],
    miscs: [],
    mashSteps: [],
    fermentationSteps: [],
    targets: {},
    ...overrides,
  };
}

export const hopUseLabels: Record<HopUse, string> = {
  mash: "Mesk",
  first_wort: "First wort",
  boil: "Kok",
  whirlpool: "Whirlpool",
  dry_hop: "Tørrhumling",
};

export const fermentableTypeLabels: Record<FermentableType, string> = {
  grain: "Malt",
  adjunct: "Adjunkt",
  extract: "Ekstrakt",
  sugar: "Sukker",
  other: "Annet",
};
