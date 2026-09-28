import { calculateStrikeTemperature, calculateWaterVolumes, expectedGravities, type WaterVolumeResult } from "../brewing-calculations/index.ts";
import { brewStages, type BrewStage, type IngredientKind } from "../model/brewing.ts";
import { profileValue, type ProfileValues } from "../model/equipment-profile.ts";
import type { RecipeDocument } from "../model/recipe.ts";

/**
 * The whole brew day at a glance, built from the frozen recipe snapshot and the batch's
 * equipment snapshot. Unlike the stage view it covers every phase at once, so the brewer
 * heating strike water can already see mash temperatures, hop amounts and pitch temperature.
 *
 * Values stated by the recipe (or its import source) are `recipe`; values the app derives
 * from the equipment profile via `brewing-calculations` are `calculated` and must be shown
 * as such. Nothing is invented: a value neither source can give is simply absent.
 */

export type PlanSource = "recipe" | "calculated";

export interface PlanQuantity {
  value: number;
  source: PlanSource;
}

export interface PlanAddition {
  ingredientKind: IngredientKind;
  ingredientId: string;
  name: string;
  amount: number;
  unit: string;
  variant?: string;
  /** Yeast is recorded as `yeast_pitched`, everything else as `ingredient_added`. */
  eventType: "ingredient_added" | "yeast_pitched";
}

export interface BrewPlanItem {
  id: string;
  title: string;
  /** When in the phase, e.g. "60 min" (before end of boil) or "Dag 4". */
  timing?: string;
  temperatureC?: PlanQuantity;
  temperatureMaxC?: number;
  durationMin?: number;
  durationDays?: number;
  volumeL?: PlanQuantity;
  amount?: { value: number; unit: string };
  variant?: string;
  note?: string;
  /** Present when the item is an addition that can be registered from the plan. */
  addition?: PlanAddition;
  /** Addition already registered in the log. */
  done: boolean;
}

export type BrewPlanPhaseKey = "water" | BrewStage;

export interface BrewPlanPhase {
  key: BrewPlanPhaseKey;
  /** Brew stages during which this phase is the active one. */
  stages: readonly BrewStage[];
  items: BrewPlanItem[];
}

export interface BrewPlanSummary {
  strikeVolumeL?: PlanQuantity;
  strikeTemperatureC?: PlanQuantity;
  mashTemperatureC?: number;
  mashDurationMin?: number;
  spargeVolumeL?: PlanQuantity;
  spargeTemperatureC?: number;
  preBoilVolumeL?: PlanQuantity;
  boilTimeMin: number;
  grainKg: number;
  hopTotalG: number;
  dryHopTotalG: number;
  pitchTemperatureC?: number;
  og: number | null;
  fg: number | null;
  /** Water volumes need the boil-off rate, which the batch's equipment snapshot lacks. */
  waterVolumesNeedBoilOff: boolean;
}

export interface BrewPlan {
  summary: BrewPlanSummary;
  phases: BrewPlanPhase[];
}

export interface BrewPlanInput {
  recipe: RecipeDocument;
  equipment: ProfileValues;
  /** Ingredient ids already registered as added or pitched. */
  doneIngredientIds?: ReadonlySet<string>;
}

export type PhaseStatus = "done" | "current" | "upcoming";

export const brewPlanPhaseLabels: Record<BrewPlanPhaseKey, string> = {
  water: "Vann",
  mash: "Mesk",
  lauter: "Skylling",
  boil: "Kok",
  whirlpool: "Whirlpool",
  cooling: "Kjøling og gjærtilsetning",
  fermentation: "Gjæring",
  conditioning: "Modning",
  packaging: "Pakking",
};

const recipe = (value: number): PlanQuantity => ({ value, source: "recipe" });
const calculated = (value: number): PlanQuantity => ({ value, source: "calculated" });

/** Grain and adjuncts that go into the mash; sugars and extracts do not absorb water. */
function mashedGrainKg(doc: RecipeDocument): number {
  return doc.fermentables.filter((f) => f.type === "grain" || f.type === "adjunct").reduce((sum, f) => sum + f.amountKg, 0);
}

function plannedWater(doc: RecipeDocument, equipment: ProfileValues, grainKg: number): WaterVolumeResult | null {
  const boilOffLPerH = equipment.boil_off_l_per_h;
  if (boilOffLPerH === undefined || grainKg <= 0) return null;
  return calculateWaterVolumes({
    batchVolumeL: doc.batchSizeL,
    grainKg,
    boilTimeMin: doc.boilTimeMin,
    boilOffLPerH,
    grainAbsorptionLPerKg: profileValue(equipment, "grain_absorption_l_per_kg") ?? 0.8,
    mashThicknessLPerKg: profileValue(equipment, "mash_thickness_l_per_kg") ?? 3,
    mashDeadSpaceL: profileValue(equipment, "mash_dead_space_l"),
    pumpPipeLossL: profileValue(equipment, "pump_pipe_loss_l"),
    kettleLossL: profileValue(equipment, "kettle_loss_l"),
    chillerLossL: profileValue(equipment, "chiller_loss_l"),
    transferLossL: profileValue(equipment, "transfer_loss_l"),
    coolingShrinkagePct: profileValue(equipment, "cooling_shrinkage_pct"),
  });
}

export function buildBrewPlan({ recipe: doc, equipment, doneIngredientIds = new Set() }: BrewPlanInput): BrewPlan {
  const grainKg = mashedGrainKg(doc);
  const water = plannedWater(doc, equipment, grainKg);
  const firstMash = doc.mashSteps[0];
  const done = (id: string) => doneIngredientIds.has(id);

  // Strike water: the source's own plan wins; our calculation is the fallback.
  const strikeVolumeL = firstMash?.infusionL !== undefined
    ? recipe(firstMash.infusionL)
    : water
      ? calculated(water.mashWaterL)
      : undefined;
  let strikeTemperatureC: PlanQuantity | undefined;
  if (firstMash?.infusionTemperatureC !== undefined) {
    strikeTemperatureC = recipe(firstMash.infusionTemperatureC);
  } else if (firstMash && grainKg > 0) {
    const thickness = strikeVolumeL ? strikeVolumeL.value / grainKg : profileValue(equipment, "mash_thickness_l_per_kg") ?? 3;
    strikeTemperatureC = calculated(
      calculateStrikeTemperature({
        targetMashTempC: firstMash.temperatureC,
        grainTempC: profileValue(equipment, "grain_temperature_c") ?? 18,
        mashThicknessLPerKg: thickness,
        systemOffsetC: profileValue(equipment, "strike_temp_offset_c") ?? 0,
      }).strikeTempC,
    );
  }

  const infusedL = doc.mashSteps.reduce((sum, step) => sum + (step.infusionL ?? 0), 0);
  const spargeVolumeL = water
    ? calculated(infusedL > 0 && firstMash?.infusionL !== undefined ? Math.max(0, water.totalWaterL - infusedL) : water.spargeWaterL)
    : undefined;
  const preBoilVolumeL = water ? calculated(water.preBoilVolumeL) : undefined;
  const pitchStep = doc.fermentationSteps[0];

  const hopItem = (hop: RecipeDocument["hops"][number], timing?: string): BrewPlanItem => ({
    id: `hop:${hop.id}`,
    title: hop.name,
    timing,
    temperatureC: hop.temperatureC === undefined ? undefined : recipe(hop.temperatureC),
    durationMin: hop.use === "whirlpool" ? hop.timeMin : undefined,
    amount: { value: hop.amountG, unit: "g" },
    variant: hop.variant,
    note: hop.notes,
    addition: {
      ingredientKind: "hop",
      ingredientId: hop.id,
      name: hop.name,
      amount: hop.amountG,
      unit: "g",
      variant: hop.variant,
      eventType: "ingredient_added",
    },
    done: done(hop.id),
  });
  const miscItem = (misc: RecipeDocument["miscs"][number], timing?: string): BrewPlanItem => ({
    id: `misc:${misc.id}`,
    title: misc.name,
    timing,
    amount: { value: misc.amount, unit: misc.unit },
    note: misc.notes,
    addition: {
      ingredientKind: "misc",
      ingredientId: misc.id,
      name: misc.name,
      amount: misc.amount,
      unit: misc.unit,
      eventType: "ingredient_added",
    },
    done: done(misc.id),
  });
  const hopsFor = (use: RecipeDocument["hops"][number]["use"]) => doc.hops.filter((hop) => hop.use === use);
  const miscsFor = (use: RecipeDocument["miscs"][number]["use"]) => doc.miscs.filter((misc) => misc.use === use);
  const byBoilTime = <T extends { timeMin?: number }>(a: T, b: T) => (b.timeMin ?? 0) - (a.timeMin ?? 0);

  const waterItems: BrewPlanItem[] = [];
  if (strikeVolumeL || strikeTemperatureC) {
    waterItems.push({ id: "water:strike", title: "Innmeskingsvann", volumeL: strikeVolumeL, temperatureC: strikeTemperatureC, done: false });
  }
  doc.mashSteps.slice(1).forEach((step) => {
    if (step.infusionL === undefined) return;
    waterItems.push({
      id: `water:infusion:${step.id}`,
      title: `Tilsetning til ${step.name.toLowerCase()}`,
      volumeL: recipe(step.infusionL),
      temperatureC: step.infusionTemperatureC === undefined ? undefined : recipe(step.infusionTemperatureC),
      done: false,
    });
  });
  if (spargeVolumeL || doc.spargeTemperatureC !== undefined) {
    waterItems.push({
      id: "water:sparge",
      title: "Skyllevann",
      volumeL: spargeVolumeL,
      temperatureC: doc.spargeTemperatureC === undefined ? undefined : recipe(doc.spargeTemperatureC),
      done: false,
    });
  }
  if (water) waterItems.push({ id: "water:total", title: "Vann totalt", volumeL: calculated(water.totalWaterL), done: false });

  const mashItems: BrewPlanItem[] = [
    ...doc.mashSteps.map((step) => ({
      id: `mash:${step.id}`,
      title: step.name,
      temperatureC: recipe(step.temperatureC),
      durationMin: step.durationMin,
      note: step.notes,
      done: false,
    })),
    ...doc.fermentables
      .filter((f) => f.type === "grain" || f.type === "adjunct")
      .map((f) => ({ id: `grain:${f.id}`, title: f.name, amount: { value: f.amountKg, unit: "kg" }, done: false })),
    ...hopsFor("mash").map((hop) => hopItem(hop, "Mesk")),
    ...miscsFor("mash").map((misc) => miscItem(misc, "Mesk")),
  ];

  const lauterItems: BrewPlanItem[] = [
    ...(doc.spargeTemperatureC !== undefined
      ? [{ id: "lauter:sparge", title: "Skyll", temperatureC: recipe(doc.spargeTemperatureC), volumeL: spargeVolumeL, done: false }]
      : []),
    ...(preBoilVolumeL ? [{ id: "lauter:pre-boil", title: "Volum før kok", volumeL: preBoilVolumeL, done: false }] : []),
    ...hopsFor("first_wort").map((hop) => hopItem(hop, "First wort")),
  ];

  const boilItems: BrewPlanItem[] = [
    ...(doc.boilTimeMin > 0 ? [{ id: "boil:boil", title: "Kok", durationMin: doc.boilTimeMin, done: false }] : []),
    ...[...hopsFor("boil")].sort(byBoilTime).map((hop) => hopItem(hop, `${hop.timeMin ?? 0} min`)),
    ...[...miscsFor("boil")].sort(byBoilTime).map((misc) => miscItem(misc, `${misc.timeMin ?? 0} min`)),
  ];

  const whirlpoolItems: BrewPlanItem[] = [
    ...hopsFor("whirlpool").map((hop) => hopItem(hop)),
    ...miscsFor("whirlpool").map((misc) => miscItem(misc)),
  ];

  const coolingItems: BrewPlanItem[] = [
    ...(pitchStep?.temperatureC !== undefined
      ? [{
          id: "cooling:pitch-temp",
          title: "Kjøl til",
          temperatureC: recipe(pitchStep.temperatureC),
          temperatureMaxC: pitchStep.temperatureMaxC,
          done: false,
        }]
      : []),
    ...doc.cultures.map((culture) => ({
      id: `culture:${culture.id}`,
      title: culture.name,
      amount: { value: culture.amount, unit: culture.unit },
      variant: culture.variant,
      note: culture.notes,
      addition: {
        ingredientKind: "culture" as const,
        ingredientId: culture.id,
        name: culture.name,
        amount: culture.amount,
        unit: culture.unit,
        variant: culture.variant,
        eventType: "yeast_pitched" as const,
      },
      done: done(culture.id),
    })),
  ];

  const fermentationItems: BrewPlanItem[] = [
    ...doc.fermentationSteps.map((step) => ({
      id: `fermentation:${step.id}`,
      title: step.name,
      temperatureC: step.temperatureC === undefined ? undefined : recipe(step.temperatureC),
      temperatureMaxC: step.temperatureMaxC,
      durationDays: step.durationDays,
      note: step.notes,
      done: false,
    })),
    ...[...hopsFor("dry_hop")]
      .sort((a, b) => (a.dayOfFermentation ?? 0) - (b.dayOfFermentation ?? 0))
      .map((hop) => hopItem(hop, hop.dayOfFermentation === undefined ? "Tørrhumling" : `Dag ${hop.dayOfFermentation}`)),
    ...miscsFor("fermentation").map((misc) => miscItem(misc)),
  ];

  const packagingItems: BrewPlanItem[] = [
    ...(doc.carbonationVols !== undefined
      ? [{ id: "packaging:carbonation", title: "Karbonering", amount: { value: doc.carbonationVols, unit: "vol CO₂" }, done: false }]
      : []),
    ...miscsFor("packaging").map((misc) => miscItem(misc)),
  ];

  const phases: BrewPlanPhase[] = [
    { key: "water", stages: [], items: waterItems },
    { key: "mash", stages: ["mash"], items: mashItems },
    { key: "lauter", stages: ["lauter"], items: lauterItems },
    { key: "boil", stages: ["boil"], items: boilItems },
    { key: "whirlpool", stages: ["whirlpool"], items: whirlpoolItems },
    { key: "cooling", stages: ["cooling"], items: coolingItems },
    { key: "fermentation", stages: ["fermentation", "conditioning"], items: fermentationItems },
    { key: "packaging", stages: ["packaging"], items: packagingItems },
  ];

  const { og, fg } = expectedGravities(doc);
  return {
    summary: {
      strikeVolumeL,
      strikeTemperatureC,
      mashTemperatureC: firstMash?.temperatureC,
      mashDurationMin: doc.mashSteps.length > 0 ? doc.mashSteps.reduce((sum, step) => sum + step.durationMin, 0) : undefined,
      spargeVolumeL,
      spargeTemperatureC: doc.spargeTemperatureC,
      preBoilVolumeL,
      boilTimeMin: doc.boilTimeMin,
      grainKg,
      hopTotalG: doc.hops.reduce((sum, hop) => sum + hop.amountG, 0),
      dryHopTotalG: hopsFor("dry_hop").reduce((sum, hop) => sum + hop.amountG, 0),
      pitchTemperatureC: pitchStep?.temperatureC,
      og,
      fg,
      waterVolumesNeedBoilOff: water === null && grainKg > 0 && equipment.boil_off_l_per_h === undefined,
    },
    phases: phases.filter((phase) => phase.items.length > 0 || (phase.key === "water" && grainKg > 0)),
  };
}

/**
 * Where a phase stands relative to the batch's current stage. Water is prepared before and
 * during the mash, so it counts as current until the boil starts.
 */
export function brewPlanPhaseStatus(phase: Pick<BrewPlanPhase, "key" | "stages">, currentStage: BrewStage | null): PhaseStatus {
  const stages: readonly BrewStage[] = phase.key === "water" ? ["mash", "lauter"] : phase.stages;
  if (currentStage === null) return phase.key === "water" ? "current" : "upcoming";
  if (stages.includes(currentStage)) return "current";
  const current = brewStages.indexOf(currentStage);
  const last = Math.max(...stages.map((stage) => brewStages.indexOf(stage)));
  return last < current ? "done" : "upcoming";
}

/** Ingredient ids already registered in the log (`ingredient_added` / `yeast_pitched`). */
export function registeredIngredientIds(log: readonly { type: string; data: Record<string, unknown> | null }[]): Set<string> {
  return new Set(
    log.flatMap((entry) =>
      (entry.type === "ingredient_added" || entry.type === "yeast_pitched") && typeof entry.data?.ingredientId === "string"
        ? [entry.data.ingredientId]
        : [],
    ),
  );
}
