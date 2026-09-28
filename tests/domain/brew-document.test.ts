import { describe, expect, it } from "vitest";
import { buildBrewDocument } from "../../src/domain/brew-document/brew-document.ts";
import { sunsetIpaBrewLog, sunsetIpaRecipe, sunsetIpaSplits } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { BatchDetail, TimelineItem } from "../../src/domain/model/api.ts";

const splits = sunsetIpaSplits.map((split) => ({ id: split.key, name: split.name, vessel: split.vessel, volumeL: split.volumeL, notes: null }));

const batch: BatchDetail = {
  id: "b1",
  number: 1,
  name: "Sunset IPA",
  status: "brewing",
  currentStage: "cooling",
  stageStartedAt: Date.parse("2026-09-23T13:25:00+02:00"),
  brewDate: "2026-09-23",
  recipe: { id: "r1", name: sunsetIpaRecipe.name },
  createdAt: 0,
  updatedAt: 0,
  completedAt: null,
  recipeVersion: { id: "v1", version: 1 },
  recipeSnapshot: sunsetIpaRecipe,
  equipmentSnapshot: { profileId: "p1", profileVersion: 2, values: { boil_off_l_per_h: 13.2, refractometer_wcf: 1 } },
  splits,
  outcomes: [],
};

const timeline: TimelineItem[] = sunsetIpaBrewLog.map((entry, index) => ({
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

describe("brew document", () => {
  const doc = buildBrewDocument({ batch, timeline, now: Date.parse("2026-09-23T13:30:00+02:00") });

  it("covers plan, equipment, status and the full log", () => {
    expect(doc).toContain("# Bryggedokument: Sunset IPA (#1)");
    expect(doc).toContain("### Kok (ferdig)");
    expect(doc).toContain("### Kjøling og gjærtilsetning (nå)");
    expect(doc).toContain("- Fordampning: 13,2 L/h");
    expect(doc).toContain("Skyllevann: 74,0 °C");
    expect(doc).toContain("## Logg");
    expect(doc.match(/^- \d\d\.\d\d\.\d{4}/gm)?.length).toBe(timeline.length);
  });

  it("marks calculated values and never invents measurements", () => {
    // Water volumes come from the equipment snapshot and are flagged as calculated.
    expect(doc).toMatch(/Innmeskingsvann.*≈ [\d,]+ L/);
    // The pitch temperature target has no reading in this log and must say so.
    expect(doc).toMatch(/gjærtilsetning: mål 18,0 °C, faktisk ikke målt → missing/);
    expect(doc).toContain("ikke registrert tilsatt");
  });

  it("says so when the equipment cannot give water volumes", () => {
    const withoutBoilOff = buildBrewDocument({ batch: { ...batch, equipmentSnapshot: { ...batch.equipmentSnapshot, values: {} } }, timeline: [], now: 0 });
    expect(withoutBoilOff).toContain("mangler fordampning");
    expect(withoutBoilOff).toContain("Ingenting logget ennå");
  });
});
