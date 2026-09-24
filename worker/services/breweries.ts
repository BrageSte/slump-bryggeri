import type {
  BreweryDetail,
  MeResponse,
  Role,
} from "../../src/domain/model/api.ts";
import { defaultProfileValues } from "../../src/domain/model/equipment-profile.ts";
import { publicEmail } from "../auth/brewery-mode.ts";
import type { MembershipContext, SessionUser } from "../lib/context.ts";
import { atomic, newId, type DB } from "../lib/db.ts";
import { badRequest, conflict, notFound } from "../lib/errors.ts";

const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function getMe(db: DB, sessionUser: SessionUser): Promise<MeResponse> {
  const now = Date.now();
  // Read the profile from the table, not the (briefly cached) session cookie, so renames show at once.
  const user = await db
    .selectFrom("users")
    .select(["id", "name", "email"])
    .where("id", "=", sessionUser.id)
    .executeTakeFirstOrThrow();
  const [memberships, invites] = await Promise.all([
    db
      .selectFrom("brewery_members as m")
      .innerJoin("breweries as b", "b.id", "m.brewery_id")
      .select(["b.id", "b.name", "m.role"])
      .where("m.user_id", "=", user.id)
      .where("b.deleted_at", "is", null)
      .orderBy("b.name")
      .execute(),
    db
      .selectFrom("brewery_invites as i")
      .innerJoin("breweries as b", "b.id", "i.brewery_id")
      .innerJoin("users as u", "u.id", "i.invited_by")
      .select(["i.id", "i.role", "i.expires_at", "b.id as brewery_id", "b.name as brewery_name", "u.id as inviter_id", "u.name as inviter_name"])
      .where("i.email", "=", user.email.toLowerCase())
      .where("i.accepted_at", "is", null)
      .where("i.revoked_at", "is", null)
      .where("i.expires_at", ">", now)
      .where("b.deleted_at", "is", null)
      .execute(),
  ]);

  const memberOf = new Set(memberships.map((m) => m.id));
  return {
    user: { ...user, email: publicEmail(user.email) },
    memberships: memberships.map((m) => ({ brewery: { id: m.id, name: m.name }, role: m.role })),
    pendingInvites: invites
      .filter((i) => !memberOf.has(i.brewery_id))
      .map((i) => ({
        id: i.id,
        brewery: { id: i.brewery_id, name: i.brewery_name },
        role: i.role,
        invitedBy: { id: i.inviter_id, name: i.inviter_name },
        expiresAt: i.expires_at,
      })),
  };
}

/** Creates a brewery with the creator as admin and an initial equipment profile (v1). */
export async function createBrewery(d1: D1Database, db: DB, user: SessionUser, name: string): Promise<string> {
  const now = Date.now();
  const breweryId = newId();
  const profileId = newId();
  const values = Object.entries(defaultProfileValues());

  await atomic(d1, [
    db.insertInto("breweries").values({ id: breweryId, name, created_by: user.id, created_at: now, updated_at: now }),
    db.insertInto("brewery_members").values({ brewery_id: breweryId, user_id: user.id, role: "admin", created_at: now }),
    db.insertInto("equipment_profiles").values({
      id: profileId,
      brewery_id: breweryId,
      version: 1,
      name: `${name} v1`,
      is_active: 1,
      change_note: "Standardverdier",
      created_by: user.id,
      created_at: now,
    }),
    ...values.map(([key, value]) =>
      db.insertInto("equipment_profile_values").values({ profile_id: profileId, key, value: value as number, source: "default", note: null }),
    ),
  ]);
  return breweryId;
}

export async function renameBrewery(db: DB, membership: MembershipContext, name: string): Promise<void> {
  await db
    .updateTable("breweries")
    .set({ name, updated_at: Date.now() })
    .where("id", "=", membership.breweryId)
    .execute();
}

export async function getBreweryDetail(db: DB, membership: MembershipContext): Promise<BreweryDetail> {
  const members = await db
    .selectFrom("brewery_members as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .select(["u.id", "u.name", "u.email", "m.role", "m.created_at"])
    .where("m.brewery_id", "=", membership.breweryId)
    .orderBy("m.created_at")
    .execute();

  const invites =
    membership.role === "admin"
      ? await db
          .selectFrom("brewery_invites")
          .select(["id", "email", "role", "created_at", "expires_at"])
          .where("brewery_id", "=", membership.breweryId)
          .where("accepted_at", "is", null)
          .where("revoked_at", "is", null)
          .where("expires_at", ">", Date.now())
          .orderBy("created_at", "desc")
          .execute()
      : null;

  return {
    id: membership.breweryId,
    name: membership.breweryName,
    myRole: membership.role,
    members: members.map((m) => ({ user: { id: m.id, name: m.name, email: publicEmail(m.email) }, role: m.role, joinedAt: m.created_at })),
    invites:
      invites?.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at, expiresAt: i.expires_at })) ?? null,
  };
}

export async function createInvite(
  db: DB,
  membership: MembershipContext,
  user: SessionUser,
  input: { email: string; role: Role },
): Promise<string> {
  const existingMember = await db
    .selectFrom("brewery_members as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .select("u.id")
    .where("m.brewery_id", "=", membership.breweryId)
    .where("u.email", "=", input.email)
    .executeTakeFirst();
  if (existingMember) throw conflict("Personen er allerede medlem.");

  const now = Date.now();
  // Re-inviting replaces an open invite for the same address.
  await db
    .updateTable("brewery_invites")
    .set({ revoked_at: now })
    .where("brewery_id", "=", membership.breweryId)
    .where("email", "=", input.email)
    .where("accepted_at", "is", null)
    .where("revoked_at", "is", null)
    .execute();

  const id = newId();
  await db
    .insertInto("brewery_invites")
    .values({
      id,
      brewery_id: membership.breweryId,
      email: input.email,
      role: input.role,
      invited_by: user.id,
      created_at: now,
      expires_at: now + INVITE_TTL_MS,
    })
    .execute();
  return id;
}

export async function revokeInvite(db: DB, membership: MembershipContext, inviteId: string): Promise<void> {
  const result = await db
    .updateTable("brewery_invites")
    .set({ revoked_at: Date.now() })
    .where("id", "=", inviteId)
    .where("brewery_id", "=", membership.breweryId)
    .where("accepted_at", "is", null)
    .where("revoked_at", "is", null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw notFound("Invitasjonen");
}

async function findOpenInviteForUser(db: DB, user: SessionUser, inviteId: string) {
  const invite = await db
    .selectFrom("brewery_invites")
    .selectAll()
    .where("id", "=", inviteId)
    .where("email", "=", user.email.toLowerCase())
    .where("accepted_at", "is", null)
    .where("revoked_at", "is", null)
    .where("expires_at", ">", Date.now())
    .executeTakeFirst();
  // Invites addressed to someone else are indistinguishable from missing ones.
  if (!invite) throw notFound("Invitasjonen");
  return invite;
}

export async function acceptInvite(d1: D1Database, db: DB, user: SessionUser, inviteId: string): Promise<string> {
  const invite = await findOpenInviteForUser(db, user, inviteId);
  const now = Date.now();
  await atomic(d1, [
    db
      .insertInto("brewery_members")
      .values({ brewery_id: invite.brewery_id, user_id: user.id, role: invite.role, created_at: now })
      .onConflict((oc) => oc.columns(["brewery_id", "user_id"]).doNothing()),
    db.updateTable("brewery_invites").set({ accepted_at: now, accepted_by: user.id }).where("id", "=", invite.id),
  ]);
  return invite.brewery_id;
}

export async function declineInvite(db: DB, user: SessionUser, inviteId: string): Promise<void> {
  const invite = await findOpenInviteForUser(db, user, inviteId);
  await db.updateTable("brewery_invites").set({ revoked_at: Date.now() }).where("id", "=", invite.id).execute();
}

async function adminCount(db: DB, breweryId: string): Promise<number> {
  const row = await db
    .selectFrom("brewery_members")
    .select((eb) => eb.fn.countAll<number>().as("count"))
    .where("brewery_id", "=", breweryId)
    .where("role", "=", "admin")
    .executeTakeFirstOrThrow();
  return Number(row.count);
}

async function memberRole(db: DB, breweryId: string, userId: string): Promise<Role> {
  const member = await db
    .selectFrom("brewery_members")
    .select("role")
    .where("brewery_id", "=", breweryId)
    .where("user_id", "=", userId)
    .executeTakeFirst();
  if (!member) throw notFound("Medlemmet");
  return member.role;
}

export async function updateMemberRole(db: DB, membership: MembershipContext, userId: string, role: Role): Promise<void> {
  const current = await memberRole(db, membership.breweryId, userId);
  if (current === "admin" && role !== "admin" && (await adminCount(db, membership.breweryId)) <= 1) {
    throw badRequest("Bryggeriet må ha minst én administrator.");
  }
  await db
    .updateTable("brewery_members")
    .set({ role })
    .where("brewery_id", "=", membership.breweryId)
    .where("user_id", "=", userId)
    .execute();
}

export async function removeMember(db: DB, membership: MembershipContext, userId: string): Promise<void> {
  const current = await memberRole(db, membership.breweryId, userId);
  if (current === "admin" && (await adminCount(db, membership.breweryId)) <= 1) {
    throw badRequest("Bryggeriet må ha minst én administrator.");
  }
  await db
    .deleteFrom("brewery_members")
    .where("brewery_id", "=", membership.breweryId)
    .where("user_id", "=", userId)
    .execute();
}
