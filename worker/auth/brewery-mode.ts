import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import type { AppEnv, SessionUser } from "../lib/context.ts";
import { newId, type DB } from "../lib/db.ts";
import { createBrewery } from "../services/breweries.ts";

/**
 * Brewery mode ("bryggerimodus"): the app is used by one brewery without accounts.
 *
 * - An optional shared brewery code (BREWERY_ACCESS_CODE) is entered once per device.
 * - The device then picks "who am I" among the brewery's people, or adds a new person.
 * - People are ordinary rows in `users` (with a placeholder email), so real sign-in can be
 *   added later without migrating data: give the person their real email and let Better Auth's
 *   account linking attach to it.
 *
 * Anyone with the code can act as any person — the name in the log is a label, not proof.
 * Changing BREWERY_ACCESS_CODE signs every device out.
 */

const ACCESS_COOKIE = "slump_access";
const PERSON_COOKIE = "slump_person";
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // browsers cap cookies at 400 days
export const PLACEHOLDER_EMAIL_DOMAIN = "personer.slump.invalid";

export function breweryModeEnabled(env: Env): boolean {
  return env.BREWERY_MODE === "on";
}

export function accessCodeRequired(env: Env): boolean {
  return Boolean(env.BREWERY_ACCESS_CODE);
}

export function normalizeCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, "-");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Identifies the current code, so that changing the code invalidates old access cookies. */
async function codeFingerprint(env: Env): Promise<string> {
  return (await sha256Hex(`slump-access:${normalizeCode(env.BREWERY_ACCESS_CODE)}`)).slice(0, 32);
}

/** Constant-time comparison of the submitted code with the configured one. */
export async function codeMatches(env: Env, submitted: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(normalizeCode(submitted)), sha256Hex(normalizeCode(env.BREWERY_ACCESS_CODE))]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieOptions(c: Context<AppEnv>) {
  return {
    path: "/",
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax" as const,
    maxAge: COOKIE_MAX_AGE,
  };
}

function secret(env: Env): string {
  return `brewery-mode:${env.BETTER_AUTH_SECRET}`;
}

export async function hasAccess(c: Context<AppEnv>): Promise<boolean> {
  if (!accessCodeRequired(c.env)) return true;
  const value = await getSignedCookie(c, secret(c.env), ACCESS_COOKIE);
  return typeof value === "string" && value === (await codeFingerprint(c.env));
}

export async function grantAccess(c: Context<AppEnv>): Promise<void> {
  await setSignedCookie(c, ACCESS_COOKIE, await codeFingerprint(c.env), secret(c.env), cookieOptions(c));
}

export async function setPerson(c: Context<AppEnv>, userId: string): Promise<void> {
  await setSignedCookie(c, PERSON_COOKIE, userId, secret(c.env), cookieOptions(c));
}

export function clearPerson(c: Context<AppEnv>): void {
  deleteCookie(c, PERSON_COOKIE, { path: "/" });
}

/** The single brewery the app serves in brewery mode: the oldest one that is not deleted. */
export async function modeBrewery(db: DB): Promise<{ id: string; name: string } | null> {
  const row = await db
    .selectFrom("breweries")
    .select(["id", "name"])
    .where("deleted_at", "is", null)
    .orderBy("created_at")
    .limit(1)
    .executeTakeFirst();
  return row ?? null;
}

export async function listPeople(db: DB, breweryId: string): Promise<{ id: string; name: string }[]> {
  return db
    .selectFrom("brewery_members as m")
    .innerJoin("users as u", "u.id", "m.user_id")
    .select(["u.id", "u.name"])
    .where("m.brewery_id", "=", breweryId)
    .orderBy("u.name")
    .execute();
}

/** The device's person, if the device has access and the person still belongs to the brewery. */
export async function currentPerson(c: Context<AppEnv>): Promise<SessionUser | null> {
  if (!breweryModeEnabled(c.env) || !(await hasAccess(c))) return null;
  const userId = await getSignedCookie(c, secret(c.env), PERSON_COOKIE);
  if (typeof userId !== "string" || !userId) return null;
  const brewery = await modeBrewery(c.var.db);
  if (!brewery) return null;
  const user = await c.var.db
    .selectFrom("users as u")
    .innerJoin("brewery_members as m", "m.user_id", "u.id")
    .select(["u.id", "u.name", "u.email"])
    .where("u.id", "=", userId)
    .where("m.brewery_id", "=", brewery.id)
    .executeTakeFirst();
  return user ?? null;
}

/**
 * Adds a person. The first person creates the brewery and becomes its admin; later people join
 * as members.
 */
export async function createPerson(d1: D1Database, db: DB, env: Env, name: string): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db
    .insertInto("users")
    .values({
      id,
      name,
      email: `${id}@${PLACEHOLDER_EMAIL_DOMAIN}`,
      email_verified: 0,
      image: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  const brewery = await modeBrewery(db);
  const person = { id, name, email: "" };
  try {
    if (brewery) {
      await db
        .insertInto("brewery_members")
        .values({ brewery_id: brewery.id, user_id: id, role: "member", created_at: Date.now() })
        .execute();
    } else {
      await createBrewery(d1, db, person, env.BREWERY_NAME || "Slump Bryggeri");
    }
  } catch (error) {
    await db.deleteFrom("users").where("id", "=", id).execute();
    throw error;
  }
  return id;
}

/** Placeholder emails are never shown to people. */
export function publicEmail(email: string): string {
  return email.endsWith(`@${PLACEHOLDER_EMAIL_DOMAIN}`) ? "" : email;
}
