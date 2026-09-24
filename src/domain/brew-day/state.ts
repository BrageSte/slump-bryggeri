import { brixToSg, expectedGravities } from "../brewing-calculations/index.ts";
import {
  brewStageLabels,
  brewStages,
  measurementKindSpecs,
  stageStartedEventType,
  startStageLabels,
  type BrewStage,
  type IngredientKind,
  type MeasurementKind,
} from "../model/brewing.ts";
import type { RecipeDocument } from "../model/recipe.ts";

/**
 * Derives what the brew-day screen should show — current step, targets vs. measured values,
 * due additions and the single next action — from the frozen recipe snapshot and the log.
 * Pure: the caller passes `now`.
 */

export interface BrewDayLogEntry {
  /** Timeline id; needed to cancel a timer. */
  id?: string;
  type: string;
  stage: BrewStage | null;
  /** Fermentation variant (batch split) the entry belongs to; null or absent for the whole batch. */
  splitId?: string | null;
  occurredAt: number;
  data: Record<string, unknown> | null;
  measurement: { kind: MeasurementKind; value: number; valueMin?: number | null; valueMax?: number | null } | null;
}

export type TargetValue = { kind: "value"; value: number } | { kind: "range"; min: number; max: number };
export type TargetStatus = "ok" | "low" | "high" | "uncertain" | "missing";

export interface StageTarget {
  key: string;
  measurementKind: MeasurementKind;
  label: string;
  target: TargetValue;
  unit: string;
  actual: { value: number; occurredAt: number; valueMin?: number; valueMax?: number; derivedFrom?: "brix" } | null;
  status: TargetStatus;
}

export interface PlannedAddition {
  ingredientKind: IngredientKind;
  ingredientId: string;
  name: string;
  amount: number;
  unit: string;
  variant?: string;
  /** Minutes into the stage (boil/whirlpool) or fermentation day (dry hop) when due. */
  dueAt: number;
  dueLabel: string;
  status: "done" | "due" | "upcoming";
  /** What was logged as added; dry hops are adjusted to taste, so it can differ from the plan. */
  actual?: { amount: number; unit: string };
}

export type NextAction =
  | { kind: "start_stage"; stage: BrewStage; label: string }
  | { kind: "add_ingredient"; addition: PlannedAddition; label: string; inMin: number }
  | { kind: "log_measurement"; measurementKind: MeasurementKind; label: string }
  | { kind: "complete"; label: string };

export interface StageStep {
  label: string;
  detail: string | null;
  totalMin: number | null;
  remainingMin: number | null;
  /** When the current timed step ends (mash rest, boil, whirlpool), or null. */
  endsAt: number | null;
}

export interface BrewDayState {
  stage: BrewStage | null;
  stageStartedAt: number | null;
  elapsedMin: number | null;
  step: StageStep | null;
  fermentationDay: number | null;
  targets: StageTarget[];
  additions: PlannedAddition[];
  nextAction: NextAction | null;
}

export interface BrewDayInput {
  recipe: RecipeDocument;
  stage: BrewStage | null;
  stageStartedAt: number | null;
  log: BrewDayLogEntry[];
  now: number;
  /** Refractometer wort correction factor from the equipment snapshot. */
  wcf?: number;
  completed?: boolean;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const DEFAULT_MASH_PH = { min: 5.2, max: 5.4 } as const;
const DEFAULT_WHIRLPOOL_MIN = 20;

export function deriveBrewDayState(input: BrewDayInput): BrewDayState {
  const { recipe, stage, now } = input;
  const log = [...input.log].sort((a, b) => a.occurredAt - b.occurredAt);

  if (input.completed) {
    return {
      stage,
      stageStartedAt: input.stageStartedAt,
      elapsedMin: null,
      step: null,
      fermentationDay: null,
      targets: [],
      additions: [],
      nextAction: null,
    };
  }

  if (stage === null) {
    return {
      stage: null,
      stageStartedAt: null,
      elapsedMin: null,
      step: null,
      fermentationDay: null,
      targets: [],
      additions: [],
      nextAction: { kind: "start_stage", stage: "mash", label: startStageLabels.mash },
    };
  }

  const stageStartedAt = input.stageStartedAt ?? findStageStart(log, stage);
  const elapsedMin = stageStartedAt === null ? null : Math.max(0, (now - stageStartedAt) / MINUTE);
  const doneIngredients = new Map<string, { amount: number; unit: string } | null>();
  for (const e of log) {
    if ((e.type !== "ingredient_added" && e.type !== "yeast_pitched") || typeof e.data?.ingredientId !== "string") continue;
    const { amount, unit } = e.data;
    doneIngredients.set(e.data.ingredientId, typeof amount === "number" && typeof unit === "string" ? { amount, unit } : null);
  }

  const fermentationStart = findFermentationStart(log);
  const fermentationDay =
    fermentationStart !== null && stageIndex(stage) >= stageIndex("fermentation")
      ? Math.floor((now - fermentationStart) / DAY)
      : null;

  const additions = plannedAdditions(recipe, stage, elapsedMin ?? 0, fermentationDay, doneIngredients);
  const targets = stageTargets(input, log, stage, stageStartedAt);
  const step = stageStep(recipe, stage, elapsedMin, fermentationDay, stageStartedAt);
  const nextAction = chooseNextAction(recipe, stage, additions, log, elapsedMin ?? 0, now);

  return { stage, stageStartedAt, elapsedMin, step, fermentationDay, targets, additions, nextAction };
}

function stageIndex(stage: BrewStage): number {
  return brewStages.indexOf(stage);
}

function findStageStart(log: BrewDayLogEntry[], stage: BrewStage): number | null {
  const type = stageStartedEventType(stage);
  const event = log.findLast((e) => e.type === type);
  return event?.occurredAt ?? null;
}

function findFermentationStart(log: BrewDayLogEntry[]): number | null {
  const event = log.find((e) => e.type === "fermentation_started" || e.type === "yeast_pitched");
  return event?.occurredAt ?? null;
}

function hasWhirlpool(recipe: RecipeDocument): boolean {
  return recipe.hops.some((h) => h.use === "whirlpool") || recipe.miscs.some((m) => m.use === "whirlpool");
}

/** The stage that follows `stage` for this recipe (whirlpool is skipped when unused). */
export function followingStage(recipe: RecipeDocument, stage: BrewStage | null): BrewStage | null {
  let index = stage === null ? 0 : stageIndex(stage) + 1;
  let candidate = brewStages[index] ?? null;
  if (candidate === "whirlpool" && !hasWhirlpool(recipe)) {
    index += 1;
    candidate = brewStages[index] ?? null;
  }
  return candidate;
}

function plannedAdditions(
  recipe: RecipeDocument,
  stage: BrewStage,
  elapsedMin: number,
  fermentationDay: number | null,
  done: Map<string, { amount: number; unit: string } | null>,
): PlannedAddition[] {
  const additions: PlannedAddition[] = [];
  const status = (id: string, isDue: boolean): PlannedAddition["status"] =>
    done.has(id) ? "done" : isDue ? "due" : "upcoming";

  if (stage === "boil") {
    for (const hop of recipe.hops) {
      if (hop.use !== "boil" && hop.use !== "first_wort") continue;
      const timeMin = hop.use === "first_wort" ? recipe.boilTimeMin : (hop.timeMin ?? 0);
      const dueAt = Math.max(0, recipe.boilTimeMin - timeMin);
      additions.push({
        ingredientKind: "hop",
        ingredientId: hop.id,
        name: hop.name,
        amount: hop.amountG,
        unit: "g",
        variant: hop.variant,
        dueAt,
        dueLabel: hop.use === "first_wort" ? "First wort" : `${timeMin} min`,
        status: status(hop.id, elapsedMin >= dueAt),
      });
    }
    for (const misc of recipe.miscs) {
      if (misc.use !== "boil") continue;
      const timeMin = misc.timeMin ?? 0;
      const dueAt = Math.max(0, recipe.boilTimeMin - timeMin);
      additions.push({
        ingredientKind: "misc",
        ingredientId: misc.id,
        name: misc.name,
        amount: misc.amount,
        unit: misc.unit,
        dueAt,
        dueLabel: `${timeMin} min`,
        status: status(misc.id, elapsedMin >= dueAt),
      });
    }
  } else if (stage === "whirlpool") {
    for (const hop of recipe.hops) {
      if (hop.use !== "whirlpool") continue;
      additions.push({
        ingredientKind: "hop",
        ingredientId: hop.id,
        name: hop.name,
        amount: hop.amountG,
        unit: "g",
        variant: hop.variant,
        dueAt: 0,
        dueLabel: hop.temperatureC === undefined ? "Whirlpool" : `Whirlpool ${hop.temperatureC} °C`,
        status: status(hop.id, true),
      });
    }
    for (const misc of recipe.miscs) {
      if (misc.use !== "whirlpool") continue;
      additions.push({
        ingredientKind: "misc",
        ingredientId: misc.id,
        name: misc.name,
        amount: misc.amount,
        unit: misc.unit,
        dueAt: 0,
        dueLabel: "Whirlpool",
        status: status(misc.id, true),
      });
    }
  } else if (stage === "fermentation" || stage === "conditioning") {
    for (const hop of recipe.hops) {
      if (hop.use !== "dry_hop") continue;
      const day = hop.dayOfFermentation ?? 0;
      additions.push({
        ingredientKind: "hop",
        ingredientId: hop.id,
        name: hop.name,
        amount: hop.amountG,
        unit: "g",
        variant: hop.variant,
        dueAt: day,
        dueLabel: `Dag ${day}`,
        status: status(hop.id, fermentationDay !== null && fermentationDay >= day),
      });
    }
  }

  for (const addition of additions) {
    const actual = done.get(addition.ingredientId);
    if (actual) addition.actual = actual;
  }
  return additions.sort((a, b) => a.dueAt - b.dueAt);
}

export function compareMeasurementToTarget(
  kind: MeasurementKind,
  target: TargetValue,
  actual: { value: number; valueMin?: number | null; valueMax?: number | null },
): TargetStatus {
  const targetTolerance = target.kind === "value" ? measurementKindSpecs[kind].tolerance : 0;
  const targetMin = target.kind === "range" ? target.min : target.value - targetTolerance;
  const targetMax = target.kind === "range" ? target.max : target.value + targetTolerance;
  if (actual.valueMin !== undefined && actual.valueMin !== null && actual.valueMax !== undefined && actual.valueMax !== null) {
    if (actual.valueMin >= targetMin && actual.valueMax <= targetMax) return "ok";
    if (actual.valueMax < targetMin) return "low";
    if (actual.valueMin > targetMax) return "high";
    return "uncertain";
  }
  if (target.kind === "range") {
    if (actual.value < target.min) return "low";
    if (actual.value > target.max) return "high";
    return "ok";
  }
  if (actual.value < targetMin) return "low";
  if (actual.value > targetMax) return "high";
  return "ok";
}

export function temperatureTarget(min: number | undefined, max: number | undefined): TargetValue | null {
  if (min === undefined) return null;
  return max === undefined || max === min ? { kind: "value", value: min } : { kind: "range", min, max };
}

function stageTargets(
  input: BrewDayInput,
  log: BrewDayLogEntry[],
  stage: BrewStage,
  stageStartedAt: number | null,
): StageTarget[] {
  const { recipe } = input;
  const wcf = input.wcf ?? 1;
  const inStage = log.filter(
    (e) => e.measurement !== null && e.stage === stage && (stageStartedAt === null || e.occurredAt >= stageStartedAt),
  );
  const latest = (entries: BrewDayLogEntry[], kind: MeasurementKind) => entries.findLast((e) => e.measurement?.kind === kind);

  const targets: StageTarget[] = [];
  const add = (
    key: string,
    measurementKind: MeasurementKind,
    label: string,
    target: TargetValue | null,
    actual: StageTarget["actual"],
  ) => {
    if (target === null) return;
    targets.push({
      key,
      measurementKind,
      label,
      target,
      unit: measurementKindSpecs[measurementKind].unit ?? "",
      actual,
      status: actual === null ? "missing" : compareMeasurementToTarget(measurementKind, target, actual),
    });
  };
  const actualOf = (entry: BrewDayLogEntry | undefined): StageTarget["actual"] =>
    entry?.measurement
      ? {
          value: entry.measurement.value,
          valueMin: entry.measurement.valueMin ?? undefined,
          valueMax: entry.measurement.valueMax ?? undefined,
          occurredAt: entry.occurredAt,
        }
      : null;

  switch (stage) {
    case "mash": {
      const step = currentMashStep(recipe, stageStartedAt === null ? 0 : (input.now - stageStartedAt) / MINUTE);
      add("mash-temp", "temperature", "Mesketemperatur", step ? { kind: "value", value: step.temperatureC } : null, actualOf(latest(inStage, "temperature")));
      add(
        "mash-ph",
        "ph",
        "Mesk-pH",
        {
          kind: "range",
          min: recipe.targets.mashPhMin ?? DEFAULT_MASH_PH.min,
          max: recipe.targets.mashPhMax ?? DEFAULT_MASH_PH.max,
        },
        actualOf(latest(inStage, "ph")),
      );
      break;
    }
    case "lauter":
      add(
        "sparge-temp",
        "temperature",
        "Skyllevann",
        recipe.spargeTemperatureC === undefined ? null : { kind: "value", value: recipe.spargeTemperatureC },
        actualOf(latest(inStage, "temperature")),
      );
      break;
    case "whirlpool": {
      const temp = recipe.hops.find((h) => h.use === "whirlpool" && h.temperatureC !== undefined)?.temperatureC;
      add(
        "whirlpool-temp",
        "temperature",
        "Whirlpool",
        temp === undefined ? null : { kind: "value", value: temp },
        actualOf(latest(inStage, "temperature")),
      );
      break;
    }
    case "cooling": {
      const pitch = recipe.fermentationSteps[0];
      add(
        "pitch-temp",
        "temperature",
        "Temperatur ved gjærtilsetning",
        temperatureTarget(pitch?.temperatureC, pitch?.temperatureMaxC),
        actualOf(latest(inStage, "temperature")),
      );
      const { og } = expectedGravities(recipe);
      const postBoil = log.filter(
        (e) => e.stage !== null && stageIndex(e.stage) >= stageIndex("boil") && stageIndex(e.stage) <= stageIndex("cooling"),
      );
      add("og", "sg", "OG", og === null ? null : { kind: "value", value: round3(og) }, latestGravity(postBoil, wcf));
      break;
    }
    // Fermentation is summarized per variant in fermentation.ts; gravity is not judged against the FG
    // target while the yeast is still working.
    default:
      break;
  }
  return targets;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function latestGravity(entries: BrewDayLogEntry[], wcf: number): StageTarget["actual"] {
  const entry = entries.findLast((e) => e.measurement?.kind === "sg" || e.measurement?.kind === "brix");
  if (!entry?.measurement) return null;
  if (entry.measurement.kind === "sg") return { value: entry.measurement.value, occurredAt: entry.occurredAt };
  return { value: round3(brixToSg(entry.measurement.value, wcf)), occurredAt: entry.occurredAt, derivedFrom: "brix" };
}

function currentMashStep(recipe: RecipeDocument, elapsedMin: number) {
  let cumulative = 0;
  for (const step of recipe.mashSteps) {
    cumulative += step.durationMin;
    if (elapsedMin < cumulative) return step;
  }
  return recipe.mashSteps.at(-1);
}

/** The planned fermentation step for a fermentation day (0 = pitch day). */
export function currentFermentationStep(recipe: RecipeDocument, day: number) {
  let cumulative = 0;
  for (const step of recipe.fermentationSteps) {
    cumulative += step.durationDays ?? 0;
    if (day < cumulative) return step;
  }
  return recipe.fermentationSteps.at(-1);
}

function stageStep(
  recipe: RecipeDocument,
  stage: BrewStage,
  elapsedMin: number | null,
  fermentationDay: number | null,
  stageStartedAt: number | null,
): StageStep {
  const endsAt = (minutesIntoStage: number) => (stageStartedAt === null ? null : stageStartedAt + minutesIntoStage * MINUTE);
  switch (stage) {
    case "mash": {
      if (recipe.mashSteps.length === 0) return { label: "Mesk", detail: null, totalMin: null, remainingMin: null, endsAt: null };
      let cumulative = 0;
      const elapsed = elapsedMin ?? 0;
      for (const [index, step] of recipe.mashSteps.entries()) {
        cumulative += step.durationMin;
        const isLast = index === recipe.mashSteps.length - 1;
        if (elapsed < cumulative || isLast) {
          return {
            label: `${step.name} · ${formatNumber(step.temperatureC)} °C`,
            detail: recipe.mashSteps.length > 1 ? `Steg ${index + 1} av ${recipe.mashSteps.length}` : null,
            totalMin: step.durationMin,
            remainingMin: elapsedMin === null ? null : Math.max(0, cumulative - elapsed),
            endsAt: endsAt(cumulative),
          };
        }
      }
      return { label: "Mesk", detail: null, totalMin: null, remainingMin: null, endsAt: null };
    }
    case "boil":
      return {
        label: "Kok",
        detail: `${recipe.boilTimeMin} min`,
        totalMin: recipe.boilTimeMin,
        remainingMin: elapsedMin === null ? null : Math.max(0, recipe.boilTimeMin - elapsedMin),
        endsAt: endsAt(recipe.boilTimeMin),
      };
    case "whirlpool": {
      const whirlpoolHops = recipe.hops.filter((h) => h.use === "whirlpool");
      const total = whirlpoolHops.length > 0 ? Math.max(...whirlpoolHops.map((h) => h.timeMin ?? 0)) : DEFAULT_WHIRLPOOL_MIN;
      return {
        label: "Whirlpool",
        detail: null,
        totalMin: total,
        remainingMin: elapsedMin === null ? null : Math.max(0, total - elapsedMin),
        endsAt: endsAt(total),
      };
    }
    case "fermentation": {
      const step = currentFermentationStep(recipe, fermentationDay ?? 0);
      return {
        label: step ? step.name : "Gjæring",
        detail: step?.notes ?? null,
        totalMin: null,
        remainingMin: null,
        endsAt: null,
      };
    }
    default:
      return { label: brewStageLabels[stage], detail: null, totalMin: null, remainingMin: null, endsAt: null };
  }
}

function formatNumber(value: number): string {
  return value.toLocaleString("nb-NO", { maximumFractionDigits: 1 });
}

function chooseNextAction(
  recipe: RecipeDocument,
  stage: BrewStage,
  additions: PlannedAddition[],
  log: BrewDayLogEntry[],
  elapsedMin: number,
  now: number,
): NextAction {
  const pending = additions.find((a) => a.status !== "done");

  if ((stage === "boil" || stage === "whirlpool") && pending) {
    return {
      kind: "add_ingredient",
      addition: pending,
      label: `Tilsett ${pending.name}`,
      inMin: Math.max(0, pending.dueAt - elapsedMin),
    };
  }

  if (stage === "fermentation") {
    const dueDryHop = additions.find((a) => a.status === "due");
    if (dueDryHop) return { kind: "add_ingredient", addition: dueDryHop, label: `Tørrhumle ${dueDryHop.name}`, inMin: 0 };
    const recentGravity = log.some(
      (e) => (e.measurement?.kind === "sg" || e.measurement?.kind === "brix") && e.stage === "fermentation" && now - e.occurredAt < DAY,
    );
    if (!recentGravity) return { kind: "log_measurement", measurementKind: "sg", label: "Sjekk gravity" };
  }

  const next = followingStage(recipe, stage);
  if (next === null) return { kind: "complete", label: "Avslutt batch" };
  return { kind: "start_stage", stage: next, label: startStageLabels[next] };
}
