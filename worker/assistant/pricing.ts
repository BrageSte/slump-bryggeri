import type { AssistantUsage } from "./run.ts";

/**
 * Anthropic list prices in USD per million tokens (October 2026). Cache reads cost 0.1× (Opus 5.5: 0.05×) and
 * 5-minute cache writes 1.25× the input price. Used only to show an estimate in the app; the
 * invoice in the Anthropic Console is the real number.
 */
const pricesPerMTok: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-5-5": { input: 4, output: 20 },
};

export function estimateCostUsd(model: string, usage: AssistantUsage): number | null {
  const price = pricesPerMTok[model];
  if (!price) return null;
  const cacheReadMultiplier = model === "claude-opus-5-5" ? 0.05 : 0.1;
  const inputCost =
    usage.inputTokens * price.input + usage.cacheReadTokens * price.input * cacheReadMultiplier + usage.cacheWriteTokens * price.input * 1.25;
  return (inputCost + usage.outputTokens * price.output) / 1_000_000 + usage.webSearchRequests * 10 / 1_000;
}
