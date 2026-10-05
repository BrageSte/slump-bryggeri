import type { z } from "zod";
import type { BsmxSourceData } from "../../src/domain/import/bsmx.ts";
import type { createRecipeSchema, RecipeDetail, RecipeSummary, saveRecipeVersionSchema } from "../../src/domain/model/api.ts";
import type { RecipeDocument } from "../../src/domain/model/recipe.ts";
import type { MembershipContext, SessionUser } from "../lib/context.ts";
import { atomic, isUniqueViolation, newId, parseJson, type DB } from "../lib/db.ts";
import { conflict, forbidden, notFound } from "../lib/errors.ts";

/** The brewery's recipes, newest change first, with the current version's document. */
export async function listRecipeDocuments(db: DB, breweryId: string) {
  const rows = await db
    .selectFrom("recipes as r")
    .innerJoin("recipe_versions as v", "v.id", "r.current_version_id")
    .select(["r.id", "r.name", "r.style", "r.updated_at", "v.version", "v.id as versionId", "v.data"])
    .where("r.brewery_id", "=", breweryId)
    .where("r.deleted_at", "is", null)
    .orderBy("r.updated_at", "desc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    style: r.style,
    version: r.version,
    versionId: r.versionId,
    updatedAt: r.updated_at,
    document: parseJson<RecipeDocument>(r.data) as RecipeDocument,
  }));
}

export async function listRecipes(db: DB, breweryId: string): Promise<RecipeSummary[]> {
  const recipes = await listRecipeDocuments(db, breweryId);
  return recipes.map(({ document, versionId: _versionId, ...r }) => ({ ...r, batchSizeL: document.batchSizeL }));
}

/** Loads a recipe scoped to the brewery. Recipes in other breweries are reported as missing. */
async function findRecipe(db: DB, breweryId: string, recipeId: string) {
  const recipe = await db
    .selectFrom("recipes")
    .selectAll()
    .where("id", "=", recipeId)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!recipe) throw notFound("Oppskriften");
  return recipe;
}

export async function getRecipe(db: DB, breweryId: string, recipeId: string): Promise<RecipeDetail> {
  const recipe = await findRecipe(db, breweryId, recipeId);
  const [versions, source] = await Promise.all([
    db
      .selectFrom("recipe_versions as v")
      .innerJoin("users as u", "u.id", "v.created_by")
      .select([
        "v.id",
        "v.version",
        "v.kind",
        "v.change_note",
        "v.created_at",
        "v.data",
        "v.parent_version_id",
        "u.id as user_id",
        "u.name as user_name",
      ])
      .where("v.recipe_id", "=", recipe.id)
      .orderBy("v.version", "desc")
      .execute(),
    db
      .selectFrom("recipe_sources")
      .select(["kind", "url", "original_text", "filename", "data"])
      .where("recipe_id", "=", recipe.id)
      .orderBy("created_at")
      .executeTakeFirst(),
  ]);

  const current = versions.find((v) => v.id === recipe.current_version_id) ?? versions[0];
  if (!current) throw notFound("Oppskriften");

  const summarize = (v: (typeof versions)[number]) => ({
    id: v.id,
    version: v.version,
    kind: v.kind,
    changeNote: v.change_note,
    createdAt: v.created_at,
    createdBy: { id: v.user_id, name: v.user_name },
  });

  return {
    id: recipe.id,
    name: recipe.name,
    style: recipe.style,
    createdAt: recipe.created_at,
    updatedAt: recipe.updated_at,
    current: {
      ...summarize(current),
      data: parseJson<RecipeDocument>(current.data) as RecipeDocument,
      parentVersionId: current.parent_version_id,
    },
    versions: versions.map(summarize),
    source: source
      ? {
          kind: source.kind,
          url: source.url,
          // An imported file can be large; it is downloaded on its own (getRecipeSourceFile).
          originalText: source.filename === null ? source.original_text : null,
          filename: source.filename,
          bsmx: source.kind === "bsmx" ? parseJson<BsmxSourceData>(source.data) : null,
        }
      : null,
  };
}

/** The imported file behind a recipe, exactly as it was picked (for download). */
export async function getRecipeSourceFile(db: DB, breweryId: string, recipeId: string): Promise<{ filename: string; text: string }> {
  const recipe = await findRecipe(db, breweryId, recipeId);
  const source = await db
    .selectFrom("recipe_sources")
    .select(["filename", "original_text"])
    .where("recipe_id", "=", recipe.id)
    .where("filename", "is not", null)
    .orderBy("created_at")
    .executeTakeFirst();
  if (!source?.filename || source.original_text === null) throw notFound("Originalfilen");
  return { filename: source.filename, text: source.original_text };
}

export async function getRecipeVersion(db: DB, breweryId: string, recipeId: string, versionId: string) {
  await findRecipe(db, breweryId, recipeId);
  const version = await db
    .selectFrom("recipe_versions")
    .select(["id", "version", "kind", "data", "created_at"])
    .where("id", "=", versionId)
    .where("recipe_id", "=", recipeId)
    .executeTakeFirst();
  if (!version) throw notFound("Oppskriftsversjonen");
  return { ...version, data: parseJson<RecipeDocument>(version.data) as RecipeDocument };
}

/** A new recipe with where it came from. Imports add the file name and what they read from the file. */
export type NewRecipe = {
  recipe: RecipeDocument;
  source?: { kind: string; url?: string; originalText?: string; filename?: string; data?: unknown };
};

export async function createRecipe(
  d1: D1Database,
  db: DB,
  breweryId: string,
  user: SessionUser,
  input: z.output<typeof createRecipeSchema> | NewRecipe,
): Promise<string> {
  const now = Date.now();
  const recipeId = newId();
  const versionId = newId();
  const sourceId = newId();
  const source: NonNullable<NewRecipe["source"]> = input.source ?? { kind: "manual" };

  await atomic(d1, [
    db.insertInto("recipes").values({
      id: recipeId,
      brewery_id: breweryId,
      name: input.recipe.name,
      style: input.recipe.style ?? null,
      current_version_id: versionId,
      created_by: user.id,
      created_at: now,
      updated_at: now,
    }),
    db.insertInto("recipe_sources").values({
      id: sourceId,
      recipe_id: recipeId,
      kind: source.kind,
      original_text: source.originalText ?? null,
      url: source.url ?? null,
      attachment_id: null,
      filename: source.filename ?? null,
      data: source.data === undefined ? null : JSON.stringify(source.data),
      created_by: user.id,
      created_at: now,
    }),
    db.insertInto("recipe_versions").values({
      id: versionId,
      recipe_id: recipeId,
      version: 1,
      kind: "normalized",
      parent_version_id: null,
      source_id: sourceId,
      equipment_profile_id: null,
      data: JSON.stringify(input.recipe),
      change_note: null,
      created_by: user.id,
      created_at: now,
    }),
  ]);
  return recipeId;
}

/**
 * Saves an edit as a new immutable version. Fails with 409 when someone else saved a newer
 * version since `baseVersionId` was loaded, so concurrent edits are never silently lost.
 */
export async function saveRecipeVersion(
  d1: D1Database,
  db: DB,
  breweryId: string,
  recipeId: string,
  user: SessionUser,
  input: z.output<typeof saveRecipeVersionSchema> & { equipmentProfileId?: string | null },
): Promise<string> {
  const recipe = await findRecipe(db, breweryId, recipeId);
  if (recipe.current_version_id !== input.baseVersionId) {
    throw conflict("Oppskriften er endret av noen andre siden du åpnet den. Last inn på nytt.");
  }
  const base = await db
    .selectFrom("recipe_versions")
    .select(["version", "source_id"])
    .where("id", "=", input.baseVersionId)
    .executeTakeFirstOrThrow();

  const now = Date.now();
  const versionId = newId();
  const sourceId = input.source ? newId() : base.source_id;
  try {
    await atomic(d1, [
      ...(input.source ? [db.insertInto("recipe_sources").values({
        id: sourceId!, recipe_id: recipe.id, kind: input.source.kind,
        original_text: input.source.originalText, url: null, attachment_id: null,
        filename: null, data: null, created_by: user.id, created_at: now,
      })] : []),
      db.insertInto("recipe_versions").values({
        id: versionId,
        recipe_id: recipe.id,
        version: base.version + 1,
        kind: input.kind,
        parent_version_id: input.baseVersionId,
        source_id: sourceId,
        equipment_profile_id: input.equipmentProfileId ?? null,
        data: JSON.stringify(input.recipe),
        change_note: input.changeNote ?? null,
        created_by: user.id,
        created_at: now,
      }),
      db
        .updateTable("recipes")
        .set({ name: input.recipe.name, style: input.recipe.style ?? null, current_version_id: versionId, updated_at: now })
        .where("id", "=", recipe.id)
        .where("current_version_id", "=", input.baseVersionId),
    ]);
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Oppskriften ble lagret samtidig av noen andre. Last inn på nytt.");
    throw error;
  }
  return versionId;
}

export async function deleteRecipe(db: DB, membership: MembershipContext, user: SessionUser, recipeId: string): Promise<void> {
  const recipe = await findRecipe(db, membership.breweryId, recipeId);
  if (recipe.created_by !== user.id && membership.role !== "admin") {
    throw forbidden("Bare den som opprettet oppskriften, eller en administrator, kan slette den.");
  }
  // Soft delete: batches keep their frozen snapshot and link.
  await db.updateTable("recipes").set({ deleted_at: Date.now() }).where("id", "=", recipe.id).execute();
}
