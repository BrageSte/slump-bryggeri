import { z } from "zod";
import { recipeDocumentSchema } from "../../domain/model/recipe.ts";

/** Navigation state is untrusted and may survive a switch to another brewery. Opening it never writes. */
export const assistantDraftStateSchema = z.object({
  assistantDraft: z.object({
    breweryId: z.string().min(1),
    recipe: recipeDocumentSchema,
    baseRecipeId: z.string().min(1).nullable(),
    baseVersionId: z.string().min(1).nullable().optional(),
    request: z.string().trim().min(1).max(4000),
    brewAfterSave: z.boolean(),
  }).strict(),
});

export type AssistantDraftState = z.output<typeof assistantDraftStateSchema>["assistantDraft"];

export function readAssistantDraft(state: unknown, breweryId: string, recipeId?: string): AssistantDraftState | null {
  const parsed = assistantDraftStateSchema.safeParse(state);
  if (!parsed.success) return null;
  const draft = parsed.data.assistantDraft;
  return draft.breweryId === breweryId && draft.baseRecipeId === (recipeId ?? null) ? draft : null;
}
