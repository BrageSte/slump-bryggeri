import { buildBrewPlan, type BrewPlanSummary } from "../brew-day/brew-plan.ts";
import { addSaltsToWater, deriveWaterValues, type WaterDerivedValues } from "../brewing-calculations/water-chemistry.ts";
import type { BatchDetail, TimelineItem } from "../model/api.ts";
import type { RecipeDocument } from "../model/recipe.ts";
import {
  getWaterAgent,
  isSaltAgent,
  type IonConcentrations,
  type PartialIonConcentrations,
  type WaterAgentId,
  type WaterProfile,
} from "../model/water.ts";
import { mashPhGuidance } from "./guidance.ts";
import { phReadings, type PhReading } from "./ph.ts";
import { slumpBaseWater } from "./slump-water.ts";

/**
 * The water story of one batch, with the four kinds of value kept apart:
 *   source      reported by the supplier, frozen into the batch
 *   plan        what the recipe aims for (targets) and intends to add
 *   calculated  ours: derived values and the profile after the planned salts
 *   measured    what was logged during the brew: pH readings and salts and acids actually added
 * The brew document, the assistant's water tool and the brewery history all read this one shape, so
 * "planned versus measured" and "how much acid did similar batches need" ask the same data.
 */

export interface PlannedWaterAgent {
  ingredientId: string;
  name: string;
  agent: WaterAgentId;
  amount: number;
  unit: string;
  acidStrengthPct: number | null;
  use: RecipeDocument["miscs"][number]["use"];
}

export interface LoggedWaterAgent {
  /** Id of the timeline entry. */
  id: string;
  name: string;
  agent: WaterAgentId;
  amount: number;
  unit: string;
  acidStrengthPct: number | null;
  /** The planned addition it fulfils, when it was registered from the plan. */
  ingredientId: string | null;
  at: number;
}

export interface BatchWaterSummary {
  source: {
    profile: WaterProfile;
    /** True when the profile was frozen into the batch; false when an older batch is assumed to have used the brewery's base water. */
    frozen: boolean;
    derived: WaterDerivedValues;
  };
  plan: {
    /** Planned ion concentrations (mg/L) in the brewing water, as the recipe states them. */
    target: PartialIonConcentrations | null;
    profileName: string | null;
    notes: string | null;
    mashPh: { min: number; max: number; source: "recipe" | "assumed" };
    additions: PlannedWaterAgent[];
  };
  calculated: {
    /** Water volume (mash + sparge) the planned salts were spread over, L. Null when the plan cannot say. */
    totalWaterL: number | null;
    /** True when that volume rests on assumed profile values (default boil-off, absorption ...), not on the recipe or calibration. */
    totalWaterAssumed: boolean;
    /** Source water plus the planned salts, all dissolved in the total water. Null without salts or volume. */
    afterPlannedSalts: IonConcentrations | null;
    derivedAfterPlannedSalts: WaterDerivedValues | null;
    note: string | null;
  };
  measured: {
    ph: PhReading[];
    additions: LoggedWaterAgent[];
  };
}

function plannedAdditions(recipe: RecipeDocument): PlannedWaterAgent[] {
  return recipe.miscs.flatMap((misc): PlannedWaterAgent[] =>
    misc.waterAgent
      ? [{ ingredientId: misc.id, name: misc.name, agent: misc.waterAgent, amount: misc.amount, unit: misc.unit, acidStrengthPct: misc.acidStrengthPct ?? null, use: misc.use }]
      : [],
  );
}

function loggedAdditions(timeline: readonly TimelineItem[]): LoggedWaterAgent[] {
  return timeline
    .flatMap((item): LoggedWaterAgent[] => {
      const data = item.data;
      if (item.type !== "ingredient_added" || !data || typeof data.waterAgent !== "string" || !getWaterAgent(data.waterAgent)) return [];
      if (typeof data.name !== "string" || typeof data.amount !== "number" || typeof data.unit !== "string") return [];
      return [
        {
          id: item.id,
          name: data.name,
          agent: data.waterAgent as WaterAgentId,
          amount: data.amount,
          unit: data.unit,
          acidStrengthPct: typeof data.acidStrengthPct === "number" ? data.acidStrengthPct : null,
          ingredientId: typeof data.ingredientId === "string" ? data.ingredientId : null,
          at: item.occurredAt,
        },
      ];
    })
    .sort((a, b) => a.at - b.at);
}

/** Grams of a planned salt, or null when its unit is not a weight. */
function gramsOf(addition: { amount: number; unit: string }): number | null {
  const unit = addition.unit.trim().toLowerCase();
  if (unit === "g") return addition.amount;
  if (unit === "kg") return addition.amount * 1000;
  return null;
}

export function summarizeBatchWater(input: {
  recipe: RecipeDocument;
  /** The profile frozen into the batch, if any. */
  water: WaterProfile | null | undefined;
  timeline: readonly TimelineItem[];
  /** Mash plus sparge water, L, from the brew plan. */
  totalWaterL: number | null;
  /** Whether that volume uses assumed values; the calculated profile then says so. */
  totalWaterAssumed?: boolean;
}): BatchWaterSummary {
  const profile = input.water ?? slumpBaseWater;
  const additions = plannedAdditions(input.recipe);
  const hasRecipeTarget = input.recipe.targets.mashPhMin !== undefined || input.recipe.targets.mashPhMax !== undefined;
  // Same fallback as the brew-day mash pH target (state.ts), bound by bound.
  const mashPhMin = input.recipe.targets.mashPhMin ?? mashPhGuidance.planningTarget.min;
  const mashPhMax = input.recipe.targets.mashPhMax ?? mashPhGuidance.planningTarget.max;

  const salts = additions.flatMap((addition) => {
    const agent = getWaterAgent(addition.agent);
    const grams = gramsOf(addition);
    return isSaltAgent(agent) && grams !== null ? [{ composition: agent.composition, grams }] : [];
  });
  const saltsWithoutWeight = additions.filter((addition) => isSaltAgent(getWaterAgent(addition.agent)) && gramsOf(addition) === null);
  const canCalculate = salts.length > 0 && input.totalWaterL !== null && input.totalWaterL > 0;
  const afterPlannedSalts = canCalculate ? addSaltsToWater(profile.ions, salts, input.totalWaterL!) : null;
  const notes: string[] = [];
  if (additions.some((addition) => isSaltAgent(getWaterAgent(addition.agent))) && input.totalWaterL === null) {
    notes.push("Vannmengden er ukjent, så profilen etter salter kan ikke regnes ut.");
  }
  if (saltsWithoutWeight.length > 0) notes.push(`Salter uten vekt i g eller kg er ikke regnet med: ${saltsWithoutWeight.map((salt) => salt.name).join(", ")}.`);
  if (canCalculate) notes.push("Alle planlagte salter er regnet som løst i hele brygge-vannet (mesk + skyll). Syrer er ikke regnet med.");
  if (canCalculate && input.totalWaterAssumed) notes.push("Vannmengden bygger på antatte profilverdier (se Plan og mål); veg salt etter faktisk vannmengde når den er kjent.");

  return {
    source: { profile, frozen: input.water !== null && input.water !== undefined, derived: deriveWaterValues(profile.ions) },
    plan: {
      target: input.recipe.water?.target && Object.keys(input.recipe.water.target).length > 0 ? input.recipe.water.target : null,
      profileName: input.recipe.water?.profileName ?? null,
      notes: input.recipe.water?.notes ?? null,
      mashPh: { min: mashPhMin, max: mashPhMax, source: hasRecipeTarget ? "recipe" : "assumed" },
      additions,
    },
    calculated: {
      totalWaterL: input.totalWaterL,
      totalWaterAssumed: input.totalWaterAssumed ?? false,
      afterPlannedSalts,
      derivedAfterPlannedSalts: afterPlannedSalts ? deriveWaterValues(afterPlannedSalts) : null,
      note: notes.length > 0 ? notes.join(" ") : null,
    },
    measured: { ph: phReadings(input.timeline), additions: loggedAdditions(input.timeline) },
  };
}

/** Mash plus sparge water from the brew plan, L; null when the plan cannot state both. */
export function totalBrewingWaterL(summary: Pick<BrewPlanSummary, "strikeVolumeL" | "spargeVolumeL">): number | null {
  return summary.strikeVolumeL && summary.spargeVolumeL ? summary.strikeVolumeL.value + summary.spargeVolumeL.value : null;
}

/** True when mash or sparge volume uses an assumed (not recipe, not calibrated) value. */
export function isTotalBrewingWaterAssumed(summary: Pick<BrewPlanSummary, "strikeVolumeL" | "spargeVolumeL">): boolean {
  return summary.strikeVolumeL?.source === "assumed" || summary.spargeVolumeL?.source === "assumed";
}

/** The water story of a batch from its own frozen snapshots and log. */
export function summarizeWaterOfBatch(batch: BatchDetail, timeline: readonly TimelineItem[]): BatchWaterSummary {
  const plan = buildBrewPlan({ recipe: batch.recipeSnapshot, equipment: batch.equipmentSnapshot.values, equipmentSources: batch.equipmentSnapshot.sources });
  return summarizeBatchWater({
    recipe: batch.recipeSnapshot,
    water: batch.equipmentSnapshot.water,
    timeline,
    totalWaterL: totalBrewingWaterL(plan.summary),
    totalWaterAssumed: isTotalBrewingWaterAssumed(plan.summary),
  });
}
