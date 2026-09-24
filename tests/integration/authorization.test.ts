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

    recipeA = (await alice.post(`/breweries/${breweryA}/recipes`, { recipe: sunsetIpaRecipe })).body.id;
    batchA = (await alice.post(`/breweries/${breweryA}/batches`, { recipeId: recipeA })).body.id;
    eventA = (await alice.post(`/breweries/${breweryA}/batches/${batchA}/measurements`, { kind: "temperature", value: 66.8 })).body.id;

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
      `/breweries/${breweryA}/equipment-profile`,
      `/breweries/${breweryA}/attachments/${attachmentA}`,
    ]) {
      const res = await bob.get(path);
      expect(res.status, path).toBe(404);
    }
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
      bob.post(`/breweries/${breweryA}/equipment-profile/versions`, { values: {} }),
    ];
    for (const res of await Promise.all(writes)) expect(res.status).toBe(404);

    const timeline = await alice.get(`/breweries/${breweryA}/batches/${batchA}/timeline`);
    expect(timeline.body.map((e: { id: string }) => e.id)).toContain(eventA);
    expect(timeline.body).toHaveLength(2);
  });

  it("does not let Bob accept an invite addressed to someone else", async () => {
    const invite = await alice.post(`/breweries/${breweryA}/invites`, { email: "carol@example.com", role: "member" });
    expect(invite.status).toBe(201);
    expect((await bob.post(`/invites/${invite.body.id}/accept`)).status).toBe(404);
    expect((await bob.get(`/breweries/${breweryA}`)).status).toBe(404);
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
