import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderWaterAgentsMarkdown, renderWaterProfileMarkdown, replaceDocBlock, syncWaterDoc, waterDocBlocks } from "../../src/domain/water/docs.ts";
import { slumpBaseWater } from "../../src/domain/water/slump-water.ts";

const docPath = new URL("../../docs/water.md", import.meta.url).pathname;

describe("docs/water.md", () => {
  const document = readFileSync(docPath, "utf8");

  it("shows the canonical profile and the salt table exactly as the data renders them (run `npm run docs:water` after a change)", () => {
    expect(syncWaterDoc(document, slumpBaseWater)).toBe(document);
  });

  it("carries the generated numbers and nothing hand-copied around them", () => {
    expect(document).toContain(renderWaterProfileMarkdown(slumpBaseWater));
    expect(document).toContain(renderWaterAgentsMarkdown());
    expect(renderWaterProfileMarkdown(slumpBaseWater)).toContain("| Kalsium (Ca) | 6,6 | mg/L | Oppgitt (kilde) |");
    expect(renderWaterProfileMarkdown(slumpBaseWater)).toContain("| Restalkalitet (RA) som CaCO₃ | 8,3 | mg/L | Beregnet |");
    expect(renderWaterProfileMarkdown(slumpBaseWater)).toContain("Øvrige oppgitte verdier (22)");
    expect(renderWaterProfileMarkdown(slumpBaseWater)).toContain("| Kalium | 0,53 | mg/L | – |");
    expect(renderWaterProfileMarkdown(slumpBaseWater)).toContain("| Kvikksølv | 0,0005 | µg/L | 1 |");
    expect(renderWaterProfileMarkdown(slumpBaseWater)).toContain("Alle 16 verdier med tallfestet grenseverdi ligger under den.");
    expect(renderWaterProfileMarkdown(slumpBaseWater)).toContain("**Bekreftet i bruk:** Brage, 2026-10-01.");
    expect(renderWaterAgentsMarkdown()).toContain("| Gips (kalsiumsulfat, CaSO₄·2H₂O) | `gypsum` | 23,3 | – | – | – | 55,8 | – |");
  });

  it("names every kind of value and links the canonical data", () => {
    for (const heading of ["Oppgitt (kilde)", "Beregnet", "Mål / anbefaling", "Målt i brygget"]) expect(document).toContain(heading);
    expect(document).toContain("src/domain/water/slump-water.ts");
    expect(document).toContain("ikke regler");
  });

  it("fails loudly when a block marker is missing", () => {
    expect(() => replaceDocBlock("ingen markører", waterDocBlocks.profile, "x")).toThrow(/not found/);
  });
});
