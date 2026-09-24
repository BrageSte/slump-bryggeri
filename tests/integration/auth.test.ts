import { describe, expect, it } from "vitest";
import { devOutbox } from "../../worker/auth/email.ts";
import { createUser, request } from "./client.ts";

describe("authentication", () => {
  it("serves the health check without a session", async () => {
    const res = await request("GET", "/health");
    expect(res.status).toBe(200);
  });

  it("rejects API calls without a session", async () => {
    const res = await request("GET", "/me");
    expect(res.status).toBe(401);
  });

  it("signs in with email + one-time code and no password", async () => {
    const email = `brage.${Date.now()}@example.com`;
    const sent = await request("POST", "/auth/email-otp/send-verification-otp", { json: { email, type: "sign-in" } });
    expect(sent.status).toBe(200);

    const message = devOutbox.findLast((m) => m.to === email);
    const otp = /(\d{6})/.exec(message?.subject ?? "")?.[1];
    expect(otp).toMatch(/^\d{6}$/);

    const wrong = await request("POST", "/auth/sign-in/email-otp", { json: { email, otp: otp === "000000" ? "111111" : "000000" } });
    expect(wrong.status).toBeGreaterThanOrEqual(400);

    const signedIn = await request("POST", "/auth/sign-in/email-otp", { json: { email, otp } });
    expect(signedIn.status).toBe(200);
    const cookies = signedIn.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect(cookies).toContain("session_token");

    const me = await request("GET", "/me", { headers: new Headers({ Cookie: cookies }) });
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.memberships).toEqual([]);
  });

  it("stores the one-time code hashed, never in plain text", async () => {
    const email = `hash.${Date.now()}@example.com`;
    await request("POST", "/auth/email-otp/send-verification-otp", { json: { email, type: "sign-in" } });
    const otp = /(\d{6})/.exec(devOutbox.findLast((m) => m.to === email)?.subject ?? "")?.[1] as string;
    const { env } = await import("cloudflare:test");
    const rows = await env.DB.prepare("SELECT value FROM verifications WHERE identifier LIKE ?").bind(`%${email}%`).all<{ value: string }>();
    expect(rows.results.length).toBeGreaterThan(0);
    for (const row of rows.results) expect(row.value).not.toContain(otp);
  });

  it("lets a user set their display name", async () => {
    const user = await createUser("Navnløs");
    const res = await user.patch("/me", { name: "Brage" });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe("Brage");
  });
});

describe("email provider", () => {
  it("refuses to pretend a code was sent when no provider is configured", async () => {
    const { app } = await import("../../worker/app.ts");
    const { env, createExecutionContext } = await import("cloudflare:test");
    const res = await app.request(
      "https://slump.example/api/auth/email-otp/send-verification-otp",
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@example.com", type: "sign-in" }) },
      { ...env, APP_URL: "https://slump.example", RESEND_API_KEY: "" },
      createExecutionContext(),
    );
    expect(res.status).toBe(503);
  });
});
