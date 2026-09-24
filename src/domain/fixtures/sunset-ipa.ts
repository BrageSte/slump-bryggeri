import type { BrewStage, IngredientAddedData, MeasurementKind } from "../model/brewing.ts";
import { RECIPE_SCHEMA_VERSION, type RecipeDocument } from "../model/recipe.ts";

/**
 * First realistic reference batch: "Sunset IPA – Tropical & Pine", brewed 23 Sept 2026
 * (source: Sunset_IPA_bryggelogg.pdf).
 *
 * Everything below comes from the brew log unless marked ASSUMPTION. Assumed values are
 * typical figures needed for calculations (malt colour/yield, mash duration) or illustrative
 * clock times — the log records the order of events, not the times.
 */
export const sunsetIpaRecipe: RecipeDocument = {
  schemaVersion: RECIPE_SCHEMA_VERSION,
  name: "Sunset IPA – Tropical & Pine",
  style: "American IPA (humledrevet)",
  description:
    "Humledrevet amerikansk IPA brygget som én base og delt i to varianter etter nedkjøling: " +
    "Sunset Tropical i FermZilla og Sunset Pine i 25 L gjæringsbøtte.",
  batchSizeL: 60,
  boilTimeMin: 60,
  // ASSUMPTION: back-calculated from OG ≈ 1.061 at 60 L with the assumed malt yields below.
  efficiencyPct: 60,
  spargeTemperatureC: 77.5,
  fermentables: [
    // ASSUMPTION (all four): colour and yield are typical values for these malts, not from the log.
    { id: "f-pale", name: "BEST Pale Ale", type: "grain", amountKg: 14.8, colorEbc: 6.5, yieldPct: 80 },
    { id: "f-pils", name: "Pilsner", type: "grain", amountKg: 4.0, colorEbc: 3.5, yieldPct: 81 },
    { id: "f-specialb", name: "Special B", type: "grain", amountKg: 0.37, colorEbc: 300, yieldPct: 65 },
    { id: "f-caraamber", name: "Caraamber", type: "grain", amountKg: 0.65, colorEbc: 70, yieldPct: 75 },
  ],
  hops: [
    {
      id: "h-simcoe-60",
      name: "Simcoe T90",
      amountG: 65,
      alphaPct: 12.7,
      use: "boil",
      timeMin: 60,
      form: "pellet",
      cropYear: 2022,
      notes: "Lagring ca. 4 °C; økt fra opprinnelig plan pga. alder",
    },
    {
      id: "h-citra-wp",
      name: "Citra T90",
      amountG: 84.6,
      alphaPct: 13.9,
      use: "whirlpool",
      timeMin: 20,
      temperatureC: 80,
      form: "pellet",
      cropYear: 2024,
    },
    {
      id: "h-mosaic-wp",
      name: "Mosaic T90",
      amountG: 100,
      alphaPct: 13.6,
      use: "whirlpool",
      timeMin: 20,
      temperatureC: 80,
      form: "pellet",
      cropYear: 2024,
    },
    {
      id: "h-simcoe-wp",
      name: "Simcoe T90",
      amountG: 33.9,
      alphaPct: 12.7,
      use: "whirlpool",
      timeMin: 20,
      temperatureC: 80,
      form: "pellet",
      cropYear: 2022,
    },
    // Planned dry hops, per variant (adjusted to taste).
    { id: "h-dry-t-citra", name: "Citra", amountG: 120, use: "dry_hop", dayOfFermentation: 4, variant: "Tropical" },
    { id: "h-dry-t-mosaic", name: "Mosaic", amountG: 100, use: "dry_hop", dayOfFermentation: 4, variant: "Tropical" },
    { id: "h-dry-p-simcoe", name: "Simcoe", amountG: 63, use: "dry_hop", dayOfFermentation: 4, variant: "Pine" },
    { id: "h-dry-p-citra", name: "Citra", amountG: 47, use: "dry_hop", dayOfFermentation: 4, variant: "Pine" },
    { id: "h-dry-p-mosaic", name: "Mosaic", amountG: 37, use: "dry_hop", dayOfFermentation: 4, variant: "Pine" },
  ],
  cultures: [
    { id: "y-tropical", name: "Fermoale New-E", form: "dry", amount: 2, unit: "pkg", variant: "Tropical", notes: "2 × 11,5 g" },
    { id: "y-pine", name: "Fermoale New-E", form: "dry", amount: 1, unit: "pkg", variant: "Pine", notes: "1 × 11,5 g" },
  ],
  miscs: [],
  // ASSUMPTION: mash duration. The log gives the target temperature (ca. 66–67 °C) only.
  mashSteps: [{ id: "m-main", name: "Mesk", temperatureC: 66.5, durationMin: 60 }],
  fermentationSteps: [
    { id: "g-0", name: "Dag 0", temperatureC: 18, durationDays: 1, notes: "Strø tørrgjær jevnt over vørteren. Lukk karene." },
    { id: "g-1", name: "Dag 1–2", temperatureC: 18, temperatureMaxC: 19, durationDays: 2, notes: "La aktiv gjæring gå uforstyrret." },
    {
      id: "g-2",
      name: "Dag 3–5",
      temperatureC: 20,
      temperatureMaxC: 21,
      durationDays: 3,
      notes: "Når SG nærmer seg 1.020–1.025: vurder tørrhumling.",
    },
    { id: "g-3", name: "Etter tørrhumling", temperatureC: 20, temperatureMaxC: 21, durationDays: 3, notes: "48–72 t. Følg med på hop creep." },
    {
      id: "g-4",
      name: "Før cold crash",
      temperatureC: 20,
      temperatureMaxC: 21,
      durationDays: 3,
      notes: "Stabil FG over minst 3 dager og ingen tydelig diacetyl.",
    },
    { id: "g-5", name: "Cold crash", temperatureC: 1, temperatureMaxC: 3, durationDays: 2, notes: "2–3 døgn med god oksygenbeskyttelse." },
  ],
  targets: { og: 1.061, abvPct: 6 },
  notes:
    "OG er estimert fra refraktometer/Brix, og pH er avlest med fargestrips. " +
    "Tropical karboneres til ca. 2,4–2,5 vol CO2 og tappes på bokser; Pine overføres til Corneliusfat (mål ca. 18,5 L).",
};

export interface FixtureSplit {
  key: "tropical" | "pine";
  name: string;
  vessel: string;
  volumeL: number;
}

export const sunsetIpaSplits: FixtureSplit[] = [
  { key: "tropical", name: "Sunset Tropical", vessel: "FermZilla 60 L", volumeL: 38 },
  { key: "pine", name: "Sunset Pine", vessel: "25 L bøtte", volumeL: 22 },
];

export interface FixtureLogEntry {
  /** ASSUMPTION: illustrative clock time (Europe/Oslo). The order matches the log. */
  at: string;
  stage: BrewStage;
  type: string;
  split?: FixtureSplit["key"];
  measurement?: { kind: MeasurementKind; value: number; unit: string; label?: string; comment?: string };
  ingredient?: IngredientAddedData;
  comment?: string;
}

/** Brew-day events and readings as recorded in the log. */
export const sunsetIpaBrewLog: FixtureLogEntry[] = [
  { at: "2026-09-23T10:00:00+02:00", stage: "mash", type: "mash_started" },
  { at: "2026-09-23T11:00:00+02:00", stage: "lauter", type: "lauter_started" },
  {
    at: "2026-09-23T11:05:00+02:00",
    stage: "lauter",
    type: "measurement",
    measurement: { kind: "temperature", value: 74, unit: "°C", label: "Skyllevann", comment: "77–78 °C anbefalt; 74 °C vurdert som OK" },
  },
  {
    at: "2026-09-23T11:55:00+02:00",
    stage: "lauter",
    type: "measurement",
    measurement: { kind: "volume", value: 75.7, unit: "L", label: "Før kok", comment: "20,0 US gal" },
  },
  {
    at: "2026-09-23T11:56:00+02:00",
    stage: "lauter",
    type: "measurement",
    measurement: { kind: "brix", value: 12.1, unit: "°Bx", label: "Før kok" },
  },
  {
    at: "2026-09-23T11:57:00+02:00",
    stage: "lauter",
    type: "measurement",
    measurement: { kind: "ph", value: 5.9, unit: "pH", label: "Før kok", comment: "pH-strimmel ca. 5,8–6,0" },
  },
  { at: "2026-09-23T12:00:00+02:00", stage: "boil", type: "boil_started" },
  {
    at: "2026-09-23T12:00:00+02:00",
    stage: "boil",
    type: "ingredient_added",
    ingredient: { ingredientKind: "hop", ingredientId: "h-simcoe-60", name: "Simcoe T90", amount: 65, unit: "g" },
  },
  {
    at: "2026-09-23T12:30:00+02:00",
    stage: "boil",
    type: "measurement",
    measurement: { kind: "volume", value: 71.9, unit: "L", label: "30 min igjen", comment: "19,0 US gal" },
  },
  {
    at: "2026-09-23T12:31:00+02:00",
    stage: "boil",
    type: "measurement",
    measurement: { kind: "brix", value: 14.0, unit: "°Bx", label: "30 min igjen", comment: "Ingen justering" },
  },
  {
    at: "2026-09-23T13:00:00+02:00",
    stage: "boil",
    type: "measurement",
    measurement: { kind: "volume", value: 62.5, unit: "L", label: "Etter kok, varmt", comment: "16,5 US gal" },
  },
  {
    at: "2026-09-23T13:01:00+02:00",
    stage: "boil",
    type: "measurement",
    measurement: { kind: "brix", value: 15.0, unit: "°Bx", label: "Etter kok", comment: "Først 14,2 °Bx; bekreftet 15,0" },
  },
  { at: "2026-09-23T13:02:00+02:00", stage: "boil", type: "comment", comment: "Smak: bitter, men mindre enn først antatt." },
  { at: "2026-09-23T13:05:00+02:00", stage: "whirlpool", type: "whirlpool_started" },
  {
    at: "2026-09-23T13:05:00+02:00",
    stage: "whirlpool",
    type: "ingredient_added",
    ingredient: { ingredientKind: "hop", ingredientId: "h-citra-wp", name: "Citra T90", amount: 84.6, unit: "g" },
  },
  {
    at: "2026-09-23T13:05:00+02:00",
    stage: "whirlpool",
    type: "ingredient_added",
    ingredient: { ingredientKind: "hop", ingredientId: "h-mosaic-wp", name: "Mosaic T90", amount: 100, unit: "g" },
  },
  {
    at: "2026-09-23T13:05:00+02:00",
    stage: "whirlpool",
    type: "ingredient_added",
    ingredient: { ingredientKind: "hop", ingredientId: "h-simcoe-wp", name: "Simcoe T90", amount: 33.9, unit: "g" },
  },
  {
    at: "2026-09-23T13:06:00+02:00",
    stage: "whirlpool",
    type: "measurement",
    measurement: { kind: "temperature", value: 82, unit: "°C", label: "Whirlpool", comment: "Mål 78–80 °C" },
  },
  { at: "2026-09-23T13:25:00+02:00", stage: "cooling", type: "cooling_started" },
  {
    at: "2026-09-23T14:20:00+02:00",
    stage: "cooling",
    type: "measurement",
    split: "tropical",
    measurement: { kind: "volume", value: 38, unit: "L", label: "Til gjæring" },
  },
  {
    at: "2026-09-23T14:21:00+02:00",
    stage: "cooling",
    type: "measurement",
    split: "pine",
    measurement: { kind: "volume", value: 22, unit: "L", label: "Til gjæring" },
  },
  {
    at: "2026-09-23T14:30:00+02:00",
    stage: "fermentation",
    type: "yeast_pitched",
    split: "tropical",
    ingredient: { ingredientKind: "culture", ingredientId: "y-tropical", name: "Fermoale New-E", amount: 2, unit: "pkg" },
  },
  {
    at: "2026-09-23T14:31:00+02:00",
    stage: "fermentation",
    type: "yeast_pitched",
    split: "pine",
    ingredient: { ingredientKind: "culture", ingredientId: "y-pine", name: "Fermoale New-E", amount: 1, unit: "pkg" },
  },
  {
    at: "2026-09-23T14:40:00+02:00",
    stage: "fermentation",
    type: "comment",
    split: "tropical",
    comment:
      "FermZilla viser et stort, lyst brunlig bunnlag – trolig cold break, humlerester og trub. " +
      "Ikke krise; la det sedimentere og komprimere.",
  },
];
