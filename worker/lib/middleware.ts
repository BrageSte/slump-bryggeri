import { createMiddleware } from "hono/factory";
import { createAuth } from "../auth/auth.ts";
import { currentPerson } from "../auth/brewery-mode.ts";
import type { AppEnv } from "./context.ts";
import { createDb } from "./db.ts";
import { forbidden, HttpError, notFound, unauthorized } from "./errors.ts";

export const withDb = createMiddleware<AppEnv>(async (c, next) => {
  c.set("db", createDb(c.env.DB));
  await next();
});

/**
 * Blocks cross-site state-changing requests (CSRF). Browsers always send Origin and
 * Sec-Fetch-Site on fetch() POST/PATCH/DELETE; non-browser clients have no ambient cookies.
 */
export const sameOriginWrites = createMiddleware<AppEnv>(async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("origin");
    const allowed = new Set([new URL(c.req.url).origin, c.env.APP_URL].filter(Boolean));
    if (origin && !allowed.has(origin)) throw forbidden("Forespørselen kommer fra et annet nettsted.");
    if (c.req.header("sec-fetch-site") === "cross-site") throw forbidden("Forespørselen kommer fra et annet nettsted.");
  }
  await next();
});

export const noStore = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  if (!c.res.headers.has("Cache-Control")) c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
});

/** A signed-in account (Better Auth), or — in brewery mode — the person chosen on this device. */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await createAuth(c.env, c.req.raw).api.getSession({ headers: c.req.raw.headers });
  if (session) {
    c.set("user", { id: session.user.id, name: session.user.name, email: session.user.email });
  } else {
    const person = await currentPerson(c);
    if (!person) throw unauthorized();
    c.set("user", person);
  }
  await next();
});

/**
 * user → brewery membership → permission. The brewery id from the URL is only trusted after
 * membership has been verified here; every query below this point must be scoped to it.
 * Non-members get 404 so the existence of other breweries is not revealed.
 */
export function requireMember(minimumRole: "member" | "admin" = "member") {
  return createMiddleware<AppEnv>(async (c, next) => {
    const breweryId = c.req.param("breweryId");
    if (!breweryId) throw notFound("Bryggeriet");
    const membership = await c.var.db
      .selectFrom("brewery_members as m")
      .innerJoin("breweries as b", "b.id", "m.brewery_id")
      .select(["m.role", "b.name"])
      .where("m.brewery_id", "=", breweryId)
      .where("m.user_id", "=", c.var.user.id)
      .where("b.deleted_at", "is", null)
      .executeTakeFirst();
    if (!membership) throw notFound("Bryggeriet");
    if (minimumRole === "admin" && membership.role !== "admin") throw forbidden("Dette krever administrator-tilgang.");
    c.set("membership", {
      breweryId,
      breweryName: membership.name,
      role: membership.role,
    });
    await next();
  });
}

export function requireAdmin(role: string): void {
  if (role !== "admin") throw forbidden("Dette krever administrator-tilgang.");
}

/** Cloudflare rate limiting binding; a missing binding (e.g. misconfigured env) fails open. */
export async function enforceRateLimit(limiter: RateLimit | undefined, key: string): Promise<void> {
  if (!limiter) return;
  const { success } = await limiter.limit({ key });
  if (!success) throw new HttpError(429, "rate_limited", "For mange forsøk. Vent litt og prøv igjen.");
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "local";
}
