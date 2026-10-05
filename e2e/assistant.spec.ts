import { calculateRecipeMetrics } from "../src/domain/brewing-calculations/index.ts";
import { sunsetIpaRecipe } from "../src/domain/fixtures/sunset-ipa.ts";
import { expect, test } from "./fixtures.ts";

/**
 * The brewery thread on a phone: the entry on the assistant page, the conversation without an API key
 * (the e2e server has none), and how a recipe draft from the assistant is shown. The draft's numbers and
 * the server side are covered by unit and integration tests; the thread response is faked here because
 * the e2e server cannot call Anthropic.
 */
test.describe("bryggeritråden på mobil", () => {
  test("Assistent-siden gir en egen samtale om oppskrifter og bryggeriet, ved siden av batchene", async ({ page, batch }) => {
    await page.goto("/assistent");
    await expect(page.getByRole("heading", { name: "Bryggeassistent", level: 1 })).toBeVisible();
    await expect(page.getByText("Assistenten er ikke satt opp ennå")).toBeVisible();
    const breweryLink = page.getByRole("link", { name: /Oppskrifter og bryggeriet/ });
    await expect(breweryLink).toBeVisible();
    // The batches are still there, under their own heading.
    await expect(page.getByRole("link", { name: new RegExp(batch.name) }).first()).toBeVisible();

    await breweryLink.click();
    await expect(page).toHaveURL(/\/assistent\?tema=bryggeri$/);
    await expect(page.getByRole("heading", { name: "Oppskrifter og bryggeriet", level: 1 })).toBeVisible();
    await expect(page.getByText("Delt samtale for hele bryggeriet")).toBeVisible();

    // Without a key the starters and the field are off, and it says why.
    const starter = page.getByRole("button", { name: /Lag en oppskrift på en humlerik IPA/ });
    await expect(starter).toBeVisible();
    await expect(starter).toBeDisabled();
    await expect(page.getByText("Assistenten er ikke satt opp ennå.")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Spør Veileder" })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.getByRole("link", { name: "Tilbake" }).click();
    await expect(page).toHaveURL(/\/assistent$/);
  });

  test("et utkast fra assistenten viser appens tall, og hele oppskriften på forespørsel", async ({ page }) => {
    const metrics = calculateRecipeMetrics(sunsetIpaRecipe);
    const draft = { kind: "recipe_draft", recipe: sunsetIpaRecipe, baseRecipeId: null, status: "pending", resolvedBy: null, resolvedAt: null, logEntryId: null };
    const revision = { ...draft, baseRecipeId: "en-oppskrift", recipe: { ...sunsetIpaRecipe, name: "Sunset IPA v2" } };
    await page.route("**/api/breweries/*/assistant/messages", async (route) => {
      if (route.request().method() !== "GET") return route.continue();
      await route.fulfill({
        json: {
          messages: [
            { id: "q1", role: "user", content: "Lag en IPA", actions: null, citations: [], author: { id: "u", name: "Brage" }, createdAt: Date.now() - 2000 },
            { id: "a1", role: "assistant", content: "Her er et utkast. Tallene er regnet av appen.", actions: [draft, revision], citations: [], author: null, createdAt: Date.now() - 1000 },
          ],
        },
      });
    });

    await page.goto("/assistent?tema=bryggeri");
    await expect(page.getByText("Her er et utkast. Tallene er regnet av appen.")).toBeVisible();

    const cards = page.getByTestId("recipe-draft");
    await expect(cards).toHaveCount(2);
    const card = cards.first();
    await expect(card.getByText("Utkast til ny oppskrift", { exact: true })).toBeVisible();
    await expect(card.getByText(sunsetIpaRecipe.name)).toBeVisible();
    // The key numbers are the app's calculation of the ingredients, not the recipe's own targets.
    await expect(card.getByText(new RegExp(`OG ${(metrics.og as number).toFixed(3)} · FG ${(metrics.fg as number).toFixed(3)}`))).toBeVisible();
    await expect(card.getByText(/60 L$/)).toBeVisible();
    await expect(card.getByText("Utkastet er ikke lagret.", { exact: false })).toBeVisible();
    await expect(cards.nth(1).getByText("Utkast til ny versjon av en oppskrift")).toBeVisible();
    await card.screenshot({ path: "test-results/assistant-draft-actions.png" });

    // The whole recipe is folded away until asked for.
    await expect(card.getByText("BEST Pale Ale")).toBeHidden();
    await card.getByText("Vis hele utkastet").click();
    await expect(card.getByText("BEST Pale Ale")).toBeVisible();
    await expect(card.getByText(/Malt · /)).toBeVisible();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/assistant-draft.png", fullPage: true });
  });

  for (const brewAfterSave of [false, true]) {
    test(`et nytt utkast åpnes uten skriving og ${brewAfterSave ? "går til batchveiviseren etter lagring" : "lagres med forespørselen som kilde"}`, async ({ page, request }) => {
      const me = await (await request.get("/api/me")).json();
      const base = `/api/breweries/${me.memberships[0].brewery.id}`;
      const name = `Assistentutkast ${crypto.randomUUID()}`;
      const question = "Lag en IPA på Slumps anlegg";
      const draft = { kind: "recipe_draft", recipe: { ...sunsetIpaRecipe, name }, baseRecipeId: null, baseVersionId: null, status: "pending", resolvedBy: null, resolvedAt: null, logEntryId: null };
      await page.route("**/api/breweries/*/assistant/messages", (route) => route.fulfill({ json: { messages: [
        { id: "q", role: "user", content: question, actions: null, citations: [], author: { id: "u", name: "Brage" }, createdAt: 1 },
        { id: "a", role: "assistant", content: "Her er et utkast.", actions: [draft], citations: [], author: null, createdAt: 2 },
      ] } }));
      let writes = 0;
      page.on("request", (req) => { if (req.method() === "POST" && /\/(recipes|batches)(\/|$)/.test(req.url())) writes++; });
      await page.goto("/assistent?tema=bryggeri");
      await page.getByRole("link", { name: brewAfterSave ? "Brygg denne" : "Åpne utkast", exact: true }).click();
      await expect(page).toHaveURL(/\/oppskrifter\/ny$/);
      await expect(page.getByRole("textbox", { name: "Navn", exact: true }).first()).toHaveValue(name);
      expect(writes).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/assistant-editor-${brewAfterSave}.png`, fullPage: true });
      const responsePromise = page.waitForResponse((res) => res.request().method() === "POST" && res.url().endsWith("/recipes"));
      await page.getByRole("button", { name: "Lagre oppskrift", exact: true }).click();
      const response = await responsePromise;
      expect(response.status(), await response.text()).toBe(201);
      const { id } = await response.json();
      await expect(page).toHaveURL(brewAfterSave ? new RegExp(`/brygg/ny\\?oppskrift=${id}$`) : new RegExp(`/oppskrifter/${id}$`));
      const saved = await (await request.get(`${base}/recipes/${id}`)).json();
      expect(saved.source).toMatchObject({ kind: "assistant", originalText: question });
      expect(writes).toBe(1);
      if (brewAfterSave) {
        await expect(page.getByRole("combobox", { name: "Oppskrift" })).toHaveValue(id);
        await page.screenshot({ path: "test-results/assistant-brew-wizard.png", fullPage: true });
      }
    });
  }

  test("et versjonsutkast beholder grunnlaget og blokkerer lagring etter en nyere versjon", async ({ page, request, recipe }) => {
    const me = await (await request.get("/api/me")).json();
    const path = `/api/breweries/${me.memberships[0].brewery.id}/recipes/${recipe.id}`;
    const original = await (await request.get(path)).json();
    const draft = { kind: "recipe_draft", recipe: { ...sunsetIpaRecipe, name: "Endret fra assistenten" }, baseRecipeId: recipe.id, baseVersionId: original.current.id, status: "pending", resolvedBy: null, resolvedAt: null, logEntryId: null };
    await page.route("**/api/breweries/*/assistant/messages", (route) => route.fulfill({ json: { messages: [
      { id: "q", role: "user", content: "Endre Sunset", actions: null, citations: [], author: { id: "u", name: "Brage" }, createdAt: 1 },
      { id: "a", role: "assistant", content: "Nytt utkast", actions: [draft], citations: [], author: null, createdAt: 2 },
    ] } }));
    await page.goto("/assistent?tema=bryggeri");
    await page.getByRole("link", { name: "Åpne utkast" }).click();
    await expect(page.getByRole("textbox", { name: "Navn", exact: true }).first()).toHaveValue("Endret fra assistenten");
    await expect(page.getByRole("button", { name: "Lagre ny versjon" })).toBeEnabled();
    const concurrent = await request.post(`${path}/versions`, { data: { recipe: { ...sunsetIpaRecipe, name: "Endret av en annen" }, baseVersionId: original.current.id } });
    expect(concurrent.status()).toBe(201);
    await page.reload();
    await expect(page.getByText(/Oppskriften har fått en nyere versjon/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Lagre ny versjon" })).toBeDisabled();
    const current = await (await request.get(path)).json();
    expect(current.current.data.name).toBe("Endret av en annen");
    expect(current.current.version).toBe(2);
  });
});
