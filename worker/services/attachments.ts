import type { BrewStage } from "../../src/domain/model/brewing.ts";
import type { SessionUser } from "../lib/context.ts";
import { atomic, newId, type DB } from "../lib/db.ts";
import { badRequest, HttpError, notFound } from "../lib/errors.ts";
import { findBatch } from "./batches.ts";

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** SVG and HTML are deliberately excluded: they can carry script. */
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

/** R2 is optional until it is enabled on the Cloudflare account (see wrangler.jsonc). */
function filesBucket(env: Env): R2Bucket {
  const bucket = (env as Partial<Pick<Env, "FILES">>).FILES;
  if (!bucket) throw new HttpError(503, "files_disabled", "Bildeopplasting er ikke slått på ennå.");
  return bucket;
}

/** Uploads a photo/document to R2 under the brewery/batch prefix and adds it to the brew log. */
export async function addBatchAttachment(
  env: Env,
  db: DB,
  breweryId: string,
  batchId: string,
  user: SessionUser,
  input: { file: File; caption: string | null; stage: BrewStage | null | undefined; occurredAt: number | undefined },
): Promise<{ eventId: string; attachmentId: string }> {
  const batch = await findBatch(db, breweryId, batchId);
  const files = filesBucket(env);
  if (!ALLOWED_ATTACHMENT_TYPES.has(input.file.type)) throw badRequest("Filtypen støttes ikke. Bruk JPEG, PNG, WebP, HEIC eller PDF.");
  if (input.file.size === 0) throw badRequest("Filen er tom.");
  if (input.file.size > MAX_ATTACHMENT_BYTES) throw badRequest("Filen er større enn 15 MB.");

  const attachmentId = newId();
  const eventId = newId();
  const key = `breweries/${breweryId}/batches/${batchId}/${attachmentId}`;
  const filename = input.file.name.slice(0, 200) || "bilde";

  await files.put(key, input.file.stream(), {
    httpMetadata: { contentType: input.file.type },
    customMetadata: { breweryId, batchId, uploadedBy: user.id },
  });

  const now = Date.now();
  try {
    await atomic(env.DB, [
      db.insertInto("brew_events").values({
        id: eventId,
        brewery_id: breweryId,
        batch_id: batchId,
        split_id: null,
        type: "photo",
        stage: input.stage === undefined ? batch.currentStage : input.stage,
        occurred_at: input.occurredAt ?? now,
        data: null,
        created_by: user.id,
        created_at: now,
        updated_at: now,
      }),
      db.insertInto("attachments").values({
        id: attachmentId,
        brewery_id: breweryId,
        batch_id: batchId,
        recipe_id: null,
        event_id: eventId,
        r2_key: key,
        filename,
        content_type: input.file.type,
        size_bytes: input.file.size,
        caption: input.caption,
        created_by: user.id,
        created_at: now,
      }),
    ]);
  } catch (error) {
    await files.delete(key);
    throw error;
  }
  return { eventId, attachmentId };
}

export async function getAttachmentObject(env: Env, db: DB, breweryId: string, attachmentId: string) {
  const attachment = await db
    .selectFrom("attachments")
    .select(["r2_key", "content_type", "filename"])
    .where("id", "=", attachmentId)
    .where("brewery_id", "=", breweryId)
    .where("deleted_at", "is", null)
    .executeTakeFirst();
  if (!attachment) throw notFound("Vedlegget");
  const object = await filesBucket(env).get(attachment.r2_key);
  if (!object) throw notFound("Vedlegget");
  return { object, contentType: attachment.content_type, filename: attachment.filename };
}
