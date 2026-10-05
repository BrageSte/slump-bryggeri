import Anthropic from "@anthropic-ai/sdk";
import { sql } from "kysely";
import { buildAssistantBrief, buildBrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import { buildBreweryBrief } from "../../src/domain/brew-document/brewery-brief.ts";
import type { AssistantReply, AssistantStatus, AssistantUsageSummary } from "../../src/domain/model/api.ts";
import type { ProfileValueSources, ProfileValues } from "../../src/domain/model/equipment-profile.ts";
import { slumpBaseWater } from "../../src/domain/water/slump-water.ts";
import { estimateCostUsd } from "../assistant/pricing.ts";
import { runAssistant, type AssistantUsage, type MessagesClient } from "../assistant/run.ts";
import type { DB } from "../lib/db.ts";
import { HttpError, notFound } from "../lib/errors.ts";
import { getBatch } from "./batches.ts";
import { getTimeline } from "./brew-log.ts";
import { loadBreweryHistory } from "./brewery-history.ts";
import { getActiveProfile } from "./equipment.ts";
import { listRecipeDocuments } from "./recipes.ts";

const DEFAULT_MODEL = "claude-sonnet-5-5";
const DEFAULT_DAILY_LIMIT = 40;

export type AssistantEnv = Pick<Env, "ANTHROPIC_API_KEY" | "ASSISTANT_MODEL" | "ASSISTANT_DAILY_LIMIT" | "ASSISTANT_WEB_SEARCH">;

export function assistantModel(env: AssistantEnv): string {
  return env.ASSISTANT_MODEL?.trim() || DEFAULT_MODEL;
}

function dailyLimit(env: AssistantEnv): number {
  const parsed = Number.parseInt(env.ASSISTANT_DAILY_LIMIT ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DAILY_LIMIT;
}

function webSearchEnabled(env: AssistantEnv): boolean {
  return env.ASSISTANT_WEB_SEARCH?.trim().toLowerCase() !== "off";
}

const today = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

function summarize(model: string, rows: { requests: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; web_search_requests: number; model: string }[]): AssistantUsageSummary {
  const usage = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
  let estimatedUsd: number | null = 0;
  for (const row of rows) {
    usage.requests += row.requests;
    usage.inputTokens += row.input_tokens;
    usage.outputTokens += row.output_tokens;
    usage.cacheReadTokens += row.cache_read_tokens;
    usage.cacheWriteTokens += row.cache_write_tokens;
    usage.webSearchRequests += row.web_search_requests;
    const cost = estimateCostUsd(row.model, {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheWriteTokens: row.cache_write_tokens,
      webSearchRequests: row.web_search_requests,
    });
    estimatedUsd = cost === null || estimatedUsd === null ? null : estimatedUsd + cost;
  }
  if (rows.length === 0) estimatedUsd = estimateCostUsd(model, usage) ?? null;
  return { ...usage, estimatedUsd };
}

export async function getAssistantStatus(env: AssistantEnv, db: DB, breweryId: string, now = Date.now()): Promise<AssistantStatus> {
  const model = assistantModel(env);
  const day = today(now);
  const monthPrefix = `${day.slice(0, 7)}-%`;
  const [usageRows, requestRows] = await Promise.all([
    db.selectFrom("assistant_usage").selectAll().where("brewery_id", "=", breweryId).where("day", "like", monthPrefix).execute(),
    db.selectFrom("assistant_daily_requests").selectAll().where("brewery_id", "=", breweryId).where("day", "like", monthPrefix).execute(),
  ]);
  const todayUsage = summarize(model, usageRows.filter((row) => row.day === day));
  todayUsage.requests = requestRows.find((row) => row.day === day)?.requests ?? 0;
  const monthUsage = summarize(model, usageRows);
  monthUsage.requests = requestRows.reduce((total, row) => total + row.requests, 0);
  return {
    configured: Boolean(env.ANTHROPIC_API_KEY?.trim()),
    model,
    dailyLimit: dailyLimit(env),
    today: todayUsage,
    month: monthUsage,
  };
}

/** Reserves a daily slot atomically, including across simultaneous requests and model changes. */
async function reserveDailyRequest(db: DB, breweryId: string, day: string, limit: number): Promise<boolean> {
  const result = await sql<{ requests: number }>`
    INSERT INTO assistant_daily_requests (brewery_id, day, requests)
    VALUES (${breweryId}, ${day}, 1)
    ON CONFLICT (brewery_id, day) DO UPDATE SET requests = requests + 1
    WHERE requests < ${limit}
    RETURNING requests
  `.execute(db);
  return result.rows.length > 0;
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
      web_search_requests: usage.webSearchRequests,
    })
    .onConflict((oc) =>
      oc.columns(["brewery_id", "day", "model"]).doUpdateSet({
        requests: sql`requests + 1`,
        input_tokens: sql`input_tokens + ${usage.inputTokens}`,
        output_tokens: sql`output_tokens + ${usage.outputTokens}`,
        cache_read_tokens: sql`cache_read_tokens + ${usage.cacheReadTokens}`,
        cache_write_tokens: sql`cache_write_tokens + ${usage.cacheWriteTokens}`,
        web_search_requests: sql`web_search_requests + ${usage.webSearchRequests}`,
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

type RunScope = Pick<Parameters<typeof runAssistant>[0], "batch" | "timeline" | "brewDocumentSections" | "brewery" | "loadBreweryHistory">;

/** The batch thread's grounding: the batch's own brew document, snapshots and log. */
async function batchScope(db: DB, breweryId: string, batchId: string, now: number, history?: () => Promise<unknown>): Promise<{ brief: string; scope: RunScope }> {
  // Scoped by brewery first: another brewery's batch id is a 404 whatever else is wrong.
  const [batch, timeline] = await Promise.all([getBatch(db, breweryId, batchId), getTimeline(db, breweryId, batchId)]);
  const documentInput = { batch, timeline, now };
  const brewDocumentSections = buildBrewDocumentSections(documentInput);
  return {
    brief: buildAssistantBrief(documentInput, brewDocumentSections),
    scope: {
      batch,
      timeline,
      brewDocumentSections,
      // Loaded only if the model asks for it; scoped to this brewery, excluding the batch in question.
      loadBreweryHistory: history ?? (() => loadBreweryHistory(db, breweryId, { excludeBatchId: batchId })),
    },
  };
}

/** The brewery thread's grounding: the active equipment profile, the base water and the recipes of this brewery only. */
async function breweryScope(db: DB, breweryId: string, history?: () => Promise<unknown>): Promise<{ brief: string; scope: RunScope }> {
  const [brewery, profile, recipes] = await Promise.all([
    db.selectFrom("breweries").select("name").where("id", "=", breweryId).executeTakeFirst(),
    getActiveProfile(db, breweryId),
    listRecipeDocuments(db, breweryId),
  ]);
  if (!brewery) throw notFound("Bryggeriet");
  const entries = Object.entries(profile?.values ?? {});
  const equipmentValues = Object.fromEntries(entries.map(([key, entry]) => [key, entry.value])) as ProfileValues;
  const equipmentSources = Object.fromEntries(entries.map(([key, entry]) => [key, entry.source])) as ProfileValueSources;
  return {
    brief: buildBreweryBrief({
      breweryName: brewery.name,
      equipment: profile ? { name: profile.name, version: profile.version, values: profile.values } : null,
      baseWater: slumpBaseWater,
      recipes: recipes.map(({ name, style }) => ({ name, style })),
    }),
    scope: {
      brewery: {
        equipmentValues,
        equipmentSources,
        sourceWater: slumpBaseWater,
        // The list is the brewery's own, so a recipe id from anywhere else is simply not found.
        listRecipes: async () => recipes,
        getRecipe: async (recipeId) => recipes.find((recipe) => recipe.id === recipeId) ?? null,
      },
      loadBreweryHistory: history ?? (() => loadBreweryHistory(db, breweryId)),
    },
  };
}

export async function askAssistant(input: {
  env: AssistantEnv;
  db: DB;
  breweryId: string;
  /** The batch whose thread this is; null for the brewery's own thread (recipes, equipment, history). */
  batchId: string | null;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Injected in tests; defaults to the real SDK client. */
  client?: MessagesClient;
  /** Injected in tests; defaults to the brewery's own batch history. */
  loadBreweryHistory?: () => Promise<unknown>;
  now?: number;
}): Promise<AssistantReply> {
  const { env, db, breweryId } = input;
  const now = input.now ?? Date.now();
  const day = today(now);
  const model = assistantModel(env);

  const { brief, scope } =
    input.batchId === null
      ? await breweryScope(db, breweryId, input.loadBreweryHistory)
      : await batchScope(db, breweryId, input.batchId, now, input.loadBreweryHistory);

  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey && !input.client) {
    throw new HttpError(503, "assistant_not_configured", "Assistenten er ikke satt opp: ANTHROPIC_API_KEY mangler.");
  }
  if (!(await reserveDailyRequest(db, breweryId, day, dailyLimit(env)))) {
    throw new HttpError(429, "assistant_daily_limit", `Dagens grense på ${dailyLimit(env)} spørsmål er nådd. Den nullstilles ved midnatt (UTC).`);
  }

  const client = input.client ?? new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });

  const usage: AssistantUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, webSearchRequests: 0 };
  let result;
  try {
    result = await runAssistant({
      client,
      model,
      brief,
      ...scope,
      history: input.messages,
      webSearchEnabled: webSearchEnabled(env),
      onUsage: (round) => {
        usage.inputTokens += round.inputTokens;
        usage.outputTokens += round.outputTokens;
        usage.cacheReadTokens += round.cacheReadTokens;
        usage.cacheWriteTokens += round.cacheWriteTokens;
        usage.webSearchRequests += round.webSearchRequests;
      },
    });
  } catch (error) {
    throw toHttpError(error, model);
  } finally {
    // Tokens are billed even when a later round fails, so count them either way.
    if (usage.inputTokens + usage.outputTokens + usage.webSearchRequests > 0) await recordUsage(db, breweryId, model, usage, day);
  }

  return {
    reply: result.text,
    actions: result.actions,
    toolCalls: result.toolCalls,
    citations: result.citations,
    usage: { requests: 1, ...usage, estimatedUsd: estimateCostUsd(model, usage) },
  };
}
