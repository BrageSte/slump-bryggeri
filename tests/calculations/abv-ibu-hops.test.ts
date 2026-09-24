import { describe, expect, it } from "vitest";
import {
  calculateAbv,
  calculateApparentAttenuation,
  calculateHopAdjustment,
  calculateIbu,
  dryHopDose,
  estimateFinalGravity,
  isomerizationRateFactor,
  tinsethUtilization,
} from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";

describe("ABV and attenuation", () => {
  it("uses (OG − FG) × 131.25 by default", () => {
    expect(calculateAbv(1.05, 1.01)).toBeCloseTo(5.25, 6);
    // Sunset IPA: OG ≈ 1.061 → "ca. 6 %"
    expect(calculateAbv(1.061, 1.015)).toBeCloseTo(6.04, 2);
  });

  it("supports the alternate high-gravity formula", () => {
    expect(calculateAbv(1.05, 1.01, "alternate")).toBeCloseTo(5.339, 3);
  });

  it("computes attenuation both ways", () => {
    expect(calculateApparentAttenuation(1.05, 1.01)).toBeCloseTo(80, 6);
    expect(estimateFinalGravity(1.05, 80)).toBeCloseTo(1.01, 6);
  });
});

describe("IBU (Tinseth)", () => {
  it("matches Tinseth's published utilization table", () => {
    expect(tinsethUtilization({ boilGravity: 1.05, timeMin: 60 })).toBeCloseTo(0.231, 3);
    expect(tinsethUtilization({ boilGravity: 1.03, timeMin: 60 })).toBeCloseTo(0.276, 3);
    expect(tinsethUtilization({ boilGravity: 1.05, timeMin: 0 })).toBe(0);
  });

  it("computes 1 oz of 6.4 % AA for 60 min in 5 gal at 1.050 ≈ 22 IBU", () => {
    const result = calculateIbu({
      hops: [{ id: "a", amountG: 28.35, alphaPct: 6.4, use: "boil", timeMin: 60 }],
      volumeL: 18.93,
      boilGravity: 1.05,
    });
    expect(result.total).toBeCloseTo(22.1, 1);
  });

  it("scales whirlpool utilization by temperature", () => {
    expect(isomerizationRateFactor(100)).toBeCloseTo(1, 6);
    expect(isomerizationRateFactor(82)).toBeCloseTo(0.265, 3);
    expect(isomerizationRateFactor(80)).toBeCloseTo(0.227, 3);
  });

  it("gives no bitterness for dry hops and flags missing alpha acid", () => {
    const result = calculateIbu({
      hops: [
        { id: "dry", amountG: 100, alphaPct: 12, use: "dry_hop" },
        { id: "unknown", amountG: 30, use: "boil", timeMin: 60 },
      ],
      volumeL: 20,
      boilGravity: 1.05,
    });
    expect(result.total).toBe(0);
    expect(result.contributions.find((c) => c.id === "unknown")?.missingAlpha).toBe(true);
  });

  it("computes the Sunset IPA bitterness (60 min Simcoe + 80 °C whirlpool)", () => {
    const result = calculateIbu({ hops: sunsetIpaRecipe.hops, volumeL: 60, boilGravity: 1.061 });
    const boil = result.contributions.find((c) => c.id === "h-simcoe-60");
    expect(boil?.ibu).toBeCloseTo(28.75, 1);
    expect(result.total).toBeCloseTo(42.9, 0);
  });
});

describe("hops", () => {
  it("adjusts for a lower alpha acid lot (spec example: 50 g @ 14 % with a 12.8 % lot)", () => {
    const result = calculateHopAdjustment({ amountG: 50, recipeAlphaPct: 14, actualAlphaPct: 12.8 });
    expect(result.amountG).toBeCloseTo(54.7, 1);
    expect(result.deltaG).toBeCloseTo(4.7, 1);
  });

  it("reproduces the planned Sunset IPA dry hop doses", () => {
    expect(dryHopDose(220, 38)).toBeCloseTo(5.8, 1);
    expect(dryHopDose(147, 22)).toBeCloseTo(6.7, 1);
  });
});
