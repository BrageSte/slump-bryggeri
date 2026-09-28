import type Anthropic from "@anthropic-ai/sdk";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { MessagesClient } from "../../worker/assistant/run.ts";
import { createDb } from "../../worker/lib/db.ts";
import { askAssistant, getAssistantStatus } from "../../worker/services/assistant.ts";
import { createBrewery, createUser, type TestUser } from "./client.ts";

const answer: MessagesClient = {
  messages: {
    create: async () =>
      ({
        id: "m",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-5",
        content: [{ type: "text", text: "Mål temperaturen igjen om fem minutter." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 3000, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 2500 },
      }) as unknown as Anthropic.Message,
  },
};

describe("brewing assistant", () => {
  let alice: TestUser;
  let breweryId: string;
  let batchId: string;

  beforeAll(async () => {
    alice = await createUser("Alice Assistent");
    breweryId = await createBrewery(alice, "Assistentbryggeriet");
    const recipeId = (await alice.post(`/breweries/${breweryId}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    batchId = (await alice.post(`/breweries/${breweryId}/batches`, { recipeId })).body.id;
  });

  it("reports that it is not set up without an API key, instead of failing mid-brew", async () => {
    const status = await alice.get(`/breweries/${breweryId}/assistant`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ configured: false, model: "claude-sonnet-5", dailyLimit: 40, today: { requests: 0 } });

    const ask = await alice.post(`/breweries/${breweryId}/batches/${batchId}/assistant`, { messages: [{ role: "user", content: "Hei" }] });
    expect(ask.status).toBe(503);
    expect(ask.body.error.code).toBe("assistant_not_configured");
  });

  it("validates the conversation", async () => {
    const res = await alice.post(`/breweries/${breweryId}/batches/${batchId}/assistant`, {
      messages: [{ role: "user", content: "Hei" }, { role: "assistant", content: "Hei!" }],
    });
    expect(res.status).toBe(400);
  });

  it("records token usage per day and enforces the daily limit", async () => {
    const db = createDb(env.DB);
    const limited = { ...env, ANTHROPIC_API_KEY: "", ASSISTANT_DAILY_LIMIT: "1" };
    const now = Date.parse("2026-09-28T10:00:00Z");

    const reply = await askAssistant({ env: limited, db, breweryId, batchId, messages: [{ role: "user", content: "Hvordan går det?" }], client: answer, now });
    expect(reply.reply).toBe("Mål temperaturen igjen om fem minutter.");
    expect(reply.usage).toMatchObject({ inputTokens: 3000, outputTokens: 120, cacheWriteTokens: 2500 });
    expect(reply.usage.estimatedUsd).toBeGreaterThan(0);

    const status = await getAssistantStatus(limited, db, breweryId, now);
    expect(status.today).toMatchObject({ requests: 1, inputTokens: 3000, outputTokens: 120 });
    expect(status.month.requests).toBe(1);

    await expect(
      askAssistant({ env: limited, db, breweryId, batchId, messages: [{ role: "user", content: "Og nå?" }], client: answer, now }),
    ).rejects.toMatchObject({ status: 429, code: "assistant_daily_limit" });
    // A new day starts from zero.
    const tomorrow = await getAssistantStatus(limited, db, breweryId, now + 86_400_000);
    expect(tomorrow.today.requests).toBe(0);
  });

  it("reserves the final daily slot atomically for concurrent questions", async () => {
    const db = createDb(env.DB);
    const limited = { ...env, ANTHROPIC_API_KEY: "", ASSISTANT_DAILY_LIMIT: "1" };
    const now = Date.parse("2026-10-01T10:00:00Z");
    let calls = 0;
    const slowAnswer: MessagesClient = {
      messages: {
        create: async (params) => {
          calls += 1;
          await new Promise((resolve) => setTimeout(resolve, 20));
          return answer.messages.create(params);
        },
      },
    };
    const ask = () => askAssistant({
      env: limited,
      db,
      breweryId,
      batchId,
      messages: [{ role: "user", content: "Hvordan går det?" }],
      client: slowAnswer,
      now,
    });

    const results = await Promise.allSettled([ask(), ask()]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(calls).toBe(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: { status: 429, code: "assistant_daily_limit" } });
    expect((await getAssistantStatus(limited, db, breweryId, now)).today.requests).toBe(1);
  });
});
