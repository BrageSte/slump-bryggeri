import { Hono } from "hono";
import { librarySearchQuerySchema } from "../../src/domain/model/api.ts";
import type { AppEnv } from "../lib/context.ts";
import { parse } from "../lib/validate.ts";
import { getLibraryRecipe, searchLibrary } from "../services/library.ts";

/** Public reference recipes; any signed-in user may read them. */
export const libraryRoutes = new Hono<AppEnv>()
  .get("/recipes", async (c) => c.json(await searchLibrary(c.var.db, parse(librarySearchQuerySchema, c.req.query()))))
  .get("/recipes/:libraryId", async (c) => c.json(await getLibraryRecipe(c.var.db, c.req.param("libraryId"))));
