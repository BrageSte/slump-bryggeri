import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { BSMX_MAX_BYTES } from "../../src/domain/import/bsmx.ts";
import { copyFromLibrarySchema, createRecipeSchema, importBsmxSchema, saveRecipeVersionSchema } from "../../src/domain/model/api.ts";
import type { AppEnv } from "../lib/context.ts";
import { HttpError } from "../lib/errors.ts";
import { parseJsonBody } from "../lib/validate.ts";
import { getActiveProfile } from "../services/equipment.ts";
import { copyLibraryRecipe } from "../services/library.ts";
import { importBsmxRecipe } from "../services/recipe-import.ts";
import {
  createRecipe,
  deleteRecipe,
  getRecipe,
  getRecipeSourceFile,
  getRecipeVersion,
  listRecipes,
  saveRecipeVersion,
} from "../services/recipes.ts";

/** The file travels as a JSON string; escaped newlines and quotes make the body larger than the file. */
const importBodyLimit = bodyLimit({
  maxSize: 3 * BSMX_MAX_BYTES,
  onError: () => {
    throw new HttpError(413, "too_large", `Filen er for stor (maks ${BSMX_MAX_BYTES / 1000} kB). Eksporter én oppskrift om gangen fra BeerSmith.`);
  },
});

/** `Content-Disposition: attachment` for any file name: an ASCII fallback plus the UTF-8 name (RFC 6266). */
function attachment(filename: string): string {
  const fallback = filename.replace(/[^\w. -]+/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Mounted under /breweries/:breweryId/recipes — membership is already verified. */
export const recipeRoutes = new Hono<AppEnv>()
  .get("/", async (c) => c.json(await listRecipes(c.var.db, c.var.membership.breweryId)))
  .post("/", async (c) => {
    const input = await parseJsonBody(c, createRecipeSchema);
    const id = await createRecipe(c.env.DB, c.var.db, c.var.membership.breweryId, c.var.user, input);
    return c.json({ id }, 201);
  })
  .post("/from-library", async (c) => {
    const { libraryId } = await parseJsonBody(c, copyFromLibrarySchema);
    const id = await copyLibraryRecipe(c.env.DB, c.var.db, c.var.membership.breweryId, c.var.user, libraryId);
    return c.json({ id }, 201);
  })
  .post("/import/bsmx", importBodyLimit, async (c) => {
    const input = await parseJsonBody(c, importBsmxSchema);
    const id = await importBsmxRecipe(c.env.DB, c.var.db, c.var.membership.breweryId, c.var.user, input);
    return c.json({ id }, 201);
  })
  .get("/:recipeId", async (c) => c.json(await getRecipe(c.var.db, c.var.membership.breweryId, c.req.param("recipeId"))))
  .get("/:recipeId/source/file", async (c) => {
    const file = await getRecipeSourceFile(c.var.db, c.var.membership.breweryId, c.req.param("recipeId"));
    return c.body(file.text, 200, {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": attachment(file.filename),
    });
  })
  .get("/:recipeId/versions/:versionId", async (c) =>
    c.json(await getRecipeVersion(c.var.db, c.var.membership.breweryId, c.req.param("recipeId"), c.req.param("versionId"))),
  )
  .post("/:recipeId/versions", async (c) => {
    const input = await parseJsonBody(c, saveRecipeVersionSchema);
    // An adaptation records the profile it was calculated for; the id comes from the server, not the client.
    const equipmentProfileId =
      input.kind === "adaptation" ? ((await getActiveProfile(c.var.db, c.var.membership.breweryId))?.id ?? null) : null;
    const id = await saveRecipeVersion(c.env.DB, c.var.db, c.var.membership.breweryId, c.req.param("recipeId"), c.var.user, {
      ...input,
      equipmentProfileId,
    });
    return c.json({ id }, 201);
  })
  .delete("/:recipeId", async (c) => {
    await deleteRecipe(c.var.db, c.var.membership, c.var.user, c.req.param("recipeId"));
    return c.body(null, 204);
  });
