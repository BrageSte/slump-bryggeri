import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  assistantProposedActionSchema,
  createCommentSchema,
  createEventSchema,
  createMeasurementSchema,
  type AssistantProposedAction,
} from "../../src/domain/model/api.ts";
import { measurementKindSpecs, ingredientAddedDataSchema, timerStartedDataSchema } from "../../src/domain/model/brewing.ts";
import { isSupportedMeasurementUnit, measurementToCanonical } from "../../src/domain/brewing-calculations/measurement-units.ts";
import { round } from "../../src/domain/format.ts";
import {
  brixToSg,
  calculateAbv,
  calculateApparentAttenuation,
  calculateEfficiency,
  calculateMashTemperatureAdjustment,
  calculateBoilOffRate,
  calculateStrikeTemperature,
  calculateWaterVolumes,
  convertUnitValue,
  mashedGrainKg,
  refractometerFinalGravity,
} from "../../src/domain/brewing-calculations/index.ts";
import { profileValue } from "../../src/domain/model/equipment-profile.ts";
import { addSaltsToWater, deriveWaterValues } from "../../src/domain/brewing-calculations/water-chemistry.ts";
import { ionInfo, isSaltAgent, waterAgents, waterValueBasisLabels, getWaterAgent, type IonConcentrations } from "../../src/domain/model/water.ts";
import { guidanceDisclaimer, ionGuidance, mashPhGuidance } from "../../src/domain/water/guidance.ts";
import { summarizeWaterOfBatch } from "../../src/domain/water/batch-water.ts";
import { breweryTools } from "./recipe-tools.ts";
import {
  batchTool,
  equipmentValuesOf,
  sharedTool,
  type BatchToolContext,
  type ToolContext,
  type ToolScope,
} from "./tool-kit.ts";

export type { BreweryToolContext, RecipeListing, ToolContext } from "./tool-kit.ts";

/**
 * The assistant's tools: thin wrappers around `src/domain/brewing-calculations`, so every number
 * the assistant gives comes from the same tested functions as the rest of the app (AGENTS.md: an
 * LLM never computes brewing values). Batch tools default to the batch's frozen snapshots, brewery tools
 * (`recipe-tools.ts`) to the active equipment profile. All tools are read-only; nothing here writes to the database.
 */

const waterAddedDataSchema = z.object({
  volumeL: z.number().positive().max(10_000),
  temperatureC: z.number().min(0).max(110),
  reason: z.string().trim().max(300).optional(),
}).strict();

function validateProposedAction(value: unknown, context: BatchToolContext): { action?: AssistantProposedAction; error?: string } {
  const actionResult = assistantProposedActionSchema.safeParse(value);
  if (!actionResult.success) return { error: actionResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  const action = actionResult.data;

  if (action.kind === "log_measurement") {
    const measurement = createMeasurementSchema.safeParse({
      kind: action.measurementKind,
      value: action.value,
      unit: action.unit,
      label: action.label,
      splitId: action.splitId,
      sampleTempC: action.sampleTempC,
    });
    if (!measurement.success) return { error: measurement.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
    if (!isSupportedMeasurementUnit(action.measurementKind, action.unit)) return { error: `Unsupported unit for ${action.measurementKind}: ${action.unit}` };
    if (action.measurementKind === "custom" && !action.label?.trim()) return { error: "Custom measurements need a label." };
    const canonicalValue = measurementToCanonical(action.measurementKind, action.value, action.unit);
    const spec = measurementKindSpecs[action.measurementKind];
    if (canonicalValue === null || canonicalValue < spec.min || canonicalValue > spec.max) {
      return { error: `Measurement value is outside the allowed range for ${action.measurementKind}.` };
    }
    if (action.splitId && !context.batch.splits.some((split) => split.id === action.splitId)) {
      return { error: "splitId does not belong to this batch." };
    }
    return { action };
  }

  if (action.kind === "start_timer") {
    const timer = timerStartedDataSchema.safeParse({ label: action.label, durationMin: action.durationMin });
    return timer.success ? { action } : { error: timer.error.message };
  }

  const event = createEventSchema.safeParse({ type: action.type, data: action.data });
  if (!event.success) return { error: event.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
  let validatedData: Record<string, unknown> = action.data;
  if (action.type === "water_added") {
    const water = waterAddedDataSchema.safeParse(action.data);
    if (!water.success) return { error: water.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
    validatedData = water.data;
  } else if (action.type === "ingredient_added" || action.type === "yeast_pitched") {
    const ingredient = ingredientAddedDataSchema.strict().safeParse(action.data);
    if (!ingredient.success) return { error: ingredient.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
    validatedData = ingredient.data;
  } else if (action.type === "comment") {
    const comment = createCommentSchema.pick({ body: true }).strict().safeParse(action.data);
    if (!comment.success) return { error: comment.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") };
    validatedData = comment.data;
  }
  if (JSON.stringify(validatedData).length > 10_000) return { error: "Event data is too large." };
  return { action: { ...action, data: validatedData } };
}


const saltIds = waterAgents.filter((agent) => agent.kind === "salt").map((agent) => agent.id) as [string, ...string[]];

function derivedRounded(ions: IonConcentrations) {
  const derived = deriveWaterValues(ions);
  return {
    alkalinityMmolL: round(derived.alkalinityMmolL, 2),
    alkalinityAsCaCO3MgL: round(derived.alkalinityAsCaCO3MgL, 1),
    hardnessDh: round(derived.hardnessDh, 2),
    residualAlkalinityAsCaCO3MgL: round(derived.residualAlkalinityAsCaCO3MgL, 1),
    sulfateToChlorideRatio: derived.sulfateToChlorideRatio === null ? null : round(derived.sulfateToChlorideRatio, 2),
  };
}

function ionsRounded(ions: IonConcentrations) {
  return Object.fromEntries(Object.entries(ions).map(([key, value]) => [key, round(value, 1)]));
}

const tools = [
  batchTool({
    name: "strike_temperature",
    description:
      "Strike (mash-in) water temperature for a single infusion. Defaults: grain temperature, mash thickness and the brewery's system offset from the batch's equipment snapshot.",
    input: z.object({
      targetMashTempC: z.number().min(30).max(80).describe("Target mash temperature, °C"),
      grainTempC: z.number().min(-10).max(40).optional(),
      mashThicknessLPerKg: z.number().min(1).max(10).optional().describe("Strike water per kg grain"),
      systemOffsetC: z.number().min(-10).max(15).optional(),
    }),
    run: (input, { batch }) => {
      const values = batch.equipmentSnapshot.values;
      const used = {
        targetMashTempC: input.targetMashTempC,
        grainTempC: input.grainTempC ?? profileValue(values, "grain_temperature_c") ?? 18,
        mashThicknessLPerKg: input.mashThicknessLPerKg ?? profileValue(values, "mash_thickness_l_per_kg") ?? 3,
        systemOffsetC: input.systemOffsetC ?? profileValue(values, "strike_temp_offset_c") ?? 0,
      };
      const result = calculateStrikeTemperature(used);
      return { strikeTempC: round(result.strikeTempC, 1), baseStrikeTempC: round(result.baseStrikeTempC, 1), inputsUsed: used };
    },
  }),
  batchTool({
    name: "water_volumes",
    description:
      "Mash water, sparge water, total water and pre/post-boil volumes working back from the fermenter volume. Defaults: the recipe's batch size, mashed grain and boil time, and losses/boil-off from the batch's equipment snapshot. Fails if no boil-off rate is known and none is given.",
    input: z.object({
      batchVolumeL: z.number().positive().max(10_000).optional(),
      grainKg: z.number().positive().max(1000).optional(),
      boilTimeMin: z.number().min(0).max(600).optional(),
      boilOffLPerH: z.number().min(0).max(200).optional(),
      mashThicknessLPerKg: z.number().min(1).max(10).optional(),
    }),
    run: (input, { batch }) => {
      const values = batch.equipmentSnapshot.values;
      const boilOffLPerH = input.boilOffLPerH ?? values.boil_off_l_per_h;
      if (boilOffLPerH === undefined) return { error: "Boil-off rate unknown: not in the equipment snapshot and not given." };
      const used = {
        batchVolumeL: input.batchVolumeL ?? batch.recipeSnapshot.batchSizeL,
        grainKg: input.grainKg ?? mashedGrainKg(batch.recipeSnapshot),
        boilTimeMin: input.boilTimeMin ?? batch.recipeSnapshot.boilTimeMin,
        boilOffLPerH,
        grainAbsorptionLPerKg: profileValue(values, "grain_absorption_l_per_kg") ?? 0.8,
        mashThicknessLPerKg: input.mashThicknessLPerKg ?? profileValue(values, "mash_thickness_l_per_kg") ?? 3,
        mashDeadSpaceL: profileValue(values, "mash_dead_space_l"),
        pumpPipeLossL: profileValue(values, "pump_pipe_loss_l"),
        kettleLossL: profileValue(values, "kettle_loss_l"),
        chillerLossL: profileValue(values, "chiller_loss_l"),
        transferLossL: profileValue(values, "transfer_loss_l"),
        coolingShrinkagePct: profileValue(values, "cooling_shrinkage_pct"),
      };
      const result = calculateWaterVolumes(used);
      return { ...Object.fromEntries(Object.entries(result).map(([key, value]) => [key, round(value, 1)])), inputsUsed: used };
    },
  }),
  batchTool({
    name: "mash_temperature_adjustment",
    description:
      "Litres of water at a given temperature to add to move the mash from its current to its target temperature (heat balance). Defaults: mashed grain from the recipe. Returns null additionL when the water cannot reach the target.",
    input: z.object({
      mashWaterL: z.number().positive().max(10_000).describe("Water already in the mash, L"),
      currentTempC: z.number().min(0).max(100),
      targetTempC: z.number().min(0).max(100),
      additionTempC: z.number().min(0).max(100).describe("Temperature of the water to add, °C"),
      grainKg: z.number().positive().max(1000).optional(),
      tunMassKg: z.number().min(0).max(500).optional(),
      tunSpecificHeat: z.number().min(0).max(1).optional(),
    }),
    run: (input, { batch }) => {
      const used = { ...input, grainKg: input.grainKg ?? mashedGrainKg(batch.recipeSnapshot) };
      const result = calculateMashTemperatureAdjustment(used);
      return { additionL: result ? round(result.additionL, 2) : null, inputsUsed: used };
    },
  }),
  batchTool({
    name: "gravity_from_brix",
    description:
      "Refractometer reading to SG. Before fermentation: Brix → SG. After fermentation has started, pass originalBrix (the pre-fermentation Brix) to get an alcohol-corrected estimate (Terrill 2011). WCF defaults to the batch's refractometer correction factor.",
    input: z.object({
      brix: z.number().min(0).max(40),
      originalBrix: z.number().min(0).max(40).optional(),
      wcf: z.number().min(0.9).max(1.2).optional(),
    }),
    run: (input, { batch }) => {
      const wcf = input.wcf ?? batch.equipmentSnapshot.values.refractometer_wcf ?? 1;
      if (input.originalBrix !== undefined) {
        return {
          sg: round(refractometerFinalGravity({ originalBrix: input.originalBrix, finalBrix: input.brix, wcf }), 4),
          method: "Terrill 2011 (estimate; uncertainty depends on WCF and the refractometer)",
          wcf,
        };
      }
      return { sg: round(brixToSg(input.brix, wcf), 4), method: "Brix to SG before fermentation", wcf };
    },
  }),
  sharedTool({
    name: "abv_and_attenuation",
    description: "ABV and apparent attenuation from OG and FG.",
    input: z.object({ og: z.number().min(1).max(1.2), fg: z.number().min(0.98).max(1.1) }),
    run: ({ og, fg }) => ({ abvPct: round(calculateAbv(og, fg), 2), apparentAttenuationPct: round(calculateApparentAttenuation(og, fg), 1) }),
  }),
  batchTool({
    name: "brewhouse_efficiency",
    description: "Actual brewhouse efficiency (%) from a measured gravity and the volume it was measured at, using the recipe's grain bill.",
    input: z.object({ measuredSg: z.number().min(1).max(1.2), volumeL: z.number().positive().max(10_000) }),
    run: ({ measuredSg, volumeL }, { batch }) => ({
      efficiencyPct: round(calculateEfficiency({ fermentables: batch.recipeSnapshot.fermentables, sg: measuredSg, volumeL }), 1),
      plannedEfficiencyPct: batch.recipeSnapshot.efficiencyPct,
    }),
  }),
  batchTool({
    name: "observed_boil_off",
    description: "Boil-off rate (L/h) from volumes measured before and after the boil.",
    input: z.object({
      preBoilVolumeL: z.number().positive().max(10_000),
      postBoilVolumeL: z.number().positive().max(10_000),
      boilTimeMin: z.number().positive().max(600).optional(),
    }),
    run: (input, { batch }) => {
      const boilTimeMin = input.boilTimeMin ?? batch.recipeSnapshot.boilTimeMin;
      return {
        boilOffLPerH: round(calculateBoilOffRate({ ...input, boilTimeMin }), 2),
        profileBoilOffLPerH: batch.equipmentSnapshot.values.boil_off_l_per_h ?? null,
        boilTimeMin,
      };
    },
  }),
  sharedTool({
    name: "convert_units",
    description: "Convert between supported units: L ↔ US gal, °C ↔ °F, g/kg ↔ oz/lb, bar ↔ psi, SG ↔ °P, °Bx ↔ SG (before fermentation).",
    input: z.object({ value: z.number(), fromUnit: z.string().max(10), toUnit: z.string().max(10) }),
    run: ({ value, fromUnit, toUnit }, context) => {
      const result = convertUnitValue(value, fromUnit, toUnit, { wcf: equipmentValuesOf(context).refractometer_wcf });
      return result === null ? { error: `Cannot convert ${fromUnit} to ${toUnit}.` } : { value: round(result, 4), unit: toUnit };
    },
  }),
  batchTool({
    name: "water_chemistry",
    description:
      "This batch's water chemistry in four separate parts: sourceWater (ions as the supplier reports them, frozen into the batch; frozen=false means an older batch assumed to have used the brewery's base water), calculated (values we derive from it: alkalinity, residual alkalinity, hardness, and the profile after the recipe's planned salts), plan (the recipe's target ions, mash pH target, planned salts and acids) and measured (pH readings with sample point, sample temperature and instrument, and the salts and acids actually logged). Optionally pass whatIfSalts to see the profile after dissolving salts (grams) in totalWaterL (defaults to the plan's mash plus sparge water). guidance holds general windows, not rules. There is no mash pH prediction and no acid dosing: do not estimate them.",
    input: z.object({
      whatIfSalts: z.array(z.object({ agent: z.enum(saltIds), grams: z.number().positive().max(100_000) })).max(10).optional(),
      totalWaterL: z.number().positive().max(10_000).optional(),
    }),
    run: (input, { batch, timeline }) => {
      if (!timeline) return { error: "not available" };
      const summary = summarizeWaterOfBatch(batch, timeline);
      const { source, plan, calculated, measured } = summary;
      const whatIf = (() => {
        if (!input.whatIfSalts || input.whatIfSalts.length === 0) return undefined;
        const totalWaterL = input.totalWaterL ?? calculated.totalWaterL;
        if (totalWaterL === null) return { error: "Water volume unknown: not in the plan and not given as totalWaterL." };
        const salts = input.whatIfSalts.flatMap((salt) => {
          const agent = getWaterAgent(salt.agent);
          return isSaltAgent(agent) ? [{ composition: agent.composition, grams: salt.grams }] : [];
        });
        const resulting = addSaltsToWater(source.profile.ions, salts, totalWaterL);
        return { basis: waterValueBasisLabels.calculated, totalWaterL, resultingIonsMgL: ionsRounded(resulting), derived: derivedRounded(resulting), note: "All salts counted as dissolved in the whole water volume; acids are not modelled." };
      })();
      return {
        sourceWater: {
          basis: waterValueBasisLabels.reported,
          frozenInBatch: source.frozen,
          name: source.profile.name,
          ionsMgL: source.profile.ions,
          reportedAlkalinityMmolL: source.profile.alkalinityMmolL,
          reportedHardnessDh: source.profile.hardnessDh,
          reportedWaterPh: source.profile.ph,
          otherReported: (source.profile.otherReported ?? []).map(({ name, value, unit, limit }) => ({ name, value, unit, limit })),
          confirmedUse: source.profile.confirmedUse ?? null,
          source: { organization: source.profile.source.organization, url: source.profile.source.url, retrievedAt: source.profile.source.retrievedAt, publishedAt: source.profile.source.publishedAt },
          caveats: source.profile.caveats,
        },
        calculated: {
          basis: waterValueBasisLabels.calculated,
          fromSourceWater: derivedRounded(source.profile.ions),
          totalWaterL: calculated.totalWaterL === null ? null : round(calculated.totalWaterL, 1),
          totalWaterAssumed: calculated.totalWaterAssumed,
          afterPlannedSalts: calculated.afterPlannedSalts ? { ionsMgL: ionsRounded(calculated.afterPlannedSalts), derived: derivedRounded(calculated.afterPlannedSalts) } : null,
          note: calculated.note,
          whatIf,
        },
        plan: { basis: waterValueBasisLabels.target, ...plan },
        measured: {
          basis: waterValueBasisLabels.measured,
          ph: measured.ph.map(({ point, stage, value, valueMin, valueMax, sampleTempC, instrument, comment, at }) => ({ point, stage, value, valueMin, valueMax, sampleTempC, instrument, comment, at: new Date(at).toISOString() })),
          additions: measured.additions.map(({ agent, name, amount, unit, acidStrengthPct, at }) => ({ agent, name, amount, unit, acidStrengthPct, at: new Date(at).toISOString() })),
        },
        guidance: {
          basis: waterValueBasisLabels.target,
          disclaimer: guidanceDisclaimer,
          mashPh: { windowAtRoomTemperature: mashPhGuidance.window, planningTarget: mashPhGuidance.planningTarget, note: mashPhGuidance.note },
          ionsMgL: ionGuidance.filter((entry) => entry.typical).map((entry) => ({ ion: ionInfo[entry.ion].name, typical: entry.typical, cautionAbove: entry.cautionAbove ?? null })),
        },
      };
    },
  }),
  batchTool({
    name: "get_batch_section",
    description: "Return the requested section of this batch's brew document. An empty section means no section content is available.",
    input: z.object({ section: z.enum(["plan", "water", "equipment", "status", "results", "calibration", "log"]) }),
    run: ({ section }, context) => context.brewDocumentSections?.[section] ?? { error: "not available" },
  }),
  sharedTool({
    name: "brewery_history",
    description: "The brewery's own observed boil-off, brewhouse efficiency, strike-temperature offset and attenuation across earlier batches, with counts; per batch also the source water used, mash pH target, pH readings (sample point, temperature, instrument) and salts and acids added. Use only for calibration, questions about what is normal for this brewery, or how earlier batches' water and pH compare.",
    input: z.object({}),
    run: async (_input, context) => (context.loadBreweryHistory ? context.loadBreweryHistory() : { error: "not available" }),
  }),
  batchTool({
    name: "propose_actions",
    description:
      "Suggest only new, actual observations from this batch, or a timer the brewer requested, for confirmation. First address all questions; this tool never replaces advice. Do not propose targets, plans, hypotheticals, already logged values, or anything the brewer says not to log. Never performs a write. Each action must match one of these strict shapes: {kind:'log_measurement',measurementKind,value,unit,label?,splitId?,sampleTempC?} (for pH, label «pH før kok», «pH etter kok» or «Slutt-pH» when the stage does not already say where the sample was taken, and sampleTempC when the brewer states it); {kind:'log_event',type,data} (water_added data is {volumeL,temperatureC,reason?}, ingredient_added/yeast_pitched use ingredient data, comment data is {body}); or {kind:'start_timer',label,durationMin}.",
    // Expose the strict action union to Claude; runAssistantTool has a tolerant item-wise fallback
    // so invalid suggestions are still reported without discarding valid siblings.
    input: z.object({ actions: z.array(assistantProposedActionSchema).max(12) }).strict(),
    run: ({ actions }, context) => {
      const accepted: { index: number; action: AssistantProposedAction }[] = [];
      const rejected: { index: number; reason: string }[] = [];
      actions.forEach((candidate, index) => {
        const result = validateProposedAction(candidate, context);
        if (result.action) {
          accepted.push({ index, action: result.action });
          context.proposedActions?.push(result.action);
        } else {
          rejected.push({ index, reason: result.error ?? "Invalid action." });
        }
      });
      return { accepted, rejected };
    },
  }),
  ...breweryTools,
];

const definitionsFor = (scopes: readonly ToolScope[]): Anthropic.Tool[] =>
  tools
    .filter((t) => scopes.includes(t.scope))
    .map((t) => {
      const { $schema: _schema, ...schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
      return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema };
    });

/** The tools of the batch thread, in the shape the Messages API expects. Order is fixed so the prompt cache holds. */
export const assistantToolDefinitions: Anthropic.Tool[] = definitionsFor(["batch", "both"]);

/** The tools of the brewery thread (recipes, equipment, history). */
export const breweryToolDefinitions: Anthropic.Tool[] = definitionsFor(["brewery", "both"]);

/**
 * Runs one tool call. Invalid input or a failing calculation becomes an error result, never a throw. A tool outside the
 * thread's scope is unknown to it: the context says which thread this is (`brewery` set, or a `batch`).
 */
export async function runAssistantTool(name: string, input: unknown, context: ToolContext): Promise<{ content: string; isError: boolean }> {
  const scopes: readonly ToolScope[] = context.brewery ? ["brewery", "both"] : ["batch", "both"];
  const definition = tools.find((t) => t.name === name && scopes.includes(t.scope));
  if (!definition) return { content: `Unknown tool: ${name}`, isError: true };
  if (definition.scope === "batch" && !context.batch) return { content: `${name} needs a batch.`, isError: true };
  let parsedInput: unknown;
  const parsed = definition.input.safeParse(input);
  if (parsed.success) {
    parsedInput = parsed.data;
  } else if (name === "propose_actions") {
    const raw = z.object({ actions: z.array(z.unknown()).max(12) }).strict().safeParse(input);
    if (!raw.success) return { content: `Invalid input: ${raw.error.message}`, isError: true };
    parsedInput = raw.data;
  } else {
    return { content: `Invalid input: ${parsed.error.message}`, isError: true };
  }
  try {
    // Each tool's run matches its own schema; the union type loses that pairing.
    const result = await (definition.run as (input: unknown, context: ToolContext) => unknown | Promise<unknown>)(parsedInput, context);
    const content = name === "get_batch_section" && typeof result === "string" ? result : JSON.stringify(result) ?? "null";
    return { content, isError: false };
  } catch (error) {
    return { content: error instanceof Error ? error.message : "Calculation failed", isError: true };
  }
}
