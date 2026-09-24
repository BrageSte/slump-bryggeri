import { Hono } from "hono";
import { updateProfileSchema } from "../../src/domain/model/api.ts";
import { createAuth } from "../auth/auth.ts";
import type { AppEnv } from "../lib/context.ts";
import { parseJsonBody } from "../lib/validate.ts";
import { acceptInvite, declineInvite, getMe } from "../services/breweries.ts";

export const meRoutes = new Hono<AppEnv>()
  .get("/me", async (c) => c.json(await getMe(c.var.db, c.var.user)))
  .patch("/me", async (c) => {
    const { name } = await parseJsonBody(c, updateProfileSchema);
    const auth = createAuth(c.env, c.req.raw);
    if (await auth.api.getSession({ headers: c.req.raw.headers })) {
      const { headers } = await auth.api.updateUser({ body: { name }, headers: c.req.raw.headers, returnHeaders: true });
      // Forward the refreshed session cookie cache so the new name is used immediately.
      for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
    } else {
      await c.var.db
        .updateTable("users")
        .set({ name, updated_at: new Date().toISOString() })
        .where("id", "=", c.var.user.id)
        .execute();
    }
    return c.json(await getMe(c.var.db, c.var.user));
  })
  .post("/invites/:inviteId/accept", async (c) => {
    const breweryId = await acceptInvite(c.env.DB, c.var.db, c.var.user, c.req.param("inviteId"));
    return c.json({ breweryId });
  })
  .post("/invites/:inviteId/decline", async (c) => {
    await declineInvite(c.var.db, c.var.user, c.req.param("inviteId"));
    return c.body(null, 204);
  });
