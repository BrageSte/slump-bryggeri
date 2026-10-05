import type {
  AssistantCitation,
  AssistantMessageAction,
  AssistantPostResponse,
  AssistantRecipeDraft,
  AssistantReplyAction,
  AssistantThreadMessage,
  AssistantThreadResponse,
} from "../../src/domain/model/api.ts";
import type { SessionUser } from "../lib/context.ts";
import { newId, parseJson, type DB } from "../lib/db.ts";
import { conflict, notFound } from "../lib/errors.ts";
import { getBatch } from "./batches.ts";
import { askAssistant, type AssistantEnv } from "./assistant.ts";
import type { MessagesClient } from "../assistant/run.ts";
import { draftForModel } from "../assistant/recipe-tools.ts";

const THREAD_LIMIT = 100;
const HISTORY_LIMIT = 12;

/**
 * Which thread: a batch's own (`batchId`), or the brewery's (`null`, stored with a NULL `batch_id`). Both are scoped by
 * the verified brewery id, so the two kinds never mix and no thread is reachable from another brewery.
 */
async function assertThread(db: DB, breweryId: string, batchId: string | null): Promise<void> {
  if (batchId !== null) await getBatch(db, breweryId, batchId);
}

function pendingActions(actions: AssistantReplyAction[] | null): AssistantMessageAction[] | null {
  if (!actions?.length) return null;
  return actions.map((action) => ({
    ...action,
    status: "pending",
    resolvedBy: null,
    resolvedAt: null,
    logEntryId: null,
  }));
}

type ThreadRow = Awaited<ReturnType<typeof threadRows>>[number];

function draftsOf(row: Pick<ThreadRow, "role" | "actions">): AssistantRecipeDraft[] {
  if (row.role !== "assistant") return [];
  return (actionsFromJson(row.actions) ?? []).filter((action): action is AssistantMessageAction & AssistantRecipeDraft => action.kind === "recipe_draft");
}

/**
 * What the model is told about the drafts it showed: the latest ones in full (so it can refine them), older ones by name.
 * The drafts are stored with the message, not as recipes, so this is the only way the model can see them again.
 */
function draftNote(drafts: AssistantRecipeDraft[], full: boolean): string {
  if (drafts.length === 0) return "";
  const shown = full
    ? drafts.map((draft) => JSON.stringify(draftForModel(draft))).join("\n")
    : drafts.map((draft) => `«${draft.recipe.name}»`).join(", ");
  return `\n\n[Utkast vist til bryggeren${full ? ", regnet av appen" : ""}: ${shown}]`;
}

function modelHistory(rows: ThreadRow[]): { role: "user" | "assistant"; content: string }[] {
  const oldestFirst = [...rows].reverse();
  const latestWithDraft = oldestFirst.findLastIndex((row) => draftsOf(row).length > 0);
  const history: { role: "user" | "assistant"; content: string }[] = [];
  oldestFirst.forEach((row, index) => {
    const content = row.content + draftNote(draftsOf(row), index === latestWithDraft);
    const previous = history.at(-1);
    if (previous?.role === row.role) previous.content += `\n\n${content}`;
    else history.push({ role: row.role, content });
  });
  // The API requires a user turn at the beginning; this can happen when the 12-message window starts mid-thread.
  while (history[0]?.role === "assistant") history.shift();
  return history;
}

function actionsFromJson(value: string | null): AssistantMessageAction[] | null {
  return parseJson<AssistantMessageAction[]>(value);
}

function citationsFromJson(value: string | null): AssistantCitation[] {
  return parseJson<AssistantCitation[]>(value) ?? [];
}

async function threadRows(db: DB, breweryId: string, batchId: string | null, limit: number) {
  const thread = db
    .selectFrom("assistant_messages as m")
    .leftJoin("users as u", "u.id", "m.created_by")
    .select([
      "m.id",
      "m.role",
      "m.content",
      "m.actions",
      "m.citations",
      "m.created_by",
      "m.created_at",
      "u.name as author_name",
    ])
    .where("m.brewery_id", "=", breweryId);
  return (batchId === null ? thread.where("m.batch_id", "is", null) : thread.where("m.batch_id", "=", batchId))
    .orderBy("m.created_at", "desc")
    .orderBy("m.id", "desc")
    .limit(limit)
    .execute();
}

function messageFromRow(row: {
  id: string;
  role: "user" | "assistant";
  content: string;
  actions: string | null;
  citations: string | null;
  created_by: string | null;
  created_at: number;
  author_name: string | null;
}): AssistantThreadMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    actions: actionsFromJson(row.actions),
    citations: citationsFromJson(row.citations),
    author: row.created_by && row.author_name ? { id: row.created_by, name: row.author_name } : null,
    createdAt: row.created_at,
  };
}

export async function getAssistantThread(db: DB, breweryId: string, batchId: string | null): Promise<AssistantThreadResponse> {
  await assertThread(db, breweryId, batchId);
  const rows = await threadRows(db, breweryId, batchId, THREAD_LIMIT);
  return { messages: rows.reverse().map(messageFromRow) };
}

export async function sendAssistantMessage(input: {
  env: AssistantEnv;
  db: DB;
  breweryId: string;
  /** The batch whose thread this is; null for the brewery's own thread. */
  batchId: string | null;
  user: SessionUser;
  content: string;
  client?: MessagesClient;
  now?: number;
}): Promise<AssistantPostResponse> {
  const { db, breweryId, batchId, user } = input;
  await assertThread(db, breweryId, batchId);

  const createdAt = input.now ?? Date.now();
  const userId = newId();
  await db
    .insertInto("assistant_messages")
    .values({
      id: userId,
      brewery_id: breweryId,
      batch_id: batchId,
      role: "user",
      content: input.content,
      actions: null,
      citations: null,
      created_by: user.id,
      created_at: createdAt,
    })
    .execute();

  // Load from D1 after storing the new question so persisted shared history is the model input.
  const recent = await threadRows(db, breweryId, batchId, HISTORY_LIMIT);
  const history = modelHistory(recent);

  const reply = await askAssistant({
    env: input.env,
    db,
    breweryId,
    batchId,
    messages: history,
    client: input.client,
    now: input.now,
  });

  const assistantId = newId();
  const assistantCreatedAt = input.now === undefined ? Date.now() : createdAt + 1;
  const actions = pendingActions(reply.actions);
  await db
    .insertInto("assistant_messages")
    .values({
      id: assistantId,
      brewery_id: breweryId,
      batch_id: batchId,
      role: "assistant",
      content: reply.reply,
      actions: actions ? JSON.stringify(actions) : null,
      citations: reply.citations.length > 0 ? JSON.stringify(reply.citations) : null,
      created_by: null,
      created_at: assistantCreatedAt,
    })
    .execute();

  return {
    messages: [
      { id: userId, role: "user", content: input.content, actions: null, citations: [], author: { id: user.id, name: user.name }, createdAt },
      { id: assistantId, role: "assistant", content: reply.reply, actions, citations: reply.citations, author: null, createdAt: assistantCreatedAt },
    ],
    toolCalls: reply.toolCalls,
    usage: reply.usage,
  };
}

export async function resolveAssistantAction(input: {
  db: DB;
  breweryId: string;
  batchId: string | null;
  messageId: string;
  actionIndex: number;
  user: SessionUser;
  status: "done" | "dismissed";
  /** The log entry (batch thread) or the saved recipe (brewery thread) the action led to. */
  logEntryId?: string;
}): Promise<void> {
  await assertThread(input.db, input.breweryId, input.batchId);
  const found = input.db
    .selectFrom("assistant_messages")
    .select(["id", "actions"])
    .where("id", "=", input.messageId)
    .where("brewery_id", "=", input.breweryId)
    .where("role", "=", "assistant");
  const message = await (input.batchId === null ? found.where("batch_id", "is", null) : found.where("batch_id", "=", input.batchId)).executeTakeFirst();
  if (!message?.actions) throw notFound("Assistentforslaget");

  const actions = actionsFromJson(message.actions);
  const action = actions?.[input.actionIndex];
  if (!actions || !action) throw notFound("Assistentforslaget");
  if (action.status !== "pending") throw conflict("Forslaget er allerede behandlet av noen i bryggeriet.");

  actions[input.actionIndex] = {
    ...action,
    status: input.status,
    resolvedBy: { id: input.user.id, name: input.user.name },
    resolvedAt: Date.now(),
    logEntryId: input.status === "done" ? input.logEntryId ?? null : null,
  };
  const update = input.db
    .updateTable("assistant_messages")
    .set({ actions: JSON.stringify(actions) })
    .where("id", "=", message.id)
    .where("brewery_id", "=", input.breweryId)
    .where("actions", "=", message.actions);
  const result = await (input.batchId === null ? update.where("batch_id", "is", null) : update.where("batch_id", "=", input.batchId)).executeTakeFirst();
  if (result.numUpdatedRows === 0n) throw conflict("Forslaget ble behandlet samtidig av noen andre. Last inn tråden på nytt.");
}
