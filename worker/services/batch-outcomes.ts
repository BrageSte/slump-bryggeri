import { calculateAbv } from "../../src/domain/brewing-calculations/index.ts";
import type { BatchOutcome, BatchSummary, SaveOutcomeInput } from "../../src/domain/model/api.ts";
import type { SessionUser } from "../lib/context.ts";
import { isUniqueViolation, newId, type DB } from "../lib/db.ts";
import { conflict, notFound } from "../lib/errors.ts";
import { assertSplit } from "./brew-log.ts";

/** Results recorded for a batch, the whole batch first and then variants in split order. */
export async function listOutcomes(db: DB, breweryId: string, batchId: string): Promise<BatchOutcome[]> {
  const rows = await db
    .selectFrom("batch_outcomes as o")
    .innerJoin("users as u", "u.id", "o.updated_by")
    .leftJoin("batch_splits as s", "s.id", "o.split_id")
    .select([
      "o.id",
      "o.split_id",
      "o.og",
      "o.og_source",
      "o.fg",
      "o.fg_source",
      "o.packaged_volume_l",
      "o.packaged_on",
      "o.packaging",
      "o.carbonation_vols",
      "o.tasting_notes",
      "o.rating",
      "o.next_time",
      "o.updated_at",
      "u.id as user_id",
      "u.name as user_name",
      "s.sort_order",
    ])
    .where("o.batch_id", "=", batchId)
    .where("o.brewery_id", "=", breweryId)
    .orderBy("s.sort_order")
    .orderBy("o.created_at")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    splitId: r.split_id,
    og: r.og,
    ogSource: r.og_source,
    fg: r.fg,
    fgSource: r.fg_source,
    packagedVolumeL: r.packaged_volume_l,
    packagedOn: r.packaged_on,
    packaging: r.packaging,
    carbonationVols: r.carbonation_vols,
    tastingNotes: r.tasting_notes,
    rating: r.rating,
    nextTime: r.next_time,
    updatedAt: r.updated_at,
    updatedBy: { id: r.user_id, name: r.user_name },
  }));
}

/** ABV range and average rating per batch, for the history list. */
export async function resultSummaries(db: DB, breweryId: string, batchIds: string[]): Promise<Map<string, NonNullable<BatchSummary["result"]>>> {
  const summaries = new Map<string, NonNullable<BatchSummary["result"]>>();
  if (batchIds.length === 0) return summaries;
  const rows = await db
    .selectFrom("batch_outcomes")
    .select(["batch_id", "og", "fg", "rating"])
    .where("brewery_id", "=", breweryId)
    .where("batch_id", "in", batchIds)
    .execute();
  const byBatch = new Map<string, typeof rows>();
  for (const row of rows) byBatch.set(row.batch_id, [...(byBatch.get(row.batch_id) ?? []), row]);
  for (const [batchId, outcomes] of byBatch) {
    const abvs = outcomes.flatMap((o) => (o.og !== null && o.fg !== null ? [calculateAbv(o.og, o.fg)] : []));
    const ratings = outcomes.flatMap((o) => (o.rating === null ? [] : [o.rating]));
    summaries.set(batchId, {
      abvPct: abvs.length > 0 ? [Math.min(...abvs), Math.max(...abvs)] : null,
      rating: ratings.length > 0 ? ratings.reduce((sum, r) => sum + r, 0) / ratings.length : null,
    });
  }
  return summaries;
}

/**
 * Creates or updates the result for one variant. A stale `baseUpdatedAt` (someone else saved in
 * between) or a result created at the same time by someone else is a 409, never a silent overwrite.
 */
export async function saveOutcome(db: DB, breweryId: string, batchId: string, user: SessionUser, input: SaveOutcomeInput): Promise<string> {
  const batch = await db
    .selectFrom("batches")
    .select("id")
    .where("id", "=", batchId)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!batch) throw notFound("Brygget");
  await assertSplit(db, breweryId, batchId, input.splitId);

  const existing = await db
    .selectFrom("batch_outcomes")
    .select(["id", "updated_at"])
    .where("batch_id", "=", batchId)
    .where("brewery_id", "=", breweryId)
    .where((eb) => (input.splitId === null ? eb("split_id", "is", null) : eb("split_id", "=", input.splitId)))
    .executeTakeFirst();

  const values = {
    og: input.og,
    og_source: input.ogSource,
    fg: input.fg,
    fg_source: input.fgSource,
    packaged_volume_l: input.packagedVolumeL,
    packaged_on: input.packagedOn,
    packaging: input.packaging,
    carbonation_vols: input.carbonationVols,
    tasting_notes: input.tastingNotes || null,
    rating: input.rating,
    next_time: input.nextTime || null,
  };
  const now = Date.now();

  if (existing) {
    if (input.baseUpdatedAt !== existing.updated_at) {
      throw conflict("Resultatet er endret av noen andre siden du åpnet det. Last inn på nytt.");
    }
    const result = await db
      .updateTable("batch_outcomes")
      .set({ ...values, updated_by: user.id, updated_at: now })
      .where("id", "=", existing.id)
      .where("updated_at", "=", existing.updated_at)
      .executeTakeFirst();
    if (Number(result.numUpdatedRows) === 0) throw conflict("Resultatet ble lagret samtidig av noen andre. Last inn på nytt.");
    return existing.id;
  }

  if (input.baseUpdatedAt !== undefined) throw conflict("Resultatet er slettet eller endret. Last inn på nytt.");
  const id = newId();
  try {
    await db
      .insertInto("batch_outcomes")
      .values({
        id,
        brewery_id: breweryId,
        batch_id: batchId,
        split_id: input.splitId,
        ...values,
        created_by: user.id,
        created_at: now,
        updated_by: user.id,
        updated_at: now,
      })
      .execute();
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Resultatet ble lagret samtidig av noen andre. Last inn på nytt.");
    throw error;
  }
  return id;
}
