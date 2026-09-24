import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { sunsetIpaRecipe } from "../../src/domain/fixtures/sunset-ipa.ts";
import { BSMX_MAX_BYTES, parseBsmx } from "../../src/domain/import/bsmx.ts";
import type { RecipeDetail, RecipeSummary } from "../../src/domain/model/api.ts";
import { recipeDocumentSchema } from "../../src/domain/model/recipe.ts";
import { bsmxFixtures } from "../fixtures/beersmith/index.ts";
import { createBrewery, createUser, download, type TestUser } from "./client.ts";

const files = Object.keys(bsmxFixtures).sort();

type ImportResponse = { id: string; error: { code: string; message: string; issues?: { path: string; message: string }[] } };

/** The part of a fixture between <Recipe> and </Recipe>, for building folder exports. */
const recipeElement = (file: string) => {
  const text = bsmxFixtures[file]!;
  return text.slice(text.indexOf("<Recipe>"), text.lastIndexOf("</Recipe>") + "</Recipe>".length);
};

describe("BeerSmith import (.bsmx)", () => {
  let brewer: TestUser;
  let brewery: string;

  beforeAll(async () => {
    brewer = await createUser("Brage");
    brewery = await createBrewery(brewer);
  });

  const importFile = (filename: string, text: string, recipeIndex?: number) =>
    brewer.post<ImportResponse>(`/breweries/${brewery}/recipes/import/bsmx`, {
      filename,
      text,
      ...(recipeIndex !== undefined && { recipeIndex }),
    });
  const getRecipe = (id: string) => brewer.get<RecipeDetail>(`/breweries/${brewery}/recipes/${id}`);
  const sourceFile = (id: string) => download(brewer, `/breweries/${brewery}/recipes/${id}/source/file`);

  it("imports all seven files", () => {
    expect(files).toHaveLength(7);
  });

  it.each(files)("imports %s as a plan and gives the file back byte for byte", async (filename) => {
    const text = bsmxFixtures[filename]!;
    const created = await importFile(filename, text);
    expect(created.status).toBe(201);

    const recipe = await getRecipe(created.body.id);
    expect(recipe.status).toBe(200);
    expect(recipe.body.current.version).toBe(1);
    // The server's parse gives exactly what the pure adapter gives (and the review screen showed).
    expect(recipe.body.current.data).toEqual(recipeDocumentSchema.parse(parseBsmx(text)[0]!.recipe));
    expect(recipe.body.source).toMatchObject({ kind: "bsmx", filename, url: null, originalText: null });
    expect(recipe.body.source?.bsmx).toMatchObject({ format: "bsmx", recipeIndex: 0, recipeCount: 1 });
    expect(recipe.body.source?.bsmx?.equipment?.name).toBeTruthy();

    const file = await sourceFile(created.body.id);
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/xml; charset=utf-8");
    expect(file.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"; filename*=UTF-8''${filename}`);
    expect(file.headers.get("cache-control")).toBe("no-store");
    expect(file.bytes).toEqual(new TextEncoder().encode(text));
  });

  it("keeps BeerSmith's equipment on the recipe's source, stated apart from derived, without touching the profile", async () => {
    const profileBefore = await brewer.get(`/breweries/${brewery}/equipment-profile`);
    const created = await importFile("Bitter_90l.bsmx", bsmxFixtures["Bitter_90l.bsmx"]!);
    const { bsmx } = (await getRecipe(created.body.id)).body.source!;
    expect(bsmx?.equipment?.name).toBe("1My Equipment - 100l");
    expect(bsmx?.equipment?.stated.efficiencyPct).toBe(80);
    expect(bsmx?.equipment?.stated.batchVolumeL).toBeCloseTo(90, 2);
    expect(bsmx?.equipment?.derived.preBoilVolumeL).toBeCloseTo(102.54, 2);
    expect(bsmx?.equipment?.stated).not.toHaveProperty("preBoilVolumeL");
    expect(bsmx?.waterPlan.strikeTemperatureC).toBeGreaterThan(60);
    expect((await brewer.get(`/breweries/${brewery}/equipment-profile`)).body).toEqual(profileBefore.body);
  });

  it("creates no batch, log, measurements, results or calibration from BeerSmith (B10)", async () => {
    const before = (await brewer.get(`/breweries/${brewery}/export`)).body.tables;
    const measured = [
      ["KES_Belgian_Double.bsmx", "F_R_OG_MEASURED"],
      ["Love_in_a_canoe.bsmx", "F_R_VOLUME_MEASURED"],
    ] as const;
    for (const [filename, field] of measured) {
      const created = await importFile(filename, bsmxFixtures[filename]!);
      expect(created.status).toBe(201);
      const recipe = (await getRecipe(created.body.id)).body;
      expect(recipe.source?.bsmx?.ignoredMeasuredFields).toContain(field);
      // Measured gravities never become targets; only BeerSmith's planned IBU is carried over.
      expect(Object.keys(recipe.current.data.targets)).toEqual(["ibu"]);
    }

    const after = (await brewer.get(`/breweries/${brewery}/export`)).body.tables;
    for (const table of ["batches", "batch_recipe_snapshots", "batch_equipment_snapshots", "batch_splits", "brew_events", "measurements", "comments", "attachments", "batch_outcomes"]) {
      expect(after[table], table).toEqual([]);
    }
    for (const table of ["equipment", "equipment_profiles", "equipment_profile_values"]) {
      expect(after[table], table).toEqual(before[table]);
    }
    expect(after.recipes).toHaveLength(before.recipes.length + 2);
    expect(after.recipe_sources).toHaveLength(before.recipe_sources.length + 2);
    expect(after.recipe_versions).toHaveLength(before.recipe_versions.length + 2);
  });

  it("imports the chosen recipe from a folder export and keeps the whole file", async () => {
    const folder = `<Recipes><Name>Mappe</Name><Data>${recipeElement("IRA.bsmx")}\n${recipeElement("Bitter_90l.bsmx")}</Data></Recipes>`;
    const created = await importFile("Mappe.bsmx", folder, 1);
    expect(created.status).toBe(201);
    const recipe = (await getRecipe(created.body.id)).body;
    expect(recipe.name).toBe(parseBsmx(bsmxFixtures["Bitter_90l.bsmx"]!)[0]!.recipe.name);
    expect(recipe.source?.bsmx).toMatchObject({ recipeIndex: 1, recipeCount: 2 });
    expect((await sourceFile(created.body.id)).bytes).toEqual(new TextEncoder().encode(folder));

    const missing = await importFile("Mappe.bsmx", folder, 2);
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toMatch(/så mange oppskrifter/);
  });

  it("keeps a byte-order mark, Windows line endings and a non-ASCII file name", async () => {
    const text = `﻿${bsmxFixtures["IRA.bsmx"]!.replaceAll("\n", "\r\n")}`;
    const created = await importFile("Åsen Kölsch (2).bsmx", text);
    expect(created.status).toBe(201);
    const file = await sourceFile(created.body.id);
    expect(file.bytes.slice(0, 3)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(file.bytes).toEqual(new TextEncoder().encode(text));
    expect(file.headers.get("content-disposition")).toBe(
      "attachment; filename=\"_sen K_lsch _2_.bsmx\"; filename*=UTF-8''%C3%85sen%20K%C3%B6lsch%20%282%29.bsmx",
    );
  });

  it("rejects hostile, broken and non-BeerSmith files without creating anything", async () => {
    const countRecipes = async () => (await brewer.get<RecipeSummary[]>(`/breweries/${brewery}/recipes`)).body.length;
    const before = await countRecipes();
    const cases: [string, RegExp][] = [
      [
        '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x SYSTEM "file:///etc/passwd">]><Recipe><F_R_NAME>&x;</F_R_NAME></Recipe>',
        /DOCTYPE/,
      ],
      ['<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;">]><Recipe>&lol2;</Recipe>', /DOCTYPE/],
      ["<Recipes><Data><Recipe><F_R_NAME>Halv", /ikke avsluttet/],
      ["<Recipes><Data></Data></Recipes>", /Fant ingen oppskrift/],
      ["Dette er ikke en BeerSmith-fil", /Ugyldig XML/],
      [`${"<a>".repeat(40)}${"</a>".repeat(40)}`, /for dypt/],
    ];
    for (const [text, message] of cases) {
      const response = await importFile("fil.bsmx", text);
      expect(response.status, text.slice(0, 40)).toBe(400);
      expect(response.body.error.message, text.slice(0, 40)).toMatch(message);
    }
    expect(await countRecipes()).toBe(before);
  });

  it("refuses files over the size limit", async () => {
    const tooLarge = `${bsmxFixtures["IRA.bsmx"]!}${" ".repeat(BSMX_MAX_BYTES)}`;
    const response = await importFile("stor.bsmx", tooLarge);
    expect(response.status).toBe(400);
    expect(response.body.error.issues).toContainEqual({ path: "text", message: expect.stringMatching(/for stor/) });

    // Multi-byte characters count as bytes, not characters.
    const wide = await importFile("bred.bsmx", `<Recipe><F_R_NAME>${"ø".repeat(BSMX_MAX_BYTES / 2)}</F_R_NAME></Recipe>`);
    expect(wide.status).toBe(400);

    const huge = await importFile("enorm.bsmx", "x".repeat(4 * BSMX_MAX_BYTES));
    expect(huge.status).toBe(413);
    expect(huge.body.error.message).toMatch(/for stor/);
  });

  it("only takes BeerSmith sources through the import", async () => {
    const forged = await brewer.post(`/breweries/${brewery}/recipes`, {
      recipe: sunsetIpaRecipe,
      source: { kind: "bsmx", originalText: "<Recipe/>" },
    });
    expect(forged.status).toBe(400);

    const manual = await brewer.post<{ id: string }>(`/breweries/${brewery}/recipes`, { recipe: sunsetIpaRecipe, source: { kind: "example" } });
    expect((await getRecipe(manual.body.id)).body.source).toMatchObject({ kind: "example", filename: null, bsmx: null });
    expect((await sourceFile(manual.body.id)).status).toBe(404);
  });

  it("never changes a stored source", async () => {
    const created = await importFile("IRA.bsmx", bsmxFixtures["IRA.bsmx"]!);
    await expect(
      env.DB.prepare("UPDATE recipe_sources SET original_text = 'endret' WHERE recipe_id = ?").bind(created.body.id).run(),
    ).rejects.toThrow(/immutable/);
  });
});
