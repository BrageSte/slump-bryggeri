import { z } from "zod";

// ---------------------------------------------------------------------------
// Brew stages
// ---------------------------------------------------------------------------

export const brewStages = [
  "mash",
  "lauter",
  "boil",
  "whirlpool",
  "cooling",
  "fermentation",
  "conditioning",
  "packaging",
] as const;
export type BrewStage = (typeof brewStages)[number];
export const brewStageSchema = z.enum(brewStages);

export const brewStageLabels: Record<BrewStage, string> = {
  mash: "Mesk",
  lauter: "Skylling",
  boil: "Kok",
  whirlpool: "Whirlpool",
  cooling: "Kjøling",
  fermentation: "Gjæring",
  conditioning: "Modning",
  packaging: "Pakking",
};

/** Label for the primary button that starts a stage. */
export const startStageLabels: Record<BrewStage, string> = {
  mash: "Start mesking",
  lauter: "Start overføring",
  boil: "Start kok",
  whirlpool: "Start whirlpool",
  cooling: "Start kjøling",
  fermentation: "Gjær tilsatt",
  conditioning: "Start modning",
  packaging: "Start pakking",
};

export function nextStage(stage: BrewStage | null): BrewStage | null {
  if (stage === null) return brewStages[0];
  const index = brewStages.indexOf(stage);
  return brewStages[index + 1] ?? null;
}

export function fermentationHasStarted(stage: BrewStage | null): boolean {
  return stage === "fermentation" || stage === "conditioning" || stage === "packaging";
}

/** Event type recorded when a stage starts, e.g. `boil_started`. */
export function stageStartedEventType(stage: BrewStage): string {
  return `${stage}_started`;
}

export function stageFromStartedEvent(type: string): BrewStage | null {
  const match = /^([a-z]+)_started$/.exec(type);
  const candidate = match?.[1];
  return candidate && (brewStages as readonly string[]).includes(candidate) ? (candidate as BrewStage) : null;
}

// ---------------------------------------------------------------------------
// Batch status
// ---------------------------------------------------------------------------

export const batchStatuses = ["planned", "brewing", "fermenting", "conditioning", "completed"] as const;
export type BatchStatus = (typeof batchStatuses)[number];
export const batchStatusSchema = z.enum(batchStatuses);

export const batchStatusLabels: Record<BatchStatus, string> = {
  planned: "Planlagt",
  brewing: "Brygger nå",
  fermenting: "Gjærer",
  conditioning: "Modner",
  completed: "Ferdig",
};

export function statusForStage(stage: BrewStage): BatchStatus {
  switch (stage) {
    case "mash":
    case "lauter":
    case "boil":
    case "whirlpool":
    case "cooling":
      return "brewing";
    case "fermentation":
      return "fermenting";
    case "conditioning":
    case "packaging":
      return "conditioning";
  }
}

// ---------------------------------------------------------------------------
// Measurements
// ---------------------------------------------------------------------------

export const measurementKinds = [
  "temperature",
  "ph",
  "sg",
  "brix",
  "pressure",
  "volume",
  "flow",
  "weight",
  "custom",
] as const;
export type MeasurementKind = (typeof measurementKinds)[number];
export const measurementKindSchema = z.enum(measurementKinds);

export const measurementUnitPreferences = ["metric", "us_volume", "mixed"] as const;
export type MeasurementUnitPreference = (typeof measurementUnitPreferences)[number];
export const measurementUnitPreferenceSchema = z.enum(measurementUnitPreferences);

export interface MeasurementKindSpec {
  label: string;
  /** Canonical unit stored in the database. `null` means free text (custom). */
  unit: string | null;
  decimals: number;
  min: number;
  max: number;
  /** Absolute tolerance used when comparing against a single-value target. */
  tolerance: number;
}

export const measurementKindSpecs: Record<MeasurementKind, MeasurementKindSpec> = {
  temperature: { label: "Temperatur", unit: "°C", decimals: 1, min: -20, max: 110, tolerance: 0.5 },
  ph: { label: "pH", unit: "pH", decimals: 2, min: 0, max: 14, tolerance: 0.05 },
  sg: { label: "SG", unit: "SG", decimals: 3, min: 0.95, max: 1.2, tolerance: 0.002 },
  brix: { label: "Brix", unit: "°Bx", decimals: 1, min: 0, max: 40, tolerance: 0.3 },
  pressure: { label: "Trykk", unit: "bar", decimals: 2, min: -1, max: 10, tolerance: 0.1 },
  volume: { label: "Volum", unit: "L", decimals: 1, min: 0, max: 10_000, tolerance: 1 },
  flow: { label: "Flow", unit: "L/min", decimals: 1, min: 0, max: 1000, tolerance: 0.5 },
  weight: { label: "Vekt", unit: "g", decimals: 1, min: 0, max: 1_000_000, tolerance: 1 },
  custom: { label: "Annet", unit: null, decimals: 2, min: -1_000_000, max: 1_000_000, tolerance: 0 },
};

export function formatMeasurementValue(kind: MeasurementKind, value: number): string {
  const { decimals } = measurementKindSpecs[kind];
  if (kind === "sg") return value.toFixed(3);
  return value.toLocaleString("nb-NO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

// ---------------------------------------------------------------------------
// Brew events
// ---------------------------------------------------------------------------

/**
 * The event vocabulary is open: any lower_snake_case type is accepted so a new brewing step
 * never needs a schema change. These are the types the app itself understands.
 */
export const knownEventTypes = [
  "measurement",
  "comment",
  "photo",
  "ingredient_added",
  "transfer_started",
  "transfer_completed",
  "yeast_pitched",
  "pressure_changed",
  "cold_crash_started",
  "packaged",
  "status_changed",
  "custom",
  ...brewStages.map(stageStartedEventType),
] as const;

export const eventTypeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,47}$/, "Ugyldig hendelsestype");

export const eventTypeLabels: Record<string, string> = {
  measurement: "Måling",
  comment: "Kommentar",
  photo: "Bilde",
  ingredient_added: "Tilsetning",
  transfer_started: "Overføring startet",
  transfer_completed: "Overføring ferdig",
  yeast_pitched: "Gjær tilsatt",
  pressure_changed: "Trykk endret",
  cold_crash_started: "Cold crash startet",
  packaged: "Pakket",
  status_changed: "Status endret",
  custom: "Hendelse",
  mash_started: "Mesking startet",
  lauter_started: "Overføring/skylling startet",
  boil_started: "Kok startet",
  whirlpool_started: "Whirlpool startet",
  cooling_started: "Kjøling startet",
  fermentation_started: "Gjæring startet",
  conditioning_started: "Modning startet",
  packaging_started: "Pakking startet",
};

export const ingredientKinds = ["fermentable", "hop", "culture", "misc"] as const;
export type IngredientKind = (typeof ingredientKinds)[number];

/** Payload of an `ingredient_added` event. */
export const ingredientAddedDataSchema = z.object({
  ingredientKind: z.enum(ingredientKinds),
  /** Id of the addition in the batch recipe snapshot, when the addition was planned. */
  ingredientId: z.string().max(64).optional(),
  name: z.string().trim().min(1).max(120),
  amount: z.number().positive().max(1_000_000),
  unit: z.string().trim().min(1).max(20),
  note: z.string().trim().max(500).optional(),
});
export type IngredientAddedData = z.infer<typeof ingredientAddedDataSchema>;
