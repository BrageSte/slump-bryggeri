import type { z } from "zod";
import { BsmxImportError, bsmxSourceData, parseBsmx, type BsmxRecipeImport } from "../../src/domain/import/bsmx.ts";
import type { importBsmxSchema } from "../../src/domain/model/api.ts";
import { recipeDocumentSchema } from "../../src/domain/model/recipe.ts";
import type { SessionUser } from "../lib/context.ts";
import type { DB } from "../lib/db.ts";
import { badRequest } from "../lib/errors.ts";
import { createRecipe } from "./recipes.ts";

/**
 * Imports one recipe from a BeerSmith file as a new recipe (a plan). The server parses the file
 * itself, so what is saved never depends on the client's copy of the parser.
 *
 * Hard import rule (docs/import-bsmx.md): nothing but the recipe and its source is written. No
 * batch, brew log, measurements, results or equipment calibration comes from BeerSmith, and the
 * file's equipment stays a snapshot on the source instead of changing the brewery's profile.
 */
export async function importBsmxRecipe(
  d1: D1Database,
  db: DB,
  breweryId: string,
  user: SessionUser,
  input: z.output<typeof importBsmxSchema>,
): Promise<string> {
  let recipes: BsmxRecipeImport[];
  try {
    recipes = parseBsmx(input.text);
  } catch (error) {
    if (error instanceof BsmxImportError) throw badRequest(error.message);
    throw error;
  }
  const imported = recipes[input.recipeIndex];
  if (!imported) throw badRequest("Filen har ikke så mange oppskrifter. Velg filen på nytt.");

  const recipe = recipeDocumentSchema.safeParse(imported.recipe);
  if (!recipe.success) {
    const issue = recipe.error.issues[0];
    throw badRequest(`Oppskriften i filen har en verdi Slump ikke kan lagre${issue ? ` (${issue.path.join(".")})` : ""}.`);
  }

  return createRecipe(d1, db, breweryId, user, {
    recipe: recipe.data,
    source: {
      kind: "bsmx",
      originalText: input.text,
      filename: input.filename,
      data: bsmxSourceData(imported, input.recipeIndex, recipes.length),
    },
  });
}
