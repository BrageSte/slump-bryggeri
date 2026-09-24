import { Hono } from "hono";
import { copyFromLibrarySchema, createRecipeSchema, saveRecipeVersionSchema } from "../../src/domain/model/api.ts";
import type { AppEnv } from "../lib/context.ts";
import { parseJsonBody } from "../lib/validate.ts";
import { getActiveProfile } from "../services/equipment.ts";
import { copyLibraryRecipe } from "../services/library.ts";
import { createRecipe, deleteRecipe, getRecipe, getRecipeVersion, listRecipes, saveRecipeVersion } from "../services/recipes.ts";

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
  .get("/:recipeId", async (c) => c.json(await getRecipe(c.var.db, c.var.membership.breweryId, c.req.param("recipeId"))))
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
