import { describe, expect, it } from "vitest";
import { buildBreweryBrief } from "../../src/domain/brew-document/brewery-brief.ts";
import { holsfjordenWater20261001 } from "../../src/domain/water/slump-water.ts";

const equipment = {
  name: "Slump 60 L",
  version: 3,
  values: {
    batch_volume_l: { value: 60, source: "manual" as const },
    brewhouse_efficiency_pct: { value: 72, source: "default" as const },
    boil_off_l_per_h: { value: 13.2, source: "calibration" as const },
  },
};

describe("buildBreweryBrief", () => {
  it("states the active profile with where each value comes from", () => {
    const brief = buildBreweryBrief({ breweryName: "Slump Bryggeri", equipment, baseWater: holsfjordenWater20261001, recipes: [] });
    expect(brief).toContain("# Bryggeriet: Slump Bryggeri");
    expect(brief).toContain("versjon 3, «Slump 60 L»");
    expect(brief).toContain("Standard batchvolum til gjæring: 60 L (satt for hånd)");
    expect(brief).toContain("Brygghuseffektivitet: 72 % (≈ antatt standard)");
    expect(brief).toContain("Fordampning: 13,2 L/h (kalibrert)");
  });

  it("falls back to a documented default for an unset parameter and omits one without any", () => {
    const brief = buildBreweryBrief({ breweryName: "B", equipment: { name: "p", version: 1, values: {} }, baseWater: holsfjordenWater20261001, recipes: [] });
    // Mash thickness has a documented default; batch volume has none and must not be invented.
    expect(brief).toContain("Mesketykkelse: 3 L/kg (≈ antatt standard)");
    expect(brief).not.toContain("Standard batchvolum");
  });

  it("tells the assistant to ask when there is no profile", () => {
    const brief = buildBreweryBrief({ breweryName: "B", equipment: null, baseWater: holsfjordenWater20261001, recipes: [] });
    expect(brief).toContain("Ingen aktiv utstyrsprofil");
    expect(brief).toContain("Spør bryggeren");
  });

  it("gives the base water as the supplier's values with every ion", () => {
    const brief = buildBreweryBrief({ breweryName: "B", equipment, baseWater: holsfjordenWater20261001, recipes: [] });
    expect(brief).toContain("oppgitt av leverandør, ikke målt av oss");
    expect(brief).toContain(holsfjordenWater20261001.name);
    for (const symbol of ["Ca", "Mg", "Na", "Cl", "SO₄", "HCO₃"]) expect(brief).toContain(symbol);
  });

  it("counts the recipes and names the newest ten", () => {
    const recipes = Array.from({ length: 12 }, (_, i) => ({ name: `Oppskrift ${i + 1}`, style: i === 0 ? "Pils" : null }));
    const brief = buildBreweryBrief({ breweryName: "B", equipment, baseWater: holsfjordenWater20261001, recipes });
    expect(brief).toContain("12 oppskrifter");
    expect(brief).toContain("Oppskrift 1 (Pils)");
    expect(brief).toContain("Oppskrift 10");
    expect(brief).not.toContain("Oppskrift 11");
    expect(buildBreweryBrief({ breweryName: "B", equipment, baseWater: holsfjordenWater20261001, recipes: [] })).toContain("Ingen oppskrifter ennå");
  });
});
