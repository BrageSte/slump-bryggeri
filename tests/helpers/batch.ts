import { sunsetIpaBrewLog, sunsetIpaRecipe, sunsetIpaSplits } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BatchDetail, BatchSplit, TimelineItem } from "../../src/domain/model/api.ts";

/** The Sunset IPA's splits, shaped as the API returns them (fixture splits have no `notes`). */
export function sunsetSplits(): BatchSplit[] {
  return sunsetIpaSplits.map((split) => ({ id: split.key, name: split.name, vessel: split.vessel, volumeL: split.volumeL, notes: null }));
}

/**
 * A `BatchDetail` for the Sunset IPA reference batch, with sensible defaults for fields most
 * tests don't care about. Pass `overrides` for anything a test needs to control.
 */
export function makeBatch(overrides: Partial<BatchDetail> = {}): BatchDetail {
  return {
    id: "b1",
    number: 1,
    name: "Sunset IPA",
    status: "brewing",
    currentStage: "mash",
    stageStartedAt: 0,
    brewDate: null,
    recipe: { id: "r1", name: sunsetIpaRecipe.name },
    createdAt: 0,
    updatedAt: 0,
    completedAt: null,
    recipeVersion: { id: "v1", version: 1 },
    recipeSnapshot: sunsetIpaRecipe,
    equipmentSnapshot: { profileId: "p", profileVersion: 1, values: {} },
    splits: sunsetSplits(),
    outcomes: [],
    ...overrides,
  };
}

/**
 * The Sunset IPA's brew log (or a variant of it) mapped to `TimelineItem[]`, as the API would
 * return it. Defaults to the full `sunsetIpaBrewLog`; pass a different entry list to build a
 * variant (e.g. with an extra reading appended).
 */
export function sunsetTimeline(entries: typeof sunsetIpaBrewLog = sunsetIpaBrewLog): TimelineItem[] {
  return entries.map((entry, index) => ({
    id: `e${index}`,
    type: entry.ingredient ? "ingredient_added" : entry.type,
    stage: entry.stage,
    splitId: entry.split ?? null,
    occurredAt: Date.parse(entry.at),
    createdAt: Date.parse(entry.at),
    createdBy: { id: "u1", name: "Brage" },
    data: entry.ingredient ? { ...entry.ingredient } : null,
    measurement: entry.measurement
      ? {
          id: `m${index}`,
          kind: entry.measurement.kind,
          label: entry.measurement.label ?? null,
          value: entry.measurement.value,
          unit: entry.measurement.unit,
          enteredValue: entry.measurement.value,
          enteredUnit: entry.measurement.unit,
          valueMin: null,
          valueMax: null,
          sampleTempC: null,
          instrument: null,
          comment: entry.measurement.comment ?? null,
        }
      : null,
    comment: null,
    attachment: null,
  }));
}
