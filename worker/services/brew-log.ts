import type { z } from "zod";
import type {
  createCommentSchema,
  createEventSchema,
  createMeasurementSchema,
  TimelineItem,
} from "../../src/domain/model/api.ts";
import {
  ingredientAddedDataSchema,
  measurementKindSpecs,
  stageFromStartedEvent,
  type BrewStage,
  type MeasurementKind,
} from "../../src/domain/model/brewing.ts";
import type { MembershipContext, SessionUser } from "../lib/context.ts";
import { atomic, newId, parseJson, type DB } from "../lib/db.ts";
import { badRequest, forbidden, HttpError, notFound } from "../lib/errors.ts";
import { parse } from "../lib/validate.ts";
import { findBatch } from "./batches.ts";

/** Event types with dedicated endpoints; the generic endpoint refuses them. */
const RESERVED_EVENT_TYPES = new Set(["measurement", "comment", "photo", "status_changed"]);
const MAX_EVENT_DATA_BYTES = 10_000;

export function attachmentUrl(breweryId: string, attachmentId: string): string {
  return `/api/breweries/${breweryId}/attachments/${attachmentId}`;
}

export async function getTimeline(db: DB, breweryId: string, batchId: string): Promise<TimelineItem[]> {
  await findBatch(db, breweryId, batchId);
  const rows = await db
    .selectFrom("brew_events as e")
    .innerJoin("users as u", "u.id", "e.created_by")
    .leftJoin("measurements as m", "m.event_id", "e.id")
    .leftJoin("comments as c", "c.event_id", "e.id")
    .leftJoin("attachments as a", (join) => join.onRef("a.event_id", "=", "e.id").on("a.deleted_at", "is", null))
    .select([
      "e.id",
      "e.type",
      "e.stage",
      "e.split_id",
      "e.occurred_at",
      "e.created_at",
      "e.data",
      "u.id as user_id",
      "u.name as user_name",
      "m.id as m_id",
      "m.kind as m_kind",
      "m.label as m_label",
      "m.value as m_value",
      "m.unit as m_unit",
      "m.sample_temp_c as m_sample_temp_c",
      "m.instrument as m_instrument",
      "m.comment as m_comment",
      "c.id as c_id",
      "c.body as c_body",
      "c.edited_at as c_edited_at",
      "a.id as a_id",
      "a.filename as a_filename",
      "a.content_type as a_content_type",
      "a.size_bytes as a_size_bytes",
      "a.caption as a_caption",
    ])
    .where("e.batch_id", "=", batchId)
    .where("e.brewery_id", "=", breweryId)
    .where("e.deleted_at", "is", null)
    .orderBy("e.occurred_at")
    .orderBy("e.created_at")
    .orderBy("e.id")
    .execute();

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    stage: r.stage as BrewStage | null,
    splitId: r.split_id,
    occurredAt: r.occurred_at,
    createdAt: r.created_at,
    createdBy: { id: r.user_id, name: r.user_name },
    data: parseJson<Record<string, unknown>>(r.data),
    measurement:
      r.m_id === null
        ? null
        : {
            id: r.m_id,
            kind: r.m_kind as MeasurementKind,
            label: r.m_label,
            value: r.m_value as number,
            unit: r.m_unit as string,
            sampleTempC: r.m_sample_temp_c,
            instrument: r.m_instrument,
            comment: r.m_comment,
          },
    comment: r.c_id === null ? null : { id: r.c_id, body: r.c_body as string, editedAt: r.c_edited_at },
    attachment:
      r.a_id === null
        ? null
        : {
            id: r.a_id,
            filename: r.a_filename as string,
            contentType: r.a_content_type as string,
            sizeBytes: r.a_size_bytes as number,
            caption: r.a_caption,
            url: attachmentUrl(breweryId, r.a_id),
          },
  }));
}

async function assertSplit(db: DB, breweryId: string, batchId: string, splitId: string | null | undefined): Promise<void> {
  if (!splitId) return;
  const split = await db
    .selectFrom("batch_splits")
    .select("id")
    .where("id", "=", splitId)
    .where("batch_id", "=", batchId)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!split) throw badRequest("Ukjent gjæringsvariant for dette brygget.");
}

function eventRow(
  breweryId: string,
  batchId: string,
  user: SessionUser,
  fields: { id: string; type: string; stage: string | null; splitId: string | null; occurredAt: number; data: unknown; now: number },
) {
  return {
    id: fields.id,
    brewery_id: breweryId,
    batch_id: batchId,
    split_id: fields.splitId,
    type: fields.type,
    stage: fields.stage,
    occurred_at: fields.occurredAt,
    data: fields.data === undefined || fields.data === null ? null : JSON.stringify(fields.data),
    created_by: user.id,
    created_at: fields.now,
    updated_at: fields.now,
  };
}

export async function logMeasurement(
  d1: D1Database,
  db: DB,
  breweryId: string,
  batchId: string,
  user: SessionUser,
  input: z.output<typeof createMeasurementSchema>,
): Promise<string> {
  const batch = await findBatch(db, breweryId, batchId);
  await assertSplit(db, breweryId, batchId, input.splitId);

  const spec = measurementKindSpecs[input.kind];
  if (input.value < spec.min || input.value > spec.max) {
    throw new HttpError(400, "validation_failed", "Verdien er utenfor gyldig område.", [
      { path: "value", message: `Må være mellom ${spec.min} og ${spec.max}` },
    ]);
  }
  let unit: string;
  if (spec.unit === null) {
    if (!input.unit) throw badRequest("Egendefinerte målinger må ha en enhet.");
    unit = input.unit;
  } else {
    if (input.unit && input.unit !== spec.unit) throw badRequest(`${spec.label} lagres i ${spec.unit}.`);
    unit = spec.unit;
  }

  const now = Date.now();
  const occurredAt = input.measuredAt ?? now;
  const stage = input.stage === undefined ? batch.currentStage : input.stage;
  const eventId = newId();
  await atomic(d1, [
    db.insertInto("brew_events").values(
      eventRow(breweryId, batchId, user, {
        id: eventId,
        type: "measurement",
        stage,
        splitId: input.splitId ?? null,
        occurredAt,
        data: null,
        now,
      }),
    ),
    db.insertInto("measurements").values({
      id: newId(),
      brewery_id: breweryId,
      batch_id: batchId,
      split_id: input.splitId ?? null,
      event_id: eventId,
      kind: input.kind,
      label: input.label ?? null,
      value: input.value,
      unit,
      stage,
      measured_at: occurredAt,
      sample_temp_c: input.sampleTempC ?? null,
      instrument: input.instrument ?? null,
      comment: input.comment ?? null,
      created_by: user.id,
      created_at: now,
    }),
  ]);
  return eventId;
}

export async function addComment(
  d1: D1Database,
  db: DB,
  breweryId: string,
  batchId: string,
  user: SessionUser,
  input: z.output<typeof createCommentSchema>,
): Promise<string> {
  const batch = await findBatch(db, breweryId, batchId);
  await assertSplit(db, breweryId, batchId, input.splitId);
  const now = Date.now();
  const eventId = newId();
  await atomic(d1, [
    db.insertInto("brew_events").values(
      eventRow(breweryId, batchId, user, {
        id: eventId,
        type: "comment",
        stage: input.stage === undefined ? batch.currentStage : input.stage,
        splitId: input.splitId ?? null,
        occurredAt: input.occurredAt ?? now,
        data: null,
        now,
      }),
    ),
    db.insertInto("comments").values({
      id: newId(),
      brewery_id: breweryId,
      batch_id: batchId,
      event_id: eventId,
      body: input.body,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    }),
  ]);
  return eventId;
}

/** Only the author can edit a comment. */
export async function editComment(
  db: DB,
  breweryId: string,
  batchId: string,
  commentId: string,
  user: SessionUser,
  body: string,
): Promise<void> {
  const comment = await db
    .selectFrom("comments")
    .select(["id", "created_by"])
    .where("id", "=", commentId)
    .where("batch_id", "=", batchId)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!comment) throw notFound("Kommentaren");
  if (comment.created_by !== user.id) throw forbidden("Du kan bare redigere dine egne kommentarer.");
  const now = Date.now();
  await db.updateTable("comments").set({ body, edited_at: now, updated_at: now }).where("id", "=", comment.id).execute();
}

export async function logEvent(
  d1: D1Database,
  db: DB,
  breweryId: string,
  batchId: string,
  user: SessionUser,
  input: z.output<typeof createEventSchema>,
): Promise<string> {
  if (RESERVED_EVENT_TYPES.has(input.type)) throw badRequest(`Bruk det egne endepunktet for «${input.type}».`);
  if (stageFromStartedEvent(input.type)) throw badRequest("Bruk /stage for å starte et bryggesteg.");
  const batch = await findBatch(db, breweryId, batchId);
  await assertSplit(db, breweryId, batchId, input.splitId);

  let data: unknown = input.data ?? null;
  if (input.type === "ingredient_added" || input.type === "yeast_pitched") {
    data = parse(ingredientAddedDataSchema, input.data ?? {});
  }
  if (data !== null && JSON.stringify(data).length > MAX_EVENT_DATA_BYTES) throw badRequest("Hendelsesdata er for stor.");

  const now = Date.now();
  const eventId = newId();
  await atomic(d1, [
    db.insertInto("brew_events").values(
      eventRow(breweryId, batchId, user, {
        id: eventId,
        type: input.type,
        stage: input.stage === undefined ? batch.currentStage : input.stage,
        splitId: input.splitId ?? null,
        occurredAt: input.occurredAt ?? now,
        data,
        now,
      }),
    ),
  ]);
  return eventId;
}

/** Soft-deletes a log entry. Allowed for the author and for admins. */
export async function deleteEvent(
  d1: D1Database,
  db: DB,
  membership: MembershipContext,
  batchId: string,
  eventId: string,
  user: SessionUser,
): Promise<void> {
  const event = await db
    .selectFrom("brew_events")
    .select(["id", "created_by"])
    .where("id", "=", eventId)
    .where("batch_id", "=", batchId)
    .where("brewery_id", "=", membership.breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!event) throw notFound("Loggføringen");
  if (event.created_by !== user.id && membership.role !== "admin") {
    throw forbidden("Du kan bare slette dine egne loggføringer.");
  }
  const now = Date.now();
  await atomic(d1, [
    db.updateTable("brew_events").set({ deleted_at: now, updated_at: now }).where("id", "=", event.id),
    db.updateTable("measurements").set({ deleted_at: now }).where("event_id", "=", event.id),
    db.updateTable("comments").set({ deleted_at: now }).where("event_id", "=", event.id),
    db.updateTable("attachments").set({ deleted_at: now }).where("event_id", "=", event.id),
  ]);
}
