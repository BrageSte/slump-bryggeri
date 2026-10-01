import { describe, expect, it } from "vitest";
import { summarizeBreweryHistory } from "../../src/domain/brew-document/brewery-history.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { makeBatch } from "../helpers/batch.ts";
import type { BatchDetail, BatchOutcome, TimelineItem } from "../../src/domain/model/api.ts";
import { holsfjordenWater20261001 } from "../../src/domain/water/slump-water.ts";

const variants = [
  { id: "tropical", name: "Sunset Tropical", vessel: null, volumeL: 38, notes: null },
  { id: "pine", name: "Sunset Pine", vessel: null, volumeL: 22, notes: null },
];

function makeOutcome(id: string, splitId: string | null, og: number | null, fg: number | null): BatchOutcome {
  return {
    id,
    splitId,
    og,
    ogSource: og === null ? null : "sg",
    fg,
    fgSource: fg === null ? null : "sg",
    packagedVolumeL: null,
    packagedOn: null,
    packaging: null,
    carbonationVols: null,
    tastingNotes: null,
    rating: null,
    nextTime: null,
    updatedAt: 1,
    updatedBy: { id: "u", name: "Brage" },
  };
}

function makeHistoryBatch(input: {
  id: string;
  number: number;
  createdAt: number;
  brewDate: string | null;
  profile?: BatchDetail["equipmentSnapshot"]["values"];
  outcomes?: BatchOutcome[];
}): BatchDetail {
  return makeBatch({
    id: input.id,
    number: input.number,
    name: `Batch ${input.number}`,
    status: "completed",
    currentStage: null,
    stageStartedAt: null,
    brewDate: input.brewDate,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    completedAt: input.createdAt,
    equipmentSnapshot: { profileId: "p1", profileVersion: 1, values: input.profile ?? {} },
    splits: variants,
    outcomes: input.outcomes ?? [],
  });
}

function measurement(id: string, stage: "lauter" | "boil" | "cooling" | "fermentation" | "mash", kind: "volume" | "sg" | "temperature", value: number, occurredAt: number): TimelineItem {
  const unit = kind === "volume" ? "L" : kind === "sg" ? "SG" : "°C";
  return {
    id,
    type: "measurement",
    stage,
    splitId: null,
    occurredAt,
    createdAt: occurredAt,
    createdBy: { id: "u", name: "Brage" },
    data: null,
    measurement: {
      id: `m-${id}`,
      kind,
      label: null,
      value,
      unit,
      enteredValue: value,
      enteredUnit: unit,
      valueMin: null,
      valueMax: null,
      sampleTempC: null,
      instrument: null,
      comment: null,
    },
    comment: null,
    attachment: null,
  };
}

const measuredTimeline = (prefix: string, preBoil: number, postBoil: number, mashTemp: number): TimelineItem[] => [
  measurement(`${prefix}-pre`, "lauter", "volume", preBoil, 1),
  measurement(`${prefix}-post`, "boil", "volume", postBoil, 2),
  measurement(`${prefix}-og`, "cooling", "sg", 1.061, 3),
  measurement(`${prefix}-fermenter`, "fermentation", "volume", 60, 4),
  measurement(`${prefix}-mash`, "mash", "temperature", mashTemp, 5),
];

describe("brewery history", () => {
  const newest = makeHistoryBatch({
    id: "b-newest",
    number: 3,
    createdAt: 300,
    brewDate: "2026-09-27",
    profile: { boil_off_l_per_h: 5, brewhouse_efficiency_pct: 72, strike_temp_offset_c: 0 },
    outcomes: [
      makeOutcome("o-tropical", "tropical", 1.06, 1.012),
      makeOutcome("o-pine", "pine", 1.06, 1.014),
    ],
  });
  const older = makeHistoryBatch({
    id: "b-older",
    number: 2,
    createdAt: 200,
    brewDate: "2026-09-26",
    profile: { boil_off_l_per_h: 6, brewhouse_efficiency_pct: 70, strike_temp_offset_c: 0.5 },
    outcomes: [makeOutcome("o-whole", null, 1.06, 1.012)],
  });
  const unmeasured = makeHistoryBatch({
    id: "b-unmeasured",
    number: 1,
    createdAt: 100,
    brewDate: "2026-09-25",
    profile: { brewhouse_efficiency_pct: 71 },
    outcomes: [makeOutcome("o-unmeasured", null, null, null)],
  });

  it("summarizes measured calibration, variant results, profile values and aggregates", () => {
    const history = summarizeBreweryHistory([
      { batch: unmeasured, timeline: [] },
      { batch: older, timeline: measuredTimeline("old", 75, 65, 67.5) },
      { batch: newest, timeline: measuredTimeline("new", 75, 62, 65.5) },
    ]);

    expect(history.batches.map((batch) => batch.id)).toEqual(["b-newest", "b-older", "b-unmeasured"]);
    expect(history.batches[0]).toMatchObject({
      number: 3,
      name: "Batch 3",
      brewDate: "2026-09-27",
      status: "completed",
      recipeName: sunsetIpaRecipe.name,
      observations: { boilOffLPerH: 13, strikeOffsetDeviationC: -1 },
      equipmentProfile: { boilOffLPerH: 5, brewhouseEfficiencyPct: 72, strikeTempOffsetC: 0 },
      outcomes: [
        { variantName: "Sunset Tropical", cultures: ["Fermoale New-E"], og: 1.06, fg: 1.012, apparentAttenuationPct: 80 },
        { variantName: "Sunset Pine", cultures: ["Fermoale New-E"], og: 1.06, fg: 1.014, apparentAttenuationPct: 76.7 },
      ],
    });
    expect(history.batches[1]?.outcomes[0]).toMatchObject({ variantName: null, cultures: ["Fermoale New-E"], apparentAttenuationPct: 80 });
    expect(history.batches[2]).toMatchObject({
      observations: {},
      equipmentProfile: { brewhouseEfficiencyPct: 71 },
      outcomes: [{ variantName: null, og: null, fg: null, apparentAttenuationPct: null }],
    });

    expect(history.aggregates.boilOffLPerH).toEqual({ n: 2, mean: 11.5, min: 10, max: 13 });
    expect(history.aggregates.brewhouseEfficiencyPct).toMatchObject({ n: 2, min: expect.any(Number), max: expect.any(Number) });
    expect(history.aggregates.brewhouseEfficiencyPct.min).toBe(history.aggregates.brewhouseEfficiencyPct.max);
    expect(history.aggregates.brewhouseEfficiencyPct.mean).toBe(history.aggregates.brewhouseEfficiencyPct.min);
    expect(Math.abs((history.aggregates.brewhouseEfficiencyPct.mean ?? 0) - 60)).toBeLessThan(1.5);
    expect(history.aggregates.strikeOffsetDeviationC).toEqual({ n: 2, mean: 0, min: -1, max: 1 });
    expect(history.aggregates.attenuationByCulture["Fermoale New-E"]).toEqual({ n: 3, mean: 78.9, min: 76.7, max: 80 });
    expect(JSON.parse(JSON.stringify(history))).toEqual(history);
  });

  it("returns empty aggregates for empty input and leaves unmeasured values absent", () => {
    const empty = summarizeBreweryHistory([]);
    expect(empty).toEqual({
      batches: [],
      aggregates: {
        boilOffLPerH: { n: 0, mean: null, min: null, max: null },
        brewhouseEfficiencyPct: { n: 0, mean: null, min: null, max: null },
        strikeOffsetDeviationC: { n: 0, mean: null, min: null, max: null },
        attenuationByCulture: {},
      },
    });

    const history = summarizeBreweryHistory([{ batch: unmeasured, timeline: [] }]);
    expect(history.batches[0]?.observations).toEqual({});
    expect(history.aggregates.boilOffLPerH).toEqual({ n: 0, mean: null, min: null, max: null });
    expect(history.aggregates.brewhouseEfficiencyPct).toEqual({ n: 0, mean: null, min: null, max: null });
    expect(history.aggregates.strikeOffsetDeviationC).toEqual({ n: 0, mean: null, min: null, max: null });
  });

  it("carries each batch's water and pH facts so similar batches can be compared later", () => {
    const withWater = { ...older, equipmentSnapshot: { ...older.equipmentSnapshot, water: holsfjordenWater20261001 } };
    const base = measuredTimeline("old", 75, 65, 67.5);
    const ph = (id: string, stage: "mash" | "lauter", value: number, label: string | null, sampleTempC: number | null): TimelineItem => {
      const item = measurement(id, stage, "temperature", value, 10);
      return { ...item, measurement: { ...item.measurement!, kind: "ph", unit: "pH", label, sampleTempC, instrument: "pH-meter" } };
    };
    const acid: TimelineItem = {
      ...measurement("acid", "mash", "temperature", 0, 11),
      measurement: null,
      type: "ingredient_added",
      data: { ingredientKind: "misc", name: "Melkesyre", amount: 8, unit: "ml", waterAgent: "lactic_acid", acidStrengthPct: 80 },
    };
    const history = summarizeBreweryHistory([
      { batch: withWater, timeline: [...base, ph("p1", "mash", 5.31, null, 22), ph("p2", "lauter", 5.6, "Før kok", null), acid] },
      { batch: unmeasured, timeline: [] },
    ]);

    expect(history.batches[0]?.water).toEqual({
      sourceWaterId: "abv-holsfjorden-2026-10-01",
      sourceWaterFrozenInBatch: true,
      mashPhTarget: { min: 5.2, max: 5.4, source: "assumed" },
      phReadings: [
        { point: "mash", value: 5.31, sampleTempC: 22, instrument: "pH-meter" },
        { point: "pre_boil", value: 5.6, sampleTempC: null, instrument: "pH-meter" },
      ],
      saltsAndAcidsAdded: [{ agent: "lactic_acid", amount: 8, unit: "ml", acidStrengthPct: 80 }],
    });
    // A batch with nothing logged has no readings or additions to report, and its source water is marked as assumed.
    expect(history.batches[1]?.water).toEqual({
      sourceWaterId: "abv-holsfjorden-2026-10-01",
      sourceWaterFrozenInBatch: false,
      mashPhTarget: { min: 5.2, max: 5.4, source: "assumed" },
    });
    expect(JSON.parse(JSON.stringify(history))).toEqual(history);
  });
});
