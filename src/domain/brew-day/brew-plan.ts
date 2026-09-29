import { calculateStrikeTemperature, calculateWaterVolumes, expectedGravities, isMashed, mashedGrainKg, pointsToSg, sgToPoints, type WaterVolumeResult } from "../brewing-calculations/index.ts";
import { brewStages, type BrewStage, type IngredientKind } from "../model/brewing.ts";
import { getProfileParameter, type ProfileValueSources, type ProfileValues } from "../model/equipment-profile.ts";
import type { RecipeDocument } from "../model/recipe.ts";

/**
 * The whole brew day at a glance, built from the frozen recipe snapshot and the batch's
 * equipment snapshot. Unlike the stage view it covers every phase at once, so the brewer
 * heating strike water can already see mash temperatures, hop amounts and pitch temperature.
 *
 * Values stated by the recipe (or its import source) are `recipe`; values derived from explicit
 * profile values are `calculated`; documented defaults are `assumed` and always name their basis.
 */

export type PlanSource = "recipe" | "calculated" | "assumed";

export interface PlanAssumption {
  key: string;
  label: string;
  value: number;
  unit: string;
  explanation: string;
  measureToReplace: string;
}

export interface PlanQuantity {
  value: number;
  source: PlanSource;
  /** Labels of assumed profile values that affect this quantity. */
  assumptions?: string[];
}

/** Short, comma-joined display of assumption labels, collapsing extras to "+N". */
export function assumptionNames(labels: string[] | undefined): string {
  if (!labels || labels.length === 0) return "";
  const shown = labels.slice(0, 2).join(", ");
  return labels.length > 2 ? `${shown} +${labels.length - 2}` : shown;
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
  gravitySg?: PlanQuantity;
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
  spargeTemperatureC?: PlanQuantity;
  preBoilVolumeL?: PlanQuantity;
  preBoilSg?: PlanQuantity;
  postBoilVolumeL?: PlanQuantity;
  boilTimeMin: number;
  grainKg: number;
  hopTotalG: number;
  dryHopTotalG: number;
  pitchTemperatureC?: number;
  og: PlanQuantity | null;
  fg: PlanQuantity | null;
  assumptions: PlanAssumption[];
  waterVolumesUseAssumptions: boolean;
}

export interface BrewPlan {
  summary: BrewPlanSummary;
  phases: BrewPlanPhase[];
}

export interface BrewPlanInput {
  recipe: RecipeDocument;
  equipment: ProfileValues;
  /** Source metadata is frozen with the batch; older snapshots infer explicit values as profile values. */
  equipmentSources?: ProfileValueSources;
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

interface ResolvedProfileValue {
  value?: number;
  source: "calculated" | "assumed" | null;
  assumption?: PlanAssumption;
}

function profileSetting(equipment: ProfileValues, sources: ProfileValueSources | undefined, key: keyof ProfileValues): ResolvedProfileValue {
  const parameter = getProfileParameter(key);
  const value = equipment[key];
  const source = sources?.[key];
  const assumed = source === "default" || value === undefined;
  if (assumed && parameter?.defaultValue !== undefined) {
    return {
      value: value ?? parameter.defaultValue,
      source: "assumed",
      assumption: {
        key,
        label: parameter.label,
        value: value ?? parameter.defaultValue,
        unit: parameter.unit,
        explanation: parameter.defaultExplanation ?? `Standardverdien ${parameter.defaultValue} ${parameter.unit} brukes fordi verdien ikke er kalibrert.`,
        measureToReplace: parameter.measureToReplaceDefault ?? `Mål ${parameter.label.toLowerCase()} under bryggingen.`,
      },
    };
  }
  return value === undefined ? { source: null } : { value, source: "calculated" };
}

function quantityFrom(value: number, ...settings: ResolvedProfileValue[]): PlanQuantity {
  const assumptions = [...new Set(settings.flatMap((setting) => setting.assumption ? [setting.assumption.label] : []))];
  return { value, source: assumptions.length > 0 ? "assumed" : "calculated", assumptions: assumptions.length > 0 ? assumptions : undefined };
}

function assumptionsFrom(settings: ResolvedProfileValue[]): PlanAssumption[] {
  return [...new Map(settings.flatMap((setting) => setting.assumption ? [[setting.assumption.key, setting.assumption] as const] : [])).values()];
}

function sourceFrom(inputs: PlanQuantity[]): PlanSource {
  if (inputs.some((input) => input.source === "assumed")) return "assumed";
  if (inputs.every((input) => input.source === "recipe")) return "recipe";
  return "calculated";
}

interface PlannedWater {
  result: WaterVolumeResult;
  source: PlanSource;
  settings: ResolvedProfileValue[];
}

function plannedWater(doc: RecipeDocument, equipment: ProfileValues, sources: ProfileValueSources | undefined, grainKg: number): PlannedWater | null {
  if (grainKg <= 0) return null;
  const keys = [
    "boil_off_l_per_h",
    "grain_absorption_l_per_kg",
    "mash_thickness_l_per_kg",
    "mash_dead_space_l",
    "pump_pipe_loss_l",
    "kettle_loss_l",
    "chiller_loss_l",
    "transfer_loss_l",
    "cooling_shrinkage_pct",
  ] as const;
  const settings = keys.map((key) => profileSetting(equipment, sources, key));
  const byKey = Object.fromEntries(keys.map((key, index) => [key, settings[index]])) as Record<(typeof keys)[number], ResolvedProfileValue>;
  if (keys.some((key) => byKey[key].value === undefined)) return null;
  const result = calculateWaterVolumes({
    batchVolumeL: doc.batchSizeL,
    grainKg,
    boilTimeMin: doc.boilTimeMin,
    boilOffLPerH: byKey.boil_off_l_per_h.value!,
    grainAbsorptionLPerKg: byKey.grain_absorption_l_per_kg.value!,
    mashThicknessLPerKg: byKey.mash_thickness_l_per_kg.value!,
    mashDeadSpaceL: byKey.mash_dead_space_l.value,
    pumpPipeLossL: byKey.pump_pipe_loss_l.value,
    kettleLossL: byKey.kettle_loss_l.value,
    chillerLossL: byKey.chiller_loss_l.value,
    transferLossL: byKey.transfer_loss_l.value,
    coolingShrinkagePct: byKey.cooling_shrinkage_pct.value,
  });
  return { result, source: settings.some((setting) => setting.source === "assumed") ? "assumed" : "calculated", settings };
}

export function buildBrewPlan({ recipe: doc, equipment, equipmentSources, doneIngredientIds = new Set() }: BrewPlanInput): BrewPlan {
  const grainKg = mashedGrainKg(doc);
  const planned = plannedWater(doc, equipment, equipmentSources, grainKg);
  const water = planned?.result ?? null;
  const spargeSetting = profileSetting(equipment, equipmentSources, "sparge_temperature_c");
  const grainTemperatureSetting = profileSetting(equipment, equipmentSources, "grain_temperature_c");
  const strikeOffsetSetting = profileSetting(equipment, equipmentSources, "strike_temp_offset_c");
  const thicknessSetting = profileSetting(equipment, equipmentSources, "mash_thickness_l_per_kg");
  const firstMash = doc.mashSteps[0];
  const planAssumptions = assumptionsFrom([
    ...(planned?.settings ?? []),
    ...(firstMash && firstMash.infusionTemperatureC === undefined ? [grainTemperatureSetting, strikeOffsetSetting] : []),
    ...(doc.spargeTemperatureC === undefined && grainKg > 0 ? [spargeSetting] : []),
  ]);
  const done = (id: string) => doneIngredientIds.has(id);

  // Strike water: the source's own plan wins; our calculation is the fallback.
  const strikeVolumeL = firstMash?.infusionL !== undefined
    ? recipe(firstMash.infusionL)
    : water && planned
      ? quantityFrom(water.mashWaterL, ...planned.settings)
      : undefined;
  let strikeTemperatureC: PlanQuantity | undefined;
  if (firstMash?.infusionTemperatureC !== undefined) {
    strikeTemperatureC = recipe(firstMash.infusionTemperatureC);
  } else if (firstMash && grainKg > 0) {
    const thickness = strikeVolumeL ? strikeVolumeL.value / grainKg : thicknessSetting.value ?? 3;
    const tempSettings = [
      ...(strikeVolumeL?.source === "assumed" ? [thicknessSetting] : []),
      grainTemperatureSetting,
      strikeOffsetSetting,
    ];
    const tempSource = assumptionsFrom(tempSettings).length > 0 ? "assumed" : "calculated";
    const tempAssumptions = assumptionsFrom(tempSettings).map((assumption) => assumption.label);
    strikeTemperatureC = {
      source: tempSource,
      assumptions: tempAssumptions.length > 0 ? tempAssumptions : undefined,
      value:
      calculateStrikeTemperature({
        targetMashTempC: firstMash.temperatureC,
        grainTempC: grainTemperatureSetting.value ?? 18,
        mashThicknessLPerKg: thickness,
        systemOffsetC: strikeOffsetSetting.value ?? 0,
      }).strikeTempC,
    };
  }

  const infusedL = doc.mashSteps.reduce((sum, step) => sum + (step.infusionL ?? 0), 0);
  const spargeVolumeL = water && planned
    ? quantityFrom(infusedL > 0 && firstMash?.infusionL !== undefined ? Math.max(0, water.totalWaterL - infusedL) : water.spargeWaterL, ...planned.settings)
    : undefined;
  const preBoilVolumeL = water && planned ? quantityFrom(water.preBoilVolumeL, ...planned.settings) : undefined;
  const postBoilVolumeL = water && planned ? quantityFrom(water.postBoilVolumeL, ...planned.settings) : undefined;
  const { og: expectedOg, fg: expectedFg } = expectedGravities(doc);
  const og = expectedOg === null
    ? null
    : { value: expectedOg, source: doc.targets.og !== undefined ? "recipe" as const : "calculated" as const };
  const fg = expectedFg === null
    ? null
    : { value: expectedFg, source: doc.targets.fg !== undefined ? "recipe" as const : "calculated" as const };
  const preBoilSg = og && preBoilVolumeL
    ? {
        value: pointsToSg((sgToPoints(og.value) * doc.batchSizeL) / preBoilVolumeL.value),
        source: sourceFrom([og, preBoilVolumeL]),
        assumptions: [...new Set(preBoilVolumeL.assumptions ?? [])],
      }
    : undefined;
  const spargeTemperatureC = doc.spargeTemperatureC !== undefined
    ? recipe(doc.spargeTemperatureC)
    : grainKg > 0 && spargeSetting.value !== undefined
      ? {
          value: spargeSetting.value,
          source: spargeSetting.source ?? "assumed",
          assumptions: spargeSetting.assumption ? [spargeSetting.assumption.label] : undefined,
        }
      : undefined;
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
  if (spargeVolumeL || spargeTemperatureC) {
    waterItems.push({
      id: "water:sparge",
      title: "Skyllevann",
      volumeL: spargeVolumeL,
      temperatureC: spargeTemperatureC,
      done: false,
    });
  }
  if (water && planned) waterItems.push({ id: "water:total", title: "Vann totalt", volumeL: quantityFrom(water.totalWaterL, ...planned.settings), done: false });

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
      .filter(isMashed)
      .map((f) => ({ id: `grain:${f.id}`, title: f.name, amount: { value: f.amountKg, unit: "kg" }, done: false })),
    ...hopsFor("mash").map((hop) => hopItem(hop, "Mesk")),
    ...miscsFor("mash").map((misc) => miscItem(misc, "Mesk")),
  ];

  const lauterItems: BrewPlanItem[] = [
    ...(spargeTemperatureC || spargeVolumeL
      ? [{ id: "lauter:sparge", title: "Skyll", temperatureC: spargeTemperatureC, volumeL: spargeVolumeL, done: false }]
      : []),
    ...(preBoilVolumeL ? [{ id: "lauter:pre-boil", title: "Volum før kok", volumeL: preBoilVolumeL, done: false }] : []),
    ...(preBoilSg ? [{ id: "lauter:pre-boil-sg", title: "SG før kok", gravitySg: preBoilSg, done: false }] : []),
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

  return {
    summary: {
      strikeVolumeL,
      strikeTemperatureC,
      mashTemperatureC: firstMash?.temperatureC,
      mashDurationMin: doc.mashSteps.length > 0 ? doc.mashSteps.reduce((sum, step) => sum + step.durationMin, 0) : undefined,
      spargeVolumeL,
      spargeTemperatureC,
      preBoilVolumeL,
      preBoilSg,
      postBoilVolumeL,
      boilTimeMin: doc.boilTimeMin,
      grainKg,
      hopTotalG: doc.hops.reduce((sum, hop) => sum + hop.amountG, 0),
      dryHopTotalG: hopsFor("dry_hop").reduce((sum, hop) => sum + hop.amountG, 0),
      pitchTemperatureC: pitchStep?.temperatureC,
      og,
      fg,
      assumptions: planAssumptions,
      waterVolumesUseAssumptions: planned?.source === "assumed",
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
