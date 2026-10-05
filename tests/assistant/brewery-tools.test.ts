import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { calculateRecipeMetrics } from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { AssistantRecipeDraft, AssistantReplyAction } from "../../src/domain/model/api.ts";
import { recipeDocumentSchema } from "../../src/domain/model/recipe.ts";
import { holsfjordenWater20261001 } from "../../src/domain/water/slump-water.ts";
import { ASSISTANT_SYSTEM_PROMPT, BREWERY_ASSISTANT_SYSTEM_PROMPT, runAssistant, type MessagesClient } from "../../worker/assistant/run.ts";
import { assistantToolDefinitions, breweryToolDefinitions, runAssistantTool } from "../../worker/assistant/tools.ts";
import type { BreweryToolContext, RecipeListing } from "../../worker/assistant/tool-kit.ts";
import { makeBatch } from "../helpers/batch.ts";

const recipes: RecipeListing[] = [
  { id: "r-sunset", name: sunsetIpaRecipe.name, style: sunsetIpaRecipe.style ?? null, version: 2, versionId: "v-sunset-2", updatedAt: 2, document: sunsetIpaRecipe },
  { id: "r-pale", name: "Enkel pale ale", style: "Pale Ale", version: 1, versionId: "v-pale-1", updatedAt: 1, document: { ...sunsetIpaRecipe, name: "Enkel pale ale", batchSizeL: 20, targets: {} } },
];

function breweryContext(overrides: Partial<BreweryToolContext> = {}): BreweryToolContext {
  return {
    equipmentValues: { batch_volume_l: 60, brewhouse_efficiency_pct: 72 },
    equipmentSources: { brewhouse_efficiency_pct: "default" },
    sourceWater: holsfjordenWater20261001,
    listRecipes: async () => recipes,
    getRecipe: async (id) => recipes.find((recipe) => recipe.id === id) ?? null,
    ...overrides,
  };
}

/** A complete design_recipe call as the model would send it: structure and targets, no amounts. */
function ipaInput(extra: Record<string, unknown> = {}) {
  return {
    name: "Hazy IPA",
    style: "NEIPA",
    targets: { og: 1.064, ibu: 40 },
    fermentables: [
      { name: "Pilsnermalt", type: "grain", sharePct: 80, colorEbc: 3.5, yieldPct: 81 },
      { name: "Havre", type: "adjunct", sharePct: 15, colorEbc: 2, yieldPct: 70 },
      { name: "Hvetemalt", type: "grain", sharePct: 5, colorEbc: 4, yieldPct: 82 },
    ],
    hops: [
      { name: "Magnum", use: "boil", alphaPct: 12, timeMin: 60, ibuSharePct: 50 },
      { name: "Citra", use: "whirlpool", alphaPct: 13, timeMin: 20, temperatureC: 80, ibuSharePct: 50 },
      { name: "Citra", use: "dry_hop", dayOfFermentation: 3, gramsPerL: 6 },
    ],
    cultures: [{ name: "London Ale III", form: "liquid", amount: 1, unit: "pkg", attenuationPct: 73 }],
    mashSteps: [{ name: "Hovedmesk", temperatureC: 67, durationMin: 60 }],
    fermentationSteps: [{ name: "Primær", temperatureC: 20, durationDays: 10 }],
    ...extra,
  };
}

const call = async (name: string, input: unknown, brewery = breweryContext(), proposedActions: AssistantReplyAction[] = []) => {
  const result = await runAssistantTool(name, input, { brewery, proposedActions });
  return { ...result, json: result.isError ? null : (JSON.parse(result.content) as Record<string, any>), proposedActions };
};

describe("brewery tools: scope", () => {
  it("offers the brewery thread recipe tools and the shared ones, and no batch tools", () => {
    expect(breweryToolDefinitions.map((t) => t.name)).toEqual(["abv_and_attenuation", "convert_units", "brewery_history", "list_recipes", "get_recipe", "design_recipe"]);
    for (const definition of breweryToolDefinitions) {
      expect(definition.input_schema.type).toBe("object");
      expect(definition.input_schema).not.toHaveProperty("$schema");
    }
  });

  it("keeps the recipe tools out of the batch thread", () => {
    const names = assistantToolDefinitions.map((t) => t.name);
    expect(names).not.toContain("design_recipe");
    expect(names).not.toContain("list_recipes");
    expect(names).not.toContain("get_recipe");
  });

  it("refuses a tool outside the thread's scope instead of running it", async () => {
    expect((await call("strike_temperature", { targetMashTempC: 66 })).content).toBe("Unknown tool: strike_temperature");
    expect((await call("propose_actions", { actions: [] })).isError).toBe(true);
    const batchContext = { batch: makeBatch(), proposedActions: [] as AssistantReplyAction[] };
    expect((await runAssistantTool("design_recipe", ipaInput(), batchContext)).content).toBe("Unknown tool: design_recipe");
    expect((await runAssistantTool("list_recipes", {}, batchContext)).isError).toBe(true);
  });

  it("runs the shared tools in both threads", async () => {
    const converted = await call("convert_units", { value: 5, fromUnit: "US gal", toUnit: "L" });
    expect(converted.json).toMatchObject({ unit: "L" });
    expect(converted.json!.value).toBeCloseTo(18.9271, 3);
    expect((await call("abv_and_attenuation", { og: 1.06, fg: 1.012 })).json).toMatchObject({ abvPct: expect.any(Number) });
    const history = await call("brewery_history", {}, breweryContext());
    expect(history.json).toEqual({ error: "not available" });
  });
});

describe("list_recipes and get_recipe", () => {
  it("lists the brewery's recipes with the app's estimated metrics", async () => {
    const { json } = await call("list_recipes", {});
    expect(json!.total).toBe(2);
    const sunset = json!.recipes.find((r: { id: string }) => r.id === "r-sunset");
    const metrics = calculateRecipeMetrics(sunsetIpaRecipe);
    expect(sunset).toMatchObject({ name: sunsetIpaRecipe.name, version: 2, batchSizeL: 60 });
    expect(sunset.og).toBeCloseTo(metrics.og as number, 4);
    expect(sunset.ibu).toBeCloseTo(metrics.ibu as number, 1);
  });

  it("returns one recipe with its calculated metrics and no internal ids", async () => {
    const { json } = await call("get_recipe", { recipeId: "r-sunset" });
    expect(json!.recipe.fermentables[0]).toEqual({ name: "BEST Pale Ale", type: "grain", amountKg: 14.8, colorEbc: 6.5, yieldPct: 80 });
    expect(json!.calculated.basis).toBe("calculated estimate");
    expect(JSON.stringify(json)).not.toContain("f-pale");
  });

  it("says plainly when the id is not one of the brewery's recipes", async () => {
    expect((await call("get_recipe", { recipeId: "someone-elses" })).json).toEqual({ error: "No recipe with that id in this brewery. Use list_recipes for valid ids." });
  });
});

describe("design_recipe", () => {
  it("returns the app's recipe, hits the targets, and records the draft for the brewer", async () => {
    const proposedActions: AssistantReplyAction[] = [];
    const { json } = await call("design_recipe", ipaInput(), breweryContext(), proposedActions);

    expect(json!.draftShownToBrewer).toBe(true);
    expect(json!.inputsUsed).toMatchObject({ batchSizeL: 60, efficiencyPct: 72, boilTimeMin: 60, efficiencyFrom: "the equipment profile's standard assumption (not calibrated)" });
    expect(json!.calculated.og).toBeCloseTo(1.064, 3);
    expect(json!.calculated.ibu).toBeCloseTo(40, 0);
    expect(json!.targetComparison.map((row: { metric: string; withinTolerance: boolean }) => [row.metric, row.withinTolerance])).toEqual([["og", true], ["ibu", true]]);
    // 60 L batch at 6 g/L dry hop = 360 g, worked out by the app.
    expect(json!.recipe.hops.find((h: { use: string }) => h.use === "dry_hop").amountG).toBe(360);

    expect(proposedActions).toHaveLength(1);
    const draft = proposedActions[0] as AssistantRecipeDraft;
    expect(draft).toMatchObject({ kind: "recipe_draft", baseRecipeId: null });
    expect(recipeDocumentSchema.safeParse(draft.recipe).success).toBe(true);
    expect(draft.recipe.name).toBe("Hazy IPA");
    expect(draft.recipe.fermentables.map((f) => f.amountKg)).toEqual(json!.recipe.fermentables.map((f: { amountKg: number }) => f.amountKg));
    expect(calculateRecipeMetrics(draft.recipe).og).toBeCloseTo(1.064, 3);
  });

  it("defaults to the base recipe's size and efficiency and lists what changed", async () => {
    const proposedActions: AssistantReplyAction[] = [];
    const { json } = await call("design_recipe", ipaInput({ basedOnRecipeId: "r-sunset" }), breweryContext(), proposedActions);

    expect(json!.inputsUsed).toMatchObject({ batchSizeL: 60, efficiencyPct: 60, efficiencyFrom: "the base recipe" });
    expect(json!.changesFromBase.isEmpty).toBe(false);
    expect(json!.changesFromBase.fermentables.map((c: { kind: string }) => c.kind)).toContain("removed");
    expect(proposedActions[0]).toMatchObject({ baseRecipeId: "r-sunset", baseVersionId: "v-sunset-2" });
  });

  it("takes batch size and efficiency from the brewer when given", async () => {
    const { json } = await call("design_recipe", ipaInput({ batchSizeL: 20, efficiencyPct: 80 }));
    expect(json!.inputsUsed).toMatchObject({ batchSizeL: 20, efficiencyPct: 80, efficiencyFrom: "given" });
    expect(json!.recipe.hops.find((h: { use: string }) => h.use === "dry_hop").amountG).toBe(120);
  });

  it("computes the salts for a water target from the brewery's base water", async () => {
    const proposedActions: AssistantReplyAction[] = [];
    const { json } = await call(
      "design_recipe",
      ipaInput({ water: { profileName: "Kloridfremhevet", target: { ca: 100, cl: 150, so4: 60 } } }),
      breweryContext(),
      proposedActions,
    );

    expect(json!.water).toMatchObject({ basis: "Beregnet", sourceWater: holsfjordenWater20261001.name, totalWaterAssumed: true });
    expect(json!.water.saltsGrams.length).toBeGreaterThan(0);
    expect(json!.water.targetIonsMgL).toEqual({ ca: 100, cl: 150, so4: 60 });
    expect(Object.keys(json!.water.deviationFromTargetMgL).sort()).toEqual(["ca", "cl", "so4"]);
    const draft = (proposedActions[0] as AssistantRecipeDraft).recipe;
    expect(draft.water).toEqual({ profileName: "Kloridfremhevet", target: { ca: 100, cl: 150, so4: 60 } });
    const salts = draft.miscs.filter((m) => m.waterAgent);
    expect(salts.length).toBe(json!.water.saltsGrams.length);
    expect(salts.every((m) => m.unit === "g" && m.amount > 0 && m.use === "mash")).toBe(true);
  });

  it("keeps the water target but adds no salts when the water volume cannot be worked out", async () => {
    const proposedActions: AssistantReplyAction[] = [];
    // Nothing is mashed in a sugar-only wort, so there is no mash and sparge water to dissolve salts in.
    const sugarOnly = ipaInput({
      targets: { og: 1.04 },
      fermentables: [{ name: "Sukker", type: "sugar", sharePct: 100, yieldPct: 100 }],
      hops: [],
      water: { target: { ca: 100, cl: 100 } },
    });
    const { json } = await call("design_recipe", sugarOnly, breweryContext(), proposedActions);
    expect(json!.draftShownToBrewer).toBe(true);
    expect(json!.water.salts).toBe("not calculated");
    const draft = (proposedActions[0] as AssistantRecipeDraft).recipe;
    expect(draft.water?.target).toEqual({ ca: 100, cl: 100 });
    expect(draft.miscs.filter((m) => m.waterAgent)).toEqual([]);
  });

  it("rejects what the model must not decide, with a message it can act on", async () => {
    const noProfile = breweryContext({ equipmentValues: {} });
    expect((await call("design_recipe", ipaInput(), noProfile)).content).toMatch(/Batch size unknown.*Ask the brewer/);

    const badShares = ipaInput();
    badShares.fermentables[0]!.sharePct = 50;
    expect((await call("design_recipe", badShares)).content).toMatch(/fermentable shares must add up to 100 %/);

    expect((await call("design_recipe", ipaInput({ basedOnRecipeId: "other-brewery" }))).content).toMatch(/does not match a recipe in this brewery/);

    // The model gives no amounts: a field the schema does not know is refused, not ignored.
    const withAmounts = ipaInput();
    (withAmounts.fermentables[0] as Record<string, unknown>).amountKg = 5;
    const refused = await call("design_recipe", withAmounts);
    expect(refused.isError).toBe(true);
    expect(refused.content).toMatch(/^Invalid input/);
  });

  it("changes nothing when it fails", async () => {
    const proposedActions: AssistantReplyAction[] = [];
    const badShares = ipaInput();
    badShares.hops[0]!.ibuSharePct = 10;
    expect((await call("design_recipe", badShares, breweryContext(), proposedActions)).isError).toBe(true);
    expect(proposedActions).toEqual([]);
  });

  it("allows a few alternatives in one reply, then asks the model to wait", async () => {
    const proposedActions: AssistantReplyAction[] = [];
    for (let i = 0; i < 3; i++) expect((await call("design_recipe", ipaInput({ name: `Alt ${i}` }), breweryContext(), proposedActions)).isError).toBe(false);
    const fourth = await call("design_recipe", ipaInput({ name: "Alt 4" }), breweryContext(), proposedActions);
    expect(fourth.isError).toBe(true);
    expect(fourth.content).toMatch(/At most 3 recipe drafts/);
    expect(proposedActions).toHaveLength(3);
  });

  it("keeps the draft limit when the model designs alternatives in parallel", async () => {
    const proposedActions: AssistantReplyAction[] = [];
    const results = await Promise.all(Array.from({ length: 4 }, (_, i) => call("design_recipe", ipaInput({ name: `Parallel ${i}`, basedOnRecipeId: "r-sunset" }), breweryContext(), proposedActions)));
    expect(proposedActions).toHaveLength(3);
    expect(results.filter((result) => result.isError)).toHaveLength(1);
  });
});

describe("the brewery thread's model loop", () => {
  const usage = { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 } };
  const message = (content: unknown[], stop_reason: string) => ({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", content, stop_reason, usage }) as unknown as Anthropic.Message;
  function fakeClient(responses: Anthropic.Message[]) {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const next = responses.shift();
          if (!next) throw new Error("no more scripted responses");
          return next;
        },
      },
    };
    return { client, requests };
  }
  const base = { model: "claude-sonnet-5", brief: "# Bryggeriet: Test", history: [{ role: "user" as const, content: "Lag en hazy IPA" }], onUsage: () => {} };

  it("uses the brewery prompt and tools, runs design_recipe and returns the draft", async () => {
    const { client, requests } = fakeClient([
      message([{ type: "tool_use", id: "t1", name: "design_recipe", input: ipaInput() }], "tool_use"),
      message([{ type: "text", text: "Her er et utkast: OG 1,064, 40 IBU." }], "end_turn"),
    ]);
    const result = await runAssistant({ ...base, client, brewery: breweryContext() });

    expect(requests[0]!.system).toMatchObject([{ text: BREWERY_ASSISTANT_SYSTEM_PROMPT }, { text: "# Bryggeriet: Test" }]);
    const offered = requests[0]!.tools!.flatMap((tool) => ("name" in tool ? [tool.name] : []));
    expect(offered).toContain("design_recipe");
    expect(offered).not.toContain("propose_actions");
    expect(offered).not.toContain("get_batch_section");
    expect(result.toolCalls).toEqual(["design_recipe"]);
    expect(result.actions).toEqual([expect.objectContaining({ kind: "recipe_draft", baseRecipeId: null })]);
    expect(result.text).toContain("OG 1,064");
    // The tool result went back to the model with the app's numbers.
    const toolResult = requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(toolResult[0]!.is_error).toBe(false);
    expect(JSON.parse(toolResult[0]!.content as string).calculated.og).toBeCloseTo(1.064, 3);
  });

  it("hands a failed design back as a tool error so the model can correct it", async () => {
    const bad = ipaInput();
    bad.fermentables[0]!.sharePct = 50;
    const { client, requests } = fakeClient([
      message([{ type: "tool_use", id: "t1", name: "design_recipe", input: bad }], "tool_use"),
      message([{ type: "tool_use", id: "t2", name: "design_recipe", input: ipaInput() }], "tool_use"),
      message([{ type: "text", text: "Rettet." }], "end_turn"),
    ]);
    const result = await runAssistant({ ...base, client, brewery: breweryContext() });
    const firstResult = requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(firstResult[0]!.is_error).toBe(true);
    expect(result.actions).toHaveLength(1);
    expect(result.text).toBe("Rettet.");
  });

  it("allows eight tool rounds in the brewery thread, then asks for an answer", async () => {
    const toolTurn = () => message([{ type: "tool_use", id: "t", name: "list_recipes", input: {} }], "tool_use");
    const { client, requests } = fakeClient([...Array.from({ length: 8 }, toolTurn), message([{ type: "text", text: "Svar." }], "end_turn")]);
    const result = await runAssistant({ ...base, client, brewery: breweryContext() });
    expect(result.text).toBe("Svar.");
    expect(requests).toHaveLength(9);
    expect(requests[8]!.tool_choice).toEqual({ type: "none" });
    expect(requests[7]!.tool_choice).toBeUndefined();
  });

  it("needs exactly one of a batch and a brewery", async () => {
    const { client } = fakeClient([]);
    await expect(runAssistant({ ...base, client })).rejects.toThrow(/either a batch or a brewery/);
    await expect(runAssistant({ ...base, client, brewery: breweryContext(), batch: makeBatch() })).rejects.toThrow(/either a batch or a brewery/);
  });

  it("leaves the batch thread exactly as it was", async () => {
    const { client, requests } = fakeClient([message([{ type: "text", text: "Svar." }], "end_turn")]);
    await runAssistant({ ...base, client, batch: makeBatch(), brewDocumentSections: { header: "", plan: "", water: "", equipment: "", status: "", results: "", calibration: "", log: "" } });
    expect(requests[0]!.system).toMatchObject([{ text: ASSISTANT_SYSTEM_PROMPT }, expect.anything()]);
    expect(requests[0]!.tools!.flatMap((tool) => ("name" in tool ? [tool.name] : []))).not.toContain("design_recipe");
  });
});

describe("the brewery prompt", () => {
  it("makes the app, not the model, the source of every amount", () => {
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("The app computes every amount");
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("Never state, adjust or round an amount yourself");
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("Never say a recipe is saved");
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("Never do arithmetic yourself");
  });

  it("carries the B18 principles", () => {
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("Short first");
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("There is no inventory");
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("does not need an analysis");
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("Measuring mash pH is optional");
    expect(BREWERY_ASSISTANT_SYSTEM_PROMPT).toContain("no mash pH prediction and no acid dosing");
  });
});
