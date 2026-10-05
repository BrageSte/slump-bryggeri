import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { buildAssistantBrief, buildBrewDocumentSections } from "../src/domain/brew-document/brew-document.ts";
import { assistantIntentCases, checkIntentActions } from "../tests/fixtures/assistant-intent.ts";
import { makeBatch } from "../tests/helpers/batch.ts";
import { runAssistant, type AssistantUsage } from "../worker/assistant/run.ts";
import { estimateCostUsd } from "../worker/assistant/pricing.ts";

const caseFlag = process.argv.indexOf("--case");
const cases = caseFlag < 0 ? assistantIntentCases : assistantIntentCases.filter((test) => test.id === process.argv[caseFlag + 1]);
if (!cases.length) throw new Error("Unknown --case. Run without --live to list the case ids.");

/** Explicit opt-in. This never reads D1, writes a log, or sends production data. */
if (!process.argv.includes("--live")) {
  console.log("Synthetic intent cases (no API calls):");
  for (const test of cases) console.log(`${test.id}: ${test.question}\n  Logging: ${test.logging}. Review: ${test.review}`);
  console.log("Run npm run eval:assistant -- --live to use the existing Anthropic key (paid API calls, $1 estimated stop budget). Reports contain synthetic questions and answers only.");
  process.exit(0);
}

const modelFlag = process.argv.indexOf("--model");
const model = modelFlag >= 0 ? process.argv[modelFlag + 1] : "claude-sonnet-5-5";
if (model !== "claude-sonnet-5-5" && model !== "claude-haiku-4-5" && model !== "claude-opus-5-5") throw new Error("Choose a model with known pricing: claude-sonnet-5-5, claude-haiku-4-5 or claude-opus-5-5.");
const local: Record<string, string | undefined> = await readFile(".dev.vars", "utf8").then(parseEnv).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return {}; throw error; });
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || local.ANTHROPIC_API_KEY?.trim();
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing. Never put a key in the command line or report.");
const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 });
const now = Date.now();
const batch = makeBatch({ currentStage: "fermentation", stageStartedAt: now, status: "fermenting", splits: [] });
const context = { batch, timeline: [], now };
const sections = buildBrewDocumentSections(context);
const brief = buildAssistantBrief(context, sections);
let totalEstimatedUsd = 0;
let failed = false;
const results: unknown[] = [];
for (const test of cases) {
  const started = performance.now();
  const usage: AssistantUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
  try {
    const result = await runAssistant({ client, model, brief, brewDocumentSections: sections, batch, timeline: [],
      history: [{ role: "user", content: test.question }], webSearchEnabled: false,
      loadBreweryHistory: async () => ({ batches: [], note: "No other measured batches in this synthetic fixture." }),
      onUsage: (round) => {
        for (const key of Object.keys(usage) as (keyof AssistantUsage)[]) usage[key] += round[key];
        totalEstimatedUsd += estimateCostUsd(model, round) ?? 0;
        // Checked after each completed response: one response can overshoot this stop budget.
        if (totalEstimatedUsd >= 1) throw new Error("Estimated $1 stop budget reached.");
      },
    });
    const errors = checkIntentActions(test.logging, result.actions);
    if (result.stopReason !== "end_turn") errors.push(`Unexpected stop reason: ${result.stopReason}`);
    if (!result.text.trim() || result.text.startsWith("Assistenten ga ikke noe svar")) errors.push("Missing substantive answer.");
    failed ||= errors.length > 0;
    results.push({ ...test, result, errors, usage, estimatedUsd: estimateCostUsd(model, usage), elapsedMs: Math.round(performance.now() - started), proseReview: "pending human review" });
    console.log(`${test.id}: ${errors.length ? "FAIL" : "actions OK"} (${Math.round(performance.now() - started)} ms); prose needs review`);
  } catch (error) {
    failed = true;
    // Avoid serialising API errors: they can contain request headers.
    results.push({ id: test.id, error: error instanceof Anthropic.APIError ? { type: error.name, status: error.status } : { type: error instanceof Error ? error.name : "unknown" }, usage });
    console.log(`${test.id}: stopped after an API or budget error`);
    break;
  }
}
await mkdir("test-results", { recursive: true });
const path = `test-results/assistant-eval-${model}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await writeFile(path, JSON.stringify({ model, webSearchEnabled: false, createdAt: new Date().toISOString(), totalEstimatedUsd, results }, null, 2));
console.log(`Report: ${path}; estimated cost $${totalEstimatedUsd.toFixed(4)}. Inspect answers against the review criteria; action checks do not establish answer quality.`);
process.exitCode = failed ? 1 : 0;
