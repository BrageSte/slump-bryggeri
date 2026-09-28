import { describe, expect, it } from "vitest";
import { reviewCalibration } from "../../src/domain/brew-document/tuning.ts";
import { sunsetIpaBrewLog, sunsetIpaRecipe, sunsetIpaSplits } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BatchDetail, TimelineItem } from "../../src/domain/model/api.ts";

const batch: BatchDetail = {
  id: "b1",
  number: 1,
  name: "Sunset IPA",
  status: "fermenting",
  currentStage: "fermentation",
  stageStartedAt: 0,
  brewDate: "2026-09-23",
  recipe: { id: "r1", name: sunsetIpaRecipe.name },
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  recipeVersion: { id: "v1", version: 1 },
  recipeSnapshot: sunsetIpaRecipe,
  equipmentSnapshot: { profileId: "p", profileVersion: 1, values: { boil_off_l_per_h: 5, refractometer_wcf: 1 } },
  splits: sunsetIpaSplits.map((s) => ({ id: s.key, name: s.name, vessel: s.vessel, volumeL: s.volumeL, notes: null })),
  outcomes: [],
};

function toTimeline(entries: typeof sunsetIpaBrewLog): TimelineItem[] {
  return entries.map((entry, index) => ({
    id: `e${index}`,
    type: entry.ingredient ? "ingredient_added" : entry.type,
    stage: entry.stage,
    splitId: entry.split ?? null,
    occurredAt: Date.parse(entry.at),
    createdAt: Date.parse(entry.at),
    createdBy: { id: "u", name: "Brage" },
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
          comment: null,
        }
      : null,
    comment: null,
    attachment: null,
  }));
}

describe("calibration review from a batch's own log", () => {
  const review = reviewCalibration({ batch, timeline: toTimeline(sunsetIpaBrewLog) });
  const by = (key: string) => review.observations.find((o) => o.profileKey === key);

  it("finds the Sunset IPA boil-off: 75.7 L → 62.5 L in 60 min = 13.2 L/h against 5 L/h in the profile", () => {
    expect(by("boil_off_l_per_h")).toMatchObject({ observed: 13.2, current: 5 });
  });

  it("derives brewhouse efficiency from the post-boil Brix and 38 + 22 L into the fermenters", () => {
    // The recipe's 60 % was back-calculated from exactly this OG and volume.
    const efficiency = by("brewhouse_efficiency_pct");
    expect(efficiency?.basis).toContain("60 L til gjæring");
    expect(efficiency?.basis).toContain("fra Brix");
    expect(Math.abs((efficiency?.observed ?? 0) - 60)).toBeLessThan(1.5);
  });

  it("asks for a mash reading instead of guessing the strike offset", () => {
    expect(by("strike_temp_offset_c")).toBeUndefined();
    expect(review.missing.join(" ")).toContain("mesketemperaturen");
  });

  it("suggests a strike offset from a low first mash reading", () => {
    const mashStart = Date.parse("2026-09-23T10:00:00+02:00");
    const withMash = [...toTimeline(sunsetIpaBrewLog), {
      ...toTimeline(sunsetIpaBrewLog)[0]!,
      id: "mash-temp",
      type: "measurement",
      occurredAt: mashStart + 5 * 60_000,
      measurement: { id: "mt", kind: "temperature" as const, label: null, value: 65.5, unit: "°C", enteredValue: 65.5, enteredUnit: "°C", valueMin: null, valueMax: null, sampleTempC: null, instrument: null, comment: null },
    }];
    const offset = reviewCalibration({ batch, timeline: withMash }).observations.find((o) => o.profileKey === "strike_temp_offset_c");
    // 1 °C low at the default 3 L/kg → strike water ≈ 1.1 °C hotter.
    expect(offset).toMatchObject({ observed: -1, current: 0, suggested: 1.1 });
  });

  it("lists what is missing on an empty log", () => {
    const empty = reviewCalibration({ batch, timeline: [] });
    expect(empty.observations).toEqual([]);
    expect(empty.missing).toHaveLength(3);
  });
});
