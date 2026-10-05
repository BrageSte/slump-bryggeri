import { describe, expect, it } from "vitest";
import {
  addSaltsToWater,
  applyWaterPlan,
  calculateIbu,
  calculateRecipeMetrics,
  designRecipe,
  standardSaltIds,
  type RecipeDesignSpec,
} from "../../src/domain/brewing-calculations/index.ts";
import { emptyRecipe, recipeDocumentSchema } from "../../src/domain/model/recipe.ts";
import { getWaterAgent, isSaltAgent } from "../../src/domain/model/water.ts";
import { slumpBaseWater } from "../../src/domain/water/slump-water.ts";

/** 20 L American IPA at 72 %: three malts, bittering, late and whirlpool hops, dry hop. */
function ipaSpec(overrides: Partial<RecipeDesignSpec> = {}): RecipeDesignSpec {
  return {
    name: "Test IPA",
    style: "American IPA",
    batchSizeL: 20,
    efficiencyPct: 72,
    boilTimeMin: 60,
    targets: { og: 1.06, ibu: 45 },
    fermentables: [
      { name: "Pilsner", type: "grain", sharePct: 85, colorEbc: 3.5, yieldPct: 81 },
      { name: "Munich", type: "grain", sharePct: 10, colorEbc: 20, yieldPct: 78 },
      { name: "Carapils", type: "grain", sharePct: 5, colorEbc: 3, yieldPct: 72 },
    ],
    hops: [
      { name: "Magnum", use: "boil", alphaPct: 12, timeMin: 60, ibuSharePct: 40 },
      { name: "Citra", use: "whirlpool", alphaPct: 13.5, timeMin: 20, temperatureC: 80, ibuSharePct: 35 },
      { name: "Centennial", use: "boil", alphaPct: 9.5, timeMin: 10, ibuSharePct: 25 },
      { name: "Citra", use: "dry_hop", dayOfFermentation: 4, gramsPerL: 5 },
    ],
    cultures: [{ name: "US-05", producer: "Fermentis", form: "dry", amount: 1, unit: "pkg", attenuationPct: 78 }],
    mashSteps: [{ name: "Hovedmesk", temperatureC: 66, durationMin: 60 }],
    fermentationSteps: [{ name: "Primær", temperatureC: 19, durationDays: 10 }],
    ...overrides,
  };
}

describe("designRecipe", () => {
  it("hand-checked: one pale malt for 1.050 in 20 L at 75 % needs 4.32 kg", () => {
    // Same arithmetic as fitGrainBillToOg: 1000 points / (0.80 · 385.67 · 0.75 per kg) = 4.3215 kg.
    const { recipe } = designRecipe(
      ipaSpec({
        efficiencyPct: 75,
        targets: { og: 1.05 },
        fermentables: [{ name: "Pale", type: "grain", sharePct: 100, yieldPct: 80 }],
        hops: [],
      }),
    );
    expect(recipe.fermentables[0]!.amountKg).toBeCloseTo(4.321, 2);
  });

  it("hits OG and IBU, keeps the malt shares and builds a recipe that saves", () => {
    const { recipe, metrics } = designRecipe(ipaSpec());

    expect(Math.abs((metrics.og as number) - 1.06)).toBeLessThanOrEqual(0.001);
    expect(Math.abs((metrics.ibu as number) - 45)).toBeLessThanOrEqual(0.5);
    expect(calculateRecipeMetrics(recipe)).toEqual(metrics);

    const total = recipe.fermentables.reduce((sum, f) => sum + f.amountKg, 0);
    expect(recipe.fermentables.map((f) => Math.round((f.amountKg / total) * 100))).toEqual([85, 10, 5]);
    expect(recipe.fermentables.every((f) => f.amountKg > 0)).toBe(true);

    expect(recipeDocumentSchema.safeParse(recipe).success).toBe(true);
    expect(new Set([...recipe.fermentables, ...recipe.hops, ...recipe.cultures, ...recipe.mashSteps].map((item) => item.id)).size).toBe(
      recipe.fermentables.length + recipe.hops.length + recipe.cultures.length + recipe.mashSteps.length,
    );
    expect(recipe.targets).toEqual({ og: 1.06, ibu: 45 });
  });

  it("gives each bittering addition its share of the IBU", () => {
    const { recipe, metrics } = designRecipe(ipaSpec());
    const { contributions } = calculateIbu({ hops: recipe.hops, volumeL: recipe.batchSizeL, boilGravity: metrics.og as number });
    const byName = Object.fromEntries(recipe.hops.map((h, i) => [`${h.name}-${h.use}`, contributions[i]!.ibu]));
    expect(byName["Magnum-boil"]).toBeCloseTo(0.4 * 45, 0);
    expect(byName["Citra-whirlpool"]).toBeCloseTo(0.35 * 45, 0);
    expect(byName["Centennial-boil"]).toBeCloseTo(0.25 * 45, 0);
    expect(byName["Citra-dry_hop"]).toBe(0);
  });

  it("dry hops are grams per litre times the batch size", () => {
    const { recipe } = designRecipe(ipaSpec());
    expect(recipe.hops.find((h) => h.use === "dry_hop")!.amountG).toBe(100);
    expect(designRecipe(ipaSpec({ batchSizeL: 5 })).recipe.hops.find((h) => h.use === "dry_hop")!.amountG).toBe(25);
    // Under 10 g the weighing step is 0.1 g.
    const tiny = ipaSpec({ batchSizeL: 1, hops: [{ name: "Citra", use: "dry_hop", gramsPerL: 3.14 }], targets: { og: 1.05 } });
    expect(designRecipe(tiny).recipe.hops[0]!.amountG).toBe(3.1);
  });

  it("is deterministic and leaves the spec alone", () => {
    const spec = ipaSpec();
    const snapshot = structuredClone(spec);
    expect(designRecipe(spec)).toEqual(designRecipe(spec));
    expect(spec).toEqual(snapshot);
  });

  it("compares the targets it cannot fit with the result, with the difference worked out", () => {
    const { comparison, metrics } = designRecipe(ipaSpec({ targets: { og: 1.06, ibu: 45, colorEbc: 30, abvPct: 6.2, fg: 1.012 } }));
    const row = (metric: string) => comparison.find((c) => c.metric === metric)!;
    expect(comparison.map((c) => c.metric)).toEqual(["og", "fg", "abvPct", "ibu", "colorEbc"]);
    expect(row("og").withinTolerance).toBe(true);
    expect(row("ibu").withinTolerance).toBe(true);
    // A pale IPA malt bill is nowhere near 30 EBC.
    expect(row("colorEbc").calculated).toBeCloseTo(metrics.colorEbc as number, 1);
    expect(row("colorEbc").difference).toBeLessThan(-10);
    expect(row("colorEbc").withinTolerance).toBe(false);
    // 78 % attenuation of 1.060 is FG ≈ 1.0132, ABV ≈ 6.2 %.
    expect(row("fg").calculated).toBeCloseTo(1.0132, 3);
    expect(row("abvPct").difference).toBeCloseTo((metrics.abvPct as number) - 6.2, 1);
  });

  it("says when FG and ABV rest on the default attenuation", () => {
    expect(designRecipe(ipaSpec()).notes).toEqual([]);
    const { notes } = designRecipe(ipaSpec({ cultures: [{ name: "Ukjent", form: "dry", amount: 1, unit: "pkg" }] }));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("75 %");
  });

  it("carries the planned water through", () => {
    const { recipe } = designRecipe(ipaSpec({ water: { profileName: "Kloridfremhevet", target: { ca: 100, cl: 120 } } }));
    expect(recipe.water).toEqual({ profileName: "Kloridfremhevet", target: { ca: 100, cl: 120 } });
  });

  describe("rejects a spec that does not add up", () => {
    it("fermentable shares that are not 100 %", () => {
      const spec = ipaSpec({ fermentables: [{ name: "Pilsner", type: "grain", sharePct: 80 }, { name: "Munich", type: "grain", sharePct: 10 }] });
      expect(() => designRecipe(spec)).toThrow(/fermentable shares must add up to 100 %.*90 %/);
    });

    it("IBU shares that are not 100 %", () => {
      const spec = ipaSpec();
      spec.hops[0]!.ibuSharePct = 10;
      expect(() => designRecipe(spec)).toThrow(/ibuSharePct values must add up to 100/);
    });

    it("an IBU target with nothing that bitters", () => {
      expect(() => designRecipe(ipaSpec({ hops: [{ name: "Citra", use: "dry_hop", gramsPerL: 4 }] }))).toThrow(/targets\.ibu has no hop addition/);
    });

    it("hops that bitter without the numbers the calculation needs", () => {
      const noAlpha = ipaSpec();
      delete noAlpha.hops[0]!.alphaPct;
      expect(() => designRecipe(noAlpha)).toThrow(/Magnum: a boil addition needs alphaPct/);
      const noShare = ipaSpec();
      delete noShare.hops[1]!.ibuSharePct;
      expect(() => designRecipe(noShare)).toThrow(/Citra: a whirlpool addition needs ibuSharePct/);
      const noTime = ipaSpec();
      delete noTime.hops[2]!.timeMin;
      expect(() => designRecipe(noTime)).toThrow(/Centennial: a boil addition needs timeMin/);
    });

    it("amounts the model must not choose", () => {
      const grams = ipaSpec();
      grams.hops[0]!.gramsPerL = 1;
      expect(() => designRecipe(grams)).toThrow(/gramsPerL only applies to mash and dry hop/);
      const dry = ipaSpec();
      dry.hops[3]!.ibuSharePct = 10;
      expect(() => designRecipe(dry)).toThrow(/ibuSharePct only applies to boil/);
      const noDosage = ipaSpec();
      delete noDosage.hops[3]!.gramsPerL;
      expect(() => designRecipe(noDosage)).toThrow(/Citra: a dry_hop addition needs gramsPerL/);
    });

    it("a boil addition that gives no bitterness", () => {
      const spec = ipaSpec();
      spec.hops[2]!.timeMin = 0;
      expect(() => designRecipe(spec)).toThrow(/Centennial .* gives no bitterness/);
    });

    it("no fermentables or an impossible gravity", () => {
      expect(() => designRecipe(ipaSpec({ fermentables: [] }))).toThrow(/At least one fermentable/);
      expect(() => designRecipe(ipaSpec({ targets: { og: 1, ibu: 45 } }))).toThrow(/above 1/);
    });
  });
});

describe("applyWaterPlan", () => {
  it("hand-checked: gypsum for a calcium and sulfate target in distilled water", () => {
    // Gypsum is 23.3 % Ca and 55.8 % SO₄ by mass (Ca 50 : SO₄ 120 is almost exactly its ratio):
    // 50 mg/L Ca needs 0.2147 g/L, so 20 L takes 4.3 g, which gives SO₄ 119.8 mg/L.
    const zero = { ca: 0, mg: 0, na: 0, cl: 0, so4: 0, hco3: 0 };
    const base = emptyRecipe({ name: "Vann", water: { target: { ca: 50, so4: 120 } } });
    const { recipe, salts, solution } = applyWaterPlan(base, { source: zero, totalWaterL: 20 });

    expect(salts).toHaveLength(1);
    expect(salts[0]!.id).toBe("gypsum");
    expect(salts[0]!.grams).toBeCloseTo(4.3, 1);
    expect(solution.result.so4).toBeCloseTo(119.8, 0);
    expect(recipe.miscs).toEqual([{ id: "salt-gypsum", name: "Gips", amount: salts[0]!.grams, unit: "g", use: "mash", waterAgent: "gypsum" }]);
  });

  it("agrees with addSaltsToWater and replaces earlier salt rows but not other tilsetninger", () => {
    const base = emptyRecipe({
      name: "Vann",
      water: { target: { ca: 100, cl: 80, so4: 120 } },
      miscs: [
        { id: "m-1", name: "Whirlfloc", amount: 1, unit: "stk", use: "boil", timeMin: 10 },
        { id: "old", name: "Gips", amount: 99, unit: "g", use: "mash", waterAgent: "gypsum" },
      ],
    });
    const { recipe, solution, salts } = applyWaterPlan(base, { source: slumpBaseWater.ions, totalWaterL: 30 });

    expect(recipe.miscs.map((m) => m.name)).toContain("Whirlfloc");
    expect(recipe.miscs.filter((m) => m.waterAgent === "gypsum")).toHaveLength(1);
    expect(recipe.miscs.find((m) => m.waterAgent === "gypsum")!.amount).not.toBe(99);
    expect(salts.every((s) => standardSaltIds.includes(s.id))).toBe(true);

    const resulting = addSaltsToWater(
      slumpBaseWater.ions,
      salts.flatMap((s) => {
        const agent = getWaterAgent(s.id);
        return isSaltAgent(agent) ? [{ composition: agent.composition, grams: s.grams }] : [];
      }),
      30,
    );
    // The grams are rounded to 0.1 g after the solver, so the two agree to a rounding error.
    for (const ion of ["ca", "cl", "so4"] as const) expect(resulting[ion]).toBeCloseTo(solution.result[ion], 0);
    expect(Math.abs(solution.deviation.ca!)).toBeLessThan(5);
  });

  it("adds nothing when no target is set", () => {
    const { recipe, salts } = applyWaterPlan(emptyRecipe({ name: "Vann" }), { source: slumpBaseWater.ions, totalWaterL: 30 });
    expect(salts).toEqual([]);
    expect(recipe.miscs).toEqual([]);
  });
});
