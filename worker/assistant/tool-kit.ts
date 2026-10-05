import type { z } from "zod";
import type { BrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import type { AssistantReplyAction, BatchDetail, TimelineItem } from "../../src/domain/model/api.ts";
import type { ProfileValueSources, ProfileValues } from "../../src/domain/model/equipment-profile.ts";
import type { RecipeDocument } from "../../src/domain/model/recipe.ts";
import type { WaterProfile } from "../../src/domain/model/water.ts";

/**
 * What the assistant's tools are built from. A tool belongs to one scope: `batch` tools read the frozen snapshots and
 * log of one batch, `brewery` tools read the brewery's recipes, equipment profile and base water, and `both` tools only
 * need neither (unit conversion, ABV) or load brewery-wide history. The scope decides which tools the model is offered
 * and which the runner will execute, so a batch tool can never run without a batch.
 */

export interface RecipeListing {
  id: string;
  name: string;
  style: string | null;
  version: number;
  versionId: string;
  updatedAt: number;
  document: RecipeDocument;
}

/** The brewery-level thread's view of the brewery. The loaders are closed over the verified brewery id. */
export interface BreweryToolContext {
  equipmentValues: ProfileValues;
  equipmentSources: ProfileValueSources;
  sourceWater: WaterProfile;
  listRecipes: () => Promise<RecipeListing[]>;
  /** Null when the id is not a recipe of this brewery. */
  getRecipe: (recipeId: string) => Promise<RecipeListing | null>;
}

export interface ToolContext {
  batch?: BatchDetail;
  timeline?: TimelineItem[];
  brewDocumentSections?: BrewDocumentSections;
  loadBreweryHistory?: () => Promise<unknown>;
  /** Suggestions collected during one reply: log entries and timers, or recipe drafts. */
  proposedActions?: AssistantReplyAction[];
  brewery?: BreweryToolContext;
}
export type BatchToolContext = ToolContext & { batch: BatchDetail };
export type BreweryScopeContext = ToolContext & { brewery: BreweryToolContext };

export type ToolScope = "batch" | "brewery" | "both";

export interface AssistantTool<S extends z.ZodType, C extends ToolContext = ToolContext> {
  name: string;
  description: string;
  scope: ToolScope;
  input: S;
  run: (input: z.output<S>, context: C) => unknown | Promise<unknown>;
}

type Definition<S extends z.ZodType, C extends ToolContext> = Omit<AssistantTool<S, C>, "scope">;

export const batchTool = <S extends z.ZodType>(definition: Definition<S, BatchToolContext>): AssistantTool<S, BatchToolContext> => ({ ...definition, scope: "batch" });
export const breweryTool = <S extends z.ZodType>(definition: Definition<S, BreweryScopeContext>): AssistantTool<S, BreweryScopeContext> => ({ ...definition, scope: "brewery" });
export const sharedTool = <S extends z.ZodType>(definition: Definition<S, ToolContext>): AssistantTool<S, ToolContext> => ({ ...definition, scope: "both" });

/** The equipment values a tool should default to: the batch's frozen snapshot, or the brewery's active profile. */
export function equipmentValuesOf(context: ToolContext): ProfileValues {
  return context.batch?.equipmentSnapshot.values ?? context.brewery?.equipmentValues ?? {};
}
