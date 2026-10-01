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
