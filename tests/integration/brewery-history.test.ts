import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { createDb } from "../../worker/lib/db.ts";
import { loadBreweryHistory } from "../../worker/services/brewery-history.ts";
import { createBrewery, createUser, type TestUser } from "./client.ts";

async function addReadings(user: TestUser, breweryId: string, batchId: string, preBoil: number, postBoil: number, mashTemp: number) {
  const readings = [
    { kind: "volume", value: preBoil, stage: "lauter" },
    { kind: "volume", value: postBoil, stage: "boil" },
    { kind: "sg", value: 1.061, stage: "cooling" },
    { kind: "volume", value: 60, stage: "fermentation" },
    { kind: "temperature", value: mashTemp, stage: "mash" },
  ];
  for (const reading of readings) {
    const response = await user.post(`/breweries/${breweryId}/batches/${batchId}/measurements`, reading);
    expect(response.status, JSON.stringify(reading)).toBe(201);
  }
  const outcome = await user.put(`/breweries/${breweryId}/batches/${batchId}/outcomes`, {
    splitId: null,
    og: 1.061,
    ogSource: "sg",
    fg: 1.012,
    fgSource: "sg",
    packagedVolumeL: null,
    packagedOn: null,
    packaging: null,
    carbonationVols: null,
    tastingNotes: null,
    rating: null,
    nextTime: null,
  });
  expect(outcome.status).toBe(200);
}

describe("brewery history service", () => {
  let alice: TestUser;
  let bob: TestUser;
  let breweryId: string;
  let otherBreweryId: string;
  let batchIds: string[];
  let otherBatchId: string;

  beforeAll(async () => {
    alice = await createUser("History Alice");
    bob = await createUser("History Bob");
    breweryId = await createBrewery(alice, "History Brewery");
    otherBreweryId = await createBrewery(bob, "Other History Brewery");
    const recipeId = (await alice.post(`/breweries/${breweryId}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const otherRecipeId = (await bob.post(`/breweries/${otherBreweryId}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const newest = (await alice.post(`/breweries/${breweryId}/batches`, { recipeId, name: "Newest", brewDate: "2026-09-27" })).body.id;
    const older = (await alice.post(`/breweries/${breweryId}/batches`, { recipeId, name: "Older", brewDate: "2026-09-26" })).body.id;
    otherBatchId = (await bob.post(`/breweries/${otherBreweryId}/batches`, { recipeId: otherRecipeId, name: "Other brewery" })).body.id;
    batchIds = [newest, older];
    await addReadings(alice, breweryId, newest, 75, 62, 65.5);
    await addReadings(alice, breweryId, older, 75, 65, 67.5);
  });

  it("loads only this brewery's newest batches, aggregates measured results and supports exclusion", async () => {
    const db = createDb(env.DB);
    const history = await loadBreweryHistory(db, breweryId);
    expect(history.batches.map((batch) => batch.id)).toEqual(batchIds);
    expect(history.aggregates.boilOffLPerH).toEqual({ n: 2, mean: 11.5, min: 10, max: 13 });
    expect(history.aggregates.strikeOffsetDeviationC).toEqual({ n: 2, mean: 0, min: -1, max: 1 });
    expect(history.aggregates.attenuationByCulture["Fermoale New-E"]?.n).toBe(2);
    expect(history.batches.map((batch) => batch.id)).not.toContain(otherBatchId);

    const excluded = await loadBreweryHistory(db, breweryId, { excludeBatchId: batchIds[0] });
    expect(excluded.batches.map((batch) => batch.id)).toEqual([batchIds[1]]);
    const newestOnly = await loadBreweryHistory(db, breweryId, { limit: 1 });
    expect(newestOnly.batches.map((batch) => batch.id)).toEqual([batchIds[0]]);

    const otherHistory = await loadBreweryHistory(db, otherBreweryId);
    expect(otherHistory.batches.map((batch) => batch.id)).toEqual([otherBatchId]);
  });
});
