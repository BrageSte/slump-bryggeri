import { beforeAll, describe, expect, it } from "vitest";
import { sunsetIpaBrewLog, sunsetIpaRecipe, sunsetIpaSplits } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BatchDetail, TimelineItem } from "../../src/domain/model/api.ts";
import { deriveBrewDayState } from "../../src/domain/brew-day/state.ts";
import { addMember, createBrewery, createUser, type TestUser } from "./client.ts";

/**
 * The MVP vertical slice (spec §47/§61): create brewery → invite → recipe → batch →
 * three people log the same brew → everyone sees the same log → finish the batch.
 */
describe("collaborative brew day", () => {
  let brage: TestUser;
  let kari: TestUser;
  let ola: TestUser;
  let brewery: string;
  let recipeId: string;
  let batchId: string;
  let base: string;

  beforeAll(async () => {
    brage = await createUser("Brage");
    kari = await createUser("Kari");
    ola = await createUser("Ola");
    brewery = await createBrewery(brage, "Slump Bryggeri");
    await addMember(brage, brewery, kari);
    await addMember(brage, brewery, ola);
    base = `/breweries/${brewery}`;
  });

  it("gives the brewery three members and a default equipment profile", async () => {
    const detail = await brage.get(base);
    expect(detail.body.members.map((m: { user: { name: string } }) => m.user.name)).toEqual(["Brage", "Kari", "Ola"]);
    const profile = await kari.get(`${base}/equipment-profile`);
    expect(profile.body.version).toBe(1);
    expect(profile.body.values.brewhouse_efficiency_pct.value).toBe(72);
  });

  it("creates a recipe manually and a batch from it", async () => {
    const created = await kari.post(`${base}/recipes`, { recipe: sunsetIpaRecipe, source: { kind: "example" } });
    expect(created.status).toBe(201);
    recipeId = created.body.id;

    const batch = await brage.post(`${base}/batches`, { recipeId, brewDate: "2026-09-23" });
    expect(batch.status).toBe(201);
    batchId = batch.body.id;

    const detail = await ola.get<BatchDetail>(`${base}/batches/${batchId}`);
    expect(detail.body).toMatchObject({ number: 1, status: "planned", currentStage: null, name: sunsetIpaRecipe.name });
    expect(detail.body.recipeSnapshot).toEqual(sunsetIpaRecipe);
    expect(detail.body.equipmentSnapshot.profileVersion).toBe(1);
  });

  it("rejects invalid recipes with field-level errors", async () => {
    const res = await kari.post(`${base}/recipes`, { recipe: { ...sunsetIpaRecipe, batchSizeL: -5 } });
    expect(res.status).toBe(400);
    expect(res.body.error.issues[0].path).toBe("recipe.batchSizeL");
  });

  it("keeps the batch snapshot frozen when the recipe and calibration change later", async () => {
    const recipe = await kari.get(`${base}/recipes/${recipeId}`);
    const saved = await kari.post(`${base}/recipes/${recipeId}/versions`, {
      recipe: { ...sunsetIpaRecipe, batchSizeL: 72, name: "Sunset IPA v2" },
      baseVersionId: recipe.body.current.id,
      changeNote: "Skalert til 72 L",
    });
    expect(saved.status).toBe(201);

    const profile = await brage.post(`${base}/equipment-profile/versions`, {
      values: { brewhouse_efficiency_pct: 60, boil_off_l_per_h: 13.2 },
      changeNote: "Fra Sunset IPA",
    });
    expect(profile.status).toBe(201);

    const detail = await ola.get<BatchDetail>(`${base}/batches/${batchId}`);
    expect(detail.body.recipeSnapshot.batchSizeL).toBe(60);
    expect(detail.body.recipeSnapshot.name).toBe(sunsetIpaRecipe.name);
    expect(detail.body.equipmentSnapshot.values.brewhouse_efficiency_pct).toBe(72);

    // A new batch picks up the new version and profile.
    const second = await ola.post(`${base}/batches`, { recipeId });
    const secondDetail = await ola.get<BatchDetail>(`${base}/batches/${second.body.id}`);
    expect(secondDetail.body.number).toBe(2);
    expect(secondDetail.body.recipeSnapshot.batchSizeL).toBe(72);
    expect(secondDetail.body.equipmentSnapshot).toMatchObject({ profileVersion: 2, values: { brewhouse_efficiency_pct: 60 } });
  });

  it("detects conflicting recipe edits", async () => {
    const recipe = await kari.get(`${base}/recipes/${recipeId}`);
    const stale = recipe.body.versions.at(-1).id;
    const res = await ola.post(`${base}/recipes/${recipeId}/versions`, { recipe: sunsetIpaRecipe, baseVersionId: stale });
    expect(res.status).toBe(409);
  });

  it("lets one person log a temperature that everyone else sees (spec §61)", async () => {
    expect((await brage.post(`${base}/batches/${batchId}/stage`, { stage: "mash" })).status).toBe(201);
    const logged = await kari.post(`${base}/batches/${batchId}/measurements`, { kind: "temperature", value: 66.8 });
    expect(logged.status).toBe(201);

    for (const viewer of [brage, ola]) {
      const timeline = await viewer.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
      const entry = timeline.body.find((e) => e.id === logged.body.id);
      expect(entry).toMatchObject({
        type: "measurement",
        stage: "mash",
        createdBy: { name: "Kari" },
        measurement: { kind: "temperature", value: 66.8, unit: "°C" },
      });
    }

    const batch = await ola.get<BatchDetail>(`${base}/batches/${batchId}`);
    expect(batch.body).toMatchObject({ status: "brewing", currentStage: "mash" });
  });

  it("keeps the log chronological when three people write at once", async () => {
    const t = Date.now();
    await Promise.all([
      brage.post(`${base}/batches/${batchId}/measurements`, { kind: "ph", value: 5.34, measuredAt: t + 3000 }),
      kari.post(`${base}/batches/${batchId}/comments`, { body: "Lukter nydelig", occurredAt: t + 1000 }),
      ola.post(`${base}/batches/${batchId}/measurements`, { kind: "temperature", value: 66.9, measuredAt: t + 2000 }),
      // Backdated entry (logged afterwards) sorts by when it happened.
      ola.post(`${base}/batches/${batchId}/measurements`, { kind: "temperature", value: 67.1, measuredAt: t - 60_000 }),
    ]);
    const timeline = await brage.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    const times = timeline.body.map((e) => e.occurredAt);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    const recent = timeline.body.filter((e) => e.occurredAt >= t);
    expect(recent.map((e) => e.createdBy.name)).toEqual(["Kari", "Ola", "Brage"]);
  });

  it("validates measurement values and units", async () => {
    const path = `${base}/batches/${batchId}/measurements`;
    expect((await kari.post(path, { kind: "ph", value: 15 })).status).toBe(400);
    const fahrenheit = await kari.post(path, { kind: "temperature", value: 66, unit: "°F" });
    expect(fahrenheit.status).toBe(201);
    const gallons = await kari.post(path, { kind: "volume", value: 21, unit: "US gal" });
    expect(gallons.status).toBe(201);
    const timeline = await kari.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    expect(timeline.body.find((event) => event.id === fahrenheit.body.id)?.measurement).toMatchObject({
      kind: "temperature",
      value: expect.closeTo(18.8889, 3),
      unit: "°C",
      enteredValue: 66,
      enteredUnit: "°F",
    });
    expect(timeline.body.find((event) => event.id === gallons.body.id)?.measurement).toMatchObject({
      kind: "volume",
      value: expect.closeTo(79.4936, 3),
      unit: "L",
      enteredValue: 21,
      enteredUnit: "US gal",
    });
    const strips = await kari.post(path, { kind: "ph", value: 5.3, valueMin: 5.8, valueMax: 6.0 });
    expect(strips.status).toBe(201);
    const withStrips = await kari.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    expect(withStrips.body.find((event) => event.id === strips.body.id)?.measurement).toMatchObject({
      kind: "ph",
      value: 5.9,
      enteredValue: 5.9,
      valueMin: 5.8,
      valueMax: 6,
      instrument: "pH-strips",
    });
    const exactPh = await kari.post(path, { kind: "ph", value: 5.3 });
    expect(exactPh.status).toBe(201);
    const withExactPh = await kari.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    expect(withExactPh.body.find((event) => event.id === exactPh.body.id)?.measurement).toMatchObject({
      kind: "ph",
      value: 5.3,
      instrument: null,
    });
    expect((await kari.post(path, { kind: "ph", value: 5.9, valueMin: 6.0, valueMax: 5.8, instrument: "pH-strips" })).status).toBe(400);
    expect((await kari.post(path, { kind: "temperature", value: 66, valueMin: 65, valueMax: 67 })).status).toBe(400);
    expect((await kari.post(path, { kind: "volume", value: 10, unit: "imperial gallons" })).status).toBe(400);
    expect((await kari.post(path, { kind: "custom", value: 3 })).status).toBe(400);
    expect((await kari.post(path, { kind: "custom", value: 3, unit: "ppm", label: "Oppløst O2" })).status).toBe(201);
    expect((await kari.post(path, { kind: "sg", value: "1.061" })).status).toBe(400);
  });

  it("lets only the author edit a comment", async () => {
    const created = await kari.post(`${base}/batches/${batchId}/comments`, { body: "Mesk-pH ser bra ut" });
    const timeline = await kari.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    const commentId = timeline.body.find((e) => e.id === created.body.id)?.comment?.id as string;

    expect((await ola.patch(`${base}/batches/${batchId}/comments/${commentId}`, { body: "Hacket" })).status).toBe(403);
    expect((await kari.patch(`${base}/batches/${batchId}/comments/${commentId}`, { body: "Mesk-pH 5,34 – bra" })).status).toBe(204);

    const after = await ola.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    const comment = after.body.find((e) => e.id === created.body.id)?.comment;
    expect(comment?.body).toBe("Mesk-pH 5,34 – bra");
    expect(comment?.editedAt).toBeTypeOf("number");
  });

  it("replaces a corrected measurement and the new value drives target comparison", async () => {
    const batch = await kari.post(`${base}/batches`, { recipeId });
    const correctionBatchId = batch.body.id as string;
    expect((await kari.post(`${base}/batches/${correctionBatchId}/stage`, { stage: "mash" })).status).toBe(201);
    const logged = await kari.post(`${base}/batches/${correctionBatchId}/measurements`, { kind: "ph", value: 5.34 });
    const before = await kari.get<TimelineItem[]>(`${base}/batches/${correctionBatchId}/timeline`);
    const original = before.body.find((item) => item.id === logged.body.id)!;

    const corrected = await ola.patch(`${base}/batches/${correctionBatchId}/events/${original.id}/correction`, {
      entryKind: "measurement",
      baseUpdatedAt: original.updatedAt,
      value: 5.48,
      unit: "pH",
      label: original.measurement?.label,
      occurredAt: original.occurredAt + 1000,
      stage: "mash",
      splitId: null,
      sampleTempC: null,
      comment: "Første avlesning var feil",
    });
    expect(corrected.status).toBe(201);

    const after = await ola.get<TimelineItem[]>(`${base}/batches/${correctionBatchId}/timeline`);
    expect(after.body.some((item) => item.id === original.id)).toBe(false);
    const replacement = after.body.find((item) => item.id === corrected.body.id)!;
    expect(replacement.measurement).toMatchObject({ kind: "ph", value: 5.48, unit: "pH", instrument: null, comment: "Første avlesning var feil" });
    expect(replacement.data?.corrections).toEqual([
      expect.objectContaining({
        previousMeasurement: expect.objectContaining({ value: 5.34, unit: "pH" }),
        previousCreatedByName: "Kari",
        previousOccurredAt: original.occurredAt,
        correctedBy: ola.id,
      }),
    ]);

    const detail = await ola.get<BatchDetail>(`${base}/batches/${correctionBatchId}`);
    const state = deriveBrewDayState({
      recipe: detail.body.recipeSnapshot,
      stage: "mash",
      stageStartedAt: detail.body.stageStartedAt,
      log: after.body.map((item) => ({
        type: item.type,
        stage: item.stage,
        occurredAt: item.occurredAt,
        data: item.data,
        measurement: item.measurement
          ? { kind: item.measurement.kind, value: item.measurement.value, valueMin: item.measurement.valueMin, valueMax: item.measurement.valueMax }
          : null,
      })),
      now: Date.now(),
    });
    expect(state.targets.find((target) => target.key === "mash-ph")).toMatchObject({ actual: { value: 5.48 }, status: "high" });

    const stale = await ola.patch(`${base}/batches/${correctionBatchId}/events/${replacement.id}/correction`, {
      entryKind: "measurement",
      baseUpdatedAt: replacement.updatedAt! - 1,
      value: 5.3,
      unit: "pH",
      occurredAt: replacement.occurredAt,
      stage: "mash",
      splitId: null,
    });
    expect(stale.status).toBe(409);
  });

  it("corrects generic event data by replacing the old timeline row", async () => {
    const batch = await kari.post(`${base}/batches`, { recipeId });
    const correctionBatchId = batch.body.id as string;
    const logged = await kari.post(`${base}/batches/${correctionBatchId}/events`, {
      type: "custom",
      stage: "boil",
      data: { title: "Vørtervolum", amount: 20, unit: "US gal", note: "før" },
    });
    const before = await kari.get<TimelineItem[]>(`${base}/batches/${correctionBatchId}/timeline`);
    const original = before.body.find((item) => item.id === logged.body.id)!;
    const corrected = await ola.patch(`${base}/batches/${correctionBatchId}/events/${original.id}/correction`, {
      entryKind: "event",
      baseUpdatedAt: original.updatedAt,
      occurredAt: original.occurredAt + 1000,
      stage: "boil",
      splitId: null,
      data: { ...original.data, amount: 19, unit: "US gal", note: "målt på nytt" },
    });
    expect(corrected.status).toBe(201);
    const after = await ola.get<TimelineItem[]>(`${base}/batches/${correctionBatchId}/timeline`);
    expect(after.body.some((item) => item.id === original.id)).toBe(false);
    const replacement = after.body.find((item) => item.id === corrected.body.id)!;
    expect(replacement.data).toMatchObject({ amount: 19, unit: "US gal", note: "målt på nytt" });
    expect(replacement.data?.corrections).toEqual([
      expect.objectContaining({ previousData: expect.objectContaining({ amount: 20, note: "før" }) }),
    ]);
  });

  it("lets authors and admins remove log entries, but not other members", async () => {
    const logged = await ola.post(`${base}/batches/${batchId}/measurements`, { kind: "temperature", value: 12 });
    expect((await kari.delete(`${base}/batches/${batchId}/events/${logged.body.id}`)).status).toBe(403);
    expect((await brage.delete(`${base}/batches/${batchId}/events/${logged.body.id}`)).status).toBe(204);
    const timeline = await ola.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    expect(timeline.body.some((e) => e.id === logged.body.id)).toBe(false);
  });

  it("stores photos in R2 and serves them only to members", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const form = new FormData();
    form.set("file", new File([bytes], "bunnfall.png", { type: "image/png" }));
    form.set("caption", "Bunnfall i FermZilla");
    const uploaded = await ola.upload(`${base}/batches/${batchId}/attachments`, form);
    expect(uploaded.status).toBe(201);

    const timeline = await kari.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    const photo = timeline.body.find((e) => e.id === uploaded.body.id);
    expect(photo?.attachment).toMatchObject({ caption: "Bunnfall i FermZilla", contentType: "image/png", sizeBytes: 8 });

    const download = await kari.get(photo?.attachment?.url.replace(/^\/api/, "") as string);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");

    const svg = new FormData();
    svg.set("file", new File(["<svg onload=alert(1)>"], "x.svg", { type: "image/svg+xml" }));
    expect((await ola.upload(`${base}/batches/${batchId}/attachments`, svg)).status).toBe(400);

    const outsider = await createUser("Outsider");
    expect((await outsider.get(photo?.attachment?.url.replace(/^\/api/, "") as string)).status).toBe(404);
  });

  it("finishes the batch so it moves to history", async () => {
    expect((await brage.patch(`${base}/batches/${batchId}`, { status: "completed" })).status).toBe(204);
    const done = await kari.get(`${base}/batches?status=completed`);
    expect(done.body.map((b: { id: string }) => b.id)).toContain(batchId);
    const active = await kari.get(`${base}/batches?status=brewing,fermenting,conditioning`);
    expect(active.body.map((b: { id: string }) => b.id)).not.toContain(batchId);
    const timeline = await kari.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    expect(timeline.body.find((e) => e.type === "status_changed")).toMatchObject({
      createdBy: { name: "Brage" },
      data: { from: "brewing", to: "completed" },
    });
  });
});

describe("Sunset IPA reference batch replayed through the API", () => {
  it("records the whole brew log with split fermentation", async () => {
    const brewer = await createUser("Brage");
    const brewery = await createBrewery(brewer, "Slump Bryggeri");
    const base = `/breweries/${brewery}`;
    const recipeId = (await brewer.post(`${base}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const batchId = (await brewer.post(`${base}/batches`, { recipeId, brewDate: "2026-09-23" })).body.id;

    const splitIds: Record<string, string> = {};
    for (const split of sunsetIpaSplits) {
      const res = await brewer.post(`${base}/batches/${batchId}/splits`, { name: split.name, vessel: split.vessel, volumeL: split.volumeL });
      expect(res.status).toBe(201);
      splitIds[split.key] = res.body.id;
    }

    for (const entry of sunsetIpaBrewLog) {
      const occurredAt = Date.parse(entry.at);
      const splitId = entry.split ? splitIds[entry.split] : null;
      let res;
      if (entry.type.endsWith("_started")) {
        res = await brewer.post(`${base}/batches/${batchId}/stage`, { stage: entry.stage, occurredAt });
      } else if (entry.measurement) {
        res = await brewer.post(`${base}/batches/${batchId}/measurements`, {
          ...entry.measurement,
          stage: entry.stage,
          splitId,
          measuredAt: occurredAt,
        });
      } else if (entry.comment) {
        res = await brewer.post(`${base}/batches/${batchId}/comments`, { body: entry.comment, stage: entry.stage, splitId, occurredAt });
      } else {
        res = await brewer.post(`${base}/batches/${batchId}/events`, {
          type: entry.type,
          stage: entry.stage,
          splitId,
          occurredAt,
          data: entry.ingredient,
        });
      }
      expect(res.status, `${entry.type} @ ${entry.at}`).toBe(201);
    }

    const timeline = await brewer.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    expect(timeline.body).toHaveLength(sunsetIpaBrewLog.length);
    expect(timeline.body.map((e) => e.occurredAt)).toEqual(sunsetIpaBrewLog.map((e) => Date.parse(e.at)));

    const brix = timeline.body.filter((e) => e.measurement?.kind === "brix").map((e) => e.measurement?.value);
    expect(brix).toEqual([12.1, 14.0, 15.0]);
    const pineVolume = timeline.body.find((e) => e.splitId === splitIds.pine && e.measurement?.kind === "volume");
    expect(pineVolume?.measurement?.value).toBe(22);

    const batch = await brewer.get<BatchDetail>(`${base}/batches/${batchId}`);
    expect(batch.body.splits.map((s) => s.name)).toEqual(["Sunset Tropical", "Sunset Pine"]);
    expect(batch.body).toMatchObject({ status: "brewing", currentStage: "cooling" });
  });

  it("rejects ingredient events with malformed data and splits from other batches", async () => {
    const brewer = await createUser("Brage");
    const brewery = await createBrewery(brewer);
    const base = `/breweries/${brewery}`;
    const recipeId = (await brewer.post(`${base}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    const a = (await brewer.post(`${base}/batches`, { recipeId })).body.id;
    const b = (await brewer.post(`${base}/batches`, { recipeId })).body.id;
    const splitOfB = (await brewer.post(`${base}/batches/${b}/splits`, { name: "B" })).body.id;

    expect((await brewer.post(`${base}/batches/${a}/events`, { type: "ingredient_added", data: { name: "Citra" } })).status).toBe(400);
    expect((await brewer.post(`${base}/batches/${a}/events`, { type: "measurement" })).status).toBe(400);
    expect((await brewer.post(`${base}/batches/${a}/events`, { type: "boil_started" })).status).toBe(400);
    expect((await brewer.post(`${base}/batches/${a}/measurements`, { kind: "ph", value: 5.3, splitId: splitOfB })).status).toBe(400);
    expect((await brewer.post(`${base}/batches/${a}/events`, { type: "cold_crash_started", data: { targetC: 2 } })).status).toBe(201);
  });
});
