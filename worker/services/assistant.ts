import Anthropic from "@anthropic-ai/sdk";
import { sql } from "kysely";
import { buildBrewDocument } from "../../src/domain/brew-document/brew-document.ts";
import type { AssistantReply, AssistantStatus, AssistantUsageSummary } from "../../src/domain/model/api.ts";
import { estimateCostUsd } from "../assistant/pricing.ts";
import { runAssistant, type AssistantUsage, type MessagesClient } from "../assistant/run.ts";
import type { DB } from "../lib/db.ts";
import { HttpError } from "../lib/errors.ts";
import { getBatch } from "./batches.ts";
import { getTimeline } from "./brew-log.ts";

const DEFAULT_MODEL = "claude-sonnet-5";
const DEFAULT_DAILY_LIMIT = 40;

type AssistantEnv = Pick<Env, "ANTHROPIC_API_KEY" | "ASSISTANT_MODEL" | "ASSISTANT_DAILY_LIMIT">;

export function assistantModel(env: AssistantEnv): string {
  return env.ASSISTANT_MODEL?.trim() || DEFAULT_MODEL;
}

function dailyLimit(env: AssistantEnv): number {
  const parsed = Number.parseInt(env.ASSISTANT_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function summarize(model: string, rows: { requests: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; model: string }[]): AssistantUsageSummary {
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let estimatedUsd: number | null = 0;
  for (const row of rows) {
    usage.requests += row.requests;
    usage.inputTokens += row.input_tokens;
    usage.outputTokens += row.output_tokens;
    usage.cacheReadTokens += row.cache_read_tokens;
    usage.cacheWriteTokens += row.cache_write_tokens;
    const cost = estimateCostUsd(row.model, {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
    });
    estimatedUsd = cost === null || estimatedUsd === null ? null : estimatedUsd + cost;
  }
  if (rows.length === 0) estimatedUsd = estimateCostUsd(model, usage) ?? null;
  return { ...usage, estimatedUsd };
}

export async function getAssistantStatus(env: AssistantEnv, db: DB, breweryId: string, now = Date.now()): Promise<AssistantStatus> {
  const model = assistantModel(env);
  const day = today(now);
  const rows = await db
    .selectFrom("assistant_usage")
    .selectAll()
    .where("brewery_id", "=", breweryId)
    .where("day", "like", `${day.slice(0, 7)}-%`)
    .execute();
  return {
    configured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    model,
    dailyLimit: dailyLimit(env),
    today: summarize(model, rows.filter((row) => row.day === day)),
    month: summarize(model, rows),
  };
}

async function recordUsage(db: DB, breweryId: string, model: string, usage: AssistantUsage, day: string): Promise<void> {
  await db
    .insertInto("assistant_usage")
    .values({
      brewery_id: breweryId,
      day,
      model,
      requests: 1,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_write_tokens: usage.cacheWriteTokens,
    })
    .onConflict((oc) =>
      oc.columns(["brewery_id", "day", "model"]).doUpdateSet({
        requests: sql`requests + 1`,
        input_tokens: sql`input_tokens + ${usage.inputTokens}`,
        output_tokens: sql`output_tokens + ${usage.outputTokens}`,
        cache_read_tokens: sql`cache_read_tokens + ${usage.cacheReadTokens}`,
        cache_write_tokens: sql`cache_write_tokens + ${usage.cacheWriteTokens}`,
      }),
    )
    .execute();
}

/** Turns Anthropic API errors into messages a brewer (or the admin setting it up) can act on. */
function toHttpError(error: unknown, model: string): unknown {
  if (error instanceof HttpError) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new HttpError(502, "assistant_key_rejected", "Anthropic avviste API-nøkkelen. Sjekk ANTHROPIC_API_KEY.");
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new HttpError(502, "assistant_model_unavailable", `Modellen «${model}» er ikke tilgjengelig for API-nøkkelen. Sjekk ASSISTANT_MODEL.`);
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new HttpError(429, "assistant_rate_limited", "Anthropic får for mange spørsmål akkurat nå. Vent litt og prøv igjen.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(error.message)) {
      return new HttpError(502, "assistant_no_credit", "Anthropic-kontoen er tom for kreditt. Fyll på i console.anthropic.com → Billing.");
    }
    console.error("assistant bad request", error.message);
    return new HttpError(502, "assistant_bad_request", "Anthropic avviste forespørselen. Se loggen til workeren.");
  }
  if (error instanceof Anthropic.APIError || error instanceof Anthropic.APIConnectionError) {
    console.error("assistant unavailable", error.message);
    return new HttpError(503, "assistant_unavailable", "Fikk ikke kontakt med Anthropic. Prøv igjen om litt.");
  }
  return error;
}

export async function askAssistant(input: {
  env: AssistantEnv;
  db: DB;
  breweryId: string;
  batchId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Injected in tests; defaults to the real SDK client. */
  client?: MessagesClient;
  now?: number;
}): Promise<AssistantReply> {
  const { env, db, breweryId } = input;
  const now = input.now ?? Date.now();
  const day = today(now);
  const model = assistantModel(env);

  // Scoped by brewery first: another brewery's batch id is a 404 whatever else is wrong.
  const [batch, timeline] = await Promise.all([getBatch(db, breweryId, input.batchId), getTimeline(db, breweryId, input.batchId)]);

  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey && !input.client) {
    throw new HttpError(503, "assistant_not_configured", "Assistenten er ikke satt opp: ANTHROPIC_API_KEY mangler.");
  }
  const status = await getAssistantStatus(env, db, breweryId, now);
  if (status.today.requests >= status.dailyLimit) {
    throw new HttpError(429, "assistant_daily_limit", `Dagens grense på ${status.dailyLimit} spørsmål er nådd. Den nullstilles ved midnatt (UTC).`);
  }

  const document = buildBrewDocument({ batch, timeline, now });
  const client = input.client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });

  const usage: AssistantUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let result;
  try {
    result = await runAssistant({
      client,
      model,
      document,
      history: input.messages,
      batch,
      onUsage: (round) => {
        usage.inputTokens += round.inputTokens;
        usage.outputTokens += round.outputTokens;
        usage.cacheReadTokens += round.cacheReadTokens;
        usage.cacheWriteTokens += round.cacheWriteTokens;
      },
    });
  } catch (error) {
    throw toHttpError(error, model);
  } finally {
    // Tokens are billed even when a later round fails, so count them either way.
    if (usage.inputTokens + usage.outputTokens > 0) await recordUsage(db, breweryId, model, usage, day);
  }

  return {
    reply: result.text,
    toolCalls: result.toolCalls,
    usage: { requests: 1, ...usage, estimatedUsd: estimateCostUsd(model, usage) },
  };
}
