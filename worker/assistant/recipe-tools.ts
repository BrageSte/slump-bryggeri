import { z } from "zod";
import { buildBrewPlan } from "../../src/domain/brew-day/brew-plan.ts";
import {
  applyWaterPlan,
  calculateRecipeMetrics,
  designRecipe,
  diffRecipes,
  type RecipeDesignSpec,
  type RecipeMetrics,
} from "../../src/domain/brewing-calculations/index.ts";
import { round } from "../../src/domain/format.ts";
import { profileValue } from "../../src/domain/model/equipment-profile.ts";
import {
  cultureForms,
  fermentableTypes,
  hopForms,
  hopUses,
  miscUses,
  recipeDocumentSchema,
  type RecipeDocument,
} from "../../src/domain/model/recipe.ts";
import { ionKeys, partialIonConcentrationsSchema, waterValueBasisLabels, type IonConcentrations } from "../../src/domain/model/water.ts";
import { isTotalBrewingWaterAssumed, totalBrewingWaterL } from "../../src/domain/water/batch-water.ts";
import type { AssistantRecipeDraft } from "../../src/domain/model/api.ts";
import { breweryTool, type BreweryScopeContext } from "./tool-kit.ts";

/**
 * The brewery-level tools. The model reads recipes and proposes the *structure* of a new one (`design_recipe`);
 * the app computes every amount through `designRecipe`, and the draft that reaches the brewer is that computed
 * recipe, never text the model wrote. Nothing here writes to the database.
 */

const MAX_RECIPES_LISTED = 60;
const MAX_DRAFTS_PER_REPLY = 3;

const text = (max: number) => z.string().trim().min(1).max(max);

/** Metrics as the app shows them: estimates from the ingredients, rounded for reading. */
function metricsView(metrics: RecipeMetrics) {
  return {
    basis: "calculated estimate",
    og: metrics.og === null ? null : round(metrics.og, 4),
    fg: metrics.fg === null ? null : round(metrics.fg, 4),
    abvPct: metrics.abvPct === null ? null : round(metrics.abvPct, 1),
    ibu: metrics.ibu === null ? null : round(metrics.ibu, 1),
    colorEbc: metrics.colorEbc === null ? null : round(metrics.colorEbc, 1),
    totalFermentablesKg: round(metrics.totalFermentablesKg, 2),
    totalHopsG: round(metrics.totalHopsG, 1),
    grainBillPct: metrics.grainBillPct.map((pct) => round(pct, 1)),
    hopsMissingAlpha: metrics.hopsMissingAlpha,
  };
}

/** The parts of a recipe the model needs, without ids and without empty fields. */
function recipeView(recipe: RecipeDocument) {
  return {
    name: recipe.name,
    style: recipe.style,
    description: recipe.description,
    batchSizeL: recipe.batchSizeL,
    boilTimeMin: recipe.boilTimeMin,
    efficiencyPct: recipe.efficiencyPct,
    carbonationVols: recipe.carbonationVols,
    fermentables: recipe.fermentables.map(({ name, type, amountKg, colorEbc, yieldPct }) => ({ name, type, amountKg, colorEbc, yieldPct })),
    hops: recipe.hops.map(({ name, use, amountG, alphaPct, timeMin, temperatureC, dayOfFermentation }) => ({ name, use, amountG, alphaPct, timeMin, temperatureC, dayOfFermentation })),
    cultures: recipe.cultures.map(({ name, producer, form, amount, unit, attenuationPct }) => ({ name, producer, form, amount, unit, attenuationPct })),
    miscs: recipe.miscs.map(({ name, amount, unit, use, timeMin, waterAgent }) => ({ name, amount, unit, use, timeMin, waterAgent })),
    mashSteps: recipe.mashSteps.map(({ name, temperatureC, durationMin }) => ({ name, temperatureC, durationMin })),
    fermentationSteps: recipe.fermentationSteps.map(({ name, temperatureC, temperatureMaxC, durationDays }) => ({ name, temperatureC, temperatureMaxC, durationDays })),
    water: recipe.water,
    targets: recipe.targets,
    notes: recipe.notes,
  };
}

/**
 * An earlier draft as the model sees it in the conversation history: the same view `design_recipe` returned, so a follow-up
 * such as "a bit more bitter" can be answered by calling `design_recipe` again from the structure, with `basedOnRecipeId`.
 */
export function draftForModel(draft: AssistantRecipeDraft) {
  return roundedJson({ basedOnRecipeId: draft.baseRecipeId, recipe: recipeView(draft.recipe), calculated: metricsView(calculateRecipeMetrics(draft.recipe)) });
}

const roundedJson = <T>(value: T): T => JSON.parse(JSON.stringify(value, (_key, v: unknown) => (typeof v === "number" ? round(v, 4) : v))) as T;
const ionsRounded = (ions: IonConcentrations) => Object.fromEntries(ionKeys.map((ion) => [ion, round(ions[ion], 1)]));

const fermentableInput = z.object({
  name: text(120),
  type: z.enum(fermentableTypes),
  sharePct: z.number().positive().max(100).describe("Share of the total fermentable mass, %. All fermentable shares add up to 100. The app scales the amounts to the target OG."),
  colorEbc: z.number().min(0).max(4000).optional().describe("Typical colour of this malt, EBC."),
  yieldPct: z.number().min(0).max(100).optional().describe("Extract potential as % of sucrose (typical pale malt about 80). Leave out to use the app's default."),
  producer: z.string().trim().max(120).optional(),
}).strict();

const hopInput = z.object({
  name: text(120),
  use: z.enum(hopUses),
  alphaPct: z.number().min(0).max(30).optional().describe("Alpha acid %. Required for boil, first_wort and whirlpool. Use a typical value for the variety unless the brewer gave the lot, and say that it is typical."),
  timeMin: z.number().min(0).max(600).optional().describe("Boil: minutes before the end of the boil. Whirlpool: steep minutes. Required for boil, first_wort and whirlpool."),
  temperatureC: z.number().min(0).max(110).optional().describe("Whirlpool temperature, °C."),
  dayOfFermentation: z.number().min(0).max(365).optional().describe("Dry hop: day of fermentation."),
  form: z.enum(hopForms).optional(),
  ibuSharePct: z.number().positive().max(100).optional().describe("boil, first_wort and whirlpool only: this addition's share of the target IBU, %. The shares add up to 100. The app computes the grams."),
  gramsPerL: z.number().positive().max(30).optional().describe("mash and dry_hop only: grams per litre of batch. The app computes the grams."),
}).strict();

const cultureInput = z.object({
  name: text(120),
  producer: z.string().trim().max(120).optional(),
  form: z.enum(cultureForms),
  amount: z.number().positive().max(1000).describe("Follow the producer's dose for the batch size. The app has no pitch-rate calculation: say that this is the producer's general dosing."),
  unit: z.enum(["pkg", "g", "ml", "l"]),
  attenuationPct: z.number().min(0).max(100).optional().describe("Apparent attenuation the producer states, %. Used for FG and ABV."),
}).strict();

const miscInput = z.object({
  name: text(120),
  amount: z.number().positive().max(10_000),
  unit: text(20),
  use: z.enum(miscUses),
  timeMin: z.number().min(0).max(600).optional(),
}).strict().describe("Fining and other additions, such as Whirlfloc or yeast nutrient. Brewing-water salts are not listed here: give water.target instead.");

const designInput = z.object({
  name: text(120).describe("Recipe name."),
  style: z.string().trim().max(120).optional(),
  description: z.string().trim().max(600).optional().describe("One to three sentences in Norwegian about the beer."),
  notes: z.string().trim().max(1500).optional().describe("Short brewer's notes in Norwegian, for example what to watch on brew day."),
  basedOnRecipeId: z.string().min(1).max(64).optional().describe("Id from list_recipes when this is a new version of an existing recipe. Batch size, efficiency and boil time then default to that recipe's, and the result lists what changed."),
  batchSizeL: z.number().positive().max(1000).optional().describe("Litres into the fermenter. Defaults to the base recipe's, else the equipment profile's batch volume; ask the brewer if neither is known."),
  efficiencyPct: z.number().min(30).max(95).optional().describe("Brewhouse efficiency, %. Defaults to the base recipe's, else the equipment profile's."),
  boilTimeMin: z.number().min(0).max(240).optional().describe("Defaults to the base recipe's, else 60."),
  carbonationVols: z.number().min(0).max(5).optional(),
  targets: z.object({
    og: z.number().min(1.02).max(1.15).describe("Target original gravity. The app scales the grain bill to hit it."),
    ibu: z.number().min(0).max(150).optional().describe("Target bitterness (Tinseth). The app splits it over the boil, first wort and whirlpool additions by ibuSharePct. Required when there are such additions."),
    fg: z.number().min(0.98).max(1.1).optional().describe("Compared with the result, not fitted: the yeast's attenuation decides."),
    abvPct: z.number().min(0).max(20).optional().describe("Compared with the result, not fitted."),
    colorEbc: z.number().min(0).max(200).optional().describe("Compared with the result, not fitted: choose the malts to match it."),
    mashPhMin: z.number().min(4.5).max(6.5).optional(),
    mashPhMax: z.number().min(4.5).max(6.5).optional(),
  }).strict(),
  fermentables: z.array(fermentableInput).min(1).max(12),
  hops: z.array(hopInput).max(12),
  cultures: z.array(cultureInput).max(3).optional(),
  miscs: z.array(miscInput).max(8).optional(),
  mashSteps: z.array(z.object({ name: text(120), temperatureC: z.number().min(0).max(100), durationMin: z.number().min(0).max(600) }).strict()).min(1).max(6),
  fermentationSteps: z.array(z.object({
    name: text(120),
    temperatureC: z.number().min(-5).max(40).optional(),
    temperatureMaxC: z.number().min(-5).max(40).optional().describe("Upper bound when the plan is a range."),
    durationDays: z.number().min(0).max(365).optional(),
  }).strict()).min(1).max(6),
  water: z.object({
    profileName: z.string().trim().max(120).optional().describe("Short name of the intent, for example «Kloridfremhevet»."),
    target: partialIonConcentrationsSchema.describe("Wanted mg/L in the total brewing water (ca, mg, na, cl, so4, hco3). The app computes the salts from the brewery's base water."),
  }).strict().optional(),
}).strict();

export const breweryTools = [
  breweryTool({
    name: "list_recipes",
    description:
      "The brewery's own recipes: id, name, style, version, batch size and the app's estimated OG, FG, ABV, IBU and colour. Use it to find a recipe to base a new version on, to see what the brewery already brews, or before suggesting something similar.",
    input: z.object({}).strict(),
    run: async (_input, { brewery }) => {
      const recipes = await brewery.listRecipes();
      return {
        total: recipes.length,
        truncated: recipes.length > MAX_RECIPES_LISTED,
        recipes: recipes.slice(0, MAX_RECIPES_LISTED).map(({ id, name, style, version, document }) => {
          const metrics = metricsView(calculateRecipeMetrics(document));
          return { id, name, style, version, batchSizeL: document.batchSizeL, og: metrics.og, fg: metrics.fg, abvPct: metrics.abvPct, ibu: metrics.ibu, colorEbc: metrics.colorEbc };
        }),
      };
    },
  }),
  breweryTool({
    name: "get_recipe",
    description: "One recipe of this brewery, current version: ingredients with amounts, mash and fermentation steps, water plan, the recipe's own targets, and the app's calculated metrics for its ingredients.",
    input: z.object({ recipeId: z.string().min(1).max(64) }).strict(),
    run: async ({ recipeId }, { brewery }) => {
      const recipe = await brewery.getRecipe(recipeId);
      if (!recipe) return { error: "No recipe with that id in this brewery. Use list_recipes for valid ids." };
      return { id: recipe.id, version: recipe.version, recipe: recipeView(recipe.document), calculated: metricsView(calculateRecipeMetrics(recipe.document)) };
    },
  }),
  breweryTool({
    name: "design_recipe",
    description:
      "Design a recipe draft for the brewer. You give the structure: which malts in what share, which hops with use, time and IBU share (or grams per litre for dry hops), yeast, mash and fermentation steps, targets, and optionally wanted brewing-water ions. The app computes every amount: kg of malt for the target OG, grams of hops for the target IBU, grams of salts for the water. It returns the finished recipe, its calculated OG, FG, ABV, IBU and colour next to the targets, and what changed if basedOnRecipeId is given. The draft is shown to the brewer, who opens it in the recipe editor and saves it; nothing is saved here. Never state amounts or numbers that this tool did not return.",
    input: designInput,
    run: async (input, context: BreweryScopeContext) => {
      const { brewery } = context;
      const drafts = (context.proposedActions ?? []).filter((action) => action.kind === "recipe_draft");
      if (drafts.length >= MAX_DRAFTS_PER_REPLY) throw new Error(`At most ${MAX_DRAFTS_PER_REPLY} recipe drafts per reply. Offer to make more once the brewer has looked at these.`);

      const base = input.basedOnRecipeId ? await brewery.getRecipe(input.basedOnRecipeId) : null;
      if (input.basedOnRecipeId && !base) throw new Error("basedOnRecipeId does not match a recipe in this brewery. Use list_recipes for valid ids.");

      const batchSizeL = input.batchSizeL ?? base?.document.batchSizeL ?? profileValue(brewery.equipmentValues, "batch_volume_l");
      if (batchSizeL === undefined) throw new Error("Batch size unknown: the equipment profile has no batch volume. Ask the brewer, then pass batchSizeL.");
      const efficiencyPct = input.efficiencyPct ?? base?.document.efficiencyPct ?? profileValue(brewery.equipmentValues, "brewhouse_efficiency_pct");
      if (efficiencyPct === undefined) throw new Error("Efficiency unknown. Ask the brewer, then pass efficiencyPct.");
      const boilTimeMin = input.boilTimeMin ?? base?.document.boilTimeMin ?? 60;
      const profileEfficiency = brewery.equipmentSources.brewhouse_efficiency_pct ?? "default";
      const efficiencyFrom =
        input.efficiencyPct !== undefined ? "given" : base ? "the base recipe" : profileEfficiency === "default" ? "the equipment profile's standard assumption (not calibrated)" : "the equipment profile";

      const { basedOnRecipeId: _base, water: waterInput, ...rest } = input;
      const spec: RecipeDesignSpec = {
        ...rest,
        batchSizeL,
        efficiencyPct,
        boilTimeMin,
        ...(waterInput && Object.keys(waterInput.target).length > 0 && { water: waterInput }),
      };
      // RangeError messages from the design (shares that do not add up, a target that cannot be reached) go back to the model.
      const design = designRecipe(spec);
      let recipe = design.recipe;
      const notes = [...design.notes];

      let water: unknown;
      if (spec.water) {
        const plan = buildBrewPlan({ recipe, equipment: brewery.equipmentValues, equipmentSources: brewery.equipmentSources });
        const totalWaterL = totalBrewingWaterL(plan.summary);
        if (totalWaterL === null) {
          water = { salts: "not calculated", reason: "The mash and sparge water cannot be worked out from the equipment profile, so no salts were calculated. The water target is kept in the draft." };
        } else {
          const applied = applyWaterPlan(recipe, { source: brewery.sourceWater.ions, totalWaterL });
          recipe = applied.recipe;
          water = {
            basis: waterValueBasisLabels.calculated,
            sourceWater: brewery.sourceWater.name,
            totalWaterL: round(totalWaterL, 1),
            totalWaterAssumed: isTotalBrewingWaterAssumed(plan.summary),
            saltsGrams: applied.salts.map(({ name, grams }) => ({ name, grams })),
            targetIonsMgL: spec.water.target,
            resultingIonsMgL: ionsRounded(applied.solution.result),
            deviationFromTargetMgL: Object.fromEntries(Object.entries(applied.solution.deviation).map(([ion, value]) => [ion, round(value, 1)])),
            note: "Salts only add ions, so a target below the source water cannot be reached. All salts are counted as dissolved in the whole mash and sparge volume. Acid is not dosed and mash pH is not predicted.",
          };
        }
      }

      const parsed = recipeDocumentSchema.safeParse(recipe);
      if (!parsed.success) throw new Error(`The recipe is not valid: ${parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`);
      const finished = parsed.data;
      // Other design calls in the same parallel tool turn may have completed while this one loaded its base.
      if ((context.proposedActions ?? []).filter((action) => action.kind === "recipe_draft").length >= MAX_DRAFTS_PER_REPLY) {
        throw new Error(`At most ${MAX_DRAFTS_PER_REPLY} recipe drafts per reply.`);
      }
      context.proposedActions?.push({ kind: "recipe_draft", recipe: finished, baseRecipeId: base?.id ?? null, baseVersionId: base?.versionId ?? null });

      return roundedJson({
        draftShownToBrewer: true,
        inputsUsed: {
          batchSizeL,
          efficiencyPct,
          boilTimeMin,
          efficiencyFrom: efficiencyFrom,
        },
        recipe: recipeView(finished),
        calculated: metricsView(design.metrics),
        targetComparison: design.comparison,
        water,
        changesFromBase: base ? diffRecipes(base.document, finished) : undefined,
        notes,
      });
    },
  }),
];
