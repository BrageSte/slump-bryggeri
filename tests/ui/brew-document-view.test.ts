import { describe, expect, it } from "vitest";
import { buildBrewDocument } from "../../src/domain/brew-document/brew-document.ts";
import { parseBrewDocument } from "../../src/features/batches/brew-document-view.ts";
import { makeBatch, sunsetTimeline } from "../helpers/batch.ts";

describe("brew document presentation", () => {
  it("keeps plan, actual values and calibration evidence in distinct sections", () => {
    const sections = parseBrewDocument(`# Bryggedokument: Test (#1)

- Oppskrift: Test v1

## Plan og mål

### Mesk (nå)
- Mål 67 °C

## Status nå

- Mesk: mål 67 °C, faktisk ikke målt → Ikke målt

## Hva brygget sier om kalibreringen

- Ikke nok data. Logg volum før og etter kok.

## Logg

- Ingenting logget ennå.
`);

    expect(sections.map((section) => section.title)).toEqual([
      "Om brygget", "Plan og mål", "Status nå", "Hva brygget sier om kalibreringen", "Logg",
    ]);
    expect(sections[1]?.blocks).toEqual([
      { kind: "heading", text: "Mesk (nå)" },
      { kind: "list", items: [{ text: "Mål 67 °C", nested: false }] },
    ]);
    expect(sections[2]?.blocks).toEqual([
      { kind: "list", items: [{ text: "Mesk: mål 67 °C, faktisk ikke målt → Ikke målt", nested: false }] },
    ]);
    expect(sections[3]?.blocks[0]).toMatchObject({ kind: "list", items: [{ text: expect.stringContaining("Ikke nok data") }] });
  });

  it("does not turn a log comment into another document section", () => {
    const sections = parseBrewDocument(`## Resultat
- Tropical: OG 1.061
  - Smak: sitrus

## Logg
- Kommentar: Første linje
## Status nå
<script>not markup</script>`);

    expect(sections.map((section) => section.title)).toEqual(["Resultat", "Logg"]);
    expect(sections[0]?.blocks[0]).toMatchObject({ kind: "list", items: [{ nested: false }, { nested: true }] });
    expect(sections[1]?.blocks.at(-1)).toEqual({ kind: "paragraph", text: "## Status nå <script>not markup</script>" });
  });

  it("shows the water section, with its four parts as headings, between plan and equipment", () => {
    const markdown = buildBrewDocument({ batch: makeBatch(), timeline: sunsetTimeline(), now: Date.parse("2026-09-23T13:30:00+02:00") });
    const sections = parseBrewDocument(markdown);
    const titles = sections.map((section) => section.title);
    expect(titles.indexOf("Vann og pH")).toBe(titles.indexOf("Plan og mål") + 1);
    expect(titles[titles.indexOf("Vann og pH") + 1]).toMatch(/^Utstyrsprofil/);
    const water = sections.find((section) => section.title === "Vann og pH")!;
    expect(water.blocks.filter((block) => block.kind === "heading").map((block) => (block as { text: string }).text)).toEqual([
      "Kildevann (oppgitt)",
      "Beregnet fra kildevannet (≈)",
      "Plan (mål)",
      "Målt i brygget",
    ]);
  });
});
