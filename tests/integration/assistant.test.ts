import type Anthropic from "@anthropic-ai/sdk";
import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { calculateRecipeMetrics } from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { MessagesClient } from "../../worker/assistant/run.ts";
import { createDb } from "../../worker/lib/db.ts";
import { askAssistant, getAssistantStatus } from "../../worker/services/assistant.ts";
import { getAssistantThread, sendAssistantMessage } from "../../worker/services/assistant-thread.ts";
import { addMember, createBrewery, createUser, type TestUser } from "./client.ts";

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
    expect(status.body).toMatchObject({ configured: false, model: "claude-sonnet-5-5", dailyLimit: 40, today: { requests: 0 } });

    const ask = await alice.post(`/breweries/${breweryId}/batches/${batchId}/assistant/messages`, { content: "Hei" });
    expect(ask.status).toBe(503);
    expect(ask.body.error.code).toBe("assistant_not_configured");
    const thread = await alice.get(`/breweries/${breweryId}/batches/${batchId}/assistant/messages`);
    expect(thread.body.messages).toContainEqual(expect.objectContaining({ role: "user", content: "Hei", author: { id: alice.id, name: alice.name } }));
  });

  it("validates a new thread message", async () => {
    const res = await alice.post(`/breweries/${breweryId}/batches/${batchId}/assistant/messages`, { content: "  " });
    expect(res.status).toBe(400);
  });

  it("persists cited web sources and prices reported search requests", async () => {
    const user = await createUser("Source brewer");
    const brewery = await createBrewery(user, "Source test");
    const recipe = (await user.post(`/breweries/${brewery}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const batch = (await user.post(`/breweries/${brewery}/batches`, { recipeId: recipe })).body.id;
    const citation = {
      type: "web_search_result_location",
      url: "https://www.fermentis.com/en/product/safale-us-05/",
      title: "SafAle US-05",
      encrypted_index: "citation-index",
      cited_text: "Attenuation: 78–82%",
    };
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          return {
            id: "citation-message",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [{ type: "text", text: "Fermentis oppgir 78–82 % utgjæring.", citations: [citation] }],
            stop_reason: "end_turn",
            usage: {
              input_tokens: 100,
              output_tokens: 20,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              server_tool_use: { web_fetch_requests: 0, web_search_requests: 1 },
            },
          } as unknown as Anthropic.Message;
        },
      },
    };
    const db = createDb(env.DB);
    const now = Date.parse("2026-10-02T10:00:00Z");
    const response = await sendAssistantMessage({
      env: { ...env, ANTHROPIC_API_KEY: "", ASSISTANT_WEB_SEARCH: "on" },
      db,
      breweryId: brewery,
      batchId: batch,
      user: { id: user.id, name: user.name, email: user.email },
      content: "Hva er utgjæringen for US-05?",
      client,
      now,
    });

    expect(requests[0]!.tools?.some((tool) => tool.type === "web_search_20260209")).toBe(true);
    expect(response.messages[1]!.citations).toEqual([{ url: citation.url, title: citation.title }]);
    expect(response.usage).toMatchObject({ webSearchRequests: 1, estimatedUsd: expect.any(Number) });
    expect(response.usage.estimatedUsd).toBeGreaterThan(0.01);
    const thread = await getAssistantThread(db, brewery, batch);
    expect(thread.messages[1]!.citations).toEqual([{ url: citation.url, title: citation.title }]);
    const stored = await db
      .selectFrom("assistant_messages")
      .select("citations")
      .where("brewery_id", "=", brewery)
      .where("batch_id", "=", batch)
      .where("role", "=", "assistant")
      .executeTakeFirstOrThrow();
    expect(JSON.parse(stored.citations!)).toEqual([{ url: citation.url, title: citation.title }]);
    expect((await getAssistantStatus({ ...env, ASSISTANT_WEB_SEARCH: "on" }, db, brewery, now)).today.webSearchRequests).toBe(1);
  });

  it("omits web search when ASSISTANT_WEB_SEARCH is off", async () => {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          return answer.messages.create(params);
        },
      },
    };
    await askAssistant({
      env: { ...env, ANTHROPIC_API_KEY: "", ASSISTANT_WEB_SEARCH: "off" },
      db: createDb(env.DB),
      breweryId,
      batchId,
      messages: [{ role: "user", content: "Hvordan går det?" }],
      client,
      now: Date.parse("2026-10-03T10:00:00Z"),
    });
    expect(requests[0]!.tools?.some((tool) => tool.type === "web_search_20260209")).toBe(false);
  });

  it("loads model history from the shared stored thread", async () => {
    const person = await createUser("ThreadAuthor");
    const brewery = await createBrewery(person, "Delt assistenttråd");
    const recipe = (await person.post(`/breweries/${brewery}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const batch = (await person.post(`/breweries/${brewery}/batches`, { recipeId: recipe })).body.id;
    const secondPerson = await createUser("ThreadMember");
    await addMember(person, brewery, secondPerson);
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const texts = ["Første svar", "Andre svar"];
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const text = texts.shift()!;
          return {
            id: "thread-message",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } as unknown as Anthropic.Message;
        },
      },
    };
    const db = createDb(env.DB);
    const now = Date.parse("2026-09-28T10:00:00Z");
    await sendAssistantMessage({ env, db, breweryId: brewery, batchId: batch, user: { id: person.id, name: person.name, email: person.email }, content: "Første spørsmål", client, now });
    await sendAssistantMessage({ env, db, breweryId: brewery, batchId: batch, user: { id: secondPerson.id, name: secondPerson.name, email: secondPerson.email }, content: "Andre spørsmål", client, now: now + 10 });

    const stored = await getAssistantThread(db, brewery, batch);
    expect(stored.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "Første spørsmål" },
      { role: "assistant", content: "Første svar" },
      { role: "user", content: "Andre spørsmål" },
      { role: "assistant", content: "Andre svar" },
    ]);
    expect(stored.messages[1]!.author).toBeNull();
    const persisted = await db
      .selectFrom("assistant_messages")
      .select(["role", "created_by", "actions", "created_at"])
      .where("brewery_id", "=", brewery)
      .where("batch_id", "=", batch)
      .orderBy("created_at")
      .execute();
    expect(persisted.map((message) => [message.role, message.created_by, message.actions])).toEqual([
      ["user", person.id, null],
      ["assistant", null, null],
      ["user", secondPerson.id, null],
      ["assistant", null, null],
    ]);
    expect(requests[1]!.messages).toEqual(stored.messages.slice(0, 3).map(({ role, content }) => ({ role, content })));
    const shared = await secondPerson.get(`/breweries/${brewery}/batches/${batch}/assistant/messages`);
    expect(shared.body.messages[0].author).toEqual({ id: person.id, name: person.name });
    expect(shared.body.messages[2].author).toEqual({ id: secondPerson.id, name: secondPerson.name });
    const backup = await person.get(`/breweries/${brewery}/export`);
    expect(backup.body.tables.assistant_messages).toHaveLength(4);
  });

  it("stores proposals without executing them and PATCH records who handled them", async () => {
    const user = await createUser("Action brewer");
    const brewery = await createBrewery(user, "Action test");
    const recipe = (await user.post(`/breweries/${brewery}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const batch = (await user.post(`/breweries/${brewery}/batches`, { recipeId: recipe })).body.id;
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          const toolRound = params.messages.length === 1;
          return {
            id: "proposal-message",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            content: toolRound
              ? [{ type: "tool_use", id: "proposal", name: "propose_actions", input: { answer: "Målingen ligger klar til bekreftelse.", actions: [
                  { kind: "log_measurement", measurementKind: "temperature", value: 64, unit: "°C", label: "Mesketemperatur" },
                  { kind: "start_timer", label: "Mesk", durationMin: 10 },
                ] } }]
              : [{ type: "text", text: "Jeg foreslår å logge temperaturen." }],
            stop_reason: toolRound ? "tool_use" : "end_turn",
            usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } as unknown as Anthropic.Message;
        },
      },
    };
    const response = await sendAssistantMessage({
      env,
      db: createDb(env.DB),
      breweryId: brewery,
      batchId: batch,
      user: { id: user.id, name: user.name, email: user.email },
      content: "Mesken holder 64 grader.",
      client,
    });
    const assistant = response.messages[1]!;
    expect(assistant.actions?.map((action) => action.status)).toEqual(["pending", "pending"]);
    expect((await user.get(`/breweries/${brewery}/batches/${batch}/timeline`)).body).toEqual([]);

    const patched = await user.patch(`/breweries/${brewery}/batches/${batch}/assistant/messages/${assistant.id}/actions/0`, { status: "done", logEntryId: "client-log-id" });
    expect(patched.status).toBe(204);
    const dismissed = await user.patch(`/breweries/${brewery}/batches/${batch}/assistant/messages/${assistant.id}/actions/1`, { status: "dismissed" });
    expect(dismissed.status).toBe(204);
    const thread = await user.get(`/breweries/${brewery}/batches/${batch}/assistant/messages`);
    expect(thread.body.messages[1].actions[0]).toMatchObject({
      status: "done",
      resolvedBy: { id: user.id, name: user.name },
      resolvedAt: expect.any(Number),
      logEntryId: "client-log-id",
    });
    expect(thread.body.messages[1].actions[1]).toMatchObject({ status: "dismissed", resolvedBy: { id: user.id, name: user.name }, resolvedAt: expect.any(Number) });
    expect((await user.get(`/breweries/${brewery}/batches/${batch}/timeline`)).body).toEqual([]);
  });

  it("stores the advice from a tool-use turn in the shared thread, ahead of its logging acknowledgement", async () => {
    const user = await createUser("Full answer brewer");
    const brewery = await createBrewery(user, "Full answer test");
    const recipe = (await user.post(`/breweries/${brewery}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const batch = (await user.post(`/breweries/${brewery}/batches`, { recipeId: recipe })).body.id;
    let round = 0;
    const client: MessagesClient = { messages: { create: async () => ({
      id: `answer-${round}`, type: "message", role: "assistant", model: "claude-sonnet-5-5",
      content: round++ === 0 ? [
        { type: "text", text: "18 °C følger planen. Vent med å øke, og mål SG før du vurderer gjæringen." },
        { type: "tool_use", id: "proposal", name: "propose_actions", input: { answer: "18 °C følger planen. Vent med å øke, og mål SG før du vurderer gjæringen.", actions: [{ kind: "log_measurement", measurementKind: "temperature", value: 18, unit: "°C" }] } },
      ] : [{ type: "text", text: "Målingen ligger klar til bekreftelse." }],
      stop_reason: round === 1 ? "tool_use" : "end_turn", usage: { input_tokens: 100, output_tokens: 20 },
    }) as Anthropic.Message } };
    await sendAssistantMessage({ env, db: createDb(env.DB), breweryId: brewery, batchId: batch, user, content: "Vi målte 18. Bør vi øke, og hva bør vi måle?", client });
    const thread = (await user.get(`/breweries/${brewery}/batches/${batch}/assistant/messages`)).body.messages;
    expect(thread[1].content).toBe("18 °C følger planen. Vent med å øke, og mål SG før du vurderer gjæringen.");
    expect(thread[1].actions).toHaveLength(1);
    expect((await user.get(`/breweries/${brewery}/batches/${batch}/timeline`)).body).toEqual([]);
  });

  it("records token usage per day and enforces the daily limit", async () => {
    const db = createDb(env.DB);
    const limited = { ...env, ANTHROPIC_API_KEY: "", ASSISTANT_DAILY_LIMIT: "1" };
    const now = Date.parse("2026-09-28T10:00:00Z");
    let cachedBrief = "";
    const capturingAnswer: MessagesClient = {
      messages: {
        create: async (params) => {
          const cachedBlock = Array.isArray(params.system)
            ? params.system.findLast((block) => typeof block !== "string" && block.type === "text" && block.cache_control?.type === "ephemeral")
            : undefined;
          if (cachedBlock && typeof cachedBlock !== "string") cachedBrief = cachedBlock.text;
          return answer.messages.create(params);
        },
      },
    };

    const reply = await askAssistant({ env: limited, db, breweryId, batchId, messages: [{ role: "user", content: "Hvordan går det?" }], client: capturingAnswer, now });
    expect(reply.reply).toBe("Mål temperaturen igjen om fem minutter.");
    expect(reply.usage).toMatchObject({ inputTokens: 3000, outputTokens: 120, cacheWriteTokens: 2500 });
    expect(reply.usage.estimatedUsd).toBeGreaterThan(0);
    expect(cachedBrief).toContain("Hentbare seksjoner:");
    expect(cachedBrief).toContain("## Status nå");
    expect(cachedBrief).not.toContain("## Plan og mål");
    expect(cachedBrief).not.toContain("## Logg");

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

describe("brewing assistant: brewery history tool", () => {
  it("answers brewery_history with this brewery's other batches only", async () => {
    const alice = await createUser("Alice Historikk");
    const bob = await createUser("Bob Historikk");
    const breweryA = await createBrewery(alice, "Historikk A");
    const breweryB = await createBrewery(bob, "Historikk B");
    const recipeA = (await alice.post(`/breweries/${breweryA}/recipes`, { recipe: { ...sunsetIpaRecipe, name: "Eldre øl A" } })).body.id;
    const olderA = (await alice.post(`/breweries/${breweryA}/batches`, { recipeId: recipeA, name: "Eldre batch A" })).body.id;
    const currentA = (await alice.post(`/breweries/${breweryA}/batches`, { recipeId: recipeA, name: "Denne batchen" })).body.id;
    const recipeB = (await bob.post(`/breweries/${breweryB}/recipes`, { recipe: { ...sunsetIpaRecipe, name: "Bobs øl" } })).body.id;
    await bob.post(`/breweries/${breweryB}/batches`, { recipeId: recipeB, name: "Bobs batch" });

    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const scripted = [
      { content: [{ type: "tool_use", id: "h1", name: "brewery_history", input: {} }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Ingen målinger ennå." }], stop_reason: "end_turn" },
    ];
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const next = scripted.shift()!;
          return {
            id: "m",
            type: "message",
            role: "assistant",
            model: "claude-sonnet-5",
            ...next,
            usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          } as unknown as Anthropic.Message;
        },
      },
    };

    const reply = await askAssistant({
      env: { ...env, ANTHROPIC_API_KEY: "" },
      db: createDb(env.DB),
      breweryId: breweryA,
      batchId: currentA,
      messages: [{ role: "user", content: "Hva er normal fordampning for oss?" }],
      client,
    });
    expect(reply.toolCalls).toEqual(["brewery_history"]);
    const result = (requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!;
    expect(result.is_error).toBe(false);
    const text = String(result.content);
    expect(text).toContain(olderA);
    expect(text).not.toContain(currentA);
    expect(text).not.toContain("Bobs batch");
  });
});

describe("brewing assistant: brewery thread", () => {
  const usage = { input_tokens: 200, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

  /** Plays back scripted model turns and records every request. */
  function scripted(turns: { content: unknown[]; stop_reason: string }[]) {
    const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
    const client: MessagesClient = {
      messages: {
        create: async (params) => {
          requests.push(structuredClone(params));
          const next = turns.shift();
          if (!next) throw new Error("no more scripted turns");
          return { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5", ...next, usage } as unknown as Anthropic.Message;
        },
      },
    };
    return { client, requests };
  }

  const designInput = (extra: Record<string, unknown> = {}) => ({
    name: "Hazy IPA",
    targets: { og: 1.062, ibu: 35 },
    fermentables: [
      { name: "Pilsnermalt", type: "grain", sharePct: 90, yieldPct: 81 },
      { name: "Havre", type: "adjunct", sharePct: 10, yieldPct: 70 },
    ],
    hops: [
      { name: "Magnum", use: "boil", alphaPct: 12, timeMin: 60, ibuSharePct: 100 },
      { name: "Citra", use: "dry_hop", gramsPerL: 5 },
    ],
    mashSteps: [{ name: "Hovedmesk", temperatureC: 67, durationMin: 60 }],
    fermentationSteps: [{ name: "Primær", temperatureC: 20, durationDays: 10 }],
    ...extra,
  });

  const person = (u: TestUser) => ({ id: u.id, name: u.name, email: u.email });

  it("keeps the brewery thread apart from the batch threads and stores it without a batch", async () => {
    const user = await createUser("Tråd Trine");
    const brewery = await createBrewery(user, "Tråd-bryggeriet");
    const recipe = (await user.post(`/breweries/${brewery}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const batch = (await user.post(`/breweries/${brewery}/batches`, { recipeId: recipe })).body.id;
    const db = createDb(env.DB);
    const { client } = scripted([
      { content: [{ type: "text", text: "Svar i batchtråden." }], stop_reason: "end_turn" },
      { content: [{ type: "text", text: "Svar om oppskrifter." }], stop_reason: "end_turn" },
    ]);

    await sendAssistantMessage({ env, db, breweryId: brewery, batchId: batch, user: person(user), content: "Spørsmål om batchen", client });
    const reply = await sendAssistantMessage({ env, db, breweryId: brewery, batchId: null, user: person(user), content: "Spørsmål om oppskrifter", client });
    expect(reply.messages.map((m) => m.content)).toEqual(["Spørsmål om oppskrifter", "Svar om oppskrifter."]);

    const brewerySide = await user.get(`/breweries/${brewery}/assistant/messages`);
    const batchSide = await user.get(`/breweries/${brewery}/batches/${batch}/assistant/messages`);
    expect(brewerySide.status).toBe(200);
    expect(brewerySide.body.messages.map((m: { content: string }) => m.content)).toEqual(["Spørsmål om oppskrifter", "Svar om oppskrifter."]);
    expect(batchSide.body.messages.map((m: { content: string }) => m.content)).toEqual(["Spørsmål om batchen", "Svar i batchtråden."]);

    const rows = await db.selectFrom("assistant_messages").select(["batch_id", "brewery_id"]).where("brewery_id", "=", brewery).execute();
    expect(rows.filter((row) => row.batch_id === null)).toHaveLength(2);
    expect(rows.filter((row) => row.batch_id === batch)).toHaveLength(2);
    expect((await user.get(`/breweries/${brewery}/export`)).body.tables.assistant_messages).toHaveLength(4);
  });

  it("saves the question even when the assistant is not set up, like the batch thread", async () => {
    const user = await createUser("Tråd Uten Nøkkel");
    const brewery = await createBrewery(user, "Uten nøkkel");
    const ask = await user.post(`/breweries/${brewery}/assistant/messages`, { content: "Lag en pils" });
    expect(ask.status).toBe(503);
    expect(ask.body.error.code).toBe("assistant_not_configured");
    expect((await user.get(`/breweries/${brewery}/assistant/messages`)).body.messages).toEqual([
      expect.objectContaining({ role: "user", content: "Lag en pils", author: { id: user.id, name: user.name } }),
    ]);
    expect((await user.post(`/breweries/${brewery}/assistant/messages`, { content: "  " })).status).toBe(400);
  });

  it("starts from a brief with the equipment profile, the base water and this brewery's recipes", async () => {
    const user = await createUser("Brief Berit");
    const brewery = await createBrewery(user, "Brief-bryggeriet");
    await user.post(`/breweries/${brewery}/recipes`, { recipe: { ...sunsetIpaRecipe, name: "Berits IPA" } });
    const other = await createUser("Brief Annen");
    const otherBrewery = await createBrewery(other, "Annet bryggeri");
    await other.post(`/breweries/${otherBrewery}/recipes`, { recipe: { ...sunsetIpaRecipe, name: "Skjult oppskrift" } });

    const { client, requests } = scripted([{ content: [{ type: "text", text: "Ok." }], stop_reason: "end_turn" }]);
    await askAssistant({ env: { ...env, ANTHROPIC_API_KEY: "" }, db: createDb(env.DB), breweryId: brewery, batchId: null, messages: [{ role: "user", content: "Hei" }], client });

    const system = requests[0]!.system as { type: "text"; text: string; cache_control?: unknown }[];
    expect(system[0]!.text).toContain("not about one batch");
    const brief = system[1]!.text;
    expect(system[1]!.cache_control).toEqual({ type: "ephemeral" });
    expect(brief).toContain("# Bryggeriet: Brief-bryggeriet");
    expect(brief).toMatch(/## Utstyrsprofil \(versjon 1/);
    expect(brief).toContain("Brygghuseffektivitet: 72 %");
    expect(brief).toContain("Holsfjorden");
    expect(brief).toContain("1 oppskrifter. Nyeste: Berits IPA");
    expect(brief).not.toContain("Skjult oppskrift");
  });

  it("returns a recipe draft built by the app, stores it as pending, and saves no recipe", async () => {
    const user = await createUser("Utkast Ulrik");
    const brewery = await createBrewery(user, "Utkast-bryggeriet");
    const base = (await user.post(`/breweries/${brewery}/recipes`, { recipe: { ...sunsetIpaRecipe, name: "Grunnlaget" } })).body.id;
    const { client, requests } = scripted([
      { content: [{ type: "tool_use", id: "l", name: "list_recipes", input: {} }], stop_reason: "tool_use" },
      { content: [{ type: "tool_use", id: "d", name: "design_recipe", input: designInput({ basedOnRecipeId: base }) }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Her er et utkast." }], stop_reason: "end_turn" },
    ]);
    const response = await sendAssistantMessage({ env, db: createDb(env.DB), breweryId: brewery, batchId: null, user: person(user), content: "Lag en hazy IPA", client });

    expect(response.toolCalls).toEqual(["list_recipes", "design_recipe"]);
    const listed = JSON.parse(String((requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[])[0]!.content));
    expect(listed.recipes).toEqual([expect.objectContaining({ id: base, name: "Grunnlaget" })]);

    const assistant = response.messages[1]!;
    expect(assistant.actions).toHaveLength(1);
    const draft = assistant.actions![0]!;
    expect(draft).toMatchObject({ kind: "recipe_draft", baseRecipeId: base, status: "pending", resolvedBy: null, logEntryId: null });
    if (draft.kind !== "recipe_draft") throw new Error("expected a recipe draft");
    // The brewery's own batch size (60 L) and efficiency come from the base recipe, and the amounts from the app.
    expect(draft.recipe).toMatchObject({ name: "Hazy IPA", batchSizeL: 60, efficiencyPct: 60 });
    expect(draft.recipe.hops.find((h) => h.use === "dry_hop")!.amountG).toBe(300);
    expect(calculateRecipeMetrics(draft.recipe).og).toBeCloseTo(1.062, 3);

    const stored = await user.get(`/breweries/${brewery}/assistant/messages`);
    expect(stored.body.messages[1].actions[0]).toMatchObject({ kind: "recipe_draft", status: "pending", baseRecipeId: base });
    // Nothing is saved until the brewer saves it in the editor.
    const recipes = await user.get(`/breweries/${brewery}/recipes`);
    expect(recipes.body.map((r: { name: string }) => r.name)).toEqual(["Grunnlaget"]);

    const handled = await user.patch(`/breweries/${brewery}/assistant/messages/${assistant.id}/actions/0`, { status: "done", logEntryId: "saved-recipe-id" });
    expect(handled.status).toBe(204);
    const after = await user.get(`/breweries/${brewery}/assistant/messages`);
    expect(after.body.messages[1].actions[0]).toMatchObject({ status: "done", resolvedBy: { id: user.id, name: user.name }, logEntryId: "saved-recipe-id" });
    const again = await user.patch(`/breweries/${brewery}/assistant/messages/${assistant.id}/actions/0`, { status: "dismissed" });
    expect(again.status).toBe(409);
    expect((await user.patch(`/breweries/${brewery}/assistant/messages/${assistant.id}/actions/5`, { status: "dismissed" })).status).toBe(404);
  });

  it("shows the model its latest draft on the next question, so a follow-up can refine it", async () => {
    const user = await createUser("Oppfølging Ola");
    const brewery = await createBrewery(user, "Oppfølging-bryggeriet");
    const db = createDb(env.DB);
    const { client, requests } = scripted([
      { content: [{ type: "tool_use", id: "d1", name: "design_recipe", input: designInput({ name: "Første utkast", batchSizeL: 20 }) }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Her er det første utkastet." }], stop_reason: "end_turn" },
      { content: [{ type: "tool_use", id: "d2", name: "design_recipe", input: designInput({ name: "Andre utkast", batchSizeL: 20 }) }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Her er det andre utkastet." }], stop_reason: "end_turn" },
      { content: [{ type: "text", text: "Ok." }], stop_reason: "end_turn" },
    ]);
    // Explicit times keep the stored order well defined; the app's own clock can give two messages the same millisecond.
    const start = Date.parse("2026-10-06T10:00:00Z");
    const ask = (content: string, step: number) => sendAssistantMessage({ env, db, breweryId: brewery, batchId: null, user: person(user), content, client, now: start + step * 1000 });
    await ask("Lag en IPA", 0);
    await ask("Lag en annen", 1);
    await ask("Gjør den siste litt mer bitter", 2);

    const lastRequest = requests.at(-1)!.messages.map((m) => String(m.content));
    const history = lastRequest.join("\n---\n");
    // The newest draft comes with its structure and the app's numbers, the older one only by name.
    expect(history).toContain("Utkast vist til bryggeren, regnet av appen:");
    expect(history).toContain('"name":"Andre utkast"');
    expect(history).toContain('"calculated"');
    expect(history).toContain("[Utkast vist til bryggeren: «Første utkast»]");
    expect(history).not.toContain('"name":"Første utkast"');
    expect(requests.at(-1)!.messages.at(-1)).toEqual({ role: "user", content: "Gjør den siste litt mer bitter" });
    // Nothing of this is stored in the message text itself.
    const stored = await user.get(`/breweries/${brewery}/assistant/messages`);
    expect(stored.body.messages[1].content).toBe("Her er det første utkastet.");
  });

  it("cannot read or base a draft on another brewery's recipe", async () => {
    const alice = await createUser("Isolasjon Alice");
    const bob = await createUser("Isolasjon Bob");
    const breweryA = await createBrewery(alice, "Isolasjon A");
    const breweryB = await createBrewery(bob, "Isolasjon B");
    const bobsRecipe = (await bob.post(`/breweries/${breweryB}/recipes`, { recipe: { ...sunsetIpaRecipe, name: "Bobs hemmelige IPA" } })).body.id;
    const { client, requests } = scripted([
      { content: [{ type: "tool_use", id: "g", name: "get_recipe", input: { recipeId: bobsRecipe } }, { type: "tool_use", id: "d", name: "design_recipe", input: designInput({ basedOnRecipeId: bobsRecipe }) }], stop_reason: "tool_use" },
      { content: [{ type: "text", text: "Fant den ikke." }], stop_reason: "end_turn" },
    ]);
    const response = await sendAssistantMessage({ env, db: createDb(env.DB), breweryId: breweryA, batchId: null, user: person(alice), content: "Bruk Bobs oppskrift", client });

    const results = requests[1]!.messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(JSON.parse(String(results[0]!.content))).toHaveProperty("error");
    expect(results[1]!.is_error).toBe(true);
    expect(JSON.stringify(results)).not.toContain("Bobs hemmelige IPA");
    expect(response.messages[1]!.actions).toBeNull();
  });

  it("draws on the same daily limit as the batch threads", async () => {
    const user = await createUser("Kvote Kari");
    const brewery = await createBrewery(user, "Kvote-bryggeriet");
    const recipe = (await user.post(`/breweries/${brewery}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const batch = (await user.post(`/breweries/${brewery}/batches`, { recipeId: recipe })).body.id;
    const limited = { ...env, ANTHROPIC_API_KEY: "", ASSISTANT_DAILY_LIMIT: "1" };
    const db = createDb(env.DB);
    const now = Date.parse("2026-10-05T10:00:00Z");
    await askAssistant({ env: limited, db, breweryId: brewery, batchId: batch, messages: [{ role: "user", content: "Hei" }], client: answer, now });
    await expect(askAssistant({ env: limited, db, breweryId: brewery, batchId: null, messages: [{ role: "user", content: "Hei" }], client: answer, now })).rejects.toMatchObject({ status: 429, code: "assistant_daily_limit" });
    expect((await getAssistantStatus(limited, db, brewery, now)).today.requests).toBe(1);
  });
});
