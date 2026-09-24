import { Hono } from "hono";
import type { AppEnv } from "../lib/context.ts";
import { getAttachmentObject } from "../services/attachments.ts";

/** Mounted under /breweries/:breweryId/attachments — membership is already verified. */
export const attachmentRoutes = new Hono<AppEnv>().get("/:attachmentId", async (c) => {
  const { object, contentType, filename } = await getAttachmentObject(
    c.env,
    c.var.db,
    c.var.membership.breweryId,
    c.req.param("attachmentId"),
  );
  return new Response(object.body, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(object.size),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(filename)}`,
      // Attachments never change for a given id; private because they require a session.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});
