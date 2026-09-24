import { Hono } from "hono";
import { choosePersonSchema, unlockSchema, type ModeResponse } from "../../src/domain/model/api.ts";
import {
  accessCodeRequired,
  breweryModeEnabled,
  clearPerson,
  codeMatches,
  createPerson,
  grantAccess,
  hasAccess,
  listPeople,
  modeBrewery,
  setPerson,
} from "../auth/brewery-mode.ts";
import type { AppEnv } from "../lib/context.ts";
import { forbidden, HttpError, notFound } from "../lib/errors.ts";
import { clientIp, enforceRateLimit } from "../lib/middleware.ts";
import { parseJsonBody } from "../lib/validate.ts";

/** Public endpoints for brewery mode: code entry and "who am I". Mounted before requireUser. */
export const breweryModeRoutes = new Hono<AppEnv>()
  .get("/mode", async (c) => {
    const enabled = breweryModeEnabled(c.env);
    const unlocked = enabled && (await hasAccess(c));
    const brewery = enabled ? await modeBrewery(c.var.db) : null;
    const body: ModeResponse = {
      breweryMode: enabled,
      codeRequired: enabled && accessCodeRequired(c.env),
      unlocked,
      breweryName: enabled ? (brewery?.name ?? (c.env.BREWERY_NAME || "Slump Bryggeri")) : null,
      people: unlocked ? (brewery ? await listPeople(c.var.db, brewery.id) : []) : null,
    };
    return c.json(body);
  })
  .use("/brewery-mode/*", async (c, next) => {
    if (!breweryModeEnabled(c.env)) throw notFound("Endepunktet");
    await next();
  })
  .post("/brewery-mode/unlock", async (c) => {
    await enforceRateLimit(c.env.AUTH_RATE_LIMITER, `unlock:${clientIp(c.req.raw)}`);
    const { code } = await parseJsonBody(c, unlockSchema);
    if (accessCodeRequired(c.env) && !(await codeMatches(c.env, code))) {
      throw new HttpError(401, "wrong_code", "Feil bryggerikode.");
    }
    await grantAccess(c);
    return c.body(null, 204);
  })
  .post("/brewery-mode/person", async (c) => {
    if (!(await hasAccess(c))) throw forbidden("Skriv inn bryggerikoden først.");
    const input = await parseJsonBody(c, choosePersonSchema);
    let userId: string;
    if ("userId" in input) {
      const brewery = await modeBrewery(c.var.db);
      const people = brewery ? await listPeople(c.var.db, brewery.id) : [];
      if (!people.some((p) => p.id === input.userId)) throw notFound("Personen");
      userId = input.userId;
    } else {
      userId = await createPerson(c.env.DB, c.var.db, c.env, input.name);
    }
    await setPerson(c, userId);
    return c.json({ userId });
  })
  .post("/brewery-mode/leave", (c) => {
    clearPerson(c);
    return c.body(null, 204);
  });
