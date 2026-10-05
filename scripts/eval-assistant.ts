import Anthropic from "@anthropic-ai/sdk";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseEnv } from "node:util";
import { selectIntentCases } from "../tests/fixtures/assistant-intent.ts";
import { parseEvalOptions } from "./assistant-eval/options.ts";
import { runIntentEvaluation, summarizeEvaluation, type EvalReport } from "./assistant-eval/runner.ts";

const options = parseEvalOptions(process.argv.slice(2));
const cases = selectIntentCases(options.caseId);
if (!cases.length) throw new Error("Unknown --case. Run without --live to list case ids.");
const count = cases.length * options.profiles.length * options.repeats;

/** No credential access or paid calls without an explicit live flag. */
if (!options.live) {
  console.log(`Dry run: ${cases.length} synthetic cases, ${options.profiles.length} Sonnet profiles, ${options.repeats} repetition(s) = ${count} questions. No API calls.`);
  for (const test of cases) console.log(`${test.id} [${test.category}]: ${test.question}\n  Expected proposals: ${test.expectedReadings.length}. Review: ${test.review}`);
  console.log("Use --live to run paid calls. --compare selects Sonnet medium/high; --repeats 3 repeats the same fixture set. --budget-usd controls the shared estimated stop budget (default $1). Haiku is no longer evaluated.");
  process.exit(0);
}
const local: Record<string, string | undefined> = await readFile(".dev.vars", "utf8").then(parseEnv).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return {}; throw error; });
const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || local.ANTHROPIC_API_KEY?.trim();
if (!apiKey) throw new Error("ANTHROPIC_API_KEY is missing. Never put a key in a command line or report.");
const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 60_000 });
const path = options.output ?? options.resume ?? `eval-results/assistant-eval-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
const previous = options.resume ? JSON.parse(await readFile(options.resume, "utf8")) as EvalReport : undefined;
await mkdir(dirname(path), { recursive: true });
let checkpoint = Promise.resolve();
function save(report: EvalReport) {
  const snapshot = JSON.stringify({ ...report, summary: summarizeEvaluation(report) }, null, 2);
  checkpoint = checkpoint.then(async () => { await writeFile(`${path}.tmp`, snapshot); await rename(`${path}.tmp`, path); });
  return checkpoint;
}
console.log(`Live: ${count} questions, ${options.concurrency} concurrent tasks, estimated $${options.budgetUsd} shared stop budget. Synthetic data only; web search disabled; no database writes.`);
const report = await runIntentEvaluation({ options, cases, client, previous, onProgress: async (record, partial) => {
  console.log(`${partial.results.length}/${count} ${record.profileId} r${record.repetition} ${record.caseId}: ${record.status}${record.contractErrors.length ? ` FAIL ${record.contractErrors.join(" ")}` : ""}; ${record.wordCount ?? 0} words; total ~$${partial.budget.estimatedUsd.toFixed(3)}`);
  await save(partial);
} });
await save(report);
console.log(JSON.stringify(summarizeEvaluation(report), null, 2));
console.log(`Report: ${path}. Prose needs separate review; contract checks do not establish answer quality. The estimated stop budget is checked between calls, so in-flight responses can overshoot it.`);
process.exitCode = report.results.some((result) => result.status !== "completed" || result.contractErrors.length) ? 1 : 0;
