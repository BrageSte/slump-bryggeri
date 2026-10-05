import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { createDb } from "../../worker/lib/db.ts";
import { createBrewery, createUser } from "./client.ts";

describe("saving assistant drafts through the ordinary recipe endpoints", () => {
  it("keeps the prompt as a source per version, preserves the original, and rejects a stale version", async () => {
    const user = await createUser("Draft brewer");
    const brewery = await createBrewery(user);
    const base = `/breweries/${brewery}`;
    const created = await user.post(`${base}/recipes`, { recipe: sunsetIpaRecipe, source: { kind: "assistant", originalText: "Lag en IPA" } });
    expect(created.status).toBe(201);
    const path = `${base}/recipes/${created.body.id}`;
    const original = (await user.get(path)).body;
    expect(original.source).toMatchObject({ kind: "assistant", originalText: "Lag en IPA" });
    const saved = await user.post(`${path}/versions`, { recipe: { ...sunsetIpaRecipe, name: "Sunset v2" }, baseVersionId: original.current.id,
      source: { kind: "assistant", originalText: "Endre til Sunset v2" } });
    expect(saved.status).toBe(201);
    const current = (await user.get(path)).body;
    expect(current.current.version).toBe(2);
    expect(current.source.originalText).toBe("Lag en IPA");
    const db = createDb(env.DB);
    const version = await db.selectFrom("recipe_versions").selectAll().where("id", "=", saved.body.id).executeTakeFirstOrThrow();
    const source = await db.selectFrom("recipe_sources").selectAll().where("id", "=", version.source_id!).executeTakeFirstOrThrow();
    expect(source).toMatchObject({ kind: "assistant", original_text: "Endre til Sunset v2", recipe_id: created.body.id });
    const old = await db.selectFrom("recipe_versions").select("data").where("id", "=", original.current.id).executeTakeFirstOrThrow();
    expect(JSON.parse(old.data).name).toBe(sunsetIpaRecipe.name);
    expect((await user.post(`${path}/versions`, { recipe: sunsetIpaRecipe, baseVersionId: original.current.id,
      source: { kind: "assistant", originalText: "Stale draft" } })).status).toBe(409);
    expect(await db.selectFrom("recipe_sources").selectAll().where("recipe_id", "=", created.body.id).execute()).toHaveLength(2);
    expect((await user.get(`${base}/batches`)).body).toEqual([]);
  });
});
