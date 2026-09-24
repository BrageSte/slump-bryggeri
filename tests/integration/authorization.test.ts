import { beforeAll, describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { addMember, createBrewery, createUser, request, type TestUser } from "./client.ts";

/**
 * Spec §52: Alice – Brewery A, Bob – Brewery B.
 * Bob must never be able to read or write Brewery A's data by manipulating ids.
 */
describe("brewery isolation (Alice vs Bob)", () => {
  let alice: TestUser;
  let bob: TestUser;
  let breweryA: string;
  let breweryB: string;
  let recipeA: string;
  let batchA: string;
  let eventA: string;
  let attachmentA: string;

  beforeAll(async () => {
    alice = await createUser("Alice");
    bob = await createUser("Bob");
    breweryA = await createBrewery(alice, "Brewery A");
    breweryB = await createBrewery(bob, "Brewery B");

    recipeA = (await alice.post(`/breweries/${breweryA}/recipes`, { recipe: sunsetIpaRecipe, source: { kind: "example" } })).body.id;
    batchA = (await alice.post(`/breweries/${breweryA}/batches`, { recipeId: recipeA })).body.id;
    eventA = (await alice.post(`/breweries/${breweryA}/batches/${batchA}/measurements`, { kind: "temperature", value: 66.8 })).body.id;
    await alice.post(`/breweries/${breweryA}/batches/${batchA}/splits`, { name: "Lille tank", volumeL: 24 });
    await alice.post(`/breweries/${breweryA}/batches/${batchA}/comments`, { body: "Backup test comment" });

    const form = new FormData();
    form.set("file", new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "mash.jpg", { type: "image/jpeg" }));
    attachmentA = (await alice.upload(`/breweries/${breweryA}/batches/${batchA}/attachments`, form)).body.attachmentId;
    expect(attachmentA).toBeTruthy();
  });

  it("hides Brewery A from Bob entirely (404, not 403)", async () => {
    for (const path of [
      `/breweries/${breweryA}`,
      `/breweries/${breweryA}/recipes`,
      `/breweries/${breweryA}/recipes/${recipeA}`,
      `/breweries/${breweryA}/batches`,
      `/breweries/${breweryA}/batches/${batchA}`,
      `/breweries/${breweryA}/batches/${batchA}/timeline`,
      `/breweries/${breweryA}/export`,
      `/breweries/${breweryA}/equipment-profile`,
      `/breweries/${breweryA}/attachments/${attachmentA}`,
    ]) {
      const res = await bob.get(path);
      expect(res.status, path).toBe(404);
    }
  });

  it("exports a versioned, brewery-scoped backup with attachment metadata", async () => {
    const response = await alice.get(`/breweries/${breweryA}/export`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="slump-bryggeri-backup-/);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const backup = response.body as {
      format: string;
      formatVersion: number;
      files: { binaryIncluded: boolean; items: { id: string; sizeBytes: number; downloadUrl: string | null }[] };
      tables: {
        breweries: { id: string; name: string }[];
        users: { id: string }[];
        brewery_members: { user_id: string }[];
        equipment_profiles: unknown[];
        equipment_profile_values: unknown[];
        recipes: { id: string }[];
        recipe_sources: { recipe_id: string }[];
        recipe_versions: { recipe_id: string }[];
        batches: { id: string }[];
        batch_recipe_snapshots: { batch_id: string }[];
        batch_equipment_snapshots: { batch_id: string }[];
        batch_splits: { batch_id: string }[];
        brew_events: { id: string }[];
        measurements: { event_id: string }[];
        comments: { body: string }[];
        attachments: { id: string }[];
        batch_outcomes: unknown[];
      };
    };
    expect(backup.format).toBe("slump-brewery-backup");
    expect(backup.formatVersion).toBe(1);
    expect(backup.tables.breweries).toHaveLength(1);
    expect(backup.tables.breweries).toMatchObject([{ id: breweryA, name: "Brewery A" }]);
    expect(backup.tables.users.some((user) => user.id === alice.id)).toBe(true);
    expect(backup.tables.brewery_members.some((membership) => membership.user_id === alice.id)).toBe(true);
    expect(backup.tables.equipment_profiles.length).toBeGreaterThan(0);
    expect(backup.tables.equipment_profile_values.length).toBeGreaterThan(0);
    expect(backup.tables.recipes.some((recipe) => recipe.id === recipeA)).toBe(true);
    expect(backup.tables.recipe_sources.some((source) => source.recipe_id === recipeA)).toBe(true);
    expect(backup.tables.recipe_versions.some((version) => version.recipe_id === recipeA)).toBe(true);
    expect(backup.tables.batches.some((batch) => batch.id === batchA)).toBe(true);
    expect(backup.tables.batch_recipe_snapshots.some((snapshot) => snapshot.batch_id === batchA)).toBe(true);
    expect(backup.tables.batch_equipment_snapshots.some((snapshot) => snapshot.batch_id === batchA)).toBe(true);
    expect(backup.tables.batch_splits.some((split) => split.batch_id === batchA)).toBe(true);
    expect(backup.tables.brew_events.some((event) => event.id === eventA)).toBe(true);
    expect(backup.tables.measurements.some((measurement) => measurement.event_id === eventA)).toBe(true);
    expect(backup.tables.comments.some((comment) => comment.body === "Backup test comment")).toBe(true);
    expect(backup.tables.attachments.some((attachment) => attachment.id === attachmentA)).toBe(true);
    expect(backup.tables.batch_outcomes).toEqual([]);
    expect(backup.tables).not.toHaveProperty("sessions");
    expect(backup.tables).not.toHaveProperty("accounts");
    expect(backup.files.binaryIncluded).toBe(false);
    expect(backup.files.items).toContainEqual(
      expect.objectContaining({
        id: attachmentA,
        sizeBytes: 4,
        downloadUrl: `/api/breweries/${breweryA}/attachments/${attachmentA}`,
      }),
    );

    const member = await createUser("ExportMember");
    await addMember(alice, breweryA, member);
    expect((await member.get(`/breweries/${breweryA}/export`)).status).toBe(403);

    const bobBackup = await bob.get(`/breweries/${breweryB}/export`);
    expect(bobBackup.status).toBe(200);
    expect(bobBackup.body.tables.breweries).toHaveLength(1);
    expect(bobBackup.body.tables.breweries[0].id).toBe(breweryB);
  });

  it("does not leak A's resources through Bob's own brewery id", async () => {
    expect((await bob.get(`/breweries/${breweryB}/recipes/${recipeA}`)).status).toBe(404);
    expect((await bob.get(`/breweries/${breweryB}/batches/${batchA}`)).status).toBe(404);
    expect((await bob.get(`/breweries/${breweryB}/batches/${batchA}/timeline`)).status).toBe(404);
    expect((await bob.get(`/breweries/${breweryB}/attachments/${attachmentA}`)).status).toBe(404);
  });

  it("refuses every write into Brewery A", async () => {
    const writes = [
      bob.post(`/breweries/${breweryA}/recipes`, { recipe: sunsetIpaRecipe }),
      bob.post(`/breweries/${breweryA}/batches`, { recipeId: recipeA }),
      bob.post(`/breweries/${breweryB}/batches`, { recipeId: recipeA }),
      bob.post(`/breweries/${breweryA}/batches/${batchA}/measurements`, { kind: "temperature", value: 99 }),
      bob.post(`/breweries/${breweryB}/batches/${batchA}/measurements`, { kind: "temperature", value: 99 }),
      bob.post(`/breweries/${breweryB}/batches/${batchA}/comments`, { body: "hei" }),
      bob.post(`/breweries/${breweryB}/batches/${batchA}/stage`, { stage: "boil" }),
      bob.delete(`/breweries/${breweryB}/batches/${batchA}/events/${eventA}`),
      bob.post(`/breweries/${breweryA}/invites`, { email: bob.email, role: "admin" }),
      bob.patch(`/breweries/${breweryA}/settings`, { unitPreference: "us_volume" }),
      bob.post(`/breweries/${breweryA}/equipment-profile/versions`, { values: {} }),
    ];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(404);

    const timeline = await alice.get(`/breweries/${breweryA}/batches/${batchA}/timeline`);
    expect(timeline.body.map((e: { id: string }) => e.id)).toContain(eventA);
    expect(timeline.body).toHaveLength(3);
  });

  it("does not let Bob accept an invite addressed to someone else", async () => {
    const invite = await alice.post(`/breweries/${breweryA}/invites`, { email: "carol@example.com", role: "member" });
    expect(invite.status).toBe(201);
    expect((await bob.post(`/invites/${invite.body.id}/accept`)).status).toBe(404);
    expect((await bob.get(`/breweries/${breweryA}`)).status).toBe(404);
  });

  it("lets admins set shared brewery measurement units", async () => {
    expect((await alice.patch(`/breweries/${breweryA}/settings`, { unitPreference: "us_volume" })).status).toBe(204);
    expect((await alice.get(`/breweries/${breweryA}`)).body.unitPreference).toBe("us_volume");
    const me = await alice.get("/me");
    expect(me.body.memberships.find((membership: { brewery: { id: string } }) => membership.brewery.id === breweryA).brewery.unitPreference).toBe("us_volume");

    const member = await createUser("PreferenceMember");
    await addMember(alice, breweryA, member);
    expect((await member.get(`/breweries/${breweryA}`)).body.unitPreference).toBe("us_volume");
    expect((await member.patch(`/breweries/${breweryA}/settings`, { unitPreference: "metric" })).status).toBe(403);
    expect((await alice.patch(`/breweries/${breweryA}/settings`, { unitPreference: "imperial" })).status).toBe(400);
  });

  it("restricts admin actions to admins", async () => {
    const member = await createUser("Member");
    await addMember(alice, breweryA, member, "member");
    expect((await member.get(`/breweries/${breweryA}`)).status).toBe(200);
    expect((await member.get(`/breweries/${breweryA}`)).body.invites).toBeNull();
    expect((await member.post(`/breweries/${breweryA}/invites`, { email: "x@example.com", role: "member" })).status).toBe(403);
    expect((await member.post(`/breweries/${breweryA}/equipment-profile/versions`, { values: {} })).status).toBe(403);
    expect((await member.patch(`/breweries/${breweryA}/members/${alice.id}`, { role: "member" })).status).toBe(403);
    expect((await member.delete(`/breweries/${breweryA}/batches/${batchA}`)).status).toBe(403);
    // …but members can brew.
    expect((await member.post(`/breweries/${breweryA}/batches/${batchA}/measurements`, { kind: "ph", value: 5.34 })).status).toBe(201);
  });

  it("keeps at least one admin", async () => {
    const solo = await createUser("Solo");
    const brewery = await createBrewery(solo);
    expect((await solo.patch(`/breweries/${brewery}/members/${solo.id}`, { role: "member" })).status).toBe(400);
    expect((await solo.delete(`/breweries/${brewery}/members/${solo.id}`)).status).toBe(400);
  });

  it("blocks cross-site writes (CSRF)", async () => {
    const res = await request("POST", `/breweries/${breweryA}/batches/${batchA}/comments`, {
      headers: alice.headers,
      json: { body: "fra et annet nettsted" },
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });
});
