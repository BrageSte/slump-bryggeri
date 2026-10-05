import { createHash } from "node:crypto";
import { buildAssistantBrief, buildBrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import { summarizeBreweryHistory } from "../../src/domain/brew-document/brewery-history.ts";
import { selectIntentCases, buildIntentContext, checkIntentActions, EVAL_NOW, type AssistantIntentCase } from "../../tests/fixtures/assistant-intent.ts";
import { ASSISTANT_SYSTEM_PROMPT, runAssistant, type AssistantRunResult, type AssistantUsage, type MessagesClient } from "../../worker/assistant/run.ts";
import { assistantToolDefinitions } from "../../worker/assistant/tools.ts";
import { estimateCostUsd } from "../../worker/assistant/pricing.ts";
import type { EvalOptions, EvalProfile } from "./options.ts";

const emptyUsage = (): AssistantUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 });
class BudgetStopped extends Error {}
export interface EvalResult {
  taskIndex: number;
  caseId: string;
  profileId: string;
  repetition: number;
  status: "completed" | "error" | "budget_skipped";
  elapsedMs: number;
  requestCount: number;
  responseTextRounds: { stopReason: string | null; text: string }[];
  usage: AssistantUsage;
  estimatedUsd: number;
  result?: AssistantRunResult;
  contractErrors: string[];
  warnings: string[];
  wordCount?: number;
  /** Semantic quality is deliberately not inferred from JSON or lexical checks. */
  proseReview: "pending";
  error?: { type: "api_error" | "budget_stopped"; status?: number };
}
export interface EvalReport {
  format: "slump-assistant-eval";
  version: 2;
  createdAt: string;
  fixtureNow: number;
  fixtureHash: string;
  promptHash: string;
  toolsHash: string;
  options: EvalOptions;
  webSearchEnabled: false;
  budget: { estimatedUsd: number; limitUsd: number; exhausted: boolean; requestsSent: number };
  cases: AssistantIntentCase[];
  results: EvalResult[];
}
const hash = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

/** An injected client keeps CI offline. Independent tasks use isolated contexts; only the estimated spend is shared. */
export async function runIntentEvaluation(input: {
  options: EvalOptions;
  client: MessagesClient;
  cases?: AssistantIntentCase[];
  previous?: EvalReport;
  onProgress?: (result: EvalResult, report: EvalReport) => void | Promise<void>;
}): Promise<EvalReport> {
  const cases = input.cases ?? selectIntentCases(input.options.caseId);
  if (!cases.length) throw new Error("Unknown --case. Run without --live to list case ids.");
  const tasks: { test: AssistantIntentCase; profile: EvalProfile; repetition: number }[] = [];
  for (let repetition = 1; repetition <= input.options.repeats; repetition++) {
    cases.forEach((test, index) => {
      // Alternate order rather than always warming medium before high; report cache usage and concurrency too.
      const profiles = (index + repetition) % 2 ? input.options.profiles : [...input.options.profiles].reverse();
      for (const profile of profiles) tasks.push({ test, profile, repetition });
    });
  }
  const report: EvalReport = {
    format: "slump-assistant-eval", version: 2, createdAt: new Date().toISOString(), fixtureNow: EVAL_NOW,
    fixtureHash: hash(cases.map((test) => ({ test, context: buildIntentContext(test) }))), promptHash: hash(ASSISTANT_SYSTEM_PROMPT), toolsHash: hash(assistantToolDefinitions),
    options: input.options, webSearchEnabled: false, budget: { estimatedUsd: 0, limitUsd: input.options.budgetUsd, exhausted: false, requestsSent: 0 }, cases, results: [],
  };
  if (input.previous) {
    const previous = input.previous;
    if (previous.format !== report.format || previous.version !== report.version
      || previous.fixtureHash !== report.fixtureHash || previous.promptHash !== report.promptHash || previous.toolsHash !== report.toolsHash
      || JSON.stringify(previous.options.profiles) !== JSON.stringify(report.options.profiles)
      || previous.options.repeats !== report.options.repeats || previous.webSearchEnabled !== false
      || !Number.isFinite(previous.budget.estimatedUsd) || previous.budget.estimatedUsd < 0
      || !Array.isArray(previous.results) || previous.results.length !== tasks.length) throw new Error("Resume report does not match this fixture/prompt/tool/profile set.");
    const seen = new Set<number>();
    for (const record of previous.results) {
      const task = tasks[record.taskIndex];
      if (!task || seen.has(record.taskIndex) || record.caseId !== task.test.id || record.profileId !== task.profile.id || record.repetition !== task.repetition
        || (record.status !== "completed" && record.status !== "budget_skipped")) throw new Error("Only a complete checkpoint with budget-skipped tasks can be resumed; failed requests need a separate run.");
      seen.add(record.taskIndex);
    }
    report.results = previous.results.filter((record) => record.status === "completed");
    report.budget.estimatedUsd = previous.budget.estimatedUsd;
    report.budget.requestsSent = previous.budget.requestsSent;
    report.budget.exhausted = report.budget.estimatedUsd >= report.budget.limitUsd;
  }
  const completed = new Set(report.results.map((record) => record.taskIndex));
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const taskIndex = next++;
      if (completed.has(taskIndex)) continue;
      const { test, profile, repetition } = tasks[taskIndex]!;
      const usage = emptyUsage();
      const record: EvalResult = { taskIndex, caseId: test.id, profileId: profile.id, repetition, status: "budget_skipped", elapsedMs: 0, requestCount: 0, responseTextRounds: [],
        usage, estimatedUsd: 0, contractErrors: [], warnings: [], proseReview: "pending" };
      if (!report.budget.exhausted) {
        const started = performance.now();
        const context = buildIntentContext(test);
        const sections = buildBrewDocumentSections(context);
        const client: MessagesClient = { messages: { create: async (params) => {
          if (report.budget.exhausted) throw new BudgetStopped();
          record.requestCount++;
          report.budget.requestsSent++;
          // Evaluation-only override: production thinkingSettings and the app's default remain unchanged.
          const response = await input.client.messages.create({ ...params, output_config: { ...params.output_config, effort: profile.effort } });
          record.responseTextRounds.push({ stopReason: response.stop_reason, text: response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n") });
          return response;
        } } };
        try {
          const result = await runAssistant({ client, model: profile.model, brief: buildAssistantBrief(context, sections), brewDocumentSections: sections, ...context,
            history: [...(test.history ?? []), { role: "user", content: test.question }], webSearchEnabled: false,
            loadBreweryHistory: async () => summarizeBreweryHistory([]),
            onUsage: (round) => {
              for (const key of Object.keys(usage) as (keyof AssistantUsage)[]) usage[key] += round[key];
              report.budget.estimatedUsd += estimateCostUsd(profile.model, round) ?? 0;
              report.budget.exhausted = report.budget.estimatedUsd >= report.budget.limitUsd;
            },
          });
          record.status = "completed";
          record.result = result;
          record.contractErrors = checkIntentActions(test.expectedReadings, result.actions, test.allowedOptionalEvents);
          if (result.stopReason !== "end_turn") record.contractErrors.push(`Unexpected stop reason: ${result.stopReason}`);
          if (!result.text.trim() || /^(?:Assistenten ga ikke noe svar|Assistenten kunne ikke svare|Assistenten brukte for mange)/.test(result.text)) record.contractErrors.push("Missing substantive answer.");
          if (test.requiresPlan && !result.toolCalls.includes("get_batch_section")) record.contractErrors.push("Required recipe-plan lookup was not made; fixture brief omits this detail.");
          record.wordCount = result.text.trim().split(/\s+/).filter(Boolean).length;
          if (record.wordCount > 160) record.warnings.push("Long for a phone (>160 words); review whether the extra detail was needed.");
        } catch (error) {
          record.status = "error";
          // Never serialise SDK errors, headers, request bodies or error.message into reports.
          const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" ? error.status : undefined;
          record.error = { type: error instanceof BudgetStopped ? "budget_stopped" : "api_error", ...(status === undefined ? {} : { status }) };
        }
        record.elapsedMs = Math.round(performance.now() - started);
        record.estimatedUsd = estimateCostUsd(profile.model, usage) ?? 0;
      }
      report.results.push(record);
      await input.onProgress?.(record, report);
    }
  }
  await Promise.all(Array.from({ length: input.options.concurrency }, worker));
  report.results.sort((a, b) => a.taskIndex - b.taskIndex);
  return report;
}

export function summarizeEvaluation(report: EvalReport) {
  return report.options.profiles.map((profile) => {
    const records = report.results.filter((result) => result.profileId === profile.id);
    const completed = records.filter((result) => result.status === "completed");
    const usage = emptyUsage();
    for (const record of records) for (const key of Object.keys(usage) as (keyof AssistantUsage)[]) usage[key] += record.usage[key];
    const durations = completed.map((result) => result.elapsedMs).sort((a, b) => a - b);
    return {
      ...profile, total: records.length, completed: completed.length, contractPassed: completed.filter((result) => !result.contractErrors.length).length,
      error: records.filter((result) => result.status === "error").length, skipped: records.filter((result) => result.status === "budget_skipped").length,
      meanElapsedMs: completed.length ? Math.round(completed.reduce((sum, result) => sum + result.elapsedMs, 0) / completed.length) : null,
      medianElapsedMs: durations.length ? durations[Math.floor(durations.length / 2)]! : null,
      meanWords: completed.length ? Math.round(completed.reduce((sum, result) => sum + (result.wordCount ?? 0), 0) / completed.length) : null,
      longAnswers: completed.filter((result) => result.warnings.length > 0).length,
      estimatedUsd: records.reduce((sum, result) => sum + result.estimatedUsd, 0), usage, proseReviewPending: completed.length,
    };
  });
}
