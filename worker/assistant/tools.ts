import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
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
  refractometerFinalGravity,
} from "../../src/domain/brewing-calculations/index.ts";
import type { BatchDetail } from "../../src/domain/model/api.ts";
import { profileValue } from "../../src/domain/model/equipment-profile.ts";

/**
 * The assistant's tools: thin wrappers around `src/domain/brewing-calculations`, so every number
 * the assistant gives comes from the same tested functions as the rest of the app (AGENTS.md: an
 * LLM never computes brewing values). Defaults come from the batch's frozen snapshots. All tools are
 * read-only; nothing here writes to the database.
 */

interface ToolContext {
  batch: BatchDetail;
}

interface AssistantTool<S extends z.ZodType> {
  name: string;
  description: string;
  input: S;
  run: (input: z.output<S>, context: ToolContext) => unknown;
}

const tool = <S extends z.ZodType>(definition: AssistantTool<S>) => definition;

const mashedGrainKg = (batch: BatchDetail) =>
  batch.recipeSnapshot.fermentables.filter((f) => f.type === "grain" || f.type === "adjunct").reduce((sum, f) => sum + f.amountKg, 0);

const round = (value: number, decimals = 2) => Math.round(value * 10 ** decimals) / 10 ** decimals;

const tools = [
  tool({
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
  tool({
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
        grainKg: input.grainKg ?? mashedGrainKg(batch),
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
  tool({
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
      const used = { ...input, grainKg: input.grainKg ?? mashedGrainKg(batch) };
      const result = calculateMashTemperatureAdjustment(used);
      return { additionL: result ? round(result.additionL, 2) : null, inputsUsed: used };
    },
  }),
  tool({
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
  tool({
    name: "abv_and_attenuation",
    description: "ABV and apparent attenuation from OG and FG.",
    input: z.object({ og: z.number().min(1).max(1.2), fg: z.number().min(0.98).max(1.1) }),
    run: ({ og, fg }) => ({ abvPct: round(calculateAbv(og, fg), 2), apparentAttenuationPct: round(calculateApparentAttenuation(og, fg), 1) }),
  }),
  tool({
    name: "brewhouse_efficiency",
    description: "Actual brewhouse efficiency (%) from a measured gravity and the volume it was measured at, using the recipe's grain bill.",
    input: z.object({ measuredSg: z.number().min(1).max(1.2), volumeL: z.number().positive().max(10_000) }),
    run: ({ measuredSg, volumeL }, { batch }) => ({
      efficiencyPct: round(calculateEfficiency({ fermentables: batch.recipeSnapshot.fermentables, sg: measuredSg, volumeL }), 1),
      plannedEfficiencyPct: batch.recipeSnapshot.efficiencyPct,
    }),
  }),
  tool({
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
  tool({
    name: "convert_units",
    description: "Convert between supported units: L ↔ US gal, °C ↔ °F, g/kg ↔ oz/lb, bar ↔ psi, SG ↔ °P, °Bx ↔ SG (before fermentation).",
    input: z.object({ value: z.number(), fromUnit: z.string().max(10), toUnit: z.string().max(10) }),
    run: ({ value, fromUnit, toUnit }, { batch }) => {
      const result = convertUnitValue(value, fromUnit, toUnit, { wcf: batch.equipmentSnapshot.values.refractometer_wcf });
      return result === null ? { error: `Cannot convert ${fromUnit} to ${toUnit}.` } : { value: round(result, 4), unit: toUnit };
    },
  }),
];

/** Tool definitions in the shape the Messages API expects. Order is fixed so the prompt cache holds. */
export const assistantToolDefinitions: Anthropic.Tool[] = tools.map((t) => {
  const { $schema: _schema, ...schema } = z.toJSONSchema(t.input) as Record<string, unknown>;
  return { name: t.name, description: t.description, input_schema: schema as Anthropic.Tool.InputSchema };
});

/** Runs one tool call. Invalid input or a failing calculation becomes an error result, never a throw. */
export function runAssistantTool(name: string, input: unknown, context: ToolContext): { content: string; isError: boolean } {
  const definition = tools.find((t) => t.name === name);
  if (!definition) return { content: `Unknown tool: ${name}`, isError: true };
  const parsed = definition.input.safeParse(input);
  if (!parsed.success) return { content: `Invalid input: ${parsed.error.message}`, isError: true };
  try {
    // Each tool's run matches its own schema; the union type loses that pairing.
    const result = (definition.run as (input: unknown, context: ToolContext) => unknown)(parsed.data, context);
    return { content: JSON.stringify(result), isError: false };
  } catch (error) {
    return { content: error instanceof Error ? error.message : "Calculation failed", isError: true };
  }
}
