import { describe, expect, it } from "vitest";
import { buildBrewDocument, buildBrewDocumentSections } from "../../src/domain/brew-document/brew-document.ts";
import { deriveBrewDayState, type BrewDayLogEntry } from "../../src/domain/brew-day/state.ts";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import type { TimelineItem } from "../../src/domain/model/api.ts";
import { brewStages, type BrewStage } from "../../src/domain/model/brewing.ts";
import { recipeDocumentSchema, type RecipeDocument } from "../../src/domain/model/recipe.ts";
import {
  ionKeys,
  phSamplePoints,
  recipeWaterPlanSchema,
  waterAgents,
  waterProfileSchema,
  waterValueBases,
  type PhSamplePoint,
} from "../../src/domain/model/water.ts";
import { summarizeBatchWater, summarizeWaterOfBatch } from "../../src/domain/water/batch-water.ts";
import { classifyHardness, describeSourceWater, numericLimit } from "../../src/domain/water/describe.ts";
import {
  describeSulfateToChlorideRatio,
  guidanceDisclaimer,
  guidanceSources,
  ionGuidance,
  ionGuidanceFor,
  mashPhGuidance,
} from "../../src/domain/water/guidance.ts";
import { classifyPhSamplePoint, isHotPhSample, labelForPhSamplePoint, phReadings } from "../../src/domain/water/ph.ts";
import { holsfjordenWater20261001, slumpBaseWater, slumpWaterProfileById, slumpWaterProfiles } from "../../src/domain/water/slump-water.ts";
import { makeBatch, sunsetTimeline } from "../helpers/batch.ts";

describe("the canonical Slump base water", () => {
  it("is valid and comes with everything needed to re-verify it", () => {
    for (const profile of slumpWaterProfiles) {
      expect(waterProfileSchema.safeParse(profile).success, profile.id).toBe(true);
      expect(profile.source.url.startsWith("https://"), profile.id).toBe(true);
      expect(profile.source.retrievedAt, profile.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(new Set(slumpWaterProfiles.map((profile) => profile.id)).size).toBe(slumpWaterProfiles.length);
    expect(slumpBaseWater).toBe(slumpWaterProfiles.at(-1));
    expect(slumpWaterProfileById(slumpBaseWater.id)).toBe(slumpBaseWater);
  });

  it("keeps the entry read from ABV on 2026-10-01 exactly as published (entries are records, never edited)", () => {
    const profile = holsfjordenWater20261001;
    expect(profile.id).toBe("abv-holsfjorden-2026-10-01");
    expect(profile.ions).toEqual({ ca: 6.6, mg: 0.89, na: 2.7, cl: 2.5, so4: 3.4, hco3: 16.5 });
    expect([profile.alkalinityMmolL, profile.hardnessDh, profile.ph]).toEqual([0.3, 1.1, 7.3]);
    expect(profile.source).toMatchObject({
      kind: "supplier_report",
      url: "https://www.abvann.no/temasider/vannkvalitet",
      retrievedAt: "2026-10-01",
      // ABV states no analysis date; the page's Last-Modified is kept apart so nobody reads it as one.
      publishedAt: null,
      lastModifiedAt: "2026-09-29",
    });
  });

  it("holds every parameter ABV prints for Holsfjorden (31), each one written once", () => {
    const profile = holsfjordenWater20261001;
    const typed = ["pH", "Alkalitet", "Hardhet", "Kalsium", "Magnesium", "Natrium", "Klorid", "Sulfat", "Bikarbonat"];
    expect(typed.length + profile.otherReported.length).toBe(31);
    expect(profile.otherReported).toHaveLength(22);
    const names = profile.otherReported.map((parameter) => parameter.name);
    expect(new Set(names).size).toBe(names.length);
    // The nine the app calculates with are typed; none of them is repeated in the list of the others.
    for (const name of typed) expect(names, name).not.toContain(name);
    // Spot checks against the page, including the awkward ones: tiny values, text limits, no limit.
    const byName = Object.fromEntries(profile.otherReported.map((parameter) => [parameter.name, parameter]));
    expect(byName.Kalium).toEqual({ name: "Kalium", value: 0.53, unit: "mg/L", limit: null });
    expect(byName.Kvikksølv).toEqual({ name: "Kvikksølv", value: 0.0005, unit: "µg/L", limit: "1" });
    expect(byName["Tot.org.karbon"]).toEqual({ name: "Tot.org.karbon", value: 3.2, unit: "mg/L", limit: "Ingen unormal endring" });
    expect(byName.Farge).toMatchObject({ value: 13.8, unit: "mg Pt/L", limit: "Akseptabel for abonnenten" });
    expect(byName.Jern).toMatchObject({ value: 0.02, unit: "mg Fe/L", limit: "0,2" });
    expect(byName["Koli.bakt."]).toMatchObject({ value: 0, limit: null });
  });

  it("records that Brage confirmed this is the water Slump uses, and nothing in the caveats still asks", () => {
    expect(holsfjordenWater20261001.confirmedUse).toMatchObject({ confirmedBy: "Brage", confirmedAt: "2026-10-01" });
    expect(holsfjordenWater20261001.confirmedUse?.note).toMatch(/Holsfjorden/);
    expect(holsfjordenWater20261001.caveats.join(" ")).not.toMatch(/Bekreft/);
    expect(describeSourceWater(holsfjordenWater20261001).other).toHaveLength(22);
  });

  it("reads the source's limits as printed, and finds every numeric one above its value", () => {
    expect([numericLimit("0,2"), numericLimit("50"), numericLimit(" 1,5 "), numericLimit("Akseptabel for abonnenten"), numericLimit("6,5 - 9,5"), numericLimit(null)]).toEqual([0.2, 50, 1.5, null, null, null]);
    const { other, limits } = describeSourceWater(holsfjordenWater20261001);
    expect(limits).toEqual({ checked: 16, allBelow: true });
    expect(other.find((row) => row.label === "Jern")).toMatchObject({ value: 0.02, unit: "mg Fe/L", limit: "0,2", decimals: 2, basis: "reported" });
    expect(other.find((row) => row.label === "Kvikksølv")?.decimals).toBe(4);
    // A value at or above its limit is caught.
    const above = describeSourceWater({ ...holsfjordenWater20261001, otherReported: [{ name: "Jern", value: 0.3, unit: "mg Fe/L", limit: "0,2" }] });
    expect(above.limits).toEqual({ checked: 1, allBelow: false });
  });

  it("describes a profile frozen before the other parameters were stored", () => {
    const { otherReported: _omitted, ...older } = holsfjordenWater20261001;
    const description = describeSourceWater(older as never);
    expect(description.other).toEqual([]);
    expect(description.limits).toEqual({ checked: 0, allBelow: true });
    expect(description.reported.length).toBeGreaterThan(0);
  });

  it("agrees with its own derived values to within the supplier's rounding", () => {
    const { checks } = describeSourceWater(holsfjordenWater20261001);
    expect(checks.map((check) => check.key).sort()).toEqual(["alkalinity", "hardness"]);
    for (const check of checks) {
      expect(check.withinRounding, `${check.label}: reported ${check.reported}, calculated ${check.calculated}`).toBe(true);
    }
  });

  it("is very soft and mineral-poor, a blank slate for building profiles", () => {
    const description = describeSourceWater(holsfjordenWater20261001);
    expect(description.hardnessClass).toBe("very_soft");
    expect(description.lowMineral).toBe(true);
    expect(description.belowGuidance.sort()).toEqual(["ca", "cl", "mg", "so4"]);
    expect(description.ratioText).toMatch(/sier lite/);
  });

  it("tags each row with how the value is known and keeps calculated values out of the reported ones", () => {
    const { reported, calculated } = describeSourceWater(holsfjordenWater20261001);
    expect(new Set(reported.map((row) => row.basis))).toEqual(new Set(["reported"]));
    expect(new Set(calculated.map((row) => row.basis))).toEqual(new Set(["calculated"]));
    expect(waterValueBases).toEqual(["reported", "calculated", "target", "measured"]);
  });

  it("classifies hardness on the classic bands", () => {
    expect([0.5, 3.9, 4, 7.9, 8, 20].map(classifyHardness)).toEqual(["very_soft", "very_soft", "soft", "soft", "harder", "harder"]);
  });
});

describe("general guidance", () => {
  it("is well formed, sourced and labelled as guidance rather than rules", () => {
    expect(guidanceDisclaimer).toMatch(/ikke regler/);
    for (const entry of ionGuidance) {
      expect(entry.sourceIds.length, entry.ion).toBeGreaterThan(0);
      for (const id of entry.sourceIds) expect(guidanceSources[id].url.startsWith("https://"), `${entry.ion} ${id}`).toBe(true);
      if (entry.typical) expect(entry.typical.min).toBeLessThan(entry.typical.max);
      if (entry.typical && entry.cautionAbove !== undefined) expect(entry.cautionAbove).toBeGreaterThanOrEqual(entry.typical.min);
    }
    expect(ionGuidance.map((entry) => entry.ion).sort()).toEqual([...ionKeys].sort());
  });

  it("states the mash pH window for a room-temperature sample and does not judge hot ones", () => {
    expect(mashPhGuidance.window.min).toBeLessThan(mashPhGuidance.window.max);
    expect(mashPhGuidance.planningTarget.min).toBeGreaterThanOrEqual(mashPhGuidance.window.min);
    expect(mashPhGuidance.planningTarget.max).toBeLessThanOrEqual(mashPhGuidance.window.max);
    expect(mashPhGuidance.referenceTemperatureC).toBe(20);
    expect(isHotPhSample(22)).toBe(false);
    expect(isHotPhSample(62)).toBe(true);
    expect(isHotPhSample(null)).toBe(false);
  });

  it("only reads the sulfate:chloride ratio when an ion is in flavour range", () => {
    expect(describeSulfateToChlorideRatio(1.36, { so4: 3.4, cl: 2.5 })).toMatch(/sier lite/);
    expect(describeSulfateToChlorideRatio(0.4, { so4: 40, cl: 100 })).toBe("svært malt-/rundt");
    expect(describeSulfateToChlorideRatio(3, { so4: 150, cl: 50 })).toBe("humlebetont og tørt");
    expect(describeSulfateToChlorideRatio(null, { so4: 150, cl: 0 })).toMatch(/ikke definert/);
  });

  it("never turns a source or a calculation into guidance", () => {
    // Guidance is the only place ranges live: the source profile has plain numbers and no windows.
    expect(Object.keys(holsfjordenWater20261001)).not.toContain("typical");
    expect(ionGuidanceFor("ca").typical).toEqual({ min: 50, max: 150 });
  });
});

describe("salts and acids", () => {
  it("lists each agent once, salts with a formula and acids with the strengths they are sold at", () => {
    expect(new Set(waterAgents.map((agent) => agent.id)).size).toBe(waterAgents.length);
    for (const agent of waterAgents) {
      if (agent.kind === "salt") expect(Object.keys(agent.composition).length, agent.id).toBeGreaterThan(0);
      else expect(agent.typicalStrengthsPct.length, agent.id).toBeGreaterThan(0);
    }
  });
});

describe("pH sample points", () => {
  const cases: [BrewStage | null, string | null, PhSamplePoint | null][] = [
    // The Sunset IPA reference batch: label «Før kok», logged in the lauter stage.
    ["lauter", "Før kok", "pre_boil"],
    ["boil", null, null],
    ["boil", "pH før kok", "pre_boil"],
    ["boil", "Etter kok", "post_boil"],
    ["whirlpool", null, "post_boil"],
    ["cooling", null, "post_boil"],
    ["mash", null, "mash"],
    ["mash", "Mesk-pH", "mash"],
    ["fermentation", null, "fermentation"],
    ["fermentation", "Slutt-pH", "final"],
    ["conditioning", null, null],
    ["conditioning", "Slutt-pH", "final"],
    ["packaging", null, "final"],
    [null, null, null],
    [null, "pre-boil", "pre_boil"],
  ];
  it.each(cases)("stage %s, label %s → %s", (stage, label, expected) => {
    expect(classifyPhSamplePoint({ stage, label })).toBe(expected);
  });

  it("writes a label that reads back as the chosen point, and none when the stage already says it", () => {
    for (const stage of [...brewStages, null]) {
      for (const point of phSamplePoints) {
        const label = labelForPhSamplePoint(point, stage);
        expect(classifyPhSamplePoint({ stage, label }), `${stage} ${point}`).toBe(point);
      }
    }
    expect(labelForPhSamplePoint("mash", "mash")).toBeUndefined();
    expect(labelForPhSamplePoint("pre_boil", "boil")).toBe("pH før kok");
  });

  it("reads the historical Sunset pH exactly as recorded, with no temperature or instrument invented", () => {
    const readings = phReadings(sunsetTimeline());
    expect(readings).toHaveLength(1);
    expect(readings[0]).toMatchObject({ point: "pre_boil", stage: "lauter", label: "Før kok", value: 5.9, sampleTempC: null, instrument: null });
    expect(readings[0]!.comment).toBe("pH-strimmel ca. 5,8–6,0");
  });

  it("places a sour wort at pH 3.8 before the boil whether it was labelled or only logged in the lauter stage", () => {
    const sour = (stage: BrewStage, label: string | null): TimelineItem => ({
      ...sunsetTimeline()[0]!,
      id: `sour-${stage}-${label}`,
      stage,
      measurement: { ...sunsetTimeline().find((item) => item.measurement?.kind === "ph")!.measurement!, label, value: 3.8, valueMin: null, valueMax: null, comment: null },
    });
    expect(phReadings([sour("lauter", null)])[0]).toMatchObject({ point: "pre_boil", value: 3.8 });
    expect(phReadings([sour("boil", "Før kok")])[0]).toMatchObject({ point: "pre_boil", value: 3.8 });
    expect(phReadings([sour("boil", null)])[0]).toMatchObject({ point: null, value: 3.8 });
  });
});

describe("a hot sample against the mash pH window", () => {
  const start = Date.parse("2026-10-06T08:00:00+02:00");
  const state = (value: number, sampleTempC: number | null) => {
    const log: BrewDayLogEntry[] = [
      {
        type: "measurement",
        stage: "mash",
        occurredAt: start + 20 * 60_000,
        data: null,
        measurement: { kind: "ph", value, label: null, sampleTempC },
      },
    ];
    const result = deriveBrewDayState({ recipe: sunsetIpaRecipe, stage: "mash", stageStartedAt: start, log, now: start + 25 * 60_000 });
    return result.targets.find((target) => target.key === "mash-ph")!;
  };

  it("judges a room-temperature reading against the target", () => {
    expect(state(5.3, 22).status).toBe("ok");
    expect(state(5.0, 22).status).toBe("low");
    expect(state(5.3, null).status).toBe("ok");
  });

  it("calls a hot reading uncertain instead of low", () => {
    // 5.0 hot is about 5.3 at room temperature: «Lav» would be wrong.
    expect(state(5.0, 62)).toMatchObject({ status: "uncertain", actual: { sampleTempC: 62 } });
  });

  it("keeps the app's default target from the guidance, so the number lives in one place", () => {
    const target = state(5.3, 22).target;
    expect(target).toEqual({ kind: "range", min: mashPhGuidance.planningTarget.min, max: mashPhGuidance.planningTarget.max });
  });
});

describe("water and pH of one batch", () => {
  const withWater = (recipe: Partial<RecipeDocument>): RecipeDocument => ({ ...sunsetIpaRecipe, ...recipe });
  const saltedRecipe = withWater({
    water: { profileName: "Kloridfremhevet", target: { ca: 100, cl: 150, so4: 50 }, notes: "Hazy" },
    miscs: [
      { id: "m-gypsum", name: "Gips", amount: 10, unit: "g", use: "mash", waterAgent: "gypsum" },
      { id: "m-cacl2", name: "Kalsiumklorid", amount: 20, unit: "g", use: "mash", waterAgent: "calcium_chloride_dihydrate" },
      { id: "m-lactic", name: "Melkesyre", amount: 12, unit: "ml", use: "mash", waterAgent: "lactic_acid", acidStrengthPct: 80 },
      { id: "m-whirlfloc", name: "Protafloc", amount: 5, unit: "g", use: "boil" },
    ],
  });

  it("keeps source, plan, calculated and measured apart", () => {
    const summary = summarizeBatchWater({ recipe: saltedRecipe, water: holsfjordenWater20261001, timeline: sunsetTimeline(), totalWaterL: 100 });
    expect(summary.source).toMatchObject({ frozen: true });
    expect(summary.source.profile.ions.ca).toBe(6.6);
    expect(summary.plan.target).toEqual({ ca: 100, cl: 150, so4: 50 });
    expect(summary.plan.additions.map((addition) => addition.agent)).toEqual(["gypsum", "calcium_chloride_dihydrate", "lactic_acid"]);
    expect(summary.plan.mashPh).toEqual({ min: 5.2, max: 5.4, source: "assumed" });
    // 10 g gypsum + 20 g CaCl2·2H2O in 100 L on top of the base water; the acid is not counted.
    expect(summary.calculated.afterPlannedSalts!.ca).toBeCloseTo(6.6 + 23.28 + 54.52, 1);
    expect(summary.calculated.afterPlannedSalts!.so4).toBeCloseTo(3.4 + 55.79, 1);
    expect(summary.calculated.afterPlannedSalts!.cl).toBeCloseTo(2.5 + 96.46, 1);
    expect(summary.calculated.note).toMatch(/Syrer er ikke regnet med/);
    expect(summary.measured.ph).toHaveLength(1);
    expect(summary.measured.additions).toEqual([]);
  });

  it("does not calculate a profile it has no volume or no salts for, and says why", () => {
    const noVolume = summarizeBatchWater({ recipe: saltedRecipe, water: holsfjordenWater20261001, timeline: [], totalWaterL: null });
    expect(noVolume.calculated.afterPlannedSalts).toBeNull();
    expect(noVolume.calculated.note).toMatch(/Vannmengden er ukjent/);
    const noSalts = summarizeBatchWater({ recipe: sunsetIpaRecipe, water: holsfjordenWater20261001, timeline: [], totalWaterL: 100 });
    expect(noSalts.calculated.afterPlannedSalts).toBeNull();
    expect(noSalts.plan.additions).toEqual([]);
    expect(noSalts.plan.target).toBeNull();
  });

  it("says when the water volume behind the calculated salt profile rests on assumed profile values", () => {
    const recipe = withWater({ miscs: [{ id: "m-gypsum", name: "Gips", amount: 10, unit: "g", use: "mash", waterAgent: "gypsum" }] });
    const calibrated = { boil_off_l_per_h: 13.2, grain_absorption_l_per_kg: 0.8, mash_thickness_l_per_kg: 3, mash_dead_space_l: 0, pump_pipe_loss_l: 0, kettle_loss_l: 0, chiller_loss_l: 0, transfer_loss_l: 0, cooling_shrinkage_pct: 4 };
    const batchWith = (values: Record<string, number>) => makeBatch({ recipeSnapshot: recipe, equipmentSnapshot: { profileId: "p", profileVersion: 1, values } });

    const assumed = summarizeWaterOfBatch(batchWith({}), []);
    expect(assumed.calculated.afterPlannedSalts).not.toBeNull();
    expect(assumed.calculated.totalWaterAssumed).toBe(true);
    expect(assumed.calculated.note).toMatch(/antatte profilverdier/);

    const explicit = summarizeWaterOfBatch(batchWith(calibrated), []);
    expect(explicit.calculated.totalWaterAssumed).toBe(false);
    expect(explicit.calculated.note).not.toMatch(/antatte profilverdier/);
    // The same salt in more water is less concentrated: the volume really drives the number.
    expect(explicit.calculated.totalWaterL).not.toBe(assumed.calculated.totalWaterL);
  });

  it("names a salt it cannot weigh instead of dropping it silently", () => {
    const recipe = withWater({ miscs: [{ id: "m1", name: "Gips", amount: 2, unit: "ts", use: "mash", waterAgent: "gypsum" }] });
    const summary = summarizeBatchWater({ recipe, water: null, timeline: [], totalWaterL: 100 });
    expect(summary.calculated.afterPlannedSalts).toBeNull();
    expect(summary.calculated.note).toContain("Gips");
  });

  it("assumes the brewery's base water for a batch created before water chemistry, and says so", () => {
    const legacy = summarizeBatchWater({ recipe: sunsetIpaRecipe, water: null, timeline: [], totalWaterL: null });
    expect(legacy.source.frozen).toBe(false);
    expect(legacy.source.profile).toBe(slumpBaseWater);
  });

  it("reads logged salts and acids by their agent and ignores additions without one", () => {
    const base = sunsetTimeline()[0]!;
    const added = (id: string, data: Record<string, unknown>, at: number): TimelineItem => ({ ...base, id, type: "ingredient_added", stage: "mash", occurredAt: at, data, measurement: null });
    const timeline = [
      added("a2", { ingredientKind: "misc", name: "Melkesyre", amount: 8, unit: "ml", waterAgent: "lactic_acid", acidStrengthPct: 88 }, 2000),
      added("a1", { ingredientKind: "misc", ingredientId: "m-gypsum", name: "Gips", amount: 11, unit: "g", waterAgent: "gypsum" }, 1000),
      added("a3", { ingredientKind: "misc", name: "Protafloc", amount: 5, unit: "g" }, 3000),
      added("a4", { ingredientKind: "misc", name: "Rart", amount: 5, unit: "g", waterAgent: "not_an_agent" }, 4000),
    ];
    const summary = summarizeBatchWater({ recipe: saltedRecipe, water: null, timeline, totalWaterL: 100 });
    expect(summary.measured.additions.map((addition) => [addition.agent, addition.amount, addition.ingredientId, addition.acidStrengthPct])).toEqual([
      ["gypsum", 11, "m-gypsum", null],
      ["lactic_acid", 8, null, 88],
    ]);
  });

  it("stays valid in a recipe document and keeps older recipes valid", () => {
    expect(recipeDocumentSchema.safeParse(saltedRecipe).success).toBe(true);
    expect(recipeDocumentSchema.safeParse(sunsetIpaRecipe).success).toBe(true);
    expect(recipeWaterPlanSchema.safeParse({ target: { ca: -1 } }).success).toBe(false);
    expect(recipeDocumentSchema.safeParse(withWater({ miscs: [{ id: "x", name: "Rart", amount: 1, unit: "g", use: "mash", waterAgent: "snake_oil" as never }] })).success).toBe(false);
  });
});

describe("the water section of the brew document", () => {
  const recipe = {
    ...sunsetIpaRecipe,
    water: { profileName: "Kloridfremhevet", target: { ca: 100, cl: 150 } },
    miscs: [{ id: "m-gypsum", name: "Gips", amount: 10, unit: "g", use: "mash" as const, waterAgent: "gypsum" as const }],
  };
  const input = (water: typeof holsfjordenWater20261001 | null) => ({
    batch: makeBatch({ recipeSnapshot: recipe, equipmentSnapshot: { profileId: "p", profileVersion: 1, values: {}, water } }),
    timeline: sunsetTimeline(),
    now: Date.parse("2026-09-23T13:30:00+02:00"),
  });

  it("separates the four kinds of value under their own headings", () => {
    const { water } = buildBrewDocumentSections(input(holsfjordenWater20261001));
    const headings = water.split("\n").filter((line) => line.startsWith("### "));
    expect(headings).toEqual(["### Kildevann (oppgitt)", "### Beregnet fra kildevannet (≈)", "### Plan (mål)", "### Målt i brygget"]);
    expect(water).toContain("Kilde: Vannverkets oppgitte verdier, Asker og Bærum Vannverk IKS (ABV), https://www.abvann.no/temasider/vannkvalitet. Hentet 2026-10-01; ingen prøvedato oppgitt.");
    expect(water).toContain("Profilen er frosset i batchen.");
    expect(water).toContain("Bekreftet i bruk: Brage 2026-10-01. Vannet Slump bruker kommer fra Holsfjorden, og ABVs tabell er kilden for alle verdiene.");
    expect(water).toContain("Øvrige oppgitte verdier (22): Farge 13,8 mg Pt/L; Turbiditet 0,2 FNU; Jern 0,02 mg Fe/L;");
    expect(water).toContain("Kvikksølv 0,0005 µg/L; Nikkel 0,6 µg/L; Selen 0,03 µg/L; Kalium 0,53 mg/L.");
    expect(water).toContain("Svært bløtt og mineralfattig");
  });

  it("shows the planned target and salt as plan, and the historical pH as a measurement", () => {
    const { water } = buildBrewDocumentSections(input(holsfjordenWater20261001));
    expect(water).toContain("Planlagt vannprofil «Kloridfremhevet» (mål, mg/L): Ca 100 · Cl 150");
    expect(water).toContain("Planlagt: 10 g Gips — ikke registrert tilsatt");
    expect(water).toContain("Før kok: pH 5,90, prøvetemperatur ikke oppgitt, instrument ikke oppgitt");
    expect(water).toContain("Ingen mesk-pH er beregnet");
  });

  it("is part of the document and says when an older batch has no frozen profile", () => {
    const doc = buildBrewDocument(input(null));
    expect(doc).toContain("## Vann og pH");
    expect(doc).toContain("Batchen har ingen frosset profil");
  });
});
