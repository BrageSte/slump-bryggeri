import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { assistantToolDefinitions, runAssistantTool } from "../../worker/assistant/tools.ts";
import { ASSISTANT_SYSTEM_PROMPT, runAssistant, thinkingSettings, type MessagesClient } from "../../worker/assistant/run.ts";
import { estimateCostUsd } from "../../worker/assistant/pricing.ts";
import { calculateStrikeTemperature } from "../../src/domain/brewing-calculations/index.ts";
import { holsfjordenWater20261001 } from "../../src/domain/water/slump-water.ts";
import { makeBatch, sunsetTimeline } from "../helpers/batch.ts";

const batch = makeBatch({
  equipmentSnapshot: { profileId: "p", profileVersion: 2, values: { grain_temperature_c: 16, mash_thickness_l_per_kg: 2.6, strike_temp_offset_c: 1.5 } },
  splits: [],
});

const brewDocumentSections = {
  header: "# Bryggedokument: Sunset IPA",
  plan: "## Plan og mål\nPlanlagt OG 1,061",
  water: "## Vann og pH\n- Ingen pH-målinger registrert.",
  equipment: "## Utstyrsprofil\nFordampning: 13,2 L/h",
  status: "## Status nå\nNeste handling: Mål temperatur",
  results: "",
  calibration: "## Kalibrering\nÉn batch er svakt grunnlag",
  log: "## Logg\n- Siste måling",
};

const usage = (input: number, output: number, webSearchRequests = 0): Anthropic.Usage =>
  ({
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 100,
    cache_creation_input_tokens: 0,
    server_tool_use: { web_fetch_requests: 0, web_search_requests: webSearchRequests },
  }) as Anthropic.Usage;

function message(content: unknown[], stop_reason: Anthropic.Message["stop_reason"], webSearchRequests = 0): Anthropic.Message {
  return { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", content, stop_reason, usage: usage(1000, 50, webSearchRequests) } as unknown as Anthropic.Message;
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
  it("requires a real split id for a fermented vessel reading, even when label names the vessel", async () => {
    const splitBatch = makeBatch({ currentStage: "fermentation" });
    const proposedActions: import("../../src/domain/model/api.ts").AssistantProposedAction[] = [];
    const result = await runAssistantTool("propose_actions", { answer: "Her er rådet før loggforslagene.", actions: [
      { kind: "log_measurement", measurementKind: "temperature", value: 18.5, unit: "°C", label: "Tropical" },
      { kind: "log_measurement", measurementKind: "temperature", value: 20.2, unit: "°C", splitId: "pine" },
      { kind: "log_measurement", measurementKind: "temperature", value: 19, unit: "°C", splitId: "outside-this-batch" },
    ] }, { batch: splitBatch, proposedActions });
    const parsed = JSON.parse(result.content);
    expect(parsed.accepted).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(2);
    expect(parsed.rejected[0].reason).toContain("needs a vessel's splitId");
    expect(proposedActions).toEqual([expect.objectContaining({ splitId: "pine", value: 20.2 })]);
  });
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
      "water_chemistry",
      "get_batch_section",
      "brewery_history",
      "propose_actions",
    ]);
    for (const definition of assistantToolDefinitions) {
      expect(definition.input_schema.type).toBe("object");
      expect(definition.input_schema).not.toHaveProperty("$schema");
    }
    const proposalSchema = JSON.stringify(assistantToolDefinitions.find((tool) => tool.name === "propose_actions")?.input_schema);
    expect(proposalSchema).toContain("log_measurement");
    expect(proposalSchema).toContain("log_event");
    expect(proposalSchema).toContain("start_timer");
  });

  it("computes with the app's own functions and the batch snapshot's defaults", async () => {
    const result = await runAssistantTool("strike_temperature", { targetMashTempC: 66.5 }, { batch });
    const expected = calculateStrikeTemperature({ targetMashTempC: 66.5, grainTempC: 16, mashThicknessLPerKg: 2.6, systemOffsetC: 1.5 });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content).strikeTempC).toBeCloseTo(expected.strikeTempC, 1);
  });

  it("returns the requested brew document section", async () => {
    const result = await runAssistantTool("get_batch_section", { section: "equipment" }, { batch, brewDocumentSections });
    expect(result).toEqual({ content: brewDocumentSections.equipment, isError: false });
  });

  it("returns a not available error when brewery history has no loader", async () => {
    const result = await runAssistantTool("brewery_history", {}, { batch });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({ error: "not available" });
  });

  it("serializes brewery history returned by its async loader as JSON", async () => {
    const history = { boilOff: { meanLPerH: 12.8, count: 4 } };
    const result = await runAssistantTool("brewery_history", {}, { batch, loadBreweryHistory: async () => history });
    expect(JSON.parse(result.content)).toEqual(history);
  });

  it("reports missing boil-off and invalid input as tool errors instead of guessing", async () => {
    expect(JSON.parse((await runAssistantTool("water_volumes", {}, { batch })).content)).toHaveProperty("error");
    expect((await runAssistantTool("strike_temperature", { targetMashTempC: "varm" }, { batch })).isError).toBe(true);
    expect((await runAssistantTool("does_not_exist", {}, { batch })).isError).toBe(true);
  });

  it("keeps valid proposed actions, reports invalid ones, and does not execute them", async () => {
    const proposedActions: import("../../src/domain/model/api.ts").AssistantProposedAction[] = [];
    const result = await runAssistantTool("propose_actions", {
      answer: "Her er rådet før loggforslagene.",
      actions: [
        { kind: "log_measurement", measurementKind: "temperature", value: 64, unit: "°C", label: "Mesketemperatur" },
        { kind: "log_event", type: "water_added", data: { volumeL: 3.5, temperatureC: 95 } },
        { kind: "start_timer", label: "Humle", durationMin: 10 },
        { kind: "log_measurement", measurementKind: "temperature", value: 164, unit: "°C" },
        { kind: "log_event", type: "water_added", data: { volumeL: -1, temperatureC: 95 } },
        { kind: "start_timer", label: "", durationMin: 10 },
      ],
    }, { batch, proposedActions });

    const output = JSON.parse(result.content) as { accepted: unknown[]; rejected: { index: number; reason: string }[] };
    expect(result.isError).toBe(false);
    expect(output.accepted).toHaveLength(3);
    expect(output.rejected.map((entry) => entry.index)).toEqual([3, 4, 5]);
    expect(output.rejected.every((entry) => entry.reason.length > 0)).toBe(true);
    expect(proposedActions).toHaveLength(3);
    expect(proposedActions[0]).toMatchObject({ kind: "log_measurement", value: 64 });
    expect(proposedActions[1]).toMatchObject({ kind: "log_event", type: "water_added" });
    expect(proposedActions[2]).toMatchObject({ kind: "start_timer", durationMin: 10 });
  });

  it("reports the water story in four labelled parts, from the frozen profile and the log", async () => {
    const frozen = makeBatch({ equipmentSnapshot: { profileId: "p", profileVersion: 1, values: {}, water: holsfjordenWater20261001 } });
    const result = await runAssistantTool("water_chemistry", {}, { batch: frozen, timeline: sunsetTimeline() });
    expect(result.isError).toBe(false);
    const water = JSON.parse(result.content);
    expect(Object.keys(water)).toEqual(["sourceWater", "calculated", "plan", "measured", "guidance"]);
    expect(water.sourceWater).toMatchObject({ basis: "Oppgitt (kilde)", frozenInBatch: true, ionsMgL: { ca: 6.6, hco3: 16.5 } });
    expect(water.sourceWater.source.url).toBe("https://www.abvann.no/temasider/vannkvalitet");
    expect(water.sourceWater.confirmedUse).toMatchObject({ confirmedBy: "Brage", confirmedAt: "2026-10-01" });
    expect(water.sourceWater.otherReported).toHaveLength(22);
    expect(water.sourceWater.otherReported).toContainEqual({ name: "Kalium", value: 0.53, unit: "mg/L", limit: null });
    expect(water.calculated).toMatchObject({ basis: "Beregnet", fromSourceWater: { alkalinityAsCaCO3MgL: 13.5, residualAlkalinityAsCaCO3MgL: 8.3 } });
    expect(water.plan.basis).toBe("Mål / anbefaling");
    expect(water.measured.basis).toBe("Målt i brygget");
    expect(water.measured.ph).toEqual([expect.objectContaining({ point: "pre_boil", value: 5.9, sampleTempC: null, instrument: null })]);
    expect(water.guidance.disclaimer).toMatch(/ikke regler/);
  });

  it("says plainly when an older batch has no frozen profile", async () => {
    const water = JSON.parse((await runAssistantTool("water_chemistry", {}, { batch, timeline: [] })).content);
    expect(water.sourceWater.frozenInBatch).toBe(false);
    expect(water.measured.ph).toEqual([]);
  });

  it("calculates what-if salts with the tested functions and needs a water volume", async () => {
    const withVolume = JSON.parse((await runAssistantTool("water_chemistry", { whatIfSalts: [{ agent: "gypsum", grams: 10 }, { agent: "calcium_chloride_dihydrate", grams: 20 }], totalWaterL: 100 }, { batch, timeline: [] })).content);
    expect(withVolume.calculated.whatIf).toMatchObject({ basis: "Beregnet", totalWaterL: 100 });
    expect(withVolume.calculated.whatIf.resultingIonsMgL.ca).toBeCloseTo(84.4, 1);
    expect(withVolume.calculated.whatIf.resultingIonsMgL.cl).toBeCloseTo(99, 1);
    const noVolume = JSON.parse((await runAssistantTool("water_chemistry", { whatIfSalts: [{ agent: "gypsum", grams: 10 }] }, { batch: makeBatch({ equipmentSnapshot: { profileId: "p", profileVersion: 1, values: {} }, recipeSnapshot: { ...batch.recipeSnapshot, mashSteps: [], fermentables: [] } }), timeline: [] })).content);
    expect(noVolume.calculated.whatIf).toHaveProperty("error");
  });

  it("rejects an acid as a what-if salt and refuses to answer without the log", async () => {
    expect((await runAssistantTool("water_chemistry", { whatIfSalts: [{ agent: "lactic_acid", grams: 5 }], totalWaterL: 50 }, { batch, timeline: [] })).isError).toBe(true);
    expect(JSON.parse((await runAssistantTool("water_chemistry", {}, { batch })).content)).toEqual({ error: "not available" });
  });

  it("accepts a proposed pH reading with its sample temperature and sample point label", async () => {
    const proposedActions: import("../../src/domain/model/api.ts").AssistantProposedAction[] = [];
    const result = await runAssistantTool("propose_actions", {
      answer: "Her er rådet før loggforslagene.",
      actions: [
        { kind: "log_measurement", measurementKind: "ph", value: 5.34, unit: "pH", label: "pH før kok", sampleTempC: 22 },
        { kind: "log_measurement", measurementKind: "ph", value: 5.34, unit: "pH", sampleTempC: 900 },
      ],
    }, { batch, proposedActions });
    const output = JSON.parse(result.content) as { accepted: unknown[]; rejected: { index: number }[] };
    expect(output.accepted).toHaveLength(1);
    expect(output.rejected.map((entry) => entry.index)).toEqual([1]);
    expect(proposedActions[0]).toMatchObject({ kind: "log_measurement", measurementKind: "ph", sampleTempC: 22, label: "pH før kok" });
  });

  it("tells the model to keep the four kinds of water value apart and never to predict mash pH", () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("use the water_chemistry tool");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("never compute ion concentrations, alkalinity, hardness or salt amounts yourself");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("recommended targets (general guidance windows, not rules");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("no mash pH prediction and no acid dosing");
  });

  it("tells the model not to do arithmetic and to propose reported log entries", () => {
    expect(ASSISTANT_SYSTEM_PROMPT.toLowerCase()).toContain("never do arithmetic yourself, including sums and differences");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("propose logging it with propose_actions after addressing their questions");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("Search the web only when the answer depends on specific external facts");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("Never search this batch's data, brewery history, or anything a calculation tool answers");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("note crop-year and lot variation for hops");
    expect(ASSISTANT_SYSTEM_PROMPT).toContain("labelled as general guidance rather than a fact about this batch");
  });
});

describe("assistant loop", () => {
  it("shows the complete answer supplied inside the proposal, without a redundant final acknowledgement", async () => {
    const answer = "18 °C følger planen. Vent med å øke, og mål SG før du vurderer gjæringen.";
    const { client } = fakeClient([
      message([{ type: "tool_use", id: "proposal", name: "propose_actions", input: { answer, actions: [{ kind: "log_measurement", measurementKind: "temperature", value: 18, unit: "°C" }] } }], "tool_use"),
      message([{ type: "text", text: "Målingen ligger klar til bekreftelse." }], "end_turn"),
    ]);
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", brief: "Brief", batch, history: [{ role: "user", content: "Vi målte 18. Bør vi øke?" }], onUsage: () => {} });
    expect(result.text).toBe(answer);
    expect(result.actions).toHaveLength(1);
    expect((await runAssistantTool("propose_actions", { answer, actions: [] }, { batch })).isError).toBe(true);
  });

  it("keeps the final explanation when some proposed actions were rejected", async () => {
    const { client } = fakeClient([
      message([{ type: "tool_use", id: "proposal", name: "propose_actions", input: { answer: "Her er rådet.", actions: [{ kind: "log_measurement", measurementKind: "temperature", value: 18, unit: "°C" }, { kind: "log_measurement", measurementKind: "temperature", value: 164, unit: "°C" }] } }], "tool_use"),
      message([{ type: "text", text: "164 °C er utenfor gyldig område og er ikke foreslått." }], "end_turn"),
    ]);
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", brief: "Brief", batch, history: [{ role: "user", content: "18 i kar A, 164 i kar B." }], onUsage: () => {} });
    expect(result.actions).toHaveLength(1);
    expect(result.text).toContain("164 °C er utenfor");
  });
  it("returns advice that precedes a proposal instead of showing only the last acknowledgement", async () => {
    const advice = "18 °C følger planen for dag 0. Ikke øk ennå; følg målt SG.";
    const { client } = fakeClient([
      message([{ type: "text", text: advice }, { type: "tool_use", id: "proposal", name: "propose_actions", input: { answer: advice, actions: [{ kind: "log_measurement", measurementKind: "temperature", value: 18, unit: "°C" }] } }], "tool_use"),
      message([{ type: "text", text: "Målingen ligger klar til bekreftelse." }], "end_turn"),
    ]);
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", brief: "Brief", batch, history: [{ role: "user", content: "Vi målte 18. Bør vi øke?" }], onUsage: () => {} });
    expect(result.text).toBe(advice);
    expect(result.actions).toHaveLength(1);
  });

  it("preserves earlier advice with an empty final turn and needs no extra retry", async () => {
    const { client, requests } = fakeClient([
      message([{ type: "text", text: "Mål SG før du konkluderer." }, { type: "tool_use", id: "plan", name: "get_batch_section", input: { section: "plan" } }], "tool_use"),
      message([], "end_turn"),
    ]);
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", brief: "Brief", batch, brewDocumentSections, history: [{ role: "user", content: "Er ølet ferdig?" }], onUsage: () => {} });
    expect(result.text).toBe("Mål SG før du konkluderer.");
    expect(requests).toHaveLength(2);
  });
  it("requires a prose answer with a proposal and rejects an answer-free tool call", async () => {
    const result = await runAssistantTool("propose_actions", { actions: [{ kind: "log_measurement", measurementKind: "temperature", value: 18, unit: "°C" }] }, { batch, proposedActions: [] });
    expect(result.isError).toBe(true);
    expect(result.content).toContain("answer");
    const answerParts: string[] = [];
    const proposedActions: import("../../src/domain/model/api.ts").AssistantProposedAction[] = [];
    const answer = "18 °C følger planen. Ikke øk ennå; mål SG før du vurderer gjæringen.";
    expect((await runAssistantTool("propose_actions", { answer, actions: [{ kind: "log_measurement", measurementKind: "temperature", value: 18, unit: "°C" }] }, { batch, proposedActions, answerParts })).isError).toBe(false);
    expect(answerParts).toEqual([answer]);
    expect(proposedActions).toHaveLength(1);
  });

  it("bounds an empty-answer retry even if the model stays silent", async () => {
    const { client, requests } = fakeClient([
      message([{ type: "tool_use", id: "t", name: "get_batch_section", input: { section: "plan" } }], "tool_use"),
      message([], "end_turn"), message([], "end_turn"),
    ]);
    const result = await runAssistant({ client, model: "claude-sonnet-5-5", brief: "Brief", brewDocumentSections, batch,
      history: [{ role: "user", content: "Hva sier planen?" }], onUsage: () => {} });
    expect(requests).toHaveLength(3);
    expect(result.text).toBe("Assistenten ga ikke noe svar. Prøv igjen.");
  });
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
      brief: "Kort assistentbrief",
      brewDocumentSections,
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
    // The brief is sent as a cached system block.
    expect(requests[0]!.system).toEqual([
      expect.objectContaining({ type: "text", cache_control: { type: "ephemeral" } }),
      { type: "text", text: "Kort assistentbrief", cache_control: { type: "ephemeral" } },
    ]);
    expect(requests[0]!.model).toBe("claude-sonnet-5");
  });

  it("awaits async tools and returns every result in one user message", async () => {
    const { client, requests } = fakeClient([
      message([
        { type: "tool_use", id: "section", name: "get_batch_section", input: { section: "status" } },
        { type: "tool_use", id: "history", name: "brewery_history", input: {} },
      ], "tool_use"),
      message([{ type: "text", text: "Mål temperaturen igjen." }], "end_turn"),
    ]);
    let historyLoaded = false;
    const result = await runAssistant({
      client,
      model: "claude-sonnet-5",
      brief: "Kort assistentbrief",
      brewDocumentSections,
      loadBreweryHistory: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        historyLoaded = true;
        return { attenuation: { count: 4, meanPct: 72 } };
      },
      history: [{ role: "user", content: "Er dette normalt?" }],
      batch,
      onUsage: () => {},
    });

    expect(result.text).toBe("Mål temperaturen igjen.");
    expect(historyLoaded).toBe(true);
    const returnedMessages = requests[1]!.messages.filter((entry) => entry.role === "user");
    expect(returnedMessages).toHaveLength(2);
    expect(returnedMessages.at(-1)!.content).toEqual([
      expect.objectContaining({ type: "tool_result", tool_use_id: "section", content: brewDocumentSections.status, is_error: false }),
      expect.objectContaining({ type: "tool_result", tool_use_id: "history", content: JSON.stringify({ attenuation: { count: 4, meanPct: 72 } }), is_error: false }),
    ]);
  });

  it("passes server search blocks and cited text back unchanged after pause_turn", async () => {
    const citation = {
      type: "web_search_result_location",
      url: "https://www.fermentis.com/en/product/safale-us-05/",
      title: "SafAle US-05",
      encrypted_index: "opaque-citation-index",
      cited_text: "Attenuation: 78–82%",
    };
    const searchTurn = [
      { type: "server_tool_use", id: "search-1", name: "web_search", input: { query: "SafAle US-05 attenuation" } },
      { type: "web_search_tool_result", tool_use_id: "search-1", content: [{ type: "web_search_result", url: citation.url, title: citation.title }] },
      { type: "text", text: "I found the product specification.", citations: [citation] },
    ];
    const secondSearchTurn = [
      { type: "server_tool_use", id: "search-2", name: "web_search", input: { query: "SafAle US-05 attenuation Fermentis" } },
      { type: "web_search_tool_result", tool_use_id: "search-2", content: [{ type: "web_search_result", url: citation.url, title: citation.title }] },
    ];
    const { client, requests } = fakeClient([
      message(searchTurn, "pause_turn", 1),
      message(secondSearchTurn, "pause_turn", 1),
      message([{ type: "text", text: "Fermentis oppgir 78–82 % utgjæring for SafAle US-05.", citations: [citation] }], "end_turn"),
    ]);
    const recordedUsage: number[] = [];
    const result = await runAssistant({
      client,
      model: "claude-sonnet-5",
      brief: "Kort assistentbrief",
      brewDocumentSections,
      history: [{ role: "user", content: "Hva er utgjæringen for US-05?" }],
      batch,
      onUsage: (round) => recordedUsage.push(round.webSearchRequests),
    });

    expect(requests).toHaveLength(3);
    expect(requests[1]!.messages[1]).toEqual({ role: "assistant", content: searchTurn });
    expect(requests[1]!.messages).toHaveLength(2);
    expect(requests[2]!.messages[2]).toEqual({ role: "assistant", content: secondSearchTurn });
    const firstSearch = requests[0]!.tools?.find((tool) => tool.type === "web_search_20260209");
    const continuedSearch = requests[1]!.tools?.find((tool) => tool.type === "web_search_20260209");
    const exhaustedSearch = requests[2]!.tools?.some((tool) => tool.type === "web_search_20260209");
    expect(firstSearch).toMatchObject({ type: "web_search_20260209", name: "web_search", max_uses: 2, allowed_domains: expect.arrayContaining(["fermentis.com", "bjcp.org"]) });
    expect(continuedSearch).toMatchObject({ type: "web_search_20260209", max_uses: 1 });
    expect(exhaustedSearch).toBe(false);
    expect(requests[0]!.tools?.some((tool) => tool.type?.startsWith("code_execution"))).toBe(false);
    expect(recordedUsage).toEqual([1, 1, 0]);
    expect(result.text).toContain("78–82 %");
    expect(result.citations).toEqual([{ url: citation.url, title: citation.title }]);
  });

  it("omits the server web search tool when it is disabled", async () => {
    const { client, requests } = fakeClient([message([{ type: "text", text: "Generell veiledning." }], "end_turn")]);
    await runAssistant({
      client,
      model: "claude-sonnet-5",
      brief: "doc",
      brewDocumentSections,
      history: [{ role: "user", content: "?" }],
      batch,
      webSearchEnabled: false,
      onUsage: () => {},
    });
    expect(requests[0]!.tools?.some((tool) => tool.type === "web_search_20260209")).toBe(false);
  });

  it("forces a final answer after too many tool rounds", async () => {
    const toolTurn = () => message([{ type: "tool_use", id: "t", name: "convert_units", input: { value: 1, fromUnit: "L", toUnit: "US gal" } }], "tool_use");
    const { client, requests } = fakeClient([...Array.from({ length: 6 }, toolTurn), message([{ type: "text", text: "Svar." }], "end_turn")]);
    const result = await runAssistant({ client, model: "claude-sonnet-5", brief: "doc", brewDocumentSections, history: [{ role: "user", content: "?" }], batch, onUsage: () => {} });
    expect(result.text).toBe("Svar.");
    expect(requests).toHaveLength(7);
    expect(requests[6]!.tool_choice).toEqual({ type: "none" });
    expect(requests[0]!.tool_choice).toBeUndefined();
  });

  it("explains a refusal instead of returning an empty answer", async () => {
    const { client } = fakeClient([message([], "refusal")]);
    const result = await runAssistant({ client, model: "claude-sonnet-5", brief: "doc", brewDocumentSections, history: [{ role: "user", content: "?" }], batch, onUsage: () => {} });
    expect(result.stopReason).toBe("refusal");
    expect(result.text).toMatch(/kunne ikke svare/);
  });
});

describe("assistant cost estimate", () => {
  it("uses list prices with cache reads at 0.1× and writes at 1.25×", () => {
    // Sonnet 5: $2 in / $10 out per MTok.
    const cost = estimateCostUsd("claude-sonnet-5", { inputTokens: 30_000, outputTokens: 1_500, cacheReadTokens: 10_000, cacheWriteTokens: 4_000, webSearchRequests: 0 });
    expect(cost).toBeCloseTo((30_000 * 2 + 10_000 * 0.2 + 4_000 * 2.5 + 1_500 * 10) / 1_000_000, 10);
    expect(estimateCostUsd("claude-sonnet-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 2 })).toBeCloseTo(0.02, 10);
    expect(estimateCostUsd("claude-sonnet-5-5", { inputTokens: 30_000, outputTokens: 1_500, cacheReadTokens: 10_000, cacheWriteTokens: 4_000, webSearchRequests: 0 })).toBeCloseTo(cost!, 10);
    expect(estimateCostUsd("some-future-model", { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 })).toBeNull();
  });
});


describe("model compatibility", () => {
  it("uses basic direct search and no adaptive thinking for Haiku", async () => {
    const { client, requests } = fakeClient([message([{ type: "text", text: "Hei" }], "end_turn")]);
    await runAssistant({ client, model: "claude-haiku-4-5", brief: "Brief", batch, history: [{ role: "user", content: "Hei" }], onUsage: () => {} });
    expect(requests[0]).not.toHaveProperty("thinking");
    expect(requests[0]).not.toHaveProperty("output_config");
    expect(requests[0]?.tools?.find((tool) => "name" in tool && tool.name === "web_search")).toMatchObject({ type: "web_search_20250305", allowed_callers: ["direct"], max_uses: 2 });
  });
  it.each(["claude-haiku-4-5", "claude-haiku-4-5-20251001", "claude-sonnet-4-5-20250929", "claude-opus-4-5", "unknown-model"])("does not send unsupported adaptive settings to %s", (model) => {
    expect(thinkingSettings(model)).toEqual({});
  });
  it.each(["claude-sonnet-5-5", "claude-opus-5-5", "claude-sonnet-4-6", "claude-opus-4-8"])("retains adaptive thinking and medium effort for %s", (model) => {
    expect(thinkingSettings(model)).toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "medium" } });
  });
  it("uses Opus 5.5's 0.05x cache rate and dated Haiku pricing", () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0, webSearchRequests: 0 };
    expect(estimateCostUsd("claude-opus-5-5", usage)).toBeCloseTo(0.2, 10);
    expect(estimateCostUsd("claude-haiku-4-5-20251001", usage)).toBeCloseTo(0.1, 10);
  });
});
