import { describe, expect, it } from "vitest";
import {
  calculateIbu,
  calculateRecipeMetrics,
  diffRecipes,
  fitGrainBillToOg,
  fitHopsToIbu,
} from "../../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { emptyRecipe, type RecipeDocument } from "../../src/domain/model/recipe.ts";

/** 20 L at 75 % efficiency: pale malt (80 % yield), a little crystal and a sugar addition. */
function simpleRecipe(): RecipeDocument {
  return emptyRecipe({
    name: "Test",
    batchSizeL: 20,
    efficiencyPct: 75,
    fermentables: [
      { id: "f-pale", name: "Pale", type: "grain", amountKg: 4, yieldPct: 80 },
      { id: "f-cara", name: "Cara", type: "grain", amountKg: 1, yieldPct: 75 },
      { id: "f-sugar", name: "Sukker", type: "sugar", amountKg: 0.3, yieldPct: 100 },
    ],
    hops: [
      { id: "h-boil", name: "Magnum", amountG: 20, alphaPct: 12, use: "boil", timeMin: 60 },
      { id: "h-wp", name: "Citra", amountG: 40, alphaPct: 13, use: "whirlpool", timeMin: 20, temperatureC: 80 },
      { id: "h-dry", name: "Citra", amountG: 60, use: "dry_hop", dayOfFermentation: 4 },
    ],
    targets: { og: 1.05, ibu: 30 },
  });
}

describe("fitGrainBillToOg", () => {
  it("hand-checked: 20 L at 75 % with one 80 % pale malt needs 1.050 → 4.32 kg", () => {
    // Points needed: 50 · 20 L = 1000. Per kg: 0.80 · 385.67 · 0.75 = 231.4 → 1000 / 231.4 = 4.3215 kg.
    const base = emptyRecipe({
      batchSizeL: 20,
      efficiencyPct: 75,
      fermentables: [{ id: "f", name: "Pale", type: "grain", amountKg: 1, yieldPct: 80 }],
    });
    const { recipe, og } = fitGrainBillToOg(base, 1.05);
    expect(recipe.fermentables[0]!.amountKg).toBeCloseTo(4.321, 2);
    expect(og).toBeCloseTo(1.05, 3);
  });

  it("hits the target OG, keeps percentages, fixed sugar, ids and the original", () => {
    const original = simpleRecipe();
    const snapshot = structuredClone(original);
    const { recipe, factor, og } = fitGrainBillToOg(original, 1.065, { fixedIds: ["f-sugar"] });

    expect(Math.abs(og - 1.065)).toBeLessThan(0.0005);
    expect(calculateRecipeMetrics(recipe).og).toBe(og);
    expect(factor).toBeGreaterThan(1);
    expect(recipe.fermentables.map((f) => f.id)).toEqual(["f-pale", "f-cara", "f-sugar"]);
    expect(recipe.fermentables[2]!.amountKg).toBe(0.3);
    const [pale, cara] = recipe.fermentables;
    expect((pale!.amountKg / (pale!.amountKg + cara!.amountKg)) * 100).toBeCloseTo(80, 1);
    expect(recipe.targets).toEqual(original.targets);
    expect(original).toEqual(snapshot);
  });

  it("fits Sunset IPA to a new OG", () => {
    const { recipe, og, factor } = fitGrainBillToOg(sunsetIpaRecipe, 1.07);
    expect(Math.abs(og - 1.07)).toBeLessThan(0.0005);
    expect(factor).toBeGreaterThan(1);
    const before = calculateRecipeMetrics(sunsetIpaRecipe).grainBillPct;
    calculateRecipeMetrics(recipe).grainBillPct.forEach((pct, i) => expect(pct).toBeCloseTo(before[i]!, 1));
  });

  it("throws RangeError for impossible fits", () => {
    expect(() => fitGrainBillToOg(emptyRecipe(), 1.05)).toThrow(RangeError);
    expect(() => fitGrainBillToOg(simpleRecipe(), 1)).toThrow(RangeError);
    expect(() => fitGrainBillToOg(simpleRecipe(), 0.99)).toThrow(RangeError);
    // 0.3 kg sugar in 20 L is ≈ 1.006; a target below that cannot be reached with fixed sugar.
    expect(() => fitGrainBillToOg(simpleRecipe(), 1.004, { fixedIds: ["f-sugar"] })).toThrow(RangeError);
    expect(() => fitGrainBillToOg(simpleRecipe(), 1.05, { fixedIds: ["f-pale", "f-cara", "f-sugar"] })).toThrow(RangeError);
  });
});

describe("fitHopsToIbu", () => {
  it("scales boil and whirlpool, leaves dry hop alone, agrees with calculateRecipeMetrics", () => {
    const original = simpleRecipe();
    const snapshot = structuredClone(original);
    const { recipe, ibu, factor } = fitHopsToIbu(original, 45);

    expect(Math.abs(ibu - 45)).toBeLessThan(0.5);
    expect(calculateRecipeMetrics(recipe).ibu).toBe(ibu);
    expect(factor).toBeGreaterThan(1);
    expect(recipe.hops.find((h) => h.id === "h-dry")).toEqual(original.hops[2]);
    expect(recipe.hops[0]!.amountG / 20).toBeCloseTo(factor, 1);
    expect(recipe.hops[1]!.amountG / 40).toBeCloseTo(factor, 1);
    expect(recipe.hops.map((h) => h.id)).toEqual(["h-boil", "h-wp", "h-dry"]);
    expect(original).toEqual(snapshot);
  });

  it("adjustIds restricts which additions change; the others contribute fixed IBU", () => {
    const original = simpleRecipe();
    const og = calculateRecipeMetrics(original).og!;
    const contributions = calculateIbu({ hops: original.hops, volumeL: 20, boilGravity: og }).contributions;
    const wpIbu = contributions.find((c) => c.id === "h-wp")!.ibu;
    const boilIbu = contributions.find((c) => c.id === "h-boil")!.ibu;

    const { recipe, ibu } = fitHopsToIbu(original, wpIbu + boilIbu * 2, { adjustIds: ["h-boil"] });
    expect(recipe.hops[1]).toEqual(original.hops[1]);
    expect(recipe.hops[0]!.amountG).toBeCloseTo(40, 0);
    expect(Math.abs(ibu - (wpIbu + boilIbu * 2))).toBeLessThan(0.5);
  });

  it("fits Sunset IPA (boil + whirlpool + dry hop) to a new IBU", () => {
    const { recipe, ibu } = fitHopsToIbu(sunsetIpaRecipe, 50);
    expect(Math.abs(ibu - 50)).toBeLessThan(0.5);
    sunsetIpaRecipe.hops.filter((h) => h.use === "dry_hop").forEach((h) => expect(recipe.hops.find((r) => r.id === h.id)).toEqual(h));
  });

  it("throws RangeError for impossible fits", () => {
    const original = simpleRecipe();
    expect(() => fitHopsToIbu(original, 0)).toThrow(RangeError);
    expect(() => fitHopsToIbu(original, -5)).toThrow(RangeError);
    expect(() => fitHopsToIbu({ ...original, fermentables: [] }, 30)).toThrow(RangeError);
    expect(() => fitHopsToIbu({ ...original, hops: [original.hops[2]!] }, 30)).toThrow(RangeError);
    expect(() => fitHopsToIbu(original, 30, { adjustIds: ["h-dry"] })).toThrow(RangeError);
    const noAlpha = { ...original, hops: [{ ...original.hops[0]!, alphaPct: undefined }, original.hops[1]!] };
    expect(() => fitHopsToIbu(noAlpha, 30, { adjustIds: ["h-boil"] })).toThrow(RangeError);
    // The whirlpool alone already gives more than 1 IBU.
    expect(() => fitHopsToIbu(original, 1, { adjustIds: ["h-boil"] })).toThrow(RangeError);
  });
});

describe("diffRecipes", () => {
  it("is empty for identical recipes", () => {
    const diff = diffRecipes(simpleRecipe(), simpleRecipe());
    expect(diff.isEmpty).toBe(true);
    expect(diff.metrics.og.before).toBe(diff.metrics.og.after);
  });

  it("lists a fit result's changed fermentables and metric before/after", () => {
    const original = simpleRecipe();
    const { recipe } = fitGrainBillToOg(original, 1.065, { fixedIds: ["f-sugar"] });
    const diff = diffRecipes(original, recipe);
    expect(diff.isEmpty).toBe(false);
    expect(diff.fermentables.map((c) => [c.kind, c.name])).toEqual([
      ["changed", "Pale"],
      ["changed", "Cara"],
    ]);
    expect(diff.fermentables[0]).toMatchObject({ before: { amountKg: 4 }, after: { amountKg: recipe.fermentables[0]!.amountKg } });
    expect(diff.metrics.og.before).toBeCloseTo(calculateRecipeMetrics(original).og!, 6);
    expect(diff.metrics.og.after).toBeCloseTo(1.065, 3);
    expect(diff.hops).toEqual([]);
    expect(diff.basics).toEqual([]);
  });

  it("reports added and removed hops and use/time changes", () => {
    const before = simpleRecipe();
    const after: RecipeDocument = {
      ...before,
      hops: [
        { ...before.hops[0]!, timeMin: 30 },
        before.hops[2]!,
        { id: "h-new", name: "Mosaic", amountG: 30, alphaPct: 12, use: "whirlpool", timeMin: 15 },
      ],
    };
    const diff = diffRecipes(before, after);
    expect(diff.hops).toEqual([
      { kind: "changed", name: "Magnum", before: { amountG: 20, use: "boil", timeMin: 60 }, after: { amountG: 20, use: "boil", timeMin: 30 } },
      { kind: "removed", name: "Citra", before: { amountG: 40, use: "whirlpool", timeMin: 20 } },
      { kind: "added", name: "Mosaic", after: { amountG: 30, use: "whirlpool", timeMin: 15 } },
    ]);
  });

  it("matches by normalized name when ids differ, and hops also by use", () => {
    const before = simpleRecipe();
    const after: RecipeDocument = {
      ...before,
      fermentables: before.fermentables.map((f, i) => ({ ...f, id: `new-${i}`, name: ` ${f.name.toUpperCase()}  `, amountKg: f.name === "Pale" ? 4.5 : f.amountKg })),
      hops: before.hops.map((h) => ({ ...h, id: `n-${h.id}`, name: h.name.toLowerCase() })),
    };
    const diff = diffRecipes(before, after);
    expect(diff.fermentables).toHaveLength(1);
    expect(diff.fermentables[0]).toMatchObject({ kind: "changed", before: { amountKg: 4 }, after: { amountKg: 4.5 } });
    expect(diff.hops).toEqual([]);

    const swapped: RecipeDocument = { ...after, hops: after.hops.map((h) => (h.use === "dry_hop" ? { ...h, use: "whirlpool" as const } : h)) };
    const hopDiff = diffRecipes(before, swapped).hops;
    expect(hopDiff.map((c) => c.kind).sort()).toEqual(["added", "removed"].sort());
  });

  it("reports basics, cultures, miscs and water target changes", () => {
    const before = emptyRecipe({
      name: "A",
      cultures: [{ id: "c", name: "US-05", form: "dry", amount: 1, unit: "pkg" }],
      miscs: [{ id: "m", name: "Gips", amount: 3, unit: "g", use: "mash" }],
      water: { target: { ca: 50, cl: 60 } },
    });
    const after = emptyRecipe({
      name: "B",
      batchSizeL: 25,
      cultures: [{ id: "c", name: "US-05", form: "dry", amount: 2, unit: "pkg" }],
      miscs: [],
      water: { target: { ca: 50, cl: 80, so4: 100 } },
    });
    const diff = diffRecipes(before, after);
    expect(diff.basics).toEqual([
      { field: "name", before: "A", after: "B" },
      { field: "batchSizeL", before: 20, after: 25 },
    ]);
    expect(diff.cultures).toEqual([
      { kind: "changed", name: "US-05", before: { amount: 1, unit: "pkg" }, after: { amount: 2, unit: "pkg" } },
    ]);
    expect(diff.miscs).toEqual([{ kind: "removed", name: "Gips", before: { amount: 3, unit: "g" } }]);
    expect(diff.water).toEqual([
      { ion: "cl", before: 60, after: 80 },
      { ion: "so4", before: undefined, after: 100 },
    ]);
  });
});
