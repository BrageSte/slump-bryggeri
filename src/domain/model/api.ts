import { z } from "zod";
import {
  batchStatusSchema,
  brewStageSchema,
  eventTypeSchema,
  ingredientAddedDataSchema,
  measurementKindSchema,
  type BatchStatus,
  type BrewStage,
  type MeasurementKind,
} from "./brewing.ts";
import { equipmentKinds, type ProfileValues } from "./equipment-profile.ts";
import { libraryCategoryKeys, type LibraryCategory } from "./library.ts";
import { recipeDocumentSchema, type RecipeDocument } from "./recipe.ts";

/**
 * Request schemas and response types shared by the Worker API and the React client.
 */

/**
 * When something happened (log entries, stage starts). It may be set back in time to log after the
 * fact, but not into the future; a few minutes of slack cover clocks that disagree.
 */
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;
export const timestampSchema = z
  .number()
  .int()
  .positive()
  .refine((time) => time <= Date.now() + MAX_FUTURE_SKEW_MS, { error: "Tidspunktet kan ikke være frem i tid." });

export type Role = "admin" | "member";
export const roleSchema = z.enum(["admin", "member"]);

export interface UserRef {
  id: string;
  name: string;
}

export interface ApiError {
  error: { code: string; message: string; issues?: { path: string; message: string }[] };
}

// --- Me / breweries --------------------------------------------------------

export interface Membership {
  brewery: { id: string; name: string };
  role: Role;
}

export interface PendingInvite {
  id: string;
  brewery: { id: string; name: string };
  role: Role;
  invitedBy: UserRef;
  expiresAt: number;
}

export interface MeResponse {
  user: { id: string; name: string; email: string };
  memberships: Membership[];
  pendingInvites: PendingInvite[];
}

/** Brewery mode: the app serves one brewery without accounts (see worker/auth/brewery-mode.ts). */
export interface ModeResponse {
  breweryMode: boolean;
  codeRequired: boolean;
  /** This device has entered the brewery code (or none is required). */
  unlocked: boolean;
  breweryName: string | null;
  /** The brewery's people; only when unlocked. */
  people: UserRef[] | null;
}

export const unlockSchema = z.object({ code: z.string().trim().min(1, "Skriv inn koden").max(100) });

export const choosePersonSchema = z.union([
  z.object({ userId: z.string().min(1).max(64) }),
  z.object({ name: z.string().trim().min(1, "Skriv inn et navn").max(80) }),
]);

export const updateProfileSchema = z.object({ name: z.string().trim().min(1, "Skriv inn et navn").max(80) });

export const createBrewerySchema = z.object({ name: z.string().trim().min(2, "Minst 2 tegn").max(80) });

export interface BreweryMember {
  user: UserRef & { email: string };
  role: Role;
  joinedAt: number;
}

export interface BreweryInvite {
  id: string;
  email: string;
  role: Role;
  createdAt: number;
  expiresAt: number;
}

export interface BreweryDetail {
  id: string;
  name: string;
  myRole: Role;
  members: BreweryMember[];
  /** Only included for admins. */
  invites: BreweryInvite[] | null;
}

export const createInviteSchema = z.object({
  email: z.email("Ugyldig e-postadresse").transform((e) => e.trim().toLowerCase()),
  role: roleSchema,
});

export const updateMemberSchema = z.object({ role: roleSchema });

// --- Equipment ---------------------------------------------------------------

export interface EquipmentItem {
  id: string;
  kind: (typeof equipmentKinds)[number];
  name: string;
  capacityL: number | null;
  notes: string | null;
}

export const equipmentInputSchema = z.object({
  kind: z.enum(equipmentKinds),
  name: z.string().trim().min(1).max(80),
  capacityL: z.number().positive().max(100_000).nullable(),
  notes: z.string().trim().max(1000).nullable(),
});

export interface ProfileValueEntry {
  value: number;
  source: "manual" | "calibration" | "default";
  note: string | null;
}

export interface EquipmentProfile {
  id: string;
  version: number;
  name: string;
  isActive: boolean;
  changeNote: string | null;
  createdAt: number;
  createdBy: UserRef;
  values: Record<string, ProfileValueEntry>;
}

export interface EquipmentProfileVersionSummary {
  id: string;
  version: number;
  isActive: boolean;
  changeNote: string | null;
  createdAt: number;
  createdBy: UserRef;
}

export const createProfileVersionSchema = z.object({
  changeNote: z.string().trim().max(500).optional(),
  values: z.record(z.string(), z.number().finite().nullable()),
});

// --- Recipes -------------------------------------------------------------------

export interface RecipeSummary {
  id: string;
  name: string;
  style: string | null;
  version: number;
  batchSizeL: number;
  updatedAt: number;
}

export interface RecipeVersionSummary {
  id: string;
  version: number;
  kind: "normalized" | "adaptation";
  changeNote: string | null;
  createdAt: number;
  createdBy: UserRef;
}

export interface RecipeDetail {
  id: string;
  name: string;
  style: string | null;
  createdAt: number;
  updatedAt: number;
  current: RecipeVersionSummary & { data: RecipeDocument; parentVersionId: string | null };
  versions: RecipeVersionSummary[];
  source: { kind: string; url: string | null; originalText: string | null } | null;
}

export const recipeSourceKinds = ["manual", "example", "library", "beerxml", "beerjson", "text", "url", "image", "pdf"] as const;

export const createRecipeSchema = z.object({
  recipe: recipeDocumentSchema,
  source: z
    .object({
      kind: z.enum(recipeSourceKinds),
      url: z.url().max(2000).optional(),
      originalText: z.string().max(200_000).optional(),
    })
    .optional(),
});

export const saveRecipeVersionSchema = z.object({
  recipe: recipeDocumentSchema,
  kind: z.enum(["normalized", "adaptation"]).default("normalized"),
  changeNote: z.string().trim().max(500).optional(),
  /** Optimistic concurrency: the version the edit was based on. */
  baseVersionId: z.string().min(1),
});

// --- Recipe library ----------------------------------------------------------------

export interface LibraryRecipeSummary {
  id: string;
  name: string;
  tagline: string | null;
  category: LibraryCategory;
  abvPct: number | null;
  ibu: number | null;
  og: number | null;
  colorEbc: number | null;
  batchSizeL: number;
}

export interface LibrarySearchResponse {
  items: LibraryRecipeSummary[];
  total: number;
}

export interface LibraryRecipeDetail extends LibraryRecipeSummary {
  recipe: RecipeDocument;
  /** What the importer had to guess or leave out. */
  warnings: string[];
  source: { key: string; name: string; license: string; url: string | null };
}

export const librarySearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.enum(libraryCategoryKeys).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export const copyFromLibrarySchema = z.object({ libraryId: z.string().min(1).max(64) });

// --- Batches ---------------------------------------------------------------------

export interface BatchSummary {
  id: string;
  number: number;
  name: string;
  status: BatchStatus;
  /** Short result for the history list; only on list responses, once results are recorded. */
  result?: { abvPct: [number, number] | null; rating: number | null };
  currentStage: BrewStage | null;
  stageStartedAt: number | null;
  brewDate: string | null;
  recipe: { id: string; name: string };
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface BatchSplit {
  id: string;
  name: string;
  vessel: string | null;
  volumeL: number | null;
  notes: string | null;
}

export interface BatchDetail extends BatchSummary {
  recipeVersion: { id: string; version: number };
  recipeSnapshot: RecipeDocument;
  equipmentSnapshot: { profileId: string | null; profileVersion: number | null; values: ProfileValues };
  splits: BatchSplit[];
  outcomes: BatchOutcome[];
}

// --- Batch results -----------------------------------------------------------------

export const packagingKinds = ["cans", "keg", "bottles", "other"] as const;
export type PackagingKind = (typeof packagingKinds)[number];
export const packagingLabels: Record<PackagingKind, string> = { cans: "Bokser", keg: "Fat", bottles: "Flasker", other: "Annet" };

/** Where a result gravity came from: a logged SG, a logged Brix reading, or typed in on the result form. */
export const gravitySources = ["sg", "brix", "manual"] as const;
export type GravitySource = (typeof gravitySources)[number];

/** Actual result for the whole batch (`splitId` null) or one fermentation variant. Null = ikke målt. */
export interface BatchOutcome {
  id: string;
  splitId: string | null;
  og: number | null;
  ogSource: GravitySource | null;
  fg: number | null;
  fgSource: GravitySource | null;
  packagedVolumeL: number | null;
  packagedOn: string | null;
  packaging: PackagingKind | null;
  carbonationVols: number | null;
  tastingNotes: string | null;
  rating: number | null;
  nextTime: string | null;
  updatedAt: number;
  updatedBy: UserRef;
}

export const saveOutcomeSchema = z
  .object({
    splitId: z.string().min(1).nullable(),
    og: z.number().min(1).max(1.2).nullable(),
    ogSource: z.enum(gravitySources).nullable(),
    fg: z.number().min(0.98).max(1.2).nullable(),
    fgSource: z.enum(gravitySources).nullable(),
    packagedVolumeL: z.number().positive().max(10_000).nullable(),
    packagedOn: z.iso.date().nullable(),
    packaging: z.enum(packagingKinds).nullable(),
    carbonationVols: z.number().min(0).max(6).nullable(),
    tastingNotes: z.string().trim().max(4000).nullable(),
    rating: z.number().int().min(1).max(5).nullable(),
    nextTime: z.string().trim().max(2000).nullable(),
    /** Optimistic concurrency: the result's `updatedAt` when the form was opened; absent for a new result. */
    baseUpdatedAt: z.number().int().positive().optional(),
  })
  .superRefine((input, ctx) => {
    if ((input.og === null) !== (input.ogSource === null)) {
      ctx.addIssue({ code: "custom", path: ["ogSource"], message: "OG og kilde må fylles ut sammen." });
    }
    if ((input.fg === null) !== (input.fgSource === null)) {
      ctx.addIssue({ code: "custom", path: ["fgSource"], message: "FG og kilde må fylles ut sammen." });
    }
    if (input.og !== null && input.fg !== null && input.fg >= input.og) {
      ctx.addIssue({ code: "custom", path: ["fg"], message: "FG må være lavere enn OG." });
    }
  });
export type SaveOutcomeInput = z.output<typeof saveOutcomeSchema>;

export const createBatchSchema = z.object({
  recipeId: z.string().min(1),
  /** Defaults to the recipe's current version. */
  recipeVersionId: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  brewDate: z.iso.date().optional(),
});

export const updateBatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  brewDate: z.iso.date().nullable().optional(),
  status: batchStatusSchema.optional(),
});

export const startStageSchema = z.object({
  stage: brewStageSchema,
  occurredAt: timestampSchema.optional(),
});

export const createSplitSchema = z.object({
  name: z.string().trim().min(1).max(80),
  vessel: z.string().trim().max(80).nullable().optional(),
  volumeL: z.number().positive().max(10_000).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

// --- Brew log --------------------------------------------------------------------

export interface TimelineMeasurement {
  id: string;
  kind: MeasurementKind;
  label: string | null;
  value: number;
  unit: string;
  enteredValue: number;
  enteredUnit: string;
  valueMin: number | null;
  valueMax: number | null;
  sampleTempC: number | null;
  instrument: string | null;
  comment: string | null;
}

export interface TimelineComment {
  id: string;
  body: string;
  editedAt: number | null;
}

export interface TimelineAttachment {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  caption: string | null;
  url: string;
}

export interface TimelineItem {
  id: string;
  type: string;
  stage: BrewStage | null;
  splitId: string | null;
  occurredAt: number;
  createdAt: number;
  updatedAt?: number;
  createdBy: UserRef;
  data: Record<string, unknown> | null;
  measurement: TimelineMeasurement | null;
  comment: TimelineComment | null;
  attachment: TimelineAttachment | null;
}

const optionalTimestamp = timestampSchema.optional();

export const createMeasurementSchema = z.object({
  kind: measurementKindSchema,
  value: z.number().finite(),
  valueMin: z.number().finite().optional(),
  valueMax: z.number().finite().optional(),
  /** Required for `custom`; otherwise the canonical unit for the kind is used. */
  unit: z.string().trim().min(1).max(20).optional(),
  label: z.string().trim().max(80).optional(),
  stage: brewStageSchema.nullable().optional(),
  splitId: z.string().min(1).nullable().optional(),
  measuredAt: optionalTimestamp,
  sampleTempC: z.number().min(-10).max(110).nullable().optional(),
  instrument: z.string().trim().max(80).nullable().optional(),
  comment: z.string().trim().max(1000).nullable().optional(),
}).superRefine((input, ctx) => {
  const hasMin = input.valueMin !== undefined;
  const hasMax = input.valueMax !== undefined;
  if (hasMin !== hasMax) {
    ctx.addIssue({ code: "custom", path: [hasMin ? "valueMax" : "valueMin"], message: "Et pH-intervall må ha både fra- og tilverdi." });
  }
  if ((hasMin || hasMax) && input.kind !== "ph") {
    ctx.addIssue({ code: "custom", path: ["valueMin"], message: "Intervall støttes bare for pH." });
  }
  if (hasMin && hasMax && input.valueMin! > input.valueMax!) {
    ctx.addIssue({ code: "custom", path: ["valueMax"], message: "Tilverdien må være lik eller større enn fraverdien." });
  }
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, "Skriv noe").max(4000),
  stage: brewStageSchema.nullable().optional(),
  splitId: z.string().min(1).nullable().optional(),
  occurredAt: optionalTimestamp,
});

export const updateCommentSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const correctLogEntrySchema = z.discriminatedUnion("entryKind", [
  z.object({
    entryKind: z.literal("measurement"),
    baseUpdatedAt: z.number().int().positive(),
    value: z.number().finite(),
    valueMin: z.number().finite().optional(),
    valueMax: z.number().finite().optional(),
    unit: z.string().trim().min(1).max(20),
    label: z.string().trim().max(80).nullable().optional(),
    occurredAt: timestampSchema,
    stage: brewStageSchema.nullable(),
    splitId: z.string().min(1).nullable(),
    sampleTempC: z.number().min(-10).max(110).nullable().optional(),
    instrument: z.string().trim().max(80).nullable().optional(),
    comment: z.string().trim().max(1000).nullable().optional(),
  }).superRefine((input, ctx) => {
    const hasMin = input.valueMin !== undefined;
    const hasMax = input.valueMax !== undefined;
    if (hasMin !== hasMax) ctx.addIssue({ code: "custom", path: [hasMin ? "valueMax" : "valueMin"], message: "Et pH-intervall må ha både fra- og tilverdi." });
    if ((hasMin || hasMax) && input.valueMin! > input.valueMax!) {
      ctx.addIssue({ code: "custom", path: ["valueMax"], message: "Tilverdien må være lik eller større enn fraverdien." });
    }
  }),
  z.object({
    entryKind: z.literal("event"),
    baseUpdatedAt: z.number().int().positive(),
    occurredAt: timestampSchema,
    stage: brewStageSchema.nullable(),
    splitId: z.string().min(1).nullable(),
    data: z.record(z.string(), z.unknown()),
  }),
]);
export type CorrectLogEntryInput = z.output<typeof correctLogEntrySchema>;

export const createEventSchema = z.object({
  type: eventTypeSchema,
  stage: brewStageSchema.nullable().optional(),
  splitId: z.string().min(1).nullable().optional(),
  occurredAt: optionalTimestamp,
  data: z.record(z.string(), z.unknown()).optional(),
});

export { ingredientAddedDataSchema };

export interface CreatedResponse {
  id: string;
}
