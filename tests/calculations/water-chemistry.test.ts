import { describe, expect, it } from "vitest";
import {
  addSaltsToWater,
  alkalinityAsCaCO3FromBicarbonate,
  alkalinityMmolFromBicarbonate,
  deriveWaterValues,
  hardnessDegreesDh,
  hardnessMmol,
  residualAlkalinityAsCaCO3,
  saltIonIncrease,
  saltMassFractions,
  solveSaltAdditions,
  sulfateToChlorideRatio,
} from "../../src/domain/brewing-calculations/index.ts";
import { getWaterAgent, isSaltAgent, waterAgents, type SaltComposition } from "../../src/domain/model/water.ts";

function composition(id: string) {
  const agent = getWaterAgent(id);
  if (!isSaltAgent(agent)) throw new Error(`${id} is not a salt`);
  return agent.composition;
}

describe("alkalinity and hardness", () => {
  it("states 122 mg/L bicarbonate as 2.0 mmol/L, which is 100 mg/L as CaCO3", () => {
    expect(alkalinityMmolFromBicarbonate(122.03)).toBeCloseTo(2, 3);
    expect(alkalinityAsCaCO3FromBicarbonate(122.03)).toBeCloseTo(100.09, 1);
  });

  it("counts 1 mmol/L of calcium as 5.6 °dH", () => {
    expect(hardnessMmol({ ca: 40.078, mg: 0 })).toBeCloseTo(1, 6);
    expect(hardnessDegreesDh({ ca: 40.078, mg: 0 })).toBeCloseTo(5.61, 2);
    expect(hardnessDegreesDh({ ca: 0, mg: 24.305 })).toBeCloseTo(5.61, 2);
  });

  it("computes residual alkalinity as alkalinity minus Ca/3.5 and Mg/7 in CaCO3 units (Kolbach)", () => {
    // 100.09 − (50 × 2.497 / 3.5 + 10 × 4.118 / 7) = 58.5, the same as Palmer's Ca/1.4 + Mg/1.7 form.
    expect(residualAlkalinityAsCaCO3({ ca: 50, mg: 10, hco3: 122.03 })).toBeCloseTo(58.5, 1);
    expect(residualAlkalinityAsCaCO3({ ca: 50, mg: 10, hco3: 122.03 })).toBeCloseTo(122.03 / 61.017 * 50.043 - (50 / 1.4 + 10 / 1.7), 0);
  });

  it("gives negative residual alkalinity when calcium outweighs alkalinity", () => {
    expect(residualAlkalinityAsCaCO3({ ca: 150, mg: 0, hco3: 0 })).toBeLessThan(0);
  });

  it("leaves the sulfate:chloride ratio undefined without chloride", () => {
    expect(sulfateToChlorideRatio({ so4: 150, cl: 50 })).toBe(3);
    expect(sulfateToChlorideRatio({ so4: 150, cl: 0 })).toBeNull();
  });
});

describe("salts", () => {
  // Per 1 g/L; reference values are the standard ones brewers use (Palmer, Water, 2013).
  it.each([
    ["gypsum", { ca: 232.8, so4: 557.7 }],
    ["calcium_chloride_dihydrate", { ca: 272.6, cl: 482.3 }],
    ["calcium_chloride_anhydrous", { ca: 361.1, cl: 638.9 }],
    ["epsom_salt", { mg: 98.6, so4: 389.6 }],
    ["table_salt", { na: 393.4, cl: 606.6 }],
    ["baking_soda", { na: 273.7, hco3: 726.3 }],
  ])("%s: 1 g in 1 L adds the expected ions", (id, expected) => {
    const increase = saltIonIncrease(composition(id), 1, 1);
    expect(Object.keys(increase).sort()).toEqual(Object.keys(expected).sort());
    for (const [ion, value] of Object.entries(expected)) {
      expect(increase[ion as keyof typeof increase]).toBeCloseTo(value, 0);
    }
  });

  it("accounts for the whole salt: ions plus crystal water add up to its mass", () => {
    for (const agent of waterAgents) {
      if (agent.kind !== "salt") continue;
      const formula: SaltComposition = agent.composition;
      const { ions } = saltMassFractions(formula);
      const ionFraction = Object.values(ions).reduce((sum, fraction) => sum + fraction, 0);
      // Epsom salt carries seven crystal waters, so only about half of it is ions.
      expect(ionFraction, agent.id).toBeGreaterThan(0.4);
      expect(ionFraction, agent.id).toBeLessThanOrEqual(1);
      if (!formula.hydrationWater) expect(ionFraction, agent.id).toBeCloseTo(1, 6);
    }
  });

  it("scales linearly with grams and inversely with volume", () => {
    const base = saltIonIncrease(composition("gypsum"), 10, 50);
    expect(base.ca).toBeCloseTo(46.56, 1);
    expect(saltIonIncrease(composition("gypsum"), 20, 50).ca).toBeCloseTo(base.ca! * 2, 6);
    expect(saltIonIncrease(composition("gypsum"), 10, 100).ca).toBeCloseTo(base.ca! / 2, 6);
  });

  it("adds salts on top of the source water without touching it", () => {
    const source = { ca: 6.6, mg: 0.89, na: 2.7, cl: 2.5, so4: 3.4, hco3: 16.5 };
    const result = addSaltsToWater(
      source,
      [
        { composition: composition("gypsum"), grams: 10 },
        { composition: composition("calcium_chloride_dihydrate"), grams: 20 },
      ],
      100,
    );
    // 10 g gypsum + 20 g CaCl2·2H2O in 100 L: Ca +23.28 +54.52, SO4 +55.79, Cl +96.46.
    expect(result.ca).toBeCloseTo(6.6 + 23.28 + 54.52, 1);
    expect(result.so4).toBeCloseTo(3.4 + 55.79, 1);
    expect(result.cl).toBeCloseTo(2.5 + 96.46, 1);
    expect(result.mg).toBe(0.89);
    expect(result.hco3).toBe(16.5);
    expect(source.ca).toBe(6.6);
  });

  it("rejects impossible input", () => {
    expect(() => saltIonIncrease(composition("gypsum"), 5, 0)).toThrow(RangeError);
    expect(() => saltIonIncrease(composition("gypsum"), -1, 10)).toThrow(RangeError);
    expect(() => saltMassFractions({})).toThrow(RangeError);
  });
});

describe("derived values for the Holsfjorden profile", () => {
  const derived = deriveWaterValues({ ca: 6.6, mg: 0.89, na: 2.7, cl: 2.5, so4: 3.4, hco3: 16.5 });

  it("matches the supplier's own rounded alkalinity and hardness", () => {
    expect(derived.alkalinityMmolL).toBeCloseTo(0.27, 2);
    expect(derived.alkalinityAsCaCO3MgL).toBeCloseTo(13.53, 1);
    expect(derived.hardnessDh).toBeCloseTo(1.13, 2);
  });

  it("has a small positive residual alkalinity and an unremarkable ratio", () => {
    expect(derived.residualAlkalinityAsCaCO3MgL).toBeCloseTo(8.3, 1);
    expect(derived.sulfateToChlorideRatio).toBeCloseTo(1.36, 2);
  });
});

describe("salts for a target profile", () => {
  const pure = { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 };
  const salts = ["gypsum", "calcium_chloride_dihydrate", "epsom_salt", "table_salt"].map((id) => ({ id, composition: composition(id) }));
  const grams = (solution: ReturnType<typeof solveSaltAdditions>) => Object.fromEntries(solution.salts.map((s) => [s.id, s.grams]));

  it("finds 1 g calcium chloride dihydrate for 27.3 mg/L Ca and 48.2 mg/L Cl in 10 L of pure water", () => {
    // CaCl₂·2H₂O is 147.01 g/mol: 27.26 % calcium and 48.23 % chloride.
    const solution = solveSaltAdditions({ source: pure, target: { ca: 27.26, cl: 48.23 }, waterVolumeL: 10, salts });
    expect(grams(solution)).toEqual({ gypsum: 0, calcium_chloride_dihydrate: 1, epsom_salt: 0, table_salt: 0 });
    expect(solution.deviation.ca).toBeCloseTo(0, 1);
    expect(solution.deviation.cl).toBeCloseTo(0, 1);
  });

  it("recovers the four salts that made a profile from Holsfjorden water", () => {
    const holsfjorden = { ca: 6.6, mg: 0.89, na: 2.7, cl: 2.5, so4: 3.4, hco3: 16.5 };
    const target = addSaltsToWater(
      holsfjorden,
      [
        { composition: composition("gypsum"), grams: 5 },
        { composition: composition("calcium_chloride_dihydrate"), grams: 8 },
        { composition: composition("epsom_salt"), grams: 2 },
        { composition: composition("table_salt"), grams: 1.5 },
      ],
      90,
    );
    const solution = solveSaltAdditions({ source: holsfjorden, target, waterVolumeL: 90, salts });
    expect(grams(solution)).toEqual({ gypsum: 5, calcium_chloride_dihydrate: 8, epsom_salt: 2, table_salt: 1.5 });
  });

  it("lets calcium follow the salts when it has no target, and uses no salt for an ion without one", () => {
    // Gypsum is 55.79 % sulfate: 150 mg/L in 20 L is 3 g sulfate, 5.38 g gypsum.
    const solution = solveSaltAdditions({ source: pure, target: { so4: 150 }, waterVolumeL: 20, salts });
    expect(grams(solution)).toEqual({ gypsum: 5.4, calcium_chloride_dihydrate: 0, epsom_salt: 0, table_salt: 0 });
    expect(solution.result.ca).toBeCloseTo(62.9, 0);
    expect(solution.result.mg).toBe(0);
    // Sulfate without a target: gypsum and Epsom salt stay out even when calcium and magnesium are low.
    expect(grams(solveSaltAdditions({ source: pure, target: { ca: 80, mg: 10, cl: 60 }, waterVolumeL: 20, salts })).gypsum).toBe(0);
  });

  it("never suggests negative amounts and reports a target below the source water as out of reach", () => {
    const hard = { ca: 100, mg: 5, na: 10, cl: 80, so4: 40, hco3: 200 };
    const solution = solveSaltAdditions({ source: hard, target: { ca: 50, cl: 40, so4: 120 }, waterVolumeL: 30, salts });
    expect(solution.salts.every((s) => s.grams >= 0)).toBe(true);
    expect(grams(solution).calcium_chloride_dihydrate).toBe(0);
    expect(solution.deviation.cl).toBeCloseTo(40, 6);
    expect(solution.deviation.ca!).toBeGreaterThan(0);
  });

  it("compromises in least squares when calcium, chloride and sulfate cannot all be hit", () => {
    // Cl 150 needs ≈ 85 mg/L Ca from CaCl₂ and SO₄ 75 ≈ 31 from gypsum, more than the 100 asked for.
    const solution = solveSaltAdditions({ source: pure, target: { ca: 100, cl: 150, so4: 75 }, waterVolumeL: 50, salts });
    expect(grams(solution).epsom_salt).toBe(0);
    expect(solution.result.ca).toBeGreaterThan(100);
    expect(solution.result.cl).toBeLessThan(150);
    expect(Math.abs(solution.deviation.ca!)).toBeLessThan(20);
  });

  it("rounds to the weighing step and calculates the result from the rounded grams", () => {
    const solution = solveSaltAdditions({ source: pure, target: { so4: 150 }, waterVolumeL: 20, salts, stepG: 1 });
    expect(grams(solution).gypsum).toBe(5);
    expect(solution.result.so4).toBeCloseTo((5 * 0.5579 * 1000) / 20, 0);
  });

  it("rejects a volume that is not positive", () => {
    expect(() => solveSaltAdditions({ source: pure, target: { ca: 50 }, waterVolumeL: 0, salts })).toThrow(RangeError);
  });
});
