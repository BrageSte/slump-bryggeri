import { sql } from "kysely";
import type { z } from "zod";
import type { LibraryRecipeDetail, LibraryRecipeSummary, LibrarySearchResponse, librarySearchQuerySchema } from "../../src/domain/model/api.ts";
import { librarySources, type LibraryCategory } from "../../src/domain/model/library.ts";
import type { RecipeDocument } from "../../src/domain/model/recipe.ts";
import type { SessionUser } from "../lib/context.ts";
import { parseJson, type DB } from "../lib/db.ts";
import { notFound } from "../lib/errors.ts";
import { createRecipe } from "./recipes.ts";

/**
 * The recipe library is public reference data shared by every brewery: readable by any signed-in
 * user, never written through the API. Copying a recipe creates an ordinary brewery recipe.
 */

type Row = {
  id: string;
  name: string;
  tagline: string | null;
  category: string;
  abv: number | null;
  ibu: number | null;
  og: number | null;
  ebc: number | null;
  batch_size_l: number;
};

function toSummary(row: Row): LibraryRecipeSummary {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    category: row.category as LibraryCategory,
    abvPct: row.abv,
    ibu: row.ibu,
    og: row.og,
    colorEbc: row.ebc,
    batchSizeL: row.batch_size_l,
  };
}

/** `%` and `_` in the user's text are literal characters, not wildcards. */
function likePattern(token: string): string {
  return `%${token.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

export async function searchLibrary(db: DB, query: z.output<typeof librarySearchQuerySchema>): Promise<LibrarySearchResponse> {
  const tokens = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  let base = db.selectFrom("recipe_library");
  for (const token of tokens) {
    base = base.where(sql<boolean>`search_text LIKE ${likePattern(token)} ESCAPE '\\'`);
  }
  if (query.category) base = base.where("category", "=", query.category);

  const [rows, count] = await Promise.all([
    base
      .select(["id", "name", "tagline", "category", "abv", "ibu", "og", "ebc", "batch_size_l"])
      .orderBy("name")
      .limit(query.limit)
      .offset(query.offset)
      .execute(),
    base.select((eb) => eb.fn.countAll<number>().as("total")).executeTakeFirstOrThrow(),
  ]);
  return { items: rows.map(toSummary), total: Number(count.total) };
}

async function findLibraryRow(db: DB, id: string) {
  const row = await db.selectFrom("recipe_library").selectAll().where("id", "=", id).executeTakeFirst();
  if (!row) throw notFound("Oppskriften i biblioteket");
  return row;
}

export async function getLibraryRecipe(db: DB, id: string): Promise<LibraryRecipeDetail> {
  const row = await findLibraryRow(db, id);
  const source = librarySources[row.source];
  return {
    ...toSummary(row),
    recipe: parseJson<RecipeDocument>(row.data) as RecipeDocument,
    warnings: parseJson<string[]>(row.warnings) ?? [],
    source: {
      key: row.source,
      name: source?.name ?? row.source,
      license: source?.license ?? "",
      url: row.source_url,
    },
  };
}

/** Copies a library recipe into the brewery. The original source data is kept as the recipe source (§9). */
export async function copyLibraryRecipe(
  d1: D1Database,
  db: DB,
  breweryId: string,
  user: SessionUser,
  libraryId: string,
): Promise<string> {
  const row = await findLibraryRow(db, libraryId);
  return createRecipe(d1, db, breweryId, user, {
    recipe: parseJson<RecipeDocument>(row.data) as RecipeDocument,
    source: { kind: "library", url: row.source_url ?? undefined, originalText: row.source_data },
  });
}
