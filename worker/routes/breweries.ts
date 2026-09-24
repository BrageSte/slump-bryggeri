import { Hono } from "hono";
import {
  createBrewerySchema,
  createInviteSchema,
  createProfileVersionSchema,
  equipmentInputSchema,
  updateMemberSchema,
} from "../../src/domain/model/api.ts";
import { appBaseUrl } from "../auth/auth.ts";
import { inviteEmail, sendEmail } from "../auth/email.ts";
import type { AppEnv } from "../lib/context.ts";
import { requireMember } from "../lib/middleware.ts";
import { parseJsonBody } from "../lib/validate.ts";
import { attachmentRoutes } from "./attachments.ts";
import { batchRoutes } from "./batches.ts";
import { recipeRoutes } from "./recipes.ts";
import {
  createBrewery,
  createInvite,
  getBreweryDetail,
  removeMember,
  renameBrewery,
  revokeInvite,
  updateMemberRole,
} from "../services/breweries.ts";
import {
  createEquipment,
  createProfileVersion,
  deleteEquipment,
  getActiveProfile,
  listEquipment,
  listProfileVersions,
  updateEquipment,
} from "../services/equipment.ts";

const admin = requireMember("admin");

export const breweryRoutes = new Hono<AppEnv>()
  .post("/", async (c) => {
    const { name } = await parseJsonBody(c, createBrewerySchema);
    const id = await createBrewery(c.env.DB, c.var.db, c.var.user, name);
    return c.json({ id }, 201);
  })
  .use("/:breweryId/*", requireMember())
  .use("/:breweryId", requireMember())
  .get("/:breweryId", async (c) => c.json(await getBreweryDetail(c.var.db, c.var.membership)))
  .patch("/:breweryId", admin, async (c) => {
    const { name } = await parseJsonBody(c, createBrewerySchema);
    await renameBrewery(c.var.db, c.var.membership, name);
    return c.body(null, 204);
  })

  // Members and invites (admin)
  .post("/:breweryId/invites", admin, async (c) => {
    const input = await parseJsonBody(c, createInviteSchema);
    const id = await createInvite(c.var.db, c.var.membership, c.var.user, input);
    const baseUrl = appBaseUrl(c.env, c.req.raw);
    c.executionCtx.waitUntil(
      sendEmail(c.env, baseUrl, inviteEmail(input.email, c.var.membership.breweryName, c.var.user.name, baseUrl)).catch(
        (error: unknown) => console.error("invite email failed", error),
      ),
    );
    return c.json({ id }, 201);
  })
  .delete("/:breweryId/invites/:inviteId", admin, async (c) => {
    await revokeInvite(c.var.db, c.var.membership, c.req.param("inviteId"));
    return c.body(null, 204);
  })
  .patch("/:breweryId/members/:userId", admin, async (c) => {
    const { role } = await parseJsonBody(c, updateMemberSchema);
    await updateMemberRole(c.var.db, c.var.membership, c.req.param("userId"), role);
    return c.body(null, 204);
  })
  .delete("/:breweryId/members/:userId", async (c) => {
    // Admins can remove anyone; members can only leave themselves.
    const userId = c.req.param("userId");
    if (userId !== c.var.user.id && c.var.membership.role !== "admin") {
      return c.json({ error: { code: "forbidden", message: "Dette krever administrator-tilgang." } }, 403);
    }
    await removeMember(c.var.db, c.var.membership, userId);
    return c.body(null, 204);
  })

  // Physical equipment
  .get("/:breweryId/equipment", async (c) => c.json(await listEquipment(c.var.db, c.var.membership.breweryId)))
  .post("/:breweryId/equipment", admin, async (c) => {
    const input = await parseJsonBody(c, equipmentInputSchema);
    return c.json({ id: await createEquipment(c.var.db, c.var.membership.breweryId, input) }, 201);
  })
  .put("/:breweryId/equipment/:equipmentId", admin, async (c) => {
    const input = await parseJsonBody(c, equipmentInputSchema);
    await updateEquipment(c.var.db, c.var.membership.breweryId, c.req.param("equipmentId"), input);
    return c.body(null, 204);
  })
  .delete("/:breweryId/equipment/:equipmentId", admin, async (c) => {
    await deleteEquipment(c.var.db, c.var.membership.breweryId, c.req.param("equipmentId"));
    return c.body(null, 204);
  })

  // Versioned calibration profile
  .get("/:breweryId/equipment-profile", async (c) => c.json(await getActiveProfile(c.var.db, c.var.membership.breweryId)))
  .get("/:breweryId/equipment-profile/versions", async (c) =>
    c.json(await listProfileVersions(c.var.db, c.var.membership.breweryId)),
  )
  .post("/:breweryId/equipment-profile/versions", admin, async (c) => {
    const input = await parseJsonBody(c, createProfileVersionSchema);
    const id = await createProfileVersion(c.env.DB, c.var.db, c.var.membership, c.var.user, input);
    return c.json({ id }, 201);
  })

  // Everything below is guarded by the membership middleware above.
  .route("/:breweryId/recipes", recipeRoutes)
  .route("/:breweryId/batches", batchRoutes)
  .route("/:breweryId/attachments", attachmentRoutes);
