import { describe, expect, it } from "vitest";
import { buildBrewPlan } from "../../src/domain/brew-day/brew-plan.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { phasePreview, planItemSummary, quantity, withSource } from "../../src/features/batches/plan-format.ts";

const plan = buildBrewPlan({ recipe: sunsetIpaRecipe, equipment: {} });
const phase = (key: string) => {
  const found = plan.phases.find((p) => p.key === key);
  if (!found) throw new Error(`no ${key} phase`);
  return found;
};

describe("plan formatting", () => {
  it("prefixes calculated and assumed values, and leaves recipe values alone", () => {
    expect(withSource("recipe", "66,5 °C")).toBe("66,5 °C");
    expect(withSource("calculated", "59,5 L")).toBe("≈ 59,5 L");
    expect(withSource("assumed", "59,5 L")).toBe("≈ 59,5 L antatt");
    expect(withSource("assumed", "59,5 L", true)).toBe("≈ 59,5 L");
    expect(quantity(undefined, "L")).toBeNull();
  });

  it("summarises an item on one line", () => {
    const simcoe = phase("boil").items.find((item) => item.addition);
    expect(simcoe && planItemSummary(simcoe)).toBe("65 g Simcoe T90 60 min");
    const mash = phase("mash").items[0];
    expect(mash && planItemSummary(mash)).toBe("Mesk 66,5 °C, 60 min");
  });

  it("previews the first items of a collapsed phase and counts the rest", () => {
    expect(phasePreview(phase("boil"))).toBe("Kok 60 min · 65 g Simcoe T90 60 min");
    expect(phasePreview(phase("whirlpool"))).toBe(
      "84,6 g Citra T90 80,0 °C, 20 min · 100 g Mosaic T90 80,0 °C, 20 min · 33,9 g Simcoe T90 80,0 °C, 20 min",
    );
    expect(phasePreview(phase("mash"))).toBe("Mesk 66,5 °C, 60 min · 14,80 kg BEST Pale Ale · 4,00 kg Pilsner · +2 til");
    expect(phasePreview({ items: [] })).toBe("");
  });

  it("marks calculated and assumed water values in the preview", () => {
    expect(phasePreview(phase("water"))).toBe(
      "Innmeskingsvann ≈ 73,1 °C, ≈ 59,5 L · Skyllevann 77,5 °C, ≈ 23,9 L · Vann totalt ≈ 83,4 L",
    );
  });
});
