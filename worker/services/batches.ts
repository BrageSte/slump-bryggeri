import { sql } from "kysely";
import type { z } from "zod";
import type {
  BatchDetail,
  BatchSplit,
  BatchSummary,
  createBatchSchema,
  createSplitSchema,
  updateBatchSchema,
} from "../../src/domain/model/api.ts";
import {
  stageStartedEventType,
  statusForStage,
  type BatchStatus,
  type BrewStage,
} from "../../src/domain/model/brewing.ts";
import type { ProfileValues } from "../../src/domain/model/equipment-profile.ts";
import type { RecipeDocument } from "../../src/domain/model/recipe.ts";
import type { SessionUser } from "../lib/context.ts";
import { atomic, newId, parseJson, type DB } from "../lib/db.ts";
import { notFound } from "../lib/errors.ts";
import { getActiveProfile, listEquipment, profileValuesOf } from "./equipment.ts";
import { getRecipeVersion } from "./recipes.ts";

type BatchRow = {
  id: string;
  number: number;
  name: string;
  status: BatchStatus;
  current_stage: string | null;
  stage_started_at: number | null;
  brew_date: string | null;
  recipe_id: string;
  recipe_name: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

function toSummary(row: BatchRow): BatchSummary {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    status: row.status,
    currentStage: row.current_stage as BrewStage | null,
    stageStartedAt: row.stage_started_at,
    brewDate: row.brew_date,
    recipe: { id: row.recipe_id, name: row.recipe_name },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

function batchQuery(db: DB, breweryId: string) {
  return db
    .selectFrom("batches as b")
    .innerJoin("recipes as r", "r.id", "b.recipe_id")
    .select([
      "b.id",
      "b.number",
      "b.name",
      "b.status",
      "b.current_stage",
      "b.stage_started_at",
      "b.brew_date",
      "b.recipe_id",
      "r.name as recipe_name",
      "b.created_at",
      "b.updated_at",
      "b.completed_at",
    ])
    .where("b.brewery_id", "=", breweryId)
    .where("b.deleted_at", "is", null);
}

export async function listBatches(db: DB, breweryId: string, statuses?: BatchStatus[]): Promise<BatchSummary[]> {
  let query = batchQuery(db, breweryId);
  if (statuses && statuses.length > 0) query = query.where("b.status", "in", statuses);
  const rows = await query.orderBy("b.updated_at", "desc").limit(200).execute();
  return rows.map(toSummary);
}

/** Loads a batch scoped to the brewery; batches in other breweries are reported as missing. */
export async function findBatch(db: DB, breweryId: string, batchId: string): Promise<BatchSummary> {
  const row = await batchQuery(db, breweryId).where("b.id", "=", batchId).executeTakeFirst();
  if (!row) throw notFound("Brygget");
  return toSummary(row);
}

export async function getBatch(db: DB, breweryId: string, batchId: string): Promise<BatchDetail> {
  const summary = await findBatch(db, breweryId, batchId);
  const [recipeSnapshot, equipmentSnapshot, version, splits] = await Promise.all([
    db.selectFrom("batch_recipe_snapshots").selectAll().where("batch_id", "=", batchId).executeTakeFirstOrThrow(),
    db.selectFrom("batch_equipment_snapshots").selectAll().where("batch_id", "=", batchId).executeTakeFirst(),
    db
      .selectFrom("batches as b")
      .innerJoin("recipe_versions as v", "v.id", "b.recipe_version_id")
      .select(["v.id", "v.version"])
      .where("b.id", "=", batchId)
      .executeTakeFirstOrThrow(),
    listSplits(db, breweryId, batchId),
  ]);
  const equipment = parseJson<{ values: ProfileValues }>(equipmentSnapshot?.data ?? null);
  return {
    ...summary,
    recipeVersion: { id: version.id, version: version.version },
    recipeSnapshot: parseJson<RecipeDocument>(recipeSnapshot.data) as RecipeDocument,
    equipmentSnapshot: {
      profileId: equipmentSnapshot?.equipment_profile_id ?? null,
      profileVersion: equipmentSnapshot?.profile_version ?? null,
      values: equipment?.values ?? {},
    },
    splits,
  };
}

/**
 * Creates a batch and freezes the recipe version and the active equipment profile into
 * immutable snapshots, atomically. Later edits to either never change this batch.
 */
export async function createBatch(
  d1: D1Database,
  db: DB,
  breweryId: string,
  user: SessionUser,
  input: z.output<typeof createBatchSchema>,
): Promise<string> {
  const recipe = await db
    .selectFrom("recipes")
    .select(["id", "name", "current_version_id"])
    .where("id", "=", input.recipeId)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!recipe?.current_version_id) throw notFound("Oppskriften");

  const version = await getRecipeVersion(db, breweryId, recipe.id, input.recipeVersionId ?? recipe.current_version_id);
  const [profile, equipment] = await Promise.all([getActiveProfile(db, breweryId), listEquipment(db, breweryId)]);

  const now = Date.now();
  const batchId = newId();
  await atomic(d1, [
    db.insertInto("batches").values({
      id: batchId,
      brewery_id: breweryId,
      number: sql<number>`(SELECT COALESCE(MAX(number), 0) + 1 FROM batches WHERE brewery_id = ${breweryId})`,
      name: input.name ?? version.data.name,
      recipe_id: recipe.id,
      recipe_version_id: version.id,
      status: "planned",
      current_stage: null,
      stage_started_at: null,
      brew_date: input.brewDate ?? null,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    }),
    db.insertInto("batch_recipe_snapshots").values({
      batch_id: batchId,
      recipe_version_id: version.id,
      data: JSON.stringify(version.data),
      created_at: now,
    }),
    db.insertInto("batch_equipment_snapshots").values({
      batch_id: batchId,
      equipment_profile_id: profile?.id ?? null,
      profile_version: profile?.version ?? null,
      data: JSON.stringify({ values: profileValuesOf(profile), equipment }),
      created_at: now,
    }),
  ]);
  return batchId;
}

function statusChangedEvent(db: DB, breweryId: string, batchId: string, user: SessionUser, from: BatchStatus, to: BatchStatus, now: number) {
  return db.insertInto("brew_events").values({
    id: newId(),
    brewery_id: breweryId,
    batch_id: batchId,
    split_id: null,
    type: "status_changed",
    stage: null,
    occurred_at: now,
    data: JSON.stringify({ from, to }),
    created_by: user.id,
    created_at: now,
    updated_at: now,
  });
}

export async function updateBatch(
  d1: D1Database,
  db: DB,
  breweryId: string,
  batchId: string,
  user: SessionUser,
  input: z.output<typeof updateBatchSchema>,
): Promise<void> {
  const batch = await findBatch(db, breweryId, batchId);
  const now = Date.now();
  const statusChanged = input.status !== undefined && input.status !== batch.status;
  await atomic(d1, [
    db
      .updateTable("batches")
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.brewDate !== undefined ? { brew_date: input.brewDate } : {}),
        ...(statusChanged ? { status: input.status, completed_at: input.status === "completed" ? now : null } : {}),
        updated_at: now,
      })
      .where("id", "=", batchId)
      .where("brewery_id", "=", breweryId),
    ...(statusChanged ? [statusChangedEvent(db, breweryId, batchId, user, batch.status, input.status as BatchStatus, now)] : []),
  ]);
}

/** Starts a brew stage: moves the batch forward and logs `<stage>_started` in one transaction. */
export async function startStage(
  d1: D1Database,
  db: DB,
  breweryId: string,
  batchId: string,
  user: SessionUser,
  input: { stage: BrewStage; occurredAt?: number },
): Promise<string> {
  const batch = await findBatch(db, breweryId, batchId);
  const now = Date.now();
  const occurredAt = input.occurredAt ?? now;
  const status = batch.status === "completed" ? "completed" : statusForStage(input.stage);
  const eventId = newId();
  await atomic(d1, [
    db
      .updateTable("batches")
      .set({ current_stage: input.stage, stage_started_at: occurredAt, status, updated_at: now })
      .where("id", "=", batchId)
      .where("brewery_id", "=", breweryId),
    db.insertInto("brew_events").values({
      id: eventId,
      brewery_id: breweryId,
      batch_id: batchId,
      split_id: null,
      type: stageStartedEventType(input.stage),
      stage: input.stage,
      occurred_at: occurredAt,
      data: null,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    }),
  ]);
  return eventId;
}

export async function deleteBatch(db: DB, breweryId: string, batchId: string): Promise<void> {
  await findBatch(db, breweryId, batchId);
  await db.updateTable("batches").set({ deleted_at: Date.now() }).where("id", "=", batchId).execute();
}

// --- Splits ---------------------------------------------------------------------

export async function listSplits(db: DB, breweryId: string, batchId: string): Promise<BatchSplit[]> {
  const rows = await db
    .selectFrom("batch_splits")
    .select(["id", "name", "vessel", "volume_l", "notes"])
    .where("batch_id", "=", batchId)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .orderBy("sort_order")
    .orderBy("created_at")
    .execute();
  return rows.map((r) => ({ id: r.id, name: r.name, vessel: r.vessel, volumeL: r.volume_l, notes: r.notes }));
}

export async function createSplit(
  db: DB,
  breweryId: string,
  batchId: string,
  user: SessionUser,
  input: z.output<typeof createSplitSchema>,
): Promise<string> {
  await findBatch(db, breweryId, batchId);
  const existing = await listSplits(db, breweryId, batchId);
  const id = newId();
  const now = Date.now();
  await db
    .insertInto("batch_splits")
    .values({
      id,
      brewery_id: breweryId,
      batch_id: batchId,
      name: input.name,
      vessel: input.vessel ?? null,
      equipment_id: null,
      volume_l: input.volumeL ?? null,
      notes: input.notes ?? null,
      sort_order: existing.length,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}
