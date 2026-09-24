import type { Context } from "hono";
import type { z } from "zod";
import { HttpError } from "./errors.ts";

export async function parseJsonBody<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new HttpError(400, "invalid_json", "Forespørselen er ikke gyldig JSON.");
  }
  return parse(schema, body);
}

export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HttpError(
      400,
      "validation_failed",
      "Noen felter er ugyldige.",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}
