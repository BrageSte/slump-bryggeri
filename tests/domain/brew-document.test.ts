import { describe, expect, it } from "vitest";
import { buildAssistantBrief, buildBrewDocument, buildBrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
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
  const input = { batch, timeline, now: Date.parse("2026-09-23T13:30:00+02:00") };
  const doc = buildBrewDocument(input);

  it("joins named sections into the unchanged full document", () => {
    const sections = buildBrewDocumentSections(input);
    expect(Object.values(sections).filter(Boolean).join("\n\n") + "\n").toBe(doc);
    expect(Object.keys(sections)).toEqual(["header", "plan", "equipment", "status", "results", "calibration", "log"]);
  });

  it("builds a compact assistant brief with current status, next action and recent log", () => {
    const sections = buildBrewDocumentSections(input);
    const brief = buildAssistantBrief(input, sections);
    const latestLogLine = sections.log.split(/\r?\n/).filter((line) => line.startsWith("- ")).at(-1);

    expect(brief.length).toBeLessThan(doc.length * 0.4);
    expect(brief).toContain("## Status nå");
    expect(brief).toContain("Neste handling:");
    expect(brief).toContain("planlagt effektivitet");
    expect(brief).toContain("oppskriftsmål OG");
    expect(brief).toContain("Antakelser (ikke kalibrert)");
    expect(brief).toContain(latestLogLine);
    expect(brief).toContain(`Loggen har ${timeline.length} oppføringer`);
  });

  it("covers plan, equipment, status and the full log", () => {
    expect(doc).toContain("# Bryggedokument: Sunset IPA (#1)");
    expect(doc).toContain("- Status: Brygger nå");
    expect(doc).toContain("### Kok (ferdig)");
    expect(doc).toContain("### Kjøling og gjærtilsetning (nå)");
    expect(doc).toContain("- Fordampning: 13,2 L/h");
    expect(doc).toContain("Skyllevann: 74,0 °C");
    expect(doc).toContain("## Logg");
    expect(doc.match(/^- \d\d\.\d\d\.\d{4}/gm)?.length).toBe(timeline.length);
  });

  it("marks recipe, calculated and assumed values while keeping measurements separate", () => {
    expect(doc).toContain("oppskrift/import = oppgitt verdi");
    expect(doc).toMatch(/Innmeskingsvann.*≈ antatt/);
    expect(doc).toContain("Antakelser brukt (ikke kalibrerte verdier)");
    expect(doc).toContain("Logg meskevann og maltmengde når dere brygger.");
    // The pitch temperature target has no reading in this log and must say so.
    expect(doc).toContain("Temperatur ved gjærtilsetning: mål 18,0 °C (oppskrift/import), faktisk ikke målt → Ikke målt");
    expect(doc).toContain("ikke registrert tilsatt");
  });

  it("keeps water volumes available with named assumptions when the profile lacks boil-off", () => {
    const withoutBoilOff = buildBrewDocument({ batch: { ...batch, equipmentSnapshot: { ...batch.equipmentSnapshot, values: {} } }, timeline: [], now: 0 });
    expect(withoutBoilOff).toContain("Fordampning: 5 L/h");
    expect(withoutBoilOff).toContain("≈ antatt");
    expect(withoutBoilOff).not.toContain("Vannmengder kan ikke beregnes");
    expect(withoutBoilOff).toContain("Ingenting logget ennå");
  });

  it("labels recipe and calibrated-profile quantities separately", () => {
    const values = {
      boil_off_l_per_h: 13.2,
      grain_absorption_l_per_kg: 0.8,
      mash_thickness_l_per_kg: 3,
      mash_dead_space_l: 0,
      pump_pipe_loss_l: 0,
      kettle_loss_l: 0,
      chiller_loss_l: 0,
      transfer_loss_l: 0,
      cooling_shrinkage_pct: 4,
      grain_temperature_c: 18,
      strike_temp_offset_c: 0,
      refractometer_wcf: 1,
    };
    const sources = Object.fromEntries(Object.keys(values).map((key) => [key, "calibration"])) as typeof batch.equipmentSnapshot.sources;
    const calibratedDoc = buildBrewDocument({
      batch: { ...batch, equipmentSnapshot: { ...batch.equipmentSnapshot, values, sources } },
      timeline: [],
      now: 0,
    });

    expect(calibratedDoc).toContain("Oppskriftsmål OG 1.061");
    expect(calibratedDoc).toMatch(/Innmeskingsvann.*≈ [\d,]+ °C.*≈ [\d,]+ L/);
    expect(calibratedDoc).not.toContain("Antakelser brukt (ikke kalibrerte verdier)");
  });
});
