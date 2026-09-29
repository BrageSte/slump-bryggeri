import { sql } from "kysely";
import { summarizeBreweryHistory } from "../../src/domain/brew-document/brewery-history.ts";
import { type DB } from "../lib/db.ts";
import { getBatch } from "./batches.ts";
import { getTimeline } from "./brew-log.ts";

export async function loadBreweryHistory(
  db: DB,
  breweryId: string,
  options: { excludeBatchId?: string; limit?: number } = {},
): Promise<ReturnType<typeof summarizeBreweryHistory>> {
  const requestedLimit = options.limit ?? 10;
  const limit = Number.isFinite(requestedLimit) ? Math.max(0, Math.floor(requestedLimit)) : 10;
  if (limit === 0) return summarizeBreweryHistory([]);

  let query = db
    .selectFrom("batches as b")
    .select("b.id")
    .where("b.brewery_id", "=", breweryId)
    .where("b.deleted_at", "is", null);
  if (options.excludeBatchId) query = query.where("b.id", "!=", options.excludeBatchId);

  const rows = await query
    .orderBy(sql<string>`COALESCE(b.brew_date, date(b.created_at / 1000, 'unixepoch'))`, "desc")
    .orderBy("b.created_at", "desc")
    .orderBy("b.number", "desc")
    .limit(limit)
    .execute();
  const batches = await Promise.all(
    rows.map(async ({ id }) => {
      const [batch, timeline] = await Promise.all([getBatch(db, breweryId, id), getTimeline(db, breweryId, id)]);
      return { batch, timeline };
    }),
  );
  return summarizeBreweryHistory(batches);
}
