import { expect, test } from "./fixtures.ts";

/**
 * A new batch in four steps on a phone: recipe → size → equipment → summary, then the overview of the
 * planned batch. Scaling is checked against the API in tests/integration/batch-scaling.test.ts; here the
 * point is that the steps are reachable, show the numbers and end in the overview.
 */
test.describe("ny batch på mobil", () => {
  test("oppskrift, størrelse, utstyr og oppsummering, så oversikten", async ({ page, recipe }) => {
    await page.goto(`/brygg/ny?oppskrift=${recipe.id}`);
    await expect(page.getByRole("heading", { name: "Ny batch", level: 1 })).toBeVisible();

    await test.step("1. oppskrift er forhåndsvalgt", async () => {
      await expect(page.getByRole("combobox", { name: "Oppskrift" })).toHaveValue(recipe.id);
      await expect(page.getByRole("button", { name: /^1\. Oppskrift/ })).toHaveAttribute("aria-current", "step");
      await expect(page.getByRole("button", { name: /^3\. Utstyr/ })).toBeDisabled();
      await page.getByRole("button", { name: "Neste" }).click();
    });

    await test.step("2. størrelse skalerer malt og humle, og viser før og etter", async () => {
      await expect(page.getByRole("textbox", { name: "Batchvolum (L)" })).toHaveValue("60");
      await expect(page.getByText("Uendret fra oppskriften.")).toBeVisible();
      await page.getByRole("textbox", { name: "Batchvolum (L)" }).fill("30");
      await expect(page.getByText("Uendret fra oppskriften.")).toHaveCount(0);
      // 19,82 kg of malt for 60 L is 9,91 kg for 30 L (efficiency unchanged).
      await expect(page.getByText("19,82", { exact: true })).toBeVisible();
      await expect(page.getByText(/^9,91\s*kg$/)).toBeVisible();
      await page.getByRole("button", { name: "Neste" }).click();
    });

    await test.step("3. utstyret vises med advarsel, og kan ikke endres her", async () => {
      await expect(page.getByRole("heading", { name: "Utstyr", level: 2 })).toBeVisible();
      await expect(page.getByText("Profil v1", { exact: true })).toBeVisible();
      await expect(page.getByText(/er standardverdier, ikke målt/)).toBeVisible();
      await expect(page.getByRole("link", { name: "Kalibrering" })).toHaveAttribute("href", "/mer/kalibrering");
      await page.getByRole("button", { name: "Neste" }).click();
    });

    await test.step("stegrekken får plass på skjermen i alle steg", async () => {
      const steps = page.getByRole("navigation", { name: "Steg i ny batch" });
      await expect.poll(() => steps.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    });

    await test.step("4. oppsummering", async () => {
      await expect(page.getByRole("heading", { name: "Oppsummering", level: 2 })).toBeVisible();
      await expect(page.getByText("30 L (oppskriften: 60 L)")).toBeVisible();
      await expect.poll(() => page.getByRole("navigation", { name: "Steg i ny batch" }).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(page.getByText("Profil v1")).toBeVisible();
    });

    await test.step("opprett batch og se oversikten før start", async () => {
      await page.getByRole("button", { name: "Opprett batch" }).click();
      await expect(page).toHaveURL(/\/batcher\/[\w-]+$/);
      await expect(page.getByText("Klar til å brygge")).toBeVisible();
      await expect(page.getByText("Malt", { exact: true })).toBeVisible();
      await expect(page.getByText("9,91 kg", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Start brygg" }).click();
      await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();
    });
  });

  test("en ugyldig størrelse stopper veiviseren, og Tilbake beholder valgene", async ({ page, recipe }) => {
    await page.goto(`/brygg/ny?oppskrift=${recipe.id}`);
    await page.getByRole("button", { name: "Neste" }).click();

    const volume = page.getByRole("textbox", { name: "Batchvolum (L)" });
    await volume.fill("0");
    await expect(page.getByText("Skriv inn et volum mellom 1 og 10 000 L")).toBeVisible();
    await expect(page.getByRole("button", { name: "Neste" })).toBeDisabled();

    // Norwegian decimal comma is accepted.
    await volume.fill("22,5");
    await expect(page.getByRole("button", { name: "Neste" })).toBeEnabled();
    await page.getByRole("button", { name: "Neste" }).click();
    await page.getByRole("button", { name: "Tilbake" }).click();
    await expect(volume).toHaveValue("22,5");
  });

  test("Ny batch på Brygg og Opprett batch på oppskriften åpner veiviseren", async ({ page, recipe }) => {
    await page.goto("/brygg");
    await page.getByRole("link", { name: "Ny batch" }).click();
    await expect(page).toHaveURL(/\/brygg\/ny$/);
    await expect(page.getByRole("heading", { name: "Ny batch", level: 1 })).toBeVisible();

    await page.goto(recipe.path);
    await page.getByRole("link", { name: "Opprett batch" }).click();
    await expect(page).toHaveURL(new RegExp(`/brygg/ny\\?oppskrift=${recipe.id}$`));
    await expect(page.getByRole("combobox", { name: "Oppskrift" })).toHaveValue(recipe.id);
  });
});
