import type { ContentfulStatusCode } from "hono/utils/http-status";

export class HttpError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "unauthorized", "Du må logge inn.");
export const forbidden = (message = "Du har ikke tilgang til dette.") => new HttpError(403, "forbidden", message);
/** Also used for resources in other breweries, so their existence is not revealed. */
export const notFound = (what = "Ressursen") => new HttpError(404, "not_found", `${what} finnes ikke.`);
export const conflict = (message: string) => new HttpError(409, "conflict", message);
export const badRequest = (message: string) => new HttpError(400, "bad_request", message);
