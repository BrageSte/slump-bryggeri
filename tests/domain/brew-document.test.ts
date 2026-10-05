import { describe, expect, it } from "vitest";
import { buildAssistantBrief, buildBrewDocument, buildBrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import { makeBatch, sunsetTimeline } from "../helpers/batch.ts";

const batch = makeBatch({
  currentStage: "cooling",
  stageStartedAt: Date.parse("2026-09-23T13:25:00+02:00"),
  brewDate: "2026-09-23",
  equipmentSnapshot: { profileId: "p1", profileVersion: 2, values: { boil_off_l_per_h: 13.2, refractometer_wcf: 1 } },
});

const timeline = sunsetTimeline();

describe("brew document", () => {
  it("provides split ids only in the machine brief, not the human document", () => {
    const splitBatch = { ...batch, splits: [{ id: "private-split-id", name: "Tropical", vessel: "Kar A", volumeL: 10, notes: null }] };
    const context = { batch: splitBatch, timeline: [], now: 0 };
    expect(buildAssistantBrief(context)).toContain('"id":"private-split-id","name":"Tropical"');
    expect(buildBrewDocument(context)).not.toContain("private-split-id");
  });
  const input = { batch, timeline, now: Date.parse("2026-09-23T13:30:00+02:00") };
  const doc = buildBrewDocument(input);

  it("joins named sections into the unchanged full document", () => {
    const sections = buildBrewDocumentSections(input);
    expect(Object.values(sections).filter(Boolean).join("\n\n") + "\n").toBe(doc);
    expect(Object.keys(sections)).toEqual(["header", "plan", "water", "equipment", "status", "results", "calibration", "log"]);
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
    // The assistant can ask for the water section; the brief only names it.
    expect(brief).toContain("Hentbare seksjoner: plan, water, equipment");
    expect(brief).not.toContain("Kildevann (oppgitt)");
  });

  it("covers plan, equipment, status and the full log", () => {
    expect(doc).toContain("# Bryggedokument: Sunset IPA (#1)");
    expect(doc).toContain("- Status: Brygger nå");
    expect(doc).toContain("### Kok (ferdig)");
    expect(doc).toContain("### Kjøling og gjærtilsetning (nå)");
    expect(doc).toContain("- Fordampning: 13,2 L/h");
    expect(doc).toContain("Skyllevann: 74,0 °C");
    expect(doc).toContain("## Logg");
    // The log section has one dated line per entry; the water section repeats the pH readings, so count the log alone.
    expect(buildBrewDocumentSections(input).log.match(/^- \d\d\.\d\d\.\d{4}/gm)?.length).toBe(timeline.length);
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
