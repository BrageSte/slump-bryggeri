import { Hono } from "hono";
import {
  createBatchSchema,
  createCommentSchema,
  createEventSchema,
  createMeasurementSchema,
  correctLogEntrySchema,
  createSplitSchema,
  saveOutcomeSchema,
  startStageSchema,
  timestampSchema,
  updateBatchSchema,
  updateCommentSchema,
} from "../../src/domain/model/api.ts";
import { batchStatusSchema, brewStageSchema } from "../../src/domain/model/brewing.ts";
import type { AppEnv } from "../lib/context.ts";
import { badRequest } from "../lib/errors.ts";
import { clientIp, enforceRateLimit } from "../lib/middleware.ts";
import { parse, parseJsonBody } from "../lib/validate.ts";
import { addBatchAttachment } from "../services/attachments.ts";
import { saveOutcome } from "../services/batch-outcomes.ts";
import { createBatch, createSplit, deleteBatch, getBatch, listBatches, startStage, updateBatch } from "../services/batches.ts";
import { addComment, correctLogEntry, deleteEvent, editComment, getTimeline, logEvent, logMeasurement } from "../services/brew-log.ts";

/** Mounted under /breweries/:breweryId/batches — membership is already verified. */
export const batchRoutes = new Hono<AppEnv>()
  .get("/", async (c) => {
    const statusParam = c.req.query("status");
    const statuses = statusParam ? statusParam.split(",").map((s) => parse(batchStatusSchema, s)) : undefined;
    return c.json(await listBatches(c.var.db, c.var.membership.breweryId, statuses));
  })
  .post("/", async (c) => {
    const input = await parseJsonBody(c, createBatchSchema);
    const id = await createBatch(c.env.DB, c.var.db, c.var.membership.breweryId, c.var.user, input);
    return c.json({ id }, 201);
  })
  .get("/:batchId", async (c) => c.json(await getBatch(c.var.db, c.var.membership.breweryId, c.req.param("batchId"))))
  .patch("/:batchId", async (c) => {
    const input = await parseJsonBody(c, updateBatchSchema);
    await updateBatch(c.env.DB, c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, input);
    return c.body(null, 204);
  })
  .delete("/:batchId", async (c) => {
    if (c.var.membership.role !== "admin") return c.json({ error: { code: "forbidden", message: "Dette krever administrator-tilgang." } }, 403);
    await deleteBatch(c.var.db, c.var.membership.breweryId, c.req.param("batchId"));
    return c.body(null, 204);
  })
  .post("/:batchId/stage", async (c) => {
    const input = await parseJsonBody(c, startStageSchema);
    const id = await startStage(c.env.DB, c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, input);
    return c.json({ id }, 201);
  })
  .put("/:batchId/outcomes", async (c) => {
    const input = await parseJsonBody(c, saveOutcomeSchema);
    const id = await saveOutcome(c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, input);
    return c.json({ id });
  })
  .post("/:batchId/splits", async (c) => {
    const input = await parseJsonBody(c, createSplitSchema);
    const id = await createSplit(c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, input);
    return c.json({ id }, 201);
  })

  // Brew log
  .get("/:batchId/timeline", async (c) => c.json(await getTimeline(c.var.db, c.var.membership.breweryId, c.req.param("batchId"))))
  .post("/:batchId/measurements", async (c) => {
    const input = await parseJsonBody(c, createMeasurementSchema);
    const id = await logMeasurement(c.env.DB, c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, input);
    return c.json({ id }, 201);
  })
  .post("/:batchId/comments", async (c) => {
    const input = await parseJsonBody(c, createCommentSchema);
    const id = await addComment(c.env.DB, c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, input);
    return c.json({ id }, 201);
  })
  .patch("/:batchId/comments/:commentId", async (c) => {
    const { body } = await parseJsonBody(c, updateCommentSchema);
    await editComment(c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.req.param("commentId"), c.var.user, body);
    return c.body(null, 204);
  })
  .patch("/:batchId/events/:eventId/correction", async (c) => {
    const input = await parseJsonBody(c, correctLogEntrySchema);
    const id = await correctLogEntry(
      c.env.DB,
      c.var.db,
      c.var.membership.breweryId,
      c.req.param("batchId"),
      c.req.param("eventId"),
      c.var.user,
      input,
    );
    return c.json({ id }, 201);
  })
  .post("/:batchId/events", async (c) => {
    const input = await parseJsonBody(c, createEventSchema);
    const id = await logEvent(c.env.DB, c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, input);
    return c.json({ id }, 201);
  })
  .delete("/:batchId/events/:eventId", async (c) => {
    await deleteEvent(c.env.DB, c.var.db, c.var.membership, c.req.param("batchId"), c.req.param("eventId"), c.var.user);
    return c.body(null, 204);
  })
  .post("/:batchId/attachments", async (c) => {
    await enforceRateLimit(c.env.UPLOAD_RATE_LIMITER, `upload:${c.var.user.id}:${clientIp(c.req.raw)}`);
    const form = await c.req.formData().catch(() => {
      throw badRequest("Forventet multipart/form-data.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw badRequest("Mangler fil.");
    const caption = form.get("caption");
    const stage = form.get("stage");
    const occurredAt = form.get("occurredAt");
    const result = await addBatchAttachment(c.env, c.var.db, c.var.membership.breweryId, c.req.param("batchId"), c.var.user, {
      file,
      caption: typeof caption === "string" && caption.trim() ? caption.trim().slice(0, 500) : null,
      stage: typeof stage === "string" && stage ? parse(brewStageSchema, stage) : undefined,
      occurredAt: typeof occurredAt === "string" && occurredAt ? parse(timestampSchema, Number(occurredAt)) : undefined,
    });
    return c.json({ id: result.eventId, attachmentId: result.attachmentId }, 201);
  });
