import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { MeResponse, ModeResponse } from "../../src/domain/model/api.ts";
import { app } from "../../worker/app.ts";

const ORIGIN = "https://slump.example";
const CODE = "mesk-citra-kobber-472";

/** A phone: keeps its own cookies between requests. */
class Device {
  cookies = new Map<string, string>();

  constructor(private readonly overrides: Partial<Env> = {}) {}

  async request<T = any>(method: string, path: string, json?: unknown): Promise<{ status: number; body: T }> {
    const headers = new Headers({ Origin: ORIGIN });
    if (json !== undefined) headers.set("Content-Type", "application/json");
    if (this.cookies.size > 0) headers.set("Cookie", [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "));
    const ctx = createExecutionContext();
    const response = await app.request(
      `${ORIGIN}/api${path}`,
      { method, headers, body: json === undefined ? undefined : JSON.stringify(json) },
      { ...env, BREWERY_MODE: "on", BREWERY_ACCESS_CODE: CODE, APP_URL: ORIGIN, ...this.overrides },
      ctx,
    );
    await waitOnExecutionContext(ctx);
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const [name, ...rest] = (pair ?? "").split("=");
      const value = rest.join("=");
      if (!name) continue;
      if (value === "" || /max-age=0/i.test(cookie)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as T };
  }
}

describe("brewery mode (no accounts)", () => {
  let brageId: string;

  beforeAll(async () => {
    // Relies on per-file storage isolation in the Workers test pool: this file starts with no breweries.
    const row = await env.DB.prepare("SELECT count(*) AS n FROM breweries").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("asks for the brewery code before anything else", async () => {
    const phone = new Device();
    const mode = await phone.request<ModeResponse>("GET", "/mode");
    expect(mode.body).toMatchObject({ breweryMode: true, codeRequired: true, unlocked: false, breweryName: "Slump Bryggeri", people: null });
    expect((await phone.request("GET", "/me")).status).toBe(401);
    expect((await phone.request("POST", "/brewery-mode/person", { name: "Snik" })).status).toBe(403);
    expect((await phone.request("POST", "/brewery-mode/unlock", { code: "feil-kode" })).status).toBe(401);
  });

  it("lets the first person in, creating the brewery with them as admin", async () => {
    const phone = new Device();
    expect((await phone.request("POST", "/brewery-mode/unlock", { code: " Mesk Citra Kobber 472 " })).status).toBe(204);
    expect((await phone.request<ModeResponse>("GET", "/mode")).body).toMatchObject({ unlocked: true, people: [] });

    const chosen = await phone.request<{ userId: string }>("POST", "/brewery-mode/person", { name: "Brage" });
    expect(chosen.status).toBe(200);
    brageId = chosen.body.userId;

    const me = await phone.request<MeResponse>("GET", "/me");
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ id: brageId, name: "Brage", email: "" });
    expect(me.body.memberships).toEqual([{ brewery: { id: expect.any(String), name: "Slump Bryggeri" }, role: "admin" }]);
  });

  it("lets a second phone pick an existing person or add a new one as member", async () => {
    const phone = new Device();
    await phone.request("POST", "/brewery-mode/unlock", { code: CODE });
    const mode = await phone.request<ModeResponse>("GET", "/mode");
    expect(mode.body.people).toEqual([{ id: brageId, name: "Brage" }]);

    const kari = await phone.request<{ userId: string }>("POST", "/brewery-mode/person", { name: "Kari" });
    const me = await phone.request<MeResponse>("GET", "/me");
    expect(me.body.user.id).toBe(kari.body.userId);
    expect(me.body.memberships[0]?.role).toBe("member");

    // Switch person on the same phone.
    expect((await phone.request("POST", "/brewery-mode/leave")).status).toBe(204);
    expect((await phone.request("GET", "/me")).status).toBe(401);
    await phone.request("POST", "/brewery-mode/person", { userId: brageId });
    expect((await phone.request<MeResponse>("GET", "/me")).body.user.name).toBe("Brage");
  });

  it("brews as that person: everything is attributed to them", async () => {
    const phone = new Device();
    await phone.request("POST", "/brewery-mode/unlock", { code: CODE });
    await phone.request("POST", "/brewery-mode/person", { userId: brageId });
    const me = await phone.request<MeResponse>("GET", "/me");
    const breweryId = me.body.memberships[0]?.brewery.id as string;
    const recipe = await phone.request<{ id: string }>("POST", `/breweries/${breweryId}/recipes`, {
      recipe: {
        schemaVersion: 1,
        name: "Husøl",
        batchSizeL: 60,
        boilTimeMin: 60,
        efficiencyPct: 70,
        fermentables: [],
        hops: [],
        cultures: [],
        miscs: [],
        mashSteps: [],
        fermentationSteps: [],
        targets: {},
      },
    });
    expect(recipe.status).toBe(201);
    const batch = await phone.request<{ id: string }>("POST", `/breweries/${breweryId}/batches`, { recipeId: recipe.body.id });
    const logged = await phone.request<{ id: string }>("POST", `/breweries/${breweryId}/batches/${batch.body.id}/measurements`, {
      kind: "volume",
      value: 75.7,
    });
    expect(logged.status).toBe(201);
    const timeline = await phone.request<{ createdBy: { name: string } }[]>("GET", `/breweries/${breweryId}/batches/${batch.body.id}/timeline`);
    expect(timeline.body.map((e) => e.createdBy.name)).toEqual(["Brage"]);
  });

  it("rejects people from outside the brewery and tampered cookies", async () => {
    const phone = new Device();
    await phone.request("POST", "/brewery-mode/unlock", { code: CODE });
    expect((await phone.request("POST", "/brewery-mode/person", { userId: "not-a-person" })).status).toBe(404);

    await phone.request("POST", "/brewery-mode/person", { userId: brageId });
    const signed = phone.cookies.get("slump_person") as string;
    phone.cookies.set("slump_person", signed.replace(/^[^.]+/, "someone-else"));
    expect((await phone.request("GET", "/me")).status).toBe(401);
  });

  it("signs every phone out when the code is changed", async () => {
    const phone = new Device();
    await phone.request("POST", "/brewery-mode/unlock", { code: CODE });
    await phone.request("POST", "/brewery-mode/person", { userId: brageId });
    expect((await phone.request("GET", "/me")).status).toBe(200);

    const sameCookiesNewCode = new Device({ BREWERY_ACCESS_CODE: "ny-kode-123" });
    sameCookiesNewCode.cookies = new Map(phone.cookies);
    expect((await sameCookiesNewCode.request("GET", "/me")).status).toBe(401);
  });

  it("needs no code when none is configured, and is off unless enabled", async () => {
    const open = new Device({ BREWERY_ACCESS_CODE: "" });
    expect((await open.request<ModeResponse>("GET", "/mode")).body).toMatchObject({ codeRequired: false, unlocked: true });
    expect((await open.request("POST", "/brewery-mode/person", { userId: brageId })).status).toBe(200);

    const off = new Device({ BREWERY_MODE: "" });
    expect((await off.request<ModeResponse>("GET", "/mode")).body.breweryMode).toBe(false);
    expect((await off.request("POST", "/brewery-mode/unlock", { code: CODE })).status).toBe(404);
  });
});
