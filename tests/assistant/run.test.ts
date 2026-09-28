import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { assistantToolDefinitions, runAssistantTool } from "../../worker/assistant/tools.ts";
import { runAssistant, type MessagesClient } from "../../worker/assistant/run.ts";
import { estimateCostUsd } from "../../worker/assistant/pricing.ts";
import { calculateStrikeTemperature } from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BatchDetail } from "../../src/domain/model/api.ts";

const batch: BatchDetail = {
  id: "b1",
  number: 1,
  name: "Sunset IPA",
  status: "brewing",
  currentStage: "mash",
  stageStartedAt: 0,
  brewDate: null,
  recipe: { id: "r1", name: sunsetIpaRecipe.name },
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  recipeVersion: { id: "v1", version: 1 },
  recipeSnapshot: sunsetIpaRecipe,
  equipmentSnapshot: { profileId: "p", profileVersion: 2, values: { grain_temperature_c: 16, mash_thickness_l_per_kg: 2.6, strike_temp_offset_c: 1.5 } },
  splits: [],
};

const usage = (input: number, output: number): Anthropic.Usage =>
  ({ input_tokens: input, output_tokens: output, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 }) as Anthropic.Usage;

function message(content: unknown[], stop_reason: Anthropic.Message["stop_reason"]): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", content, stop_reason, usage: usage(1000, 50) } as unknown as Anthropic.Message;
}

/** Fake Messages API: plays back scripted responses and records every request. */
function fakeClient(responses: Anthropic.Message[]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: MessagesClient = {
    messages: {
      create: async (params) => {
        // Snapshot the params: the loop keeps appending to the same messages array.
        requests.push(structuredClone(params));
        const next = responses.shift();
        if (!next) throw new Error("no more scripted responses");
        return next;
      },
    },
  };
  return { client, requests };
}

describe("assistant tools", () => {
  it("exposes JSON schemas the Messages API accepts", () => {
    expect(assistantToolDefinitions.map((t) => t.name)).toEqual([
      "strike_temperature",
      "water_volumes",
      "mash_temperature_adjustment",
      "gravity_from_brix",
      "abv_and_attenuation",
      "brewhouse_efficiency",
      "observed_boil_off",
      "convert_units",
    ]);
    for (const definition of assistantToolDefinitions) {
      expect(definition.input_schema.type).toBe("object");
      expect(definition.input_schema).not.toHaveProperty("$schema");
    }
  });

  it("computes with the app's own functions and the batch snapshot's defaults", () => {
    const result = runAssistantTool("strike_temperature", { targetMashTempC: 66.5 }, { batch });
    const expected = calculateStrikeTemperature({ targetMashTempC: 66.5, grainTempC: 16, mashThicknessLPerKg: 2.6, systemOffsetC: 1.5 });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content).strikeTempC).toBeCloseTo(expected.strikeTempC, 1);
  });

  it("reports missing boil-off and invalid input as tool errors instead of guessing", () => {
    expect(JSON.parse(runAssistantTool("water_volumes", {}, { batch }).content)).toHaveProperty("error");
    expect(runAssistantTool("strike_temperature", { targetMashTempC: "varm" }, { batch }).isError).toBe(true);
    expect(runAssistantTool("does_not_exist", {}, { batch }).isError).toBe(true);
  });
});

describe("assistant loop", () => {
  it("runs a tool, returns its result to the model and answers", async () => {
    const thinking = { type: "thinking", thinking: "", signature: "sig" };
    const { client, requests } = fakeClient([
      message([thinking, { type: "tool_use", id: "t1", name: "strike_temperature", input: { targetMashTempC: 66.5 } }], "tool_use"),
      message([{ type: "text", text: "Varm innmeskingsvannet til ca. 73 °C." }], "end_turn"),
    ]);
    const rounds: number[] = [];
    const result = await runAssistant({
      client,
      model: "claude-sonnet-5",
      document: "# Bryggedokument",
      history: [{ role: "user", content: "Hvor varmt skal innmeskingsvannet være?" }],
      batch,
      onUsage: (u) => rounds.push(u.inputTokens),
    });

    expect(result).toMatchObject({ text: "Varm innmeskingsvannet til ca. 73 °C.", toolCalls: ["strike_temperature"], stopReason: "end_turn" });
    expect(rounds).toEqual([1000, 1000]);
    const second = requests[1]!;
    // The assistant turn goes back unchanged (thinking included), followed by one message of results.
    expect(second.messages[1]).toEqual({ role: "assistant", content: [thinking, expect.objectContaining({ type: "tool_use", id: "t1" })] });
    const results = second.messages[2]!.content as Anthropic.ToolResultBlockParam[];
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1", is_error: false });
    // The brew document is sent as a cached system block.
    expect(requests[0]!.system).toEqual([
      expect.objectContaining({ type: "text" }),
      { type: "text", text: "# Bryggedokument", cache_control: { type: "ephemeral" } },
    ]);
    expect(requests[0]!.model).toBe("claude-sonnet-5");
  });

  it("forces a final answer after too many tool rounds", async () => {
    const toolTurn = () => message([{ type: "tool_use", id: "t", name: "convert_units", input: { value: 1, fromUnit: "L", toUnit: "US gal" } }], "tool_use");
    const { client, requests } = fakeClient([...Array.from({ length: 6 }, toolTurn), message([{ type: "text", text: "Svar." }], "end_turn")]);
    const result = await runAssistant({ client, model: "claude-sonnet-5", document: "doc", history: [{ role: "user", content: "?" }], batch, onUsage: () => {} });
    expect(result.text).toBe("Svar.");
    expect(requests).toHaveLength(7);
    expect(requests[6]!.tool_choice).toEqual({ type: "none" });
    expect(requests[0]!.tool_choice).toBeUndefined();
  });

  it("explains a refusal instead of returning an empty answer", async () => {
    const { client } = fakeClient([message([], "refusal")]);
    const result = await runAssistant({ client, model: "claude-sonnet-5", document: "doc", history: [{ role: "user", content: "?" }], batch, onUsage: () => {} });
    expect(result.stopReason).toBe("refusal");
    expect(result.text).toMatch(/kunne ikke svare/);
  });
});

describe("assistant cost estimate", () => {
  it("uses list prices with cache reads at 0.1× and writes at 1.25×", () => {
    // Sonnet 5: $2 in / $10 out per MTok.
    const cost = estimateCostUsd("claude-sonnet-5", { inputTokens: 30_000, outputTokens: 1_500, cacheReadTokens: 10_000, cacheWriteTokens: 4_000 });
    expect(cost).toBeCloseTo((30_000 * 2 + 10_000 * 0.2 + 4_000 * 2.5 + 1_500 * 10) / 1_000_000, 10);
    expect(estimateCostUsd("some-future-model", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBeNull();
  });
});
