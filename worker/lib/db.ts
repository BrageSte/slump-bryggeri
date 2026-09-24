import { Kysely, type Compilable } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Database } from "../../db/schema/database.ts";

export type DB = Kysely<Database>;

export function createDb(d1: D1Database): DB {
  return new Kysely<Database>({ dialect: new D1Dialect({ database: d1 }) });
}

/**
 * Runs several write queries atomically. D1 has no interactive transactions, but a
 * `batch()` executes as a single all-or-nothing transaction.
 */
export async function atomic(d1: D1Database, queries: Compilable[]): Promise<void> {
  if (queries.length === 0) return;
  const statements = queries.map((query) => {
    const compiled = query.compile();
    return d1.prepare(compiled.sql).bind(...(compiled.parameters as unknown[]));
  });
  await d1.batch(statements);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function parseJson<T>(value: string | null): T | null {
  return value === null ? null : (JSON.parse(value) as T);
}

/** True when a D1 write failed on a UNIQUE constraint (e.g. two concurrent version bumps). */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}
