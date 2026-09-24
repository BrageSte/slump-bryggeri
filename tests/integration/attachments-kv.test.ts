import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { TimelineItem } from "../../src/domain/model/api.ts";
import { app } from "../../worker/app.ts";
import { createBrewery, createUser } from "./client.ts";

describe("attachment storage with KV fallback", () => {
  it("uploads and downloads a file with its content type and size metadata", async () => {
    expect((env as unknown as { FILES?: unknown }).FILES).toBeUndefined();

    const owner = await createUser("KV brewer");
    const breweryId = await createBrewery(owner);
    const base = `/breweries/${breweryId}`;
    const recipe = await owner.post(`${base}/recipes`, { recipe: sunsetIpaRecipe });
    const batch = await owner.post(`${base}/batches`, { recipeId: recipe.body.id });
    const batchId = batch.body.id as string;
    const payload = "kv-backed-file-content";
    const bytes = new TextEncoder().encode(payload);
    const form = new FormData();
    form.set("file", new File([bytes], "kv-image.png", { type: "image/png" }));

    const uploaded = await owner.upload(`${base}/batches/${batchId}/attachments`, form);
    expect(uploaded.status).toBe(201);

    const timeline = await owner.get<TimelineItem[]>(`${base}/batches/${batchId}/timeline`);
    const attachment = timeline.body.find((event) => event.id === uploaded.body.id)?.attachment;
    expect(attachment).toMatchObject({ contentType: "image/png", sizeBytes: bytes.byteLength });

    const storedKeys = await env.FILES_KV.list<{ contentType: string; size: number }>({
      prefix: `breweries/${breweryId}/batches/${batchId}/`,
    });
    expect(storedKeys.keys).toHaveLength(1);
    expect(storedKeys.keys[0]?.metadata).toMatchObject({ contentType: "image/png", size: bytes.byteLength });

    const path = attachment?.url.replace(/^\/api/, "") as string;
    const context = createExecutionContext();
    const download = await app.request(`http://localhost/api${path}`, { headers: owner.headers }, env, context);
    await waitOnExecutionContext(context);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-type")).toBe("image/png");
    expect(download.headers.get("content-length")).toBe(String(bytes.byteLength));
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });
});
