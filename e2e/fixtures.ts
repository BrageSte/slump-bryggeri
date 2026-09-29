import { test as base, expect, type Page } from "@playwright/test";
import { sunsetIpaRecipe } from "../src/domain/fixtures/sunset-ipa.ts";

export { expect };

export interface E2EBatch {
  id: string;
  name: string;
  /** Path of the brew-day screen. */
  path: string;
}

/**
 * Every test gets its own planned batch of the Sunset IPA reference recipe, made through the API
 * as the person from global setup, so tests never depend on each other's log.
 */
export const test = base.extend<{ batch: E2EBatch }>({
  batch: async ({ request }, use) => {
    const me = (await (await request.get("/api/me")).json()) as { memberships: { brewery: { id: string } }[] };
    const breweryId = me.memberships[0]?.brewery.id;
    if (!breweryId) throw new Error("The e2e person has no brewery; did global setup run?");
    const base = `/api/breweries/${breweryId}`;

    const recipe = await request.post(`${base}/recipes`, { data: { recipe: sunsetIpaRecipe, source: { kind: "example" } } });
    expect(recipe.status(), await recipe.text()).toBe(201);
    const { id: recipeId } = (await recipe.json()) as { id: string };

    const created = await request.post(`${base}/batches`, { data: { recipeId } });
    expect(created.status(), await created.text()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await use({ id, name: sunsetIpaRecipe.name, path: `/batcher/${id}` });
  },
});

/** The phone's bottom navigation, which the floating buttons must stay above. */
export function bottomNav(page: Page) {
  return page.getByRole("navigation", { name: "Hovedmeny" });
}
