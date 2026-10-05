import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { parseEvalOptions } from "../../scripts/assistant-eval/options.ts";
import { runIntentEvaluation, summarizeEvaluation } from "../../scripts/assistant-eval/runner.ts";
import { assistantIntentCases, buildIntentContext, checkIntentActions, selectIntentCases, EVAL_NOW, type AssistantIntentCase } from "../fixtures/assistant-intent.ts";
import { recipeDocumentSchema } from "../../src/domain/model/recipe.ts";
import { buildAssistantBrief, buildBrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import type { MessagesClient } from "../../worker/assistant/run.ts";

const testCase: AssistantIntentCase = { id: "test-question", category: "intent", question: "Hva bør vi måle?", expectedReadings: [], review: "Answer the question." };
const response = (inputTokens = 10): Anthropic.Message => ({ id: "response", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: "Følg planen og mål SG før du konkluderer." }], stop_reason: "end_turn", usage: { input_tokens: inputTokens, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }) as Anthropic.Message;

/** These tests inject a fake; none read .dev.vars or send an AI request. */
describe("evaluation options", () => {
  it("defaults to an offline, single-medium run and shares one budget across compare profiles", () => {
    expect(parseEvalOptions([])).toMatchObject({ live: false, repeats: 1, concurrency: 1, budgetUsd: 1, profiles: [{ effort: "medium" }] });
    expect(parseEvalOptions(["--live", "--compare", "--repeats", "3", "--budget-usd", "3", "--concurrency", "2"])).toMatchObject({ live: true, repeats: 3, concurrency: 2, budgetUsd: 3, profiles: [{ effort: "medium" }, { effort: "high" }] });
  });
  it.each([
    ["--model", "claude-haiku-4-5"], ["--model", "unknown"], ["--effort", "max"], ["--compare", "--effort", "high"],
    ["--repeats", "0"], ["--repeats", "1.5"], ["--concurrency", "10"], ["--budget-usd", "NaN"], ["--budget-usd", "0"],
    ["--repeats"], ["--live", "--live"], ["--unrecognised"],
  ].map((args) => ({ args })))("rejects unsupported or unsafe options %j before credential access", ({ args }) => expect(() => parseEvalOptions(args)).toThrow());
});

describe("synthetic fixture set", () => {
  it("has at least twenty unique, schema-valid and deterministic cases with split/history/correction coverage", () => {
    expect(assistantIntentCases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(assistantIntentCases.map((test) => test.id)).size).toBe(assistantIntentCases.length);
    for (const test of assistantIntentCases) {
      const context = buildIntentContext(test);
      expect(context.now).toBe(EVAL_NOW);
      expect(context).toEqual(buildIntentContext(test));
      expect(recipeDocumentSchema.safeParse(context.batch.recipeSnapshot).success, test.id).toBe(true);
      const brief = buildAssistantBrief(context, buildBrewDocumentSections(context));
      expect(brief).toContain("Syntetisk eval-IPA");
      for (const reading of test.expectedReadings) if (reading.splitId) expect(context.batch.splits.some((split) => split.id === reading.splitId)).toBe(true);
    }
    expect(assistantIntentCases.filter((test) => test.history?.length).length).toBeGreaterThanOrEqual(3);
    const split = buildIntentContext(assistantIntentCases.find((test) => test.context === "splits")!);
    expect(split.batch.splits.reduce((sum, variant) => sum + (variant.volumeL ?? 0), 0)).toBe(split.batch.recipeSnapshot.batchSizeL);
  });
  it("shows only the active correction and actual stability spanning three full days", () => {
    const corrected = buildIntentContext(assistantIntentCases.find((test) => test.context === "corrected")!);
    expect(corrected.timeline.filter((entry) => entry.measurement).map((entry) => entry.measurement?.value)).toEqual([20.2]);
    const stable = buildIntentContext(assistantIntentCases.find((test) => test.context === "stable")!);
    const sg = stable.timeline.filter((entry) => entry.measurement?.value === 1.012);
    expect(sg).toHaveLength(4);
    expect(sg.at(-1)!.occurredAt - sg[0]!.occurredAt).toBe(3 * 86_400_000);
  });
  it("matches whole readings independently of order, rejecting swapped splits and extra values", () => {
    const test = assistantIntentCases.find((test) => test.id === "two-splits")!;
    const valid = test.expectedReadings.map((reading) => ({ kind: "log_measurement" as const, ...reading }));
    expect(checkIntentActions(test.expectedReadings, [...valid].reverse())).toEqual([]);
    expect(checkIntentActions(test.expectedReadings, valid.map((reading) => ({ ...reading, splitId: reading.splitId === "pine" ? "tropical" : "pine" })))).not.toEqual([]);
    expect(checkIntentActions([], valid)).not.toEqual([]);
    expect(checkIntentActions(test.expectedReadings, [valid[0]!, valid[0]!])).not.toEqual([]);
  });
  it("selects a complete subset without silently ignoring invalid ids, and permits only a fresh tasting comment", () => {
    expect(selectIntentCases("log-only,quotation")).toHaveLength(2);
    expect(() => selectIntentCases("log-only,unknown")).toThrow();
    expect(() => selectIntentCases("log-only,log-only")).toThrow();
    expect(checkIntentActions([], [{ kind: "log_event", type: "comment", data: { body: "Ingen smørsmak" } }], ["comment"])).toEqual([]);
    expect(checkIntentActions([], [{ kind: "log_measurement", measurementKind: "sg", value: 1.012, unit: "SG" }], ["comment"])).not.toEqual([]);
    const day4 = buildIntentContext(assistantIntentCases.find((test) => test.id === "two-splits")!);
    expect(day4.timeline.some((entry) => entry.type === "fermentation_started" && entry.occurredAt === day4.batch.stageStartedAt)).toBe(true);
    expect(buildBrewDocumentSections(day4).status).toContain("Gjæringsdag 4");
  });
});

describe("comparison runner", () => {
  it("runs both requested efforts and repeats with identical scripted histories and fixed fixture hashes", async () => {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClient = { messages: { create: async (params) => { requests.push(structuredClone(params)); return response(); } } };
    const test = { ...testCase, history: [{ role: "user" as const, content: "Målte 18,5." }, { role: "assistant" as const, content: "Hvilket kar?" }], question: "Tropical. Hva nå?" };
    const options = parseEvalOptions(["--compare", "--repeats", "3", "--concurrency", "2"]);
    const report = await runIntentEvaluation({ options, client, cases: [test] });
    expect(requests).toHaveLength(6);
    expect(requests.filter((request) => request.output_config?.effort === "high")).toHaveLength(3);
    expect(requests.filter((request) => request.output_config?.effort === "medium")).toHaveLength(3);
    for (const request of requests) {
      expect(request.messages).toEqual([...test.history, { role: "user", content: test.question }]);
      expect(request.tools?.some((tool) => "name" in tool && tool.name === "web_search")).toBe(false);
    }
    expect(new Set(requests.map((request) => JSON.stringify(request.system))).size).toBe(1);
    expect(report.results.every((result) => result.proseReview === "pending")).toBe(true);
    const next = await runIntentEvaluation({ options, client, cases: [test] });
    expect(next.fixtureHash).toBe(report.fixtureHash);
    expect(next.promptHash).toBe(report.promptHash);
    expect(summarizeEvaluation(report).map((profile) => ({ completed: profile.completed, contractPassed: profile.contractPassed }))).toEqual([{ completed: 3, contractPassed: 3 }, { completed: 3, contractPassed: 3 }]);
  });
  it("stops new API calls when its shared budget is exhausted, retaining paid usage and skipped records", async () => {
    const options = parseEvalOptions(["--compare", "--repeats", "3", "--budget-usd", "0.01"]);
    const client: MessagesClient = { messages: { create: async () => response(1_000_000) } };
    const report = await runIntentEvaluation({ options, client, cases: [testCase] });
    expect(report.budget).toMatchObject({ exhausted: true, requestsSent: 1 });
    expect(report.budget.estimatedUsd).toBeGreaterThan(0.01);
    expect(report.results.filter((result) => result.status === "budget_skipped")).toHaveLength(5);
    expect(report.results[0]?.usage.inputTokens).toBe(1_000_000);
  });
  it("does not store SDK error text or headers and does not mark missing plan retrieval as a prose pass", async () => {
    const options = parseEvalOptions([]);
    const failed: MessagesClient = { messages: { create: async () => { throw Object.assign(new Error("SECRET_DO_NOT_PRINT"), { status: 429, headers: { "x-api-key": "SECRET_DO_NOT_PRINT" } }); } } };
    const report = await runIntentEvaluation({ options, client: failed, cases: [testCase] });
    expect(JSON.stringify(report)).not.toContain("SECRET_DO_NOT_PRINT");
    expect(report.results[0]?.error).toEqual({ type: "api_error", status: 429 });
    const noPlan: MessagesClient = { messages: { create: async () => response() } };
    const plan = await runIntentEvaluation({ options, client: noPlan, cases: [{ ...testCase, requiresPlan: true }] });
    expect(plan.results[0]?.contractErrors.join(" ")).toContain("plan lookup");
    expect(plan.results[0]?.proseReview).toBe("pending");
  });

  it("resumes only skipped tasks without paying for completed ones again, carrying the prior spend", async () => {
    const options = parseEvalOptions(["--compare", "--budget-usd", "0.01"]);
    let requests = 0;
    const client: MessagesClient = { messages: { create: async () => { requests++; return response(requests === 1 ? 10_000 : 10); } } };
    const previous = await runIntentEvaluation({ options, client, cases: [testCase] });
    expect(requests).toBe(1);
    const resumed = await runIntentEvaluation({ options: { ...options, budgetUsd: 1 }, client, cases: [testCase], previous });
    expect(requests).toBe(2);
    expect(resumed.results.every((record) => record.status === "completed")).toBe(true);
    expect(resumed.budget.estimatedUsd).toBeGreaterThan(previous.budget.estimatedUsd);
    expect(resumed.budget.requestsSent).toBe(2);
    expect(resumed.results[0]?.result).toEqual(previous.results[0]?.result);
    await expect(runIntentEvaluation({ options: { ...options, budgetUsd: 1 }, client, cases: [{ ...testCase, question: "Different fixture" }], previous })).rejects.toThrow("does not match");
    expect(requests).toBe(2);
  });
});
