import { srmToEbc } from "../brewing-calculations/color.ts";
import { fahrenheitToCelsius, GRAMS_PER_OUNCE, LITERS_PER_US_GALLON, round } from "../brewing-calculations/units.ts";
import {
  RECIPE_SCHEMA_VERSION,
  type Culture,
  type Fermentable,
  type FermentableType,
  type FermentationStep,
  type HopAddition,
  type MashStep,
  type Misc,
  type RecipeDocument,
} from "../model/recipe.ts";
import {
  childElement,
  childNumber,
  childText,
  findElements,
  parseXml,
  XmlParseError,
  type XmlElement,
} from "./xml.ts";

/**
 * Import adapter: BeerSmith 2/3 `.bsmx` → normalized RecipeDocument.
 *
 * BSMX stores everything in BeerSmith's internal US units: volumes in fluid ounces, weights in
 * ounces, temperatures in °F and colour in SRM. The file structure is documented in
 * docs/import-bsmx.md.
 *
 * BeerSmith is an import source for *plans*. Its measured/brew-sheet fields (OG_MEASURED,
 * MASH_PH, timers …) are never imported as observations, not even when their `_SET` flag is 1;
 * they are only listed in `ignoredMeasuredFields` so the review screen can say so.
 */

export const BSMX_MAX_CHARS = 2_000_000;

const LITERS_PER_FLUID_OUNCE = LITERS_PER_US_GALLON / 128;
const flOzToL = (flOz: number) => flOz * LITERS_PER_FLUID_OUNCE;
const ozToKg = (oz: number) => (oz * GRAMS_PER_OUNCE) / 1000;
const ozToG = (oz: number) => oz * GRAMS_PER_OUNCE;
const fToC = (f: number) => round(fahrenheitToCelsius(f), 1);

/** BeerSmith's own equipment values, kept as the recipe's source snapshot (never the active profile). */
export interface BsmxEquipmentSnapshot {
  name: string;
  /** Values the brewer typed into BeerSmith. */
  stated: {
    efficiencyPct?: number;
    batchVolumeL?: number;
    fermenterLossL?: number;
    mashTunVolumeL?: number;
    mashTunMassKg?: number;
    mashTunSpecificHeat?: number;
    mashTunDeadspaceL?: number;
    boilTimeMin?: number;
    /** Only when BeerSmith treats boil-off as an hourly rate. */
    boilOffLPerHour?: number;
    coolingShrinkagePct?: number;
    trubLossL?: number;
    topUpKettleL?: number;
    topUpWaterL?: number;
    hopUtilizationPct?: number;
  };
  /** Values BeerSmith calculated from the stated ones. */
  derived: {
    preBoilVolumeL?: number;
    bottlingVolumeL?: number;
  };
}

/** The water plan BeerSmith calculated for the mash. Shown as the source's plan on brew day. */
export interface BsmxWaterPlan {
  mashWaterL?: number;
  strikeTemperatureC?: number;
  grainTemperatureC?: number;
  spargeTemperatureC?: number;
}

export interface BsmxRecipeImport {
  recipe: RecipeDocument;
  equipment: BsmxEquipmentSnapshot | null;
  waterPlan: BsmxWaterPlan;
  /** `F_R_DATE`: when the recipe was (last) brewed or created in BeerSmith. */
  sourceDate?: string;
  /** Measured fields that were filled in (`_SET = 1`) in BeerSmith and deliberately not imported. */
  ignoredMeasuredFields: string[];
  warnings: string[];
}

export class BsmxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BsmxImportError";
  }
}

/**
 * Brew-sheet fields BeerSmith fills in during a brew. Each has a `<name>_SET` flag.
 * They describe a historical brew, not the plan, so they are never imported.
 */
export const BSMX_MEASURED_FIELDS = [
  "F_R_OG_MEASURED",
  "F_R_FG_MEASURED",
  "F_R_VOLUME_MEASURED",
  "F_R_FINAL_VOL_MEASURED",
  "F_R_BOIL_VOL_MEASURED",
  "F_R_OG_BOIL_MEASURED",
  "F_R_OG_MASH_MEASURED",
  "F_R_OG_PRIMARY",
  "F_R_OG_SECONDARY",
  "F_R_MASH_PH",
  "F_R_RUNOFF_PH",
  "F_R_RUNNING_GRAVITY",
] as const;

const fermentableTypeCodes: Record<string, FermentableType> = { "0": "grain", "1": "extract", "2": "sugar", "3": "adjunct", "4": "extract" };
const hopFormCodes: Record<string, HopAddition["form"]> = { "0": "pellet", "1": "whole", "2": "whole" };
const cultureFormCodes: Record<string, Culture["form"]> = { "0": "liquid", "1": "dry", "2": "other", "3": "other" };
const miscUseCodes: Record<string, Misc["use"]> = { "0": "boil", "1": "mash", "2": "fermentation", "3": "fermentation", "4": "packaging" };
/** BeerSmith misc unit list, in its own order. Amounts are stored in the listed unit. */
const miscUnitCodes = ["mg", "g", "oz", "lb", "kg", "ml", "ts", "ss", "kopp", "pt", "qt", "l", "gal", "stk"] as const;
/** Codes confirmed against the fixture files; other codes get a review warning. */
const VERIFIED_MISC_UNITS = new Set(["6", "13"]);
const miscTimeUnits: Record<string, string> = { "0": "min", "1": "timer", "2": "dager", "3": "uker" };

const flag = (element: XmlElement, name: string) => childText(element, name) === "1";
const positive = (value: number | undefined) => (value !== undefined && value > 0 ? value : undefined);

function truncate(value: string | undefined, max: number, label: string, warnings: string[]): string | undefined {
  if (value === undefined || value.length <= max) return value;
  warnings.push(`${label} var lengre enn ${max} tegn og er forkortet.`);
  return value.slice(0, max);
}

function inRecipe(element: XmlElement): boolean {
  // Items in the Ingredients folder are the recipe's own; F_*_IN_RECIPE = 0 marks leftovers.
  const value = element.children.find((child) => /^F_[A-Z]_IN_RECIPE$/.test(child.name))?.text.trim();
  return value !== "0";
}

function convertEquipment(element: XmlElement | undefined): BsmxEquipmentSnapshot | null {
  if (!element) return null;
  const volume = (name: string) => {
    const value = childNumber(element, name);
    return value === undefined ? undefined : round(flOzToL(value), 2);
  };
  const boilOff = childNumber(element, "F_E_BOIL_OFF");
  const batch = volume("F_E_BATCH_VOL");
  const fermenterLoss = volume("F_E_FERMENTER_LOSS");
  const tunMass = childNumber(element, "F_E_TUN_MASS");
  return {
    name: childText(element, "F_E_NAME") ?? "BeerSmith-utstyr",
    stated: {
      efficiencyPct: childNumber(element, "F_E_EFFICIENCY"),
      batchVolumeL: batch,
      fermenterLossL: fermenterLoss,
      mashTunVolumeL: volume("F_E_MASH_VOL"),
      mashTunMassKg: tunMass === undefined ? undefined : round(ozToKg(tunMass), 2),
      mashTunSpecificHeat: childNumber(element, "F_E_TUN_SPECIFIC_HEAT"),
      mashTunDeadspaceL: volume("F_E_TUN_DEADSPACE"),
      boilTimeMin: childNumber(element, "F_E_BOIL_TIME"),
      boilOffLPerHour: flag(element, "F_E_BOIL_RATE_FLAG") && boilOff !== undefined ? round(flOzToL(boilOff), 2) : undefined,
      coolingShrinkagePct: childNumber(element, "F_E_COOL_PCT"),
      trubLossL: volume("F_E_TRUB_LOSS"),
      topUpKettleL: volume("F_E_TOP_UP_KETTLE"),
      topUpWaterL: volume("F_E_TOP_UP"),
      hopUtilizationPct: childNumber(element, "F_E_HOP_UTIL"),
    },
    derived: {
      preBoilVolumeL: volume("F_E_BOIL_VOL"),
      bottlingVolumeL: batch !== undefined && fermenterLoss !== undefined ? round(batch - fermenterLoss, 2) : undefined,
    },
  };
}

function convertFermentable(element: XmlElement, index: number, warnings: string[]): Fermentable | null {
  const name = childText(element, "F_G_NAME") ?? `Malt ${index + 1}`;
  const amount = positive(childNumber(element, "F_G_AMOUNT"));
  if (amount === undefined) {
    warnings.push(`Hoppet over «${name}»: mangler mengde.`);
    return null;
  }
  const typeCode = childText(element, "F_G_TYPE") ?? "0";
  const type = fermentableTypeCodes[typeCode];
  if (!type) warnings.push(`Ukjent maltype (${typeCode}) for «${name}»; lagt inn som «annet».`);
  const color = childNumber(element, "F_G_COLOR");
  const supplier = childText(element, "F_G_SUPPLIER");
  const origin = childText(element, "F_G_ORIGIN");
  return {
    id: `f${index + 1}`,
    name: name.slice(0, 120),
    type: type ?? "other",
    amountKg: round(ozToKg(amount), 3),
    ...(color !== undefined && { colorEbc: round(srmToEbc(color), 1) }),
    ...(childNumber(element, "F_G_YIELD") !== undefined && { yieldPct: childNumber(element, "F_G_YIELD") }),
    ...((supplier ?? origin) && { producer: [supplier, origin].filter(Boolean).join(", ").slice(0, 120) }),
  };
}

function convertHop(element: XmlElement, index: number, warnings: string[]): HopAddition | null {
  const name = childText(element, "F_H_NAME") ?? `Humle ${index + 1}`;
  const amount = positive(childNumber(element, "F_H_AMOUNT"));
  if (amount === undefined) {
    warnings.push(`Hoppet over «${name}»: mangler mengde.`);
    return null;
  }
  const base = {
    id: `h${index + 1}`,
    name: name.slice(0, 120),
    amountG: round(ozToG(amount), 1),
    ...(childNumber(element, "F_H_ALPHA") !== undefined && { alphaPct: childNumber(element, "F_H_ALPHA") }),
    ...(hopFormCodes[childText(element, "F_H_FORM") ?? ""] && { form: hopFormCodes[childText(element, "F_H_FORM") ?? ""] }),
  };
  const time = childNumber(element, "F_H_BOIL_TIME");
  const useCode = childText(element, "F_H_USE") ?? "0";
  switch (useCode) {
    case "0":
      return { ...base, use: "boil", timeMin: time ?? 0 };
    case "1": {
      const days = childNumber(element, "F_H_DRY_HOP_TIME");
      warnings.push(`Tørrhumling «${name}»: BeerSmith oppgir kontakttid, ikke hvilken gjæringsdag humlen tilsettes. Sett dag ved gjennomgang.`);
      return { ...base, use: "dry_hop", ...(days !== undefined && { notes: `${days} dager kontakttid (BeerSmith)` }) };
    }
    case "2":
      return { ...base, use: "mash" };
    case "3":
      return { ...base, use: "first_wort", timeMin: time };
    case "4": {
      const temperature = childNumber(element, "F_H_WHIRLPOOL_TEMP");
      return { ...base, use: "whirlpool", timeMin: time, ...(temperature !== undefined && { temperatureC: fToC(temperature) }) };
    }
    default:
      warnings.push(`Ukjent bruk (${useCode}) for humle «${name}»; lagt inn som kok.`);
      return { ...base, use: "boil", timeMin: time ?? 0 };
  }
}

function convertCulture(element: XmlElement, index: number, warnings: string[]): Culture | null {
  const name = childText(element, "F_Y_NAME") ?? `Gjær ${index + 1}`;
  const productId = childText(element, "F_Y_PRODUCT_ID");
  const amount = positive(childNumber(element, "F_Y_AMOUNT"));
  if (amount === undefined) {
    warnings.push(`Hoppet over gjær «${name}»: mangler mengde.`);
    return null;
  }
  const minAttenuation = childNumber(element, "F_Y_MIN_ATTENUATION");
  const maxAttenuation = childNumber(element, "F_Y_MAX_ATTENUATION");
  const attenuation =
    minAttenuation !== undefined && maxAttenuation !== undefined ? round((minAttenuation + maxAttenuation) / 2, 1) : undefined;
  const lab = childText(element, "F_Y_LAB");
  return {
    id: `c${index + 1}`,
    name: (productId && productId !== "-" ? `${name} (${productId})` : name).slice(0, 120),
    ...(lab && { producer: lab.slice(0, 120) }),
    form: cultureFormCodes[childText(element, "F_Y_FORM") ?? ""] ?? "other",
    amount: round(amount, 2),
    unit: "pkg",
    ...(attenuation !== undefined && { attenuationPct: attenuation }),
  };
}

function convertMisc(element: XmlElement, index: number, warnings: string[]): Misc | null {
  const name = childText(element, "F_M_NAME") ?? `Tilsetning ${index + 1}`;
  const amount = positive(childNumber(element, "F_M_AMOUNT"));
  if (amount === undefined) {
    warnings.push(`Hoppet over «${name}»: mangler mengde.`);
    return null;
  }
  const unitCode = childText(element, "F_M_UNITS") ?? "";
  const unit = miscUnitCodes[Number(unitCode)] ?? "stk";
  if (!VERIFIED_MISC_UNITS.has(unitCode)) warnings.push(`Kontroller mengde og enhet for «${name}» (BeerSmith-enhet ${unitCode}).`);
  const use = miscUseCodes[childText(element, "F_M_USE") ?? ""] ?? "other";
  const time = childNumber(element, "F_M_TIME");
  const timeUnit = miscTimeUnits[childText(element, "F_M_TIME_UNITS") ?? ""] ?? "min";
  const useFor = childText(element, "F_M_USE_FOR");
  const timing = time !== undefined && !(use === "boil" && timeUnit === "min") ? `${time} ${timeUnit}` : undefined;
  const notes = [useFor, timing].filter(Boolean).join(" · ");
  return {
    id: `m${index + 1}`,
    name: name.slice(0, 120),
    amount: round(amount, 3),
    unit,
    use,
    ...(use === "boil" && timeUnit === "min" && time !== undefined && { timeMin: time }),
    ...(notes && { notes }),
  };
}

function convertMash(element: XmlElement | undefined, warnings: string[]): { steps: MashStep[]; water: BsmxWaterPlan } {
  if (!element) {
    warnings.push("Oppskriften har ingen meskeprofil.");
    return { steps: [], water: {} };
  }
  const steps: MashStep[] = [];
  let mashWater = 0;
  const stepElements = childElement(element, "steps") ? findElements(childElement(element, "steps")!, "MashStep") : [];
  stepElements.forEach((step, index) => {
    const name = childText(step, "F_MS_NAME") ?? `Steg ${index + 1}`;
    const temperature = childNumber(step, "F_MS_STEP_TEMP");
    const duration = childNumber(step, "F_MS_STEP_TIME");
    if (temperature === undefined || duration === undefined) {
      warnings.push(`Meskesteget «${name}» mangler temperatur eller tid og er hoppet over.`);
      return;
    }
    if (childText(step, "F_MS_TYPE") === "2") warnings.push(`«${name}» er et dekoksjonssteg; kontroller planen ved gjennomgang.`);
    const infusion = positive(childNumber(step, "F_MS_INFUSION"));
    const infusionTemperature = childNumber(step, "F_MS_INFUSION_TEMP");
    if (infusion !== undefined) mashWater += flOzToL(infusion);
    steps.push({
      id: `ms${index + 1}`,
      name: name.slice(0, 120),
      temperatureC: fToC(temperature),
      durationMin: duration,
      ...(infusion !== undefined && { infusionL: round(flOzToL(infusion), 2) }),
      ...(infusion !== undefined && infusionTemperature !== undefined && { infusionTemperatureC: fToC(infusionTemperature) }),
    });
  });
  if (steps.length === 0) warnings.push("Meskeprofilen har ingen steg.");

  const strike = steps[0]?.infusionTemperatureC;
  const grain = childNumber(element, "F_MH_GRAIN_TEMP");
  const sparge = childNumber(element, "F_MH_SPARGE_TEMP");
  return {
    steps,
    water: {
      ...(mashWater > 0 && { mashWaterL: round(mashWater, 2) }),
      ...(strike !== undefined && { strikeTemperatureC: strike }),
      ...(grain !== undefined && { grainTemperatureC: fToC(grain) }),
      ...(sparge !== undefined && { spargeTemperatureC: fToC(sparge) }),
    },
  };
}

function convertFermentation(element: XmlElement | undefined): FermentationStep[] {
  if (!element) return [];
  // F_A_TYPE is BeerSmith's stage count minus one (single, two or three stage).
  const stageCount = Math.min(3, Math.max(1, (childNumber(element, "F_A_TYPE") ?? 0) + 1));
  const stages = [
    { name: "Primærgjæring", days: "F_A_PRIM_DAYS", start: "F_A_PRIM_TEMP", end: "F_A_PRIM_END_TEMP" },
    { name: "Sekundærgjæring", days: "F_A_SEC_DAYS", start: "F_A_SEC_TEMP", end: "F_A_SEC_END_TEMP" },
    { name: "Tertiærgjæring", days: "F_A_TERT_DAYS", start: "F_A_TERT_TEMP", end: "F_A_TERT_END_TEMP" },
  ].slice(0, stageCount);
  const steps: FermentationStep[] = [];
  const add = (name: string, days: number | undefined, start: number | undefined, end: number | undefined) => {
    const low = start === undefined ? undefined : fToC(start);
    const high = end === undefined ? undefined : fToC(end);
    const [min, max] = low !== undefined && high !== undefined && high < low ? [high, low] : [low, high];
    steps.push({
      id: `fs${steps.length + 1}`,
      name,
      ...(min !== undefined && { temperatureC: min }),
      ...(max !== undefined && max !== min && { temperatureMaxC: max }),
      ...(days !== undefined && { durationDays: days }),
    });
  };
  for (const stage of stages) {
    add(stage.name, childNumber(element, stage.days), childNumber(element, stage.start), childNumber(element, stage.end));
  }
  const ageDays = positive(childNumber(element, "F_A_AGE"));
  if (ageDays !== undefined) add("Modning", ageDays, childNumber(element, "F_A_AGE_TEMP"), childNumber(element, "F_A_END_AGE_TEMP"));
  return steps;
}

function convertRecipe(recipeElement: XmlElement): BsmxRecipeImport {
  const warnings: string[] = [];
  const name = childText(recipeElement, "F_R_NAME");
  if (!name) warnings.push("Oppskriften mangler navn i BSMX-filen.");

  const equipment = convertEquipment(childElement(recipeElement, "F_R_EQUIPMENT"));
  if (!equipment) warnings.push("Filen har ikke utstyrsprofil; batchstørrelse, koketid og effektivitet er satt til standardverdier.");
  const batchSizeL = positive(equipment?.stated.batchVolumeL);
  const boilTimeMin = equipment?.stated.boilTimeMin;
  const efficiencyPct = equipment?.stated.efficiencyPct;
  if (equipment && batchSizeL === undefined) warnings.push("Utstyrsprofilen mangler batchvolum; satt til 20 L.");

  const ingredients = childElement(recipeElement, "Ingredients");
  const items = (tag: string) => (ingredients ? findElements(ingredients, tag).filter(inRecipe) : []);
  const fermentables = items("Grain")
    .map((element, index) => convertFermentable(element, index, warnings))
    .filter((item): item is Fermentable => item !== null);
  const hopElements = items("Hops");
  const hops = hopElements.map((element, index) => convertHop(element, index, warnings)).filter((item): item is HopAddition => item !== null);
  const cultures = items("Yeast")
    .map((element, index) => convertCulture(element, index, warnings))
    .filter((item): item is Culture => item !== null);
  const miscs = items("Misc")
    .map((element, index) => convertMisc(element, index, warnings))
    .filter((item): item is Misc => item !== null);
  if (items("Water").length > 0) warnings.push("Vannprofiler fra BeerSmith importeres ikke ennå (kommer i M6).");
  if (fermentables.length === 0) warnings.push("Oppskriften har ingen malt eller andre fermenterbare ingredienser.");

  const mash = convertMash(childElement(recipeElement, "F_R_MASH"), warnings);

  // BeerSmith stores each hop's calculated IBU, but not the recipe's OG/FG/colour; the app
  // calculates those from the ingredients and the equipment snapshot.
  const hopIbus = hopElements.map((element) => childNumber(element, "F_H_IBU_CONTRIB") ?? 0);
  const ibu = hopIbus.length > 0 ? round(hopIbus.reduce((sum, value) => sum + value, 0), 1) : undefined;

  const ignoredMeasuredFields = BSMX_MEASURED_FIELDS.filter((field) => flag(recipeElement, `${field}_SET`));
  if (ignoredMeasuredFields.length > 0) {
    warnings.push(
      "BeerSmith-filen inneholder målte verdier fra et tidligere brygg. De importeres ikke; bryggeloggen fylles bare fra Slump.",
    );
  }

  const style = childText(childElement(recipeElement, "F_R_STYLE") ?? recipeElement, "F_S_NAME");
  const carbonation = childNumber(recipeElement, "F_R_CARB_VOLS");
  const recipe: RecipeDocument = {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    name: (name ?? "BeerSmith-oppskrift").slice(0, 120),
    ...(style && { style: style.slice(0, 120) }),
    ...(childText(recipeElement, "F_R_DESCRIPTION") && {
      description: truncate(childText(recipeElement, "F_R_DESCRIPTION"), 4000, "Beskrivelsen", warnings),
    }),
    ...(childText(recipeElement, "F_R_BREWER") && { author: childText(recipeElement, "F_R_BREWER")!.slice(0, 120) }),
    batchSizeL: batchSizeL ?? 20,
    boilTimeMin: boilTimeMin !== undefined && boilTimeMin >= 0 && boilTimeMin <= 600 ? boilTimeMin : 60,
    efficiencyPct: efficiencyPct !== undefined && efficiencyPct >= 1 && efficiencyPct <= 100 ? efficiencyPct : 72,
    ...(mash.water.spargeTemperatureC !== undefined && { spargeTemperatureC: mash.water.spargeTemperatureC }),
    ...(carbonation !== undefined && carbonation > 0 && carbonation <= 6 && { carbonationVols: carbonation }),
    fermentables: fermentables.slice(0, 50),
    hops: hops.slice(0, 100),
    cultures: cultures.slice(0, 20),
    miscs: miscs.slice(0, 50),
    mashSteps: mash.steps.slice(0, 20),
    fermentationSteps: convertFermentation(childElement(recipeElement, "F_R_AGE")),
    targets: { ...(ibu !== undefined && { ibu }) },
    ...(childText(recipeElement, "F_R_NOTES") && { notes: truncate(childText(recipeElement, "F_R_NOTES"), 10_000, "Notatene", warnings) }),
  };

  return {
    recipe,
    equipment,
    waterPlan: mash.water,
    ...(childText(recipeElement, "F_R_DATE") && { sourceDate: childText(recipeElement, "F_R_DATE") }),
    ignoredMeasuredFields,
    warnings,
  };
}

/** Parses a `.bsmx` file. A file can hold several recipes (BeerSmith exports folders the same way). */
export function parseBsmx(text: string): BsmxRecipeImport[] {
  let root: XmlElement;
  try {
    root = parseXml(text, { maxChars: BSMX_MAX_CHARS });
  } catch (error) {
    throw new BsmxImportError(error instanceof XmlParseError ? error.message : "Kunne ikke lese filen.");
  }
  const recipes = root.name === "Recipe" ? [root] : findElements(root, "Recipe");
  if (recipes.length === 0) throw new BsmxImportError("Fant ingen oppskrift i BSMX-filen.");
  return recipes.map(convertRecipe);
}

