import { describe, expect, it } from "vitest";
import { calculateRecipeMetrics } from "../../src/domain/brewing-calculations/index.ts";
import { convertDiyDogBeer, diyDogSearchText } from "../../src/domain/import/diy-dog.ts";
import { inferLibraryCategory } from "../../src/domain/model/library.ts";
import { recipeDocumentSchema } from "../../src/domain/model/recipe.ts";
import { messy, punkIpa } from "../fixtures/diy-dog-samples.ts";
import { expectWithin } from "../helpers.ts";

describe("DIY Dog import adapter", () => {
  it("converts Punk IPA into a valid normalized recipe", () => {
    const { recipe, category } = convertDiyDogBeer(punkIpa);
    expect(recipeDocumentSchema.safeParse(recipe).success).toBe(true);
    expect(category).toBe("ipa");
    expect(recipe).toMatchObject({ batchSizeL: 20, boilTimeMin: 60, author: "BrewDog (DIY Dog)", style: "IPA" });
    expect(recipe.targets).toEqual({ og: 1.056, fg: 1.01, ibu: 60, abvPct: 6, colorEbc: 17 });
    expect(recipe.mashSteps).toEqual([{ id: "ms1", name: "Mesk", temperatureC: 65, durationMin: 75 }]);
    expect(recipe.fermentationSteps[0]?.temperatureC).toBe(19);
    expect(recipe.cultures[0]).toMatchObject({ form: "liquid", attenuationPct: 82.1 });
  });

  it("maps start / middle / end to boil times", () => {
    const { recipe } = convertDiyDogBeer(punkIpa);
    expect(recipe.hops.map((h) => [h.name, h.use, h.timeMin])).toEqual([
      ["Ahtanum", "boil", 60],
      ["Chinook", "boil", 60],
      ["Crystal", "boil", 30],
      ["Chinook", "boil", 30],
      ["Ahtanum", "boil", 0],
      ["Chinook", "boil", 0],
      ["Crystal", "boil", 0],
      ["Motueka", "boil", 0],
    ]);
  });

  it("back-calculates efficiency so the estimated OG matches the recipe", () => {
    const { recipe } = convertDiyDogBeer(punkIpa);
    expectWithin(calculateRecipeMetrics(recipe).og, 1.056, 0.001);
    // …and the attenuation carries over to FG.
    expectWithin(calculateRecipeMetrics(recipe).fg, 1.01, 0.001);
  });

  it("handles the messy cases in the dataset and says what it guessed", () => {
    const { recipe, warnings, category } = convertDiyDogBeer(messy);
    expect(recipeDocumentSchema.safeParse(recipe).success).toBe(true);
    expect(category).toBe("stout");
    expect(recipe.boilTimeMin).toBe(90);

    const hop = (name: string) => recipe.hops.find((h) => h.name === name);
    expect(hop("Columbus")).toMatchObject({ use: "boil", timeMin: 90, alphaPct: 14 });
    expect(hop("Mandarina Bavaria")).toMatchObject({ use: "first_wort", timeMin: 90 });
    expect(hop("Citra")).toMatchObject({ use: "whirlpool" });
    expect(hop("Simcoe")).toMatchObject({ use: "dry_hop", dayOfFermentation: 6 });
    expect(hop("Mosaic")).toMatchObject({ use: "dry_hop", notes: "Tørrhumling 2" });
    expect(hop("Cascade")).toMatchObject({ use: "boil", timeMin: 0 });
    expect(warnings.some((w) => w.includes("Hopback"))).toBe(true);

    // Non-hops listed among the hops become misc additions.
    expect(recipe.miscs.map((m) => [m.name, m.use, m.unit])).toEqual([
      ["Sweet Orange Peel", "boil", "g"],
      ["Cold Brew Coffee", "fermentation", "ml"],
      ["American Oak Chips", "fermentation", "g"],
    ]);
    expect(recipe.fermentables.find((f) => f.name === "Honey")?.type).toBe("sugar");

    // Missing/implausible source values are dropped with a note, never passed through.
    expect(recipe.mashSteps.map((s) => [s.temperatureC, s.durationMin])).toEqual([
      [65, 30],
      [72, 60],
    ]);
    expect(recipe.fermentationSteps).toEqual([]);
    expect(recipe.cultures).toEqual([]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("99 °C"),
        expect.stringContaining("Kilden oppgir ikke gjær"),
        expect.stringContaining("Meskesteg 2 har ingen gyldig temperatur"),
      ]),
    );
    expect(recipe.targets.ibu).toBe(1157);
    expect(recipe.notes).toContain("Twist: Oak chips");
  });

  it("flags source data that contradicts itself", () => {
    const { warnings } = convertDiyDogBeer({ ...punkIpa, target_og: 1008, target_fg: 1002 });
    expect(warnings.some((w) => w.includes("oppgitt ABV er 6 %"))).toBe(true);
    expect(warnings.some((w) => w.includes("effektivitet"))).toBe(true);
    const shipwreck = convertDiyDogBeer({
      ...punkIpa,
      ingredients: { ...punkIpa.ingredients, malt: [{ name: "Pale", amount: { value: 902.3, unit: "kilograms" } }] },
    });
    expect(shipwreck.warnings.some((w) => w.includes("urealistisk"))).toBe(true);
  });

  it("builds search text from names and every ingredient", () => {
    const text = diyDogSearchText(punkIpa, "IPA");
    expect(text).toContain("motueka");
    expect(text).toContain("extra pale");
    expect(text).toContain("wyeast 1056");
  });
});

describe("library categories", () => {
  it("prefers the name and tagline over the description", () => {
    expect(inferLibraryCategory("Dead Pony Club", "Session Pale Ale.")).toBe("pale");
    expect(inferLibraryCategory("Jet Black Heart", "Nitro Stout.", "Unlike our IPAs…")).toBe("stout");
    expect(inferLibraryCategory("Kingpin", "Lager With A Twist.")).toBe("lager");
    expect(inferLibraryCategory("Something", "", "A bold India Pale Ale")).toBe("ipa");
    expect(inferLibraryCategory("Mystery", "Hmm.")).toBe("other");
  });
});
