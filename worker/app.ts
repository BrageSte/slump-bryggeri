import { Hono } from "hono";
import { z } from "zod";
import no from "zod/v4/locales/no.js";
import { appBaseUrl, createAuth } from "./auth/auth.ts";
import { canSendEmail } from "./auth/email.ts";
import type { AppEnv } from "./lib/context.ts";
import { HttpError } from "./lib/errors.ts";
import { clientIp, enforceRateLimit, noStore, requireUser, sameOriginWrites, withDb } from "./lib/middleware.ts";
import { breweryModeRoutes } from "./routes/brewery-mode.ts";
import { breweryRoutes } from "./routes/breweries.ts";
import { libraryRoutes } from "./routes/library.ts";
import { meRoutes } from "./routes/me.ts";

// Validation messages in Norwegian, matching the UI.
z.config(no());

export const app = new Hono<AppEnv>().basePath("/api");

app.onError((error, c) => {
  if (error instanceof HttpError) {
    return c.json({ error: { code: error.code, message: error.message, issues: error.issues } }, error.status);
  }
  console.error(error);
  return c.json({ error: { code: "internal", message: "Noe gikk galt. Prøv igjen." } }, 500);
});
app.notFound((c) => c.json({ error: { code: "not_found", message: "Fant ikke endepunktet." } }, 404));

app.use("*", noStore, sameOriginWrites, withDb);

app.get("/health", (c) => c.json({ ok: true }));

// Better Auth: email OTP sign-in, session, sign-out. Code requests are rate limited per IP.
app.on(["GET", "POST"], "/auth/*", async (c) => {
  if (c.req.method === "POST" && /\/(email-otp|sign-in)\//.test(c.req.path)) {
    await enforceRateLimit(c.env.AUTH_RATE_LIMITER, `auth:${clientIp(c.req.raw)}`);
  }
  // Better Auth reports success even if the email could not be sent; fail loudly instead.
  if (c.req.path.endsWith("/email-otp/send-verification-otp") && !canSendEmail(c.env, appBaseUrl(c.env, c.req.raw))) {
    throw new HttpError(503, "email_not_configured", "Innlogging med e-post er ikke satt opp på denne serveren ennå.");
  }
  return createAuth(c.env, c.req.raw).handler(c.req.raw);
});

app.route("/", breweryModeRoutes);

app.use("*", requireUser);
app.route("/", meRoutes);
app.route("/breweries", breweryRoutes);
app.route("/library", libraryRoutes);
