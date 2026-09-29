import { describe, expect, it } from "vitest";
import { reviewCalibration } from "../../src/domain/brew-document/tuning.ts";
import { makeBatch, sunsetTimeline } from "../helpers/batch.ts";

const batch = makeBatch({
  status: "fermenting",
  currentStage: "fermentation",
  brewDate: "2026-09-23",
  equipmentSnapshot: { profileId: "p", profileVersion: 1, values: { boil_off_l_per_h: 5, refractometer_wcf: 1 } },
});

describe("calibration review from a batch's own log", () => {
  const review = reviewCalibration({ batch, timeline: sunsetTimeline() });
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
    const withMash = [...sunsetTimeline(), {
      ...sunsetTimeline()[0]!,
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
