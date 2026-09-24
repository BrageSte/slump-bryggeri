import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { convertDiyDogBeer, diyDogSearchText, type DiyDogBeer } from "../../src/domain/import/diy-dog.ts";
import type { LibraryRecipeDetail, LibrarySearchResponse, RecipeDetail } from "../../src/domain/model/api.ts";
import { libraryCategoryLabels } from "../../src/domain/model/library.ts";
import { messy, punkIpa } from "../fixtures/diy-dog-samples.ts";
import { createBrewery, createUser, request, type TestUser } from "./client.ts";

/** Same row shape the seed script writes. */
async function insertLibraryRecipe(id: string, beer: DiyDogBeer) {
  const { recipe, category, warnings } = convertDiyDogBeer(beer);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO recipe_library (id, source, source_ref, source_url, name, tagline, category, abv, ibu, og, fg, ebc,
       batch_size_l, search_text, data, source_data, warnings, imported_at)
     VALUES (?, 'diydog', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      String(beer.id),
      `https://example.com/${id}.json`,
      recipe.name,
      beer.tagline ?? null,
      category,
      recipe.targets.abvPct ?? null,
      recipe.targets.ibu ?? null,
      recipe.targets.og ?? null,
      recipe.targets.fg ?? null,
      recipe.targets.colorEbc ?? null,
      recipe.batchSizeL,
      diyDogSearchText(beer, libraryCategoryLabels[category]),
      JSON.stringify(recipe),
      JSON.stringify(beer),
      JSON.stringify(warnings),
      Date.now(),
    )
    .run();
}

describe("recipe library", () => {
  let brewer: TestUser;
  let brewery: string;

  beforeAll(async () => {
    await insertLibraryRecipe("diydog-001", punkIpa);
    await insertLibraryRecipe("diydog-999", messy);
    brewer = await createUser("Brage");
    brewery = await createBrewery(brewer);
  });

  it("requires a session", async () => {
    expect((await request("GET", "/library/recipes")).status).toBe(401);
  });

  it("searches by name, ingredient and category", async () => {
    const byName = await brewer.get<LibrarySearchResponse>("/library/recipes?q=punk");
    expect(byName.body.items.map((r) => r.id)).toEqual(["diydog-001"]);
    expect(byName.body.items[0]).toMatchObject({ category: "ipa", abvPct: 6, ibu: 60, og: 1.056, batchSizeL: 20 });

    const byHop = await brewer.get<LibrarySearchResponse>("/library/recipes?q=motueka");
    expect(byHop.body.items.map((r) => r.id)).toEqual(["diydog-001"]);

    const twoWords = await brewer.get<LibrarySearchResponse>("/library/recipes?q=imperial%20columbus");
    expect(twoWords.body.items.map((r) => r.id)).toEqual(["diydog-999"]);

    const stouts = await brewer.get<LibrarySearchResponse>("/library/recipes?category=stout");
    expect(stouts.body.items.map((r) => r.id)).toContain("diydog-999");
    expect(stouts.body.items.map((r) => r.id)).not.toContain("diydog-001");
  });

  it("treats % and _ in the search text literally", async () => {
    const res = await brewer.get<LibrarySearchResponse>("/library/recipes?q=%25");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
  });

  it("validates query parameters", async () => {
    expect((await brewer.get("/library/recipes?category=pilsner-ish")).status).toBe(400);
    expect((await brewer.get("/library/recipes?limit=5000")).status).toBe(400);
  });

  it("returns the normalized recipe with source and interpretation notes", async () => {
    const res = await brewer.get<LibraryRecipeDetail>("/library/recipes/diydog-999");
    expect(res.status).toBe(200);
    expect(res.body.source).toMatchObject({ key: "diydog", name: "BrewDog DIY Dog" });
    expect(res.body.recipe.boilTimeMin).toBe(90);
    expect(res.body.warnings.length).toBeGreaterThan(0);
    expect((await brewer.get("/library/recipes/nope")).status).toBe(404);
  });

  it("copies a recipe into the brewery and keeps the original source", async () => {
    const copied = await brewer.post<{ id: string }>(`/breweries/${brewery}/recipes/from-library`, { libraryId: "diydog-001" });
    expect(copied.status).toBe(201);
    const recipe = await brewer.get<RecipeDetail>(`/breweries/${brewery}/recipes/${copied.body.id}`);
    expect(recipe.body.name).toBe("Punk IPA 2007 - 2010");
    expect(recipe.body.current.version).toBe(1);
    expect(recipe.body.source).toMatchObject({ kind: "library", url: "https://example.com/diydog-001.json" });
    expect(JSON.parse(recipe.body.source?.originalText ?? "{}").name).toBe("Punk IPA 2007 - 2010");
  });

  it("only copies into breweries the user belongs to", async () => {
    const outsider = await createUser("Outsider");
    expect((await outsider.post(`/breweries/${brewery}/recipes/from-library`, { libraryId: "diydog-001" })).status).toBe(404);
    expect((await brewer.post(`/breweries/${brewery}/recipes/from-library`, { libraryId: "missing" })).status).toBe(404);
  });
});
