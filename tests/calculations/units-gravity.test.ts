import { describe, expect, it } from "vitest";
import {
  brixToSg,
  calculateEfficiency,
  calculateGravityEstimate,
  fahrenheitToCelsius,
  grainBillPercentages,
  mashedGrainKg,
  ouncesToGrams,
  platoToSg,
  poundsToKg,
  refractometerFinalGravity,
  sgToPlato,
  usGallonsToLiters,
} from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { expectWithin } from "../helpers.ts";

describe("unit conversions", () => {
  it("converts the US gallon readings in the Sunset IPA log to litres", () => {
    expect(usGallonsToLiters(20.0)).toBeCloseTo(75.7, 1);
    expect(usGallonsToLiters(19.0)).toBeCloseTo(71.9, 1);
    expect(usGallonsToLiters(16.5)).toBeCloseTo(62.5, 1);
  });

  it("converts 2 oz to 56.7 g (import spec example)", () => {
    expect(ouncesToGrams(2)).toBeCloseTo(56.7, 1);
  });

  it("converts Fahrenheit", () => {
    expect(fahrenheitToCelsius(152)).toBeCloseTo(66.67, 2);
    expect(fahrenheitToCelsius(212)).toBeCloseTo(100, 6);
  });
});

describe("gravity", () => {
  it("matches the ASBC Plato table", () => {
    expect(platoToSg(12)).toBeCloseTo(1.0484, 4);
    expect(sgToPlato(1.048)).toBeCloseTo(11.9, 1);
    expect(sgToPlato(platoToSg(15))).toBeCloseTo(15, 1);
  });

  it("reproduces the Brix → SG conversions in the Sunset IPA log (no wort correction)", () => {
    // The log records approximate values ("≈"), so allow ±0.001.
    expectWithin(brixToSg(12.1), 1.048, 0.001);
    expectWithin(brixToSg(14.0), 1.057, 0.001);
    expectWithin(brixToSg(15.0), 1.061, 0.001);
  });

  it("applies the refractometer wort correction factor", () => {
    // 15.0 °Bx / 1.04 = 14.42 °P
    expect(brixToSg(15.0, 1.04)).toBeCloseTo(platoToSg(15 / 1.04), 10);
    expect(brixToSg(15.0, 1.04)).toBeCloseTo(1.0587, 4);
    expect(() => brixToSg(10, 0)).toThrow(RangeError);
  });

  it("corrects fermenting refractometer readings (Terrill cubic)", () => {
    expect(refractometerFinalGravity({ originalBrix: 15, finalBrix: 7.5 })).toBeCloseTo(1.0135, 4);
  });

  it("defines sucrose as 46.214 ppg", () => {
    const og = calculateGravityEstimate({
      fermentables: [{ amountKg: poundsToKg(1), type: "sugar", yieldPct: 100 }],
      volumeL: usGallonsToLiters(1),
      efficiencyPct: 50, // ignored for sugars
    });
    expect(og).toBeCloseTo(1.046214, 5);
  });

  it("estimates OG from a grain bill and back-calculates efficiency", () => {
    const fermentables = [{ amountKg: 5, type: "grain" as const, yieldPct: 80 }];
    const og = calculateGravityEstimate({ fermentables, volumeL: 23, efficiencyPct: 75 });
    expect(og).toBeCloseTo(1.0503, 4);
    expect(calculateEfficiency({ fermentables, sg: og, volumeL: 23 })).toBeCloseTo(75, 6);
  });

  it("reproduces the Sunset IPA grain bill percentages", () => {
    const pct = grainBillPercentages(sunsetIpaRecipe.fermentables).map((p) => Math.round(p * 10) / 10);
    expect(pct).toEqual([74.7, 20.2, 1.9, 3.3]);
  });

  it("sums only grain and adjunct into mashedGrainKg, leaving out sugar/extract/other", () => {
    const recipe = {
      fermentables: [
        { amountKg: 5, type: "grain" as const },
        { amountKg: 1, type: "adjunct" as const },
        { amountKg: 0.5, type: "sugar" as const },
        { amountKg: 0.3, type: "extract" as const },
        { amountKg: 0.2, type: "other" as const },
      ],
    };
    expect(mashedGrainKg(recipe)).toBeCloseTo(6, 10);
  });

  it("returns 0 for a recipe with no mashed fermentables", () => {
    expect(mashedGrainKg({ fermentables: [{ amountKg: 1, type: "sugar" as const }] })).toBe(0);
    expect(mashedGrainKg({ fermentables: [] })).toBe(0);
  });
});
