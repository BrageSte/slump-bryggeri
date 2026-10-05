import { describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { readAssistantDraft } from "../../src/features/recipes/assistant-draft.ts";

describe("assistant draft handoff", () => {
  const state = { assistantDraft: { breweryId: "slump", recipe: sunsetIpaRecipe, baseRecipeId: null, baseVersionId: null, request: "Lag en IPA", brewAfterSave: false } };
  it("accepts a validated recipe only for the same brewery and route", () => {
    expect(readAssistantDraft(state, "slump")?.recipe).toEqual(sunsetIpaRecipe);
    expect(readAssistantDraft(state, "another-brewery")).toBeNull();
    expect(readAssistantDraft(state, "slump", "some-recipe")).toBeNull();
    expect(readAssistantDraft({ assistantDraft: { ...state.assistantDraft, recipe: { name: "Broken" } } }, "slump")).toBeNull();
  });
  it("keeps the frozen version for an existing recipe and rejects unknown fields", () => {
    const revision = { assistantDraft: { ...state.assistantDraft, baseRecipeId: "recipe", baseVersionId: "v1", brewAfterSave: true } };
    expect(readAssistantDraft(revision, "slump", "recipe")?.baseVersionId).toBe("v1");
    expect(readAssistantDraft(revision, "slump", "other-recipe")).toBeNull();
    expect(readAssistantDraft({ assistantDraft: { ...state.assistantDraft, autoSave: true } }, "slump")).toBeNull();
  });
});
