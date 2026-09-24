import { describe, expect, it } from "vitest";
import { calculateRecipeMetrics } from "../../src/domain/brewing-calculations/index.ts";
import { BsmxImportError, parseBsmx, type BsmxRecipeImport } from "../../src/domain/import/bsmx.ts";
import { parseXml, XmlParseError } from "../../src/domain/import/xml.ts";
import { recipeDocumentSchema } from "../../src/domain/model/recipe.ts";
import { bsmxFixtures } from "../fixtures/beersmith/index.ts";
import { expectWithin } from "../helpers.ts";

const files = Object.keys(bsmxFixtures).sort();
const load = (file: string): BsmxRecipeImport => {
  const recipes = parseBsmx(bsmxFixtures[file]!);
  expect(recipes).toHaveLength(1);
  return recipes[0]!;
};

describe("BSMX import adapter", () => {
  it("covers all seven BeerSmith fixture files", () => {
    expect(files).toEqual([
      "Aasen_Klch.bsmx",
      "Aasen_Klch_60l.bsmx",
      "Bitter_90l.bsmx",
      "Cascade_Pale_Ale__Kveik.bsmx",
      "IRA.bsmx",
      "KES_Belgian_Double.bsmx",
      "Love_in_a_canoe.bsmx",
    ]);
  });

  it.each(files)("converts %s into a valid recipe the calculation engine accepts", (file) => {
    const { recipe } = load(file);
    const parsed = recipeDocumentSchema.safeParse(recipe);
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(recipe.fermentables.length).toBeGreaterThan(0);
    expect(recipe.hops.length).toBeGreaterThan(0);
    expect(recipe.cultures).toHaveLength(1);
    expect(recipe.mashSteps.length).toBeGreaterThan(0);
    const metrics = calculateRecipeMetrics(recipe);
    expect(metrics.og).toBeGreaterThan(1.02);
    expect(metrics.og).toBeLessThan(1.1);
  });

  it("keeps the BeerSmith equipment as a source snapshot matching the «1My Equipment - 100l» profile", () => {
    const { equipment, recipe } = load("Bitter_90l.bsmx");
    expect(equipment?.name).toBe("1My Equipment - 100l");
    const stated = equipment!.stated;
    expect(stated.efficiencyPct).toBe(80);
    expectWithin(stated.batchVolumeL, 90, 0.01);
    expectWithin(stated.fermenterLossL, 5, 0.01);
    expectWithin(stated.mashTunVolumeL, 75, 0.01);
    expectWithin(stated.mashTunMassKg, 10, 0.01);
    expect(stated.mashTunSpecificHeat).toBe(0.15);
    expectWithin(stated.mashTunDeadspaceL, 3.79, 0.01);
    expect(stated.boilTimeMin).toBe(60);
    expectWithin(stated.boilOffLPerHour, 5, 0.01);
    expect(stated.coolingShrinkagePct).toBe(4);
    expectWithin(stated.trubLossL, 3.79, 0.01);
    expect(stated.hopUtilizationPct).toBe(100);
    expectWithin(equipment!.derived.preBoilVolumeL, 102.54, 0.01);
    expectWithin(equipment!.derived.bottlingVolumeL, 85, 0.01);

    expectWithin(recipe.batchSizeL, 90, 0.01);
    expect(recipe).toMatchObject({ boilTimeMin: 60, efficiencyPct: 80 });
  });

  it("preserves different equipment names across files", () => {
    expect(files.map((file) => load(file).equipment?.name)).toEqual([
      "My 90l eqpm-modified",
      expect.any(String),
      "1My Equipment - 100l",
      "1My Equipment - 100l",
      "1My 30+20gal equipment",
      "All Grain - Large 10 Gal/38 l - Cooler",
      "1My Equipment - 100l",
    ]);
  });

  it("converts US units, SRM and entities in Aasen Kölsch", () => {
    const { recipe, waterPlan, sourceDate } = load("Aasen_Klch.bsmx");
    expect(recipe.name).toBe("Aasen Kölch"); // spelled so in BeerSmith; kept as written
    expect(recipe.style).toBe("Kölsch");
    expect(recipe.author).toBe("Steen");
    expect(sourceDate).toBe("2015-10-07");
    expect(recipe.boilTimeMin).toBe(90);

    const [pilsner, wheat] = recipe.fermentables;
    expect(pilsner).toMatchObject({ name: "Pilsner (2 Row) Ger", type: "grain", producer: "Germany", yieldPct: 81 });
    expectWithin(pilsner!.amountKg, 15.0, 0.001);
    expectWithin(pilsner!.colorEbc, 3.5, 0.05);
    expectWithin(wheat!.amountKg, 1.5, 0.001);

    expect(recipe.hops.map((hop) => [hop.name, hop.use, hop.timeMin, hop.form])).toEqual([
      ["Hallertauer Mittelfrueh", "boil", 60, "pellet"],
      ["Hallertauer Mittelfrueh", "boil", 15, "pellet"],
    ]);
    expectWithin(recipe.hops[0]!.amountG, 150, 0.1);
    expectWithin(recipe.hops[1]!.amountG, 100, 0.1);
    expectWithin(recipe.targets.ibu, 27.2, 0.05);

    expect(recipe.cultures[0]).toMatchObject({
      name: "German Ale/Kolsch (WLP029)",
      producer: "White Labs",
      form: "liquid",
      amount: 1,
      unit: "pkg",
      attenuationPct: 75,
    });

    expect(recipe.mashSteps).toHaveLength(1);
    expect(recipe.mashSteps[0]).toMatchObject({ name: "Mash In", temperatureC: 64.4, durationMin: 75, infusionTemperatureC: 73.1 });
    expectWithin(recipe.mashSteps[0]!.infusionL, 43.03, 0.01);
    expect(waterPlan).toEqual({ mashWaterL: 43.03, strikeTemperatureC: 73.1, grainTemperatureC: 10, spargeTemperatureC: 75 });
    expect(recipe.spargeTemperatureC).toBe(75);

    // F_A_TYPE 0: single stage, plus 30 days of conditioning.
    expect(recipe.fermentationSteps).toEqual([
      { id: "fs1", name: "Primærgjæring", temperatureC: 19.4, durationDays: 14 },
      { id: "fs2", name: "Modning", temperatureC: 18.3, durationDays: 30 },
    ]);
    expect(recipe.carbonationVols).toBe(2.3);
  });

  it("maps a three-stage fermentation with temperature ramps", () => {
    const { recipe } = load("Bitter_90l.bsmx");
    expect(recipe.fermentationSteps).toEqual([
      { id: "fs1", name: "Primærgjæring", temperatureC: 18.3, temperatureMaxC: 21.1, durationDays: 4 },
      { id: "fs2", name: "Sekundærgjæring", temperatureC: 22.2, durationDays: 3 },
      { id: "fs3", name: "Tertiærgjæring", temperatureC: 20, durationDays: 10 },
      { id: "fs4", name: "Modning", temperatureC: 2.2, durationDays: 14 },
    ]);
  });

  it("maps sugars, flame-out hops, dry lager yeast and misc units", () => {
    const kes = load("KES_Belgian_Double.bsmx").recipe;
    expect(kes.fermentables.find((f) => f.name === "Candi Sugar, Dark")).toMatchObject({ type: "sugar" });
    expect(kes.miscs).toEqual([
      { id: "m1", name: "Whirlfloc Tablet", amount: 0.558, unit: "stk", use: "boil", timeMin: 15, notes: "Clarity" },
      { id: "m2", name: "Yeast Nutrient", amount: 0.558, unit: "ts", use: "fermentation", notes: "Fermentation · 3 dager" },
    ]);

    const love = load("Love_in_a_canoe.bsmx").recipe;
    expect(love.hops.map((hop) => hop.timeMin)).toEqual([90, 10, 0]);
    expect(love.cultures[0]).toMatchObject({ name: "Diamond Lager", form: "dry", producer: "Lallemand" });
    expect(love.fermentables.map((f) => f.type)).toEqual(["grain", "grain"]);
  });

  describe("hard import rule: BeerSmith measurements are never imported", () => {
    it("ignores OG_MEASURED in KES Belgian Double even though _SET = 1", () => {
      const result = load("KES_Belgian_Double.bsmx");
      expect(result.ignoredMeasuredFields).toEqual(["F_R_OG_MEASURED"]);
      expect(result.recipe.targets).toEqual({ ibu: expect.any(Number) });
      expect(result.warnings.some((warning) => warning.includes("målte verdier"))).toBe(true);
    });

    it("ignores VOLUME_MEASURED in Love in a canoe even though _SET = 1", () => {
      const result = load("Love_in_a_canoe.bsmx");
      expect(result.ignoredMeasuredFields).toEqual(["F_R_VOLUME_MEASURED"]);
      // 2366.98 fl oz measured volume = 70 L; the plan keeps the equipment's 100 L batch.
      expectWithin(result.recipe.batchSizeL, 100, 0.01);
      expect(result.recipe.targets).toEqual({ ibu: expect.any(Number) });
    });

    it("returns only plan data: no observations, measurements or batch results", () => {
      for (const file of files) {
        const result = load(file);
        expect(Object.keys(result).sort()).toEqual(
          ["equipment", "ignoredMeasuredFields", "recipe", "sourceDate", "warnings", "waterPlan"].sort(),
        );
        expect(result.recipe.targets.og).toBeUndefined();
        expect(result.recipe.targets.fg).toBeUndefined();
        expect(result.recipe.targets.mashPhMin).toBeUndefined();
      }
    });
  });

  it("warns instead of guessing for dry hops without a fermentation day", () => {
    const xml = bsmxFixtures["IRA.bsmx"]!.replace("<F_H_USE>0</F_H_USE>", "<F_H_USE>1</F_H_USE>");
    const { recipe, warnings } = parseBsmx(xml)[0]!;
    expect(recipe.hops[0]).toMatchObject({ use: "dry_hop", notes: "3 dager kontakttid (BeerSmith)" });
    expect(recipe.hops[0]!.dayOfFermentation).toBeUndefined();
    expect(warnings.some((warning) => warning.includes("Tørrhumling"))).toBe(true);
  });

  it("falls back with warnings when equipment and mash are missing", () => {
    const { recipe, equipment, warnings } = parseBsmx(
      "<Recipes><Data><Recipe><F_R_NAME>Minimal</F_R_NAME><Ingredients><Data>" +
        "<Grain><F_G_NAME>Pale</F_G_NAME><F_G_AMOUNT>160</F_G_AMOUNT><F_G_TYPE>0</F_G_TYPE></Grain>" +
        "<Grain><F_G_NAME>Leftover</F_G_NAME><F_G_AMOUNT>16</F_G_AMOUNT><F_G_IN_RECIPE>0</F_G_IN_RECIPE></Grain>" +
        "<Hops><F_H_NAME>Mystery</F_H_NAME><F_H_AMOUNT>1</F_H_AMOUNT><F_H_USE>9</F_H_USE></Hops>" +
        "</Data></Ingredients></Recipe></Data></Recipes>",
    )[0]!;
    expect(recipeDocumentSchema.safeParse(recipe).success).toBe(true);
    expect(equipment).toBeNull();
    expect(recipe).toMatchObject({ batchSizeL: 20, boilTimeMin: 60, efficiencyPct: 72 });
    expect(recipe.fermentables.map((f) => f.name)).toEqual(["Pale"]);
    expect(warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("utstyrsprofil"),
        expect.stringContaining("Ukjent bruk (9)"),
        expect.stringContaining("meskeprofil"),
      ]),
    );
  });

  it("rejects files without a recipe and invalid XML with a readable error", () => {
    expect(() => parseBsmx("<Recipes><Name>Tom</Name></Recipes>")).toThrow(BsmxImportError);
    expect(() => parseBsmx("<Recipes><Recipe>")).toThrow(/ikke avsluttet/);
    expect(() => parseBsmx("ikke xml")).toThrow(BsmxImportError);
  });
});

describe("safe XML reader", () => {
  it("rejects DOCTYPE and entity declarations (billion laughs, XXE)", () => {
    const laughs = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><r>&lol2;</r>';
    expect(() => parseXml(laughs)).toThrow(XmlParseError);
    const xxe = '<!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><r>&x;</r>';
    expect(() => parseXml(xxe)).toThrow(/DOCTYPE/);
    expect(() => parseBsmx(xxe)).toThrow(BsmxImportError);
  });

  it("enforces size, depth and element limits", () => {
    expect(() => parseXml("<r>" + "x".repeat(100) + "</r>", { maxChars: 50 })).toThrow(/for stor/);
    expect(() => parseXml("<a>".repeat(40) + "</a>".repeat(40))).toThrow(/dypt/);
    expect(() => parseXml("<r>" + "<i/>".repeat(20) + "</r>", { maxElements: 10 })).toThrow(/mange elementer/);
  });

  it("rejects malformed structure", () => {
    expect(() => parseXml("<a><b></a></b>")).toThrow(/passer ikke/);
    expect(() => parseXml("<a></a><b></b>")).toThrow(/ett rotelement/);
    expect(() => parseXml("tekst<a></a>")).toThrow(/utenfor/);
    expect(() => parseXml("<a>")).toThrow(/ikke avsluttet/);
    expect(() => parseXml("")).toThrow(/ingen XML/);
  });

  it("reads declarations, comments, CDATA, attributes and entities", () => {
    const root = parseXml(
      '﻿<?xml version="1.0" encoding="UTF-8"?><!-- c --><RECIPE a="1>2" b=\'x\'><NAME>K&#246;lsch &amp; &#x2615; &nbsp;</NAME><NOTES><![CDATA[<b>fet</b>]]></NOTES><E/></RECIPE>',
    );
    expect(root.name).toBe("RECIPE");
    expect(root.children.map((child) => [child.name, child.text])).toEqual([
      ["NAME", "Kölsch & ☕ &nbsp;"],
      ["NOTES", "<b>fet</b>"],
      ["E", ""],
    ]);
  });
});
