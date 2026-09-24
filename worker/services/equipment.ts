import type {
  EquipmentItem,
  EquipmentProfile,
  EquipmentProfileVersionSummary,
  ProfileValueEntry,
} from "../../src/domain/model/api.ts";
import { getProfileParameter, type ProfileValues } from "../../src/domain/model/equipment-profile.ts";
import type { MembershipContext, SessionUser } from "../lib/context.ts";
import { atomic, isUniqueViolation, newId, type DB } from "../lib/db.ts";
import { conflict, HttpError, notFound } from "../lib/errors.ts";

// --- Physical equipment --------------------------------------------------------

export async function listEquipment(db: DB, breweryId: string): Promise<EquipmentItem[]> {
  const rows = await db
    .selectFrom("equipment")
    .select(["id", "kind", "name", "capacity_l", "notes"])
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .orderBy("kind")
    .orderBy("name")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as EquipmentItem["kind"],
    name: r.name,
    capacityL: r.capacity_l,
    notes: r.notes,
  }));
}

type EquipmentInput = Omit<EquipmentItem, "id">;

export async function createEquipment(db: DB, breweryId: string, input: EquipmentInput): Promise<string> {
  const id = newId();
  const now = Date.now();
  await db
    .insertInto("equipment")
    .values({
      id,
      brewery_id: breweryId,
      kind: input.kind,
      name: input.name,
      capacity_l: input.capacityL,
      notes: input.notes,
      created_at: now,
      updated_at: now,
    })
    .execute();
  return id;
}

export async function updateEquipment(db: DB, breweryId: string, id: string, input: EquipmentInput): Promise<void> {
  const result = await db
    .updateTable("equipment")
    .set({ kind: input.kind, name: input.name, capacity_l: input.capacityL, notes: input.notes, updated_at: Date.now() })
    .where("id", "=", id)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw notFound("Utstyret");
}

export async function deleteEquipment(db: DB, breweryId: string, id: string): Promise<void> {
  const result = await db
    .updateTable("equipment")
    .set({ deleted_at: Date.now() })
    .where("id", "=", id)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (Number(result.numUpdatedRows) === 0) throw notFound("Utstyret");
}

// --- Versioned equipment/calibration profile --------------------------------------

export async function getActiveProfile(db: DB, breweryId: string): Promise<EquipmentProfile | null> {
  const profile = await db
    .selectFrom("equipment_profiles as p")
    .innerJoin("users as u", "u.id", "p.created_by")
    .select(["p.id", "p.version", "p.name", "p.is_active", "p.change_note", "p.created_at", "u.id as user_id", "u.name as user_name"])
    .where("p.brewery_id", "=", breweryId)
    .where("p.is_active", "=", 1)
    .executeTakeFirst();
  if (!profile) return null;

  const values = await db
    .selectFrom("equipment_profile_values")
    .select(["key", "value", "source", "note"])
    .where("profile_id", "=", profile.id)
    .execute();

  return {
    id: profile.id,
    version: profile.version,
    name: profile.name,
    isActive: profile.is_active === 1,
    changeNote: profile.change_note,
    createdAt: profile.created_at,
    createdBy: { id: profile.user_id, name: profile.user_name },
    values: Object.fromEntries(
      values.map((v): [string, ProfileValueEntry] => [v.key, { value: v.value, source: v.source, note: v.note }]),
    ),
  };
}

export function profileValuesOf(profile: EquipmentProfile | null): ProfileValues {
  if (!profile) return {};
  return Object.fromEntries(Object.entries(profile.values).map(([key, entry]) => [key, entry.value])) as ProfileValues;
}

export async function listProfileVersions(db: DB, breweryId: string): Promise<EquipmentProfileVersionSummary[]> {
  const rows = await db
    .selectFrom("equipment_profiles as p")
    .innerJoin("users as u", "u.id", "p.created_by")
    .select(["p.id", "p.version", "p.is_active", "p.change_note", "p.created_at", "u.id as user_id", "u.name as user_name"])
    .where("p.brewery_id", "=", breweryId)
    .orderBy("p.version", "desc")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    isActive: r.is_active === 1,
    changeNote: r.change_note,
    createdAt: r.created_at,
    createdBy: { id: r.user_id, name: r.user_name },
  }));
}

/**
 * Saves a complete new profile version and makes it active. `values` holds the full desired
 * state: a key set to null (or left out) is uncalibrated in the new version. Unchanged values
 * keep their source/note; changed values become `manual`.
 */
export async function createProfileVersion(
  d1: D1Database,
  db: DB,
  membership: MembershipContext,
  user: SessionUser,
  input: { values: Record<string, number | null>; changeNote?: string },
): Promise<string> {
  const issues: { path: string; message: string }[] = [];
  const entries: [string, number][] = [];
  for (const [key, value] of Object.entries(input.values)) {
    const parameter = getProfileParameter(key);
    if (!parameter) {
      issues.push({ path: `values.${key}`, message: "Ukjent parameter" });
      continue;
    }
    if (value === null) continue;
    if (value < parameter.min || value > parameter.max) {
      issues.push({ path: `values.${key}`, message: `Må være mellom ${parameter.min} og ${parameter.max}` });
      continue;
    }
    entries.push([key, value]);
  }
  if (issues.length > 0) throw new HttpError(400, "validation_failed", "Noen verdier er ugyldige.", issues);

  const current = await getActiveProfile(db, membership.breweryId);
  const latest = await db
    .selectFrom("equipment_profiles")
    .select((eb) => eb.fn.max("version").as("version"))
    .where("brewery_id", "=", membership.breweryId)
    .executeTakeFirst();
  const version = (latest?.version ?? 0) + 1;
  const id = newId();
  const now = Date.now();

  const write = atomic(d1, [
    db
      .updateTable("equipment_profiles")
      .set({ is_active: 0 })
      .where("brewery_id", "=", membership.breweryId)
      .where("is_active", "=", 1),
    db.insertInto("equipment_profiles").values({
      id,
      brewery_id: membership.breweryId,
      version,
      name: `${membership.breweryName} v${version}`,
      is_active: 1,
      change_note: input.changeNote ?? null,
      created_by: user.id,
      created_at: now,
    }),
    ...entries.map(([key, value]) => {
      const previous = current?.values[key];
      const unchanged = previous !== undefined && previous.value === value;
      return db.insertInto("equipment_profile_values").values({
        profile_id: id,
        key,
        value,
        source: unchanged ? previous.source : "manual",
        note: unchanged ? previous.note : null,
      });
    }),
  ]);
  try {
    await write;
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Profilen ble endret samtidig av noen andre. Last inn på nytt.");
    throw error;
  }
  return id;
}
