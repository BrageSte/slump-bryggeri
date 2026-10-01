import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BatchDetail, TimelineItem } from "../../src/domain/model/api.ts";
import { summarizeWaterOfBatch } from "../../src/domain/water/batch-water.ts";
import { slumpBaseWater } from "../../src/domain/water/slump-water.ts";
import { createBrewery, createUser, type TestUser } from "./client.ts";

/** Water chemistry through the real API: frozen source water, planned and logged salts and acids, and pH with its context. */
describe("water chemistry in recipes and the brew log", () => {
  let brage: TestUser;
  let base: string;
  let recipeId: string;

  const waterRecipe = {
    ...sunsetIpaRecipe,
    water: { profileName: "Kloridfremhevet", target: { ca: 100, cl: 150, so4: 50 }, notes: "Hazy" },
    miscs: [
      ...sunsetIpaRecipe.miscs,
      { id: "m-gypsum", name: "Gips", amount: 10, unit: "g", use: "mash", waterAgent: "gypsum" },
      { id: "m-lactic", name: "Melkesyre", amount: 12, unit: "ml", use: "mash", waterAgent: "lactic_acid", acidStrengthPct: 80 },
    ],
  };

  const newBatch = async () => (await brage.post<{ id: string }>(`${base}/batches`, { recipeId })).body.id;
  const detail = async (batchId: string) => (await brage.get<BatchDetail>(`${base}/batches/${batchId}`)).body;
  const timeline = async (batchId: string) => (await brage.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`)).body;

  beforeAll(async () => {
    brage = await createUser("Brage");
    base = `/breweries/${await createBrewery(brage, "Slump Bryggeri")}`;
    const created = await brage.post<{ id: string }>(`${base}/recipes`, { recipe: waterRecipe, source: { kind: "manual" } });
    expect(created.status).toBe(201);
    recipeId = created.body.id;
  });

  it("stores the recipe's water plan and tagged salts and acids as written", async () => {
    const recipe = await brage.get(`${base}/recipes/${recipeId}`);
    expect(recipe.body.current.data.water).toEqual(waterRecipe.water);
    expect(recipe.body.current.data.miscs.filter((misc: { waterAgent?: string }) => misc.waterAgent).map((misc: { id: string }) => misc.id)).toEqual(["m-gypsum", "m-lactic"]);
  });

  it("rejects an unknown agent, a negative planned ion and an impossible acid strength with field-level errors", async () => {
    const unknownAgent = await brage.post(`${base}/recipes`, { recipe: { ...waterRecipe, miscs: [{ id: "m1", name: "Rart", amount: 1, unit: "g", use: "mash", waterAgent: "snake_oil" }] } });
    expect(unknownAgent.status).toBe(400);
    expect(unknownAgent.body.error.issues[0].path).toBe("recipe.miscs.0.waterAgent");
    const negativeIon = await brage.post(`${base}/recipes`, { recipe: { ...waterRecipe, water: { target: { ca: -1 } } } });
    expect(negativeIon.body.error.issues[0].path).toBe("recipe.water.target.ca");
    const strength = await brage.post(`${base}/recipes`, { recipe: { ...waterRecipe, miscs: [{ id: "m1", name: "Syre", amount: 1, unit: "ml", use: "mash", waterAgent: "lactic_acid", acidStrengthPct: 150 }] } });
    expect(strength.body.error.issues[0].path).toBe("recipe.miscs.0.acidStrengthPct");
  });

  it("freezes the source water, with its source and date, into every new batch", async () => {
    const batch = await detail(await newBatch());
    expect(batch.equipmentSnapshot.water).toEqual(slumpBaseWater);
    expect(batch.equipmentSnapshot.water?.source).toMatchObject({ retrievedAt: "2026-10-01", publishedAt: null, url: "https://www.abvann.no/temasider/vannkvalitet" });
    expect(batch.recipeSnapshot.water).toEqual(waterRecipe.water);
  });

  it("reads a batch created before water chemistry as having no frozen profile", async () => {
    const batchId = await newBatch();
    // The shape the snapshot had before this change: values and sources, no water.
    await env.DB.prepare("DELETE FROM batch_equipment_snapshots WHERE batch_id = ?").bind(batchId).run();
    await env.DB.prepare("INSERT INTO batch_equipment_snapshots (batch_id, equipment_profile_id, profile_version, data, created_at) VALUES (?, NULL, NULL, ?, ?)")
      .bind(batchId, JSON.stringify({ values: { boil_off_l_per_h: 6 }, sources: { boil_off_l_per_h: "manual" }, equipment: [] }), Date.now())
      .run();
    const batch = await detail(batchId);
    expect(batch.equipmentSnapshot.water).toBeNull();
    expect(batch.equipmentSnapshot.values).toEqual({ boil_off_l_per_h: 6 });
    // Readers fall back to the brewery's base water and say it is assumed.
    const summary = summarizeWaterOfBatch(batch, []);
    expect(summary.source.frozen).toBe(false);
    expect(summary.source.profile.id).toBe(slumpBaseWater.id);
  });

  it("records which salt or acid was added, and nothing malformed", async () => {
    const batchId = await newBatch();
    await brage.post(`${base}/batches/${batchId}/stage`, { stage: "mash" });
    const gypsum = await brage.post(`${base}/batches/${batchId}/events`, {
      type: "ingredient_added",
      stage: "mash",
      data: { ingredientKind: "misc", ingredientId: "m-gypsum", name: "Gips", amount: 11, unit: "g", waterAgent: "gypsum" },
    });
    const lactic = await brage.post(`${base}/batches/${batchId}/events`, {
      type: "ingredient_added",
      stage: "mash",
      data: { ingredientKind: "misc", name: "Melkesyre", amount: 8, unit: "ml", waterAgent: "lactic_acid", acidStrengthPct: 88 },
    });
    expect([gypsum.status, lactic.status]).toEqual([201, 201]);
    const items = await timeline(batchId);
    expect(items.find((item) => item.id === gypsum.body.id)?.data).toMatchObject({ ingredientId: "m-gypsum", amount: 11, waterAgent: "gypsum" });
    expect(items.find((item) => item.id === lactic.body.id)?.data).toMatchObject({ waterAgent: "lactic_acid", acidStrengthPct: 88 });

    const summary = summarizeWaterOfBatch(await detail(batchId), items);
    expect(summary.measured.additions.map((addition) => [addition.agent, addition.amount, addition.acidStrengthPct])).toEqual([
      ["gypsum", 11, null],
      ["lactic_acid", 8, 88],
    ]);

    const bad = await brage.post(`${base}/batches/${batchId}/events`, {
      type: "ingredient_added",
      data: { ingredientKind: "misc", name: "Rart", amount: 1, unit: "g", waterAgent: "snake_oil" },
    });
    expect(bad.status).toBe(400);
  });

  it("records pH with sample temperature, instrument and sample point, and a correction can change or clear them", async () => {
    const batchId = await newBatch();
    await brage.post(`${base}/batches/${batchId}/stage`, { stage: "lauter" });
    const logged = await brage.post(`${base}/batches/${batchId}/measurements`, {
      kind: "ph",
      value: 5.31,
      stage: "lauter",
      label: "pH før kok",
      sampleTempC: 22,
      instrument: "pH-meter",
      comment: "Kalibrert i dag",
    });
    expect(logged.status).toBe(201);
    const original = (await timeline(batchId)).find((item) => item.id === logged.body.id)!;
    expect(original.measurement).toMatchObject({ kind: "ph", value: 5.31, label: "pH før kok", sampleTempC: 22, instrument: "pH-meter" });

    const summary = summarizeWaterOfBatch(await detail(batchId), await timeline(batchId));
    expect(summary.measured.ph).toEqual([expect.objectContaining({ point: "pre_boil", value: 5.31, sampleTempC: 22, instrument: "pH-meter" })]);

    const corrected = await brage.patch(`${base}/batches/${batchId}/events/${original.id}/correction`, {
      entryKind: "measurement",
      baseUpdatedAt: original.updatedAt,
      value: 5.31,
      unit: "pH",
      label: null,
      occurredAt: original.occurredAt,
      stage: "lauter",
      splitId: null,
      sampleTempC: 24,
      instrument: null,
    });
    expect(corrected.status).toBe(201);
    const replacement = (await timeline(batchId)).find((item) => item.id === corrected.body.id)!;
    // The stage already says «før kok», so the label can go; the temperature changed; the instrument is cleared.
    expect(replacement.measurement).toMatchObject({ label: null, sampleTempC: 24, instrument: null, comment: "Kalibrert i dag" });
    expect(summarizeWaterOfBatch(await detail(batchId), await timeline(batchId)).measured.ph[0]).toMatchObject({ point: "pre_boil", sampleTempC: 24 });

    const kept = await brage.patch(`${base}/batches/${batchId}/events/${replacement.id}/correction`, {
      entryKind: "measurement",
      baseUpdatedAt: replacement.updatedAt,
      value: 5.3,
      unit: "pH",
      occurredAt: replacement.occurredAt,
      stage: "lauter",
      splitId: null,
    });
    expect(kept.status).toBe(201);
    const afterKeep = (await timeline(batchId)).find((item) => item.id === kept.body.id)!;
    // Left out means unchanged.
    expect(afterKeep.measurement).toMatchObject({ value: 5.3, sampleTempC: 24, instrument: null });
  });

  it("leaves a pH logged the old way exactly as it was, with the sample point read from the stage", async () => {
    const batchId = await newBatch();
    await brage.post(`${base}/batches/${batchId}/stage`, { stage: "mash" });
    const logged = await brage.post(`${base}/batches/${batchId}/measurements`, { kind: "ph", value: 5.34 });
    const entry = (await timeline(batchId)).find((item) => item.id === logged.body.id)!;
    expect(entry.measurement).toMatchObject({ value: 5.34, label: null, sampleTempC: null, instrument: null });
    expect(summarizeWaterOfBatch(await detail(batchId), await timeline(batchId)).measured.ph[0]).toMatchObject({ point: "mash", sampleTempC: null, instrument: null });
  });

  it("keeps a pH strip interval as an interval and reads its sample point the same way", async () => {
    const batchId = await newBatch();
    await brage.post(`${base}/batches/${batchId}/stage`, { stage: "mash" });
    const logged = await brage.post(`${base}/batches/${batchId}/measurements`, { kind: "ph", value: 5.3, valueMin: 5.2, valueMax: 5.4, sampleTempC: 21 });
    expect(logged.status).toBe(201);
    const reading = summarizeWaterOfBatch(await detail(batchId), await timeline(batchId)).measured.ph[0]!;
    expect(reading).toMatchObject({ point: "mash", valueMin: 5.2, valueMax: 5.4, instrument: "pH-strips", sampleTempC: 21 });
  });
});
