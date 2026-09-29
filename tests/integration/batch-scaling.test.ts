import { beforeAll, describe, expect, it } from "vitest";
import { calculateRecipeMetrics } from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BatchDetail } from "../../src/domain/model/api.ts";
import { createBrewery, createUser, type TestUser } from "./client.ts";

/** A batch can be made at another size than the recipe: the frozen snapshot is scaled, the recipe is not. */
describe("batch scaling", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let base: string;
  let recipeId: string;

  const batchOf = async (extra: Record<string, unknown>) => {
    const created = await owner.post(`${base}/batches`, { recipeId, ...extra });
    if (created.status !== 201) return { created };
    const detail = await owner.get<BatchDetail>(`${base}/batches/${created.body.id}`);
    return { created, detail: detail.body };
  };

  beforeAll(async () => {
    owner = await createUser("Brage");
    stranger = await createUser("Fremmed");
    const brewery = await createBrewery(owner, "Slump Bryggeri");
    base = `/breweries/${brewery}`;
    const recipe = await owner.post(`${base}/recipes`, { recipe: sunsetIpaRecipe, source: { kind: "example" } });
    recipeId = recipe.body.id;
  });

  it("freezes the recipe exactly as it is when no size or efficiency is given", async () => {
    const { detail } = await batchOf({});
    expect(detail?.recipeSnapshot).toEqual(sunsetIpaRecipe);
  });

  it("does not touch the snapshot when the chosen size and efficiency equal the recipe's", async () => {
    const { detail } = await batchOf({ batchSizeL: sunsetIpaRecipe.batchSizeL, efficiencyPct: sunsetIpaRecipe.efficiencyPct });
    expect(detail?.recipeSnapshot).toEqual(sunsetIpaRecipe);
  });

  it("scales the snapshot to the chosen size, keeps OG and IBU, and leaves the recipe alone", async () => {
    const { detail } = await batchOf({ batchSizeL: 30 });
    const snapshot = detail!.recipeSnapshot;
    expect(snapshot.batchSizeL).toBe(30);
    expect(snapshot.fermentables.find((f) => f.id === "f-pale")?.amountKg).toBeCloseTo(7.4, 3);
    expect(snapshot.hops.find((h) => h.id === "h-simcoe-60")?.amountG).toBeCloseTo(32.5, 1);
    // Whole packages round up: half of one package is still one.
    expect(snapshot.cultures.find((c) => c.id === "y-pine")?.amount).toBe(1);
    expect(snapshot.cultures.find((c) => c.id === "y-tropical")?.amount).toBe(1);
    expect(calculateRecipeMetrics(snapshot).og).toBeCloseTo(calculateRecipeMetrics(sunsetIpaRecipe).og!, 3);
    expect(calculateRecipeMetrics(snapshot).ibu).toBeCloseTo(calculateRecipeMetrics(sunsetIpaRecipe).ibu!, 0);

    const recipe = await owner.get(`${base}/recipes/${recipeId}`);
    expect(recipe.body.versions).toHaveLength(1);
    expect(recipe.body.current.data.batchSizeL).toBe(60);
    expect(recipe.body.current.data.fermentables.find((f: { id: string }) => f.id === "f-pale").amountKg).toBe(14.8);
  });

  it("compensates the malt when the efficiency differs, so OG is kept", async () => {
    const { detail } = await batchOf({ efficiencyPct: 72 });
    const snapshot = detail!.recipeSnapshot;
    expect(snapshot.batchSizeL).toBe(60);
    expect(snapshot.efficiencyPct).toBe(72);
    expect(snapshot.fermentables.find((f) => f.id === "f-pale")?.amountKg).toBeCloseTo((14.8 * 60) / 72, 3);
    expect(calculateRecipeMetrics(snapshot).og).toBeCloseTo(calculateRecipeMetrics(sunsetIpaRecipe).og!, 3);
  });

  it("refuses sizes that would round an amount to nothing, and sizes that make no sense", async () => {
    const tiny = await batchOf({ batchSizeL: 0.001 });
    expect(tiny.created.status).toBe(400);
    expect(tiny.created.body.error.code).toBe("invalid_scaling");
    expect((await batchOf({ batchSizeL: 0 })).created.status).toBe(400);
    expect((await batchOf({ batchSizeL: -5 })).created.status).toBe(400);
    expect((await batchOf({ batchSizeL: 20_000 })).created.status).toBe(400);
    expect((await batchOf({ efficiencyPct: 0 })).created.status).toBe(400);
    expect((await batchOf({ efficiencyPct: 150 })).created.status).toBe(400);
  });

  it("does not let another brewery scale (or use) this brewery's recipe", async () => {
    const otherBrewery = await createBrewery(stranger, "Andre");
    const res = await stranger.post(`/breweries/${otherBrewery}/batches`, { recipeId, batchSizeL: 30 });
    expect(res.status).toBe(404);
  });
});
