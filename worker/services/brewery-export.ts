import { notFound } from "../lib/errors.ts";
import type { DB } from "../lib/db.ts";

/** Creates a relational, versioned backup. File bytes stay in object storage. */
export async function exportBrewery(db: DB, breweryId: string) {
  const brewery = await db
    .selectFrom("breweries")
    .selectAll()
    .where("id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!brewery) throw notFound("Bryggeriet");

  const [members, invites, equipment, equipmentProfiles, profileValues, recipes, recipeSources, recipeVersions, batches, recipeSnapshots, equipmentSnapshots, splits, events, measurements, comments, attachments, outcomes] =
    await Promise.all([
      db.selectFrom("brewery_members").selectAll().where("brewery_id", "=", breweryId).orderBy("user_id").execute(),
      db.selectFrom("brewery_invites").selectAll().where("brewery_id", "=", breweryId).orderBy("created_at").orderBy("id").execute(),
      db.selectFrom("equipment").selectAll().where("brewery_id", "=", breweryId).orderBy("created_at").orderBy("id").execute(),
      db
        .selectFrom("equipment_profiles")
        .selectAll()
        .where("brewery_id", "=", breweryId)
        .orderBy("version")
        .execute(),
      db
        .selectFrom("equipment_profile_values as v")
        .innerJoin("equipment_profiles as p", "p.id", "v.profile_id")
        .select(["v.profile_id", "v.key", "v.value", "v.source", "v.note"])
        .where("p.brewery_id", "=", breweryId)
        .orderBy("v.profile_id")
        .orderBy("v.key")
        .execute(),
      db.selectFrom("recipes").selectAll().where("brewery_id", "=", breweryId).orderBy("created_at").orderBy("id").execute(),
      db
        .selectFrom("recipe_sources as s")
        .innerJoin("recipes as r", "r.id", "s.recipe_id")
        .selectAll("s")
        .where("r.brewery_id", "=", breweryId)
        .orderBy("s.created_at")
        .orderBy("s.id")
        .execute(),
      db
        .selectFrom("recipe_versions as v")
        .innerJoin("recipes as r", "r.id", "v.recipe_id")
        .selectAll("v")
        .where("r.brewery_id", "=", breweryId)
        .orderBy("v.recipe_id")
        .orderBy("v.version")
        .execute(),
      db.selectFrom("batches").selectAll().where("brewery_id", "=", breweryId).orderBy("number").execute(),
      db
        .selectFrom("batch_recipe_snapshots as s")
        .innerJoin("batches as b", "b.id", "s.batch_id")
        .selectAll("s")
        .where("b.brewery_id", "=", breweryId)
        .orderBy("s.batch_id")
        .execute(),
      db
        .selectFrom("batch_equipment_snapshots as s")
        .innerJoin("batches as b", "b.id", "s.batch_id")
        .selectAll("s")
        .where("b.brewery_id", "=", breweryId)
        .orderBy("s.batch_id")
        .execute(),
      db.selectFrom("batch_splits").selectAll().where("brewery_id", "=", breweryId).orderBy("batch_id").orderBy("sort_order").execute(),
      db.selectFrom("brew_events").selectAll().where("brewery_id", "=", breweryId).orderBy("occurred_at").orderBy("id").execute(),
      db.selectFrom("measurements").selectAll().where("brewery_id", "=", breweryId).orderBy("measured_at").orderBy("id").execute(),
      db.selectFrom("comments").selectAll().where("brewery_id", "=", breweryId).orderBy("created_at").orderBy("id").execute(),
      db.selectFrom("attachments").selectAll().where("brewery_id", "=", breweryId).orderBy("created_at").orderBy("id").execute(),
      db.selectFrom("batch_outcomes").selectAll().where("brewery_id", "=", breweryId).orderBy("batch_id").orderBy("created_at").execute(),
    ]);

  const userIds = [
    brewery.created_by,
    ...members.map((member) => member.user_id),
    ...invites.flatMap((invite) => [invite.invited_by, invite.accepted_by]),
    ...equipmentProfiles.map((profile) => profile.created_by),
    ...recipes.map((recipe) => recipe.created_by),
    ...recipeSources.map((source) => source.created_by),
    ...recipeVersions.map((version) => version.created_by),
    ...batches.map((batch) => batch.created_by),
    ...splits.map((split) => split.created_by),
    ...events.map((event) => event.created_by),
    ...measurements.map((measurement) => measurement.created_by),
    ...comments.map((comment) => comment.created_by),
    ...attachments.map((attachment) => attachment.created_by),
    ...outcomes.flatMap((outcome) => [outcome.created_by, outcome.updated_by]),
  ].filter((userId): userId is string => userId !== null);
  const users = await db.selectFrom("users").selectAll().where("id", "in", [...new Set(userIds)]).orderBy("id").execute();

  const exportedAt = Date.now();
  return {
    format: "slump-brewery-backup" as const,
    formatVersion: 1,
    exportedAt,
    files: {
      binaryIncluded: false as const,
      note: "Filbytes er ikke inkludert. Aktive vedlegg kan lastes ned separat fra lenkene under.",
      items: attachments.map((attachment) => ({
        id: attachment.id,
        breweryId: attachment.brewery_id,
        batchId: attachment.batch_id,
        recipeId: attachment.recipe_id,
        eventId: attachment.event_id,
        filename: attachment.filename,
        contentType: attachment.content_type,
        sizeBytes: attachment.size_bytes,
        caption: attachment.caption,
        createdBy: attachment.created_by,
        createdAt: attachment.created_at,
        deletedAt: attachment.deleted_at,
        downloadUrl:
          attachment.deleted_at === null ? `/api/breweries/${breweryId}/attachments/${attachment.id}` : null,
      })),
    },
    tables: {
      breweries: [brewery],
      users,
      brewery_members: members,
      brewery_invites: invites,
      equipment,
      equipment_profiles: equipmentProfiles,
      equipment_profile_values: profileValues,
      recipes,
      recipe_sources: recipeSources,
      recipe_versions: recipeVersions,
      batches,
      batch_recipe_snapshots: recipeSnapshots,
      batch_equipment_snapshots: equipmentSnapshots,
      batch_splits: splits,
      brew_events: events,
      measurements,
      comments,
      attachments,
      batch_outcomes: outcomes,
    },
  };
}
