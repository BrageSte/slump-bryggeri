import { expect, test } from "./fixtures.ts";

/**
 * Water chemistry on a phone: the Water page, planning a salt in a recipe and registering it on brew
 * day, and logging pH with its sample point, temperature and instrument. The numbers behind them are
 * covered by unit and integration tests; these check that the screens wire them up.
 */
test.describe("vann og pH på mobil", () => {
  test("Vann-siden viser kildevannet med kilde og dato, og holder oppgitt, beregnet og veiledning fra hverandre", async ({ page }) => {
    await page.goto("/mer");
    await page.getByRole("link", { name: /^Vann/ }).click();
    await expect(page.getByRole("heading", { name: "Vann", level: 1 })).toBeVisible();

    await expect(page.getByRole("heading", { name: /Holsfjorden/ })).toBeVisible();
    await expect(page.getByText("Svært bløtt", { exact: true })).toBeVisible();
    // The main card and the folded «Øvrige oppgitte verdier» card are both reported values.
    await expect(page.getByText("Oppgitt (kilde)", { exact: true })).toHaveCount(2);
    await expect(page.getByText("Beregnet", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Mål / anbefaling", { exact: true })).toBeVisible();

    const source = page.getByRole("link", { name: "Åpne kilden" });
    await expect(source).toHaveAttribute("href", "https://www.abvann.no/temasider/vannkvalitet");
    await expect(page.getByText(/Hentet 2026-10-01\. Kilden oppgir ingen prøvedato\./)).toBeVisible();
    await expect(page.getByText(/Veiledende vinduer fra bryggelitteratur, ikke regler/)).toBeVisible();
    await expect(page.getByText(/Kalsium \(6,6 mg\/L\) ligger under det vanlige vinduet på 50–150 mg\/L/)).toBeVisible();

    // Brage's confirmation is shown, and the source's other 22 values are there but folded away.
    await expect(page.getByText("Bekreftet i bruk", { exact: true })).toBeVisible();
    await expect(page.getByText(/Bekreftet av Brage 2026-10-01: Vannet Slump bruker kommer fra Holsfjorden/)).toBeVisible();
    // The supplier's numbers keep the precision it published: 6,6, not 6,60.
    await expect(page.getByText(/^6,6\s*mg\/L$/)).toBeVisible();
    await expect(page.getByText("6,60")).toHaveCount(0);
    const others = page.getByText("Vis alle 22 verdier fra ABV");
    await expect(others).toBeVisible();
    await expect(page.getByText("0,53 mg/L", { exact: true })).toBeHidden();
    await others.click();
    await expect(page.getByText("0,53 mg/L", { exact: true })).toBeVisible();
    await expect(page.getByText("0,0005 µg/L", { exact: true })).toBeVisible();
    await expect(page.getByText("Grenseverdi: 1 µg/L")).toBeVisible();
    await expect(page.getByText(/Alle 16 verdier med tallfestet grenseverdi ligger under den\./)).toBeVisible();

    // Nothing may force a sideways scroll on the phone.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: "test-results/water-page.png", fullPage: true });
  });

  test("oversikten før start viser vannet: frosset kildevann, mesk-pH-mål og planlagte salter", async ({ page, batch }) => {
    await page.goto(batch.path);
    const card = page.locator("section").filter({ has: page.getByRole("heading", { name: "Vann", exact: true }) });
    await expect(card.getByText("Kildevann frosset")).toBeVisible();
    await expect(card.getByText("Oppgitt (kilde)")).toBeVisible();
    await expect(card.getByText(/Holsfjorden/)).toBeVisible();
    await expect(card.getByText(/Ca 6,6 · Mg 0,89 · Na 2,7 · Cl 2,5 · SO₄ 3,4 · HCO₃ 16,5 mg\/L/)).toBeVisible();
    await expect(card.getByText(/Mesk-pH 5,2–5,4/)).toBeVisible();
    await expect(card.getByText("Ingen planlagt vannprofil i oppskriften.")).toBeVisible();
    await expect(card.getByText(/kalsium må vanligvis tilsettes/)).toBeVisible();
    await card.getByRole("link", { name: "Vann" }).click();
    await expect(page).toHaveURL(/\/mer\/vann$/);
  });

  test("planlegg et salt i oppskriften, registrer det på bryggedagen, og se hva som ble tilsatt", async ({ page, recipe, request }) => {
    await page.goto(`${recipe.path}/rediger`);

    await test.step("målprofil og et salt i oppskriften", async () => {
      await page.getByLabel("Navn på planen (valgfritt)").fill("Kloridfremhevet");
      await page.getByLabel("Kalsium (Ca)").fill("100");
      await page.getByLabel("Klorid (Cl)").fill("150");

      await page.getByRole("button", { name: "Legg til tilsetning" }).click();
      // Sunset has other additions already; the one just added is the last card in the section.
      const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "Andre tilsetninger" }) });
      const last = section.locator("div.rounded-md.border").last();
      await last.getByLabel("Navn").fill("Gips");
      await last.getByLabel("Mengde").fill("10");
      await last.getByLabel("Enhet").fill("g");
      await last.getByLabel("Bruk").selectOption("mash");
      await last.getByLabel("Salt eller syre i vannet").selectOption("gypsum");
      await page.getByRole("button", { name: "Lagre ny versjon" }).click();

      await expect(page).toHaveURL(new RegExp(`${recipe.path}$`));
      await expect(page.getByText(/Vann · mål \/ anbefaling/i)).toBeVisible();
      await expect(page.getByText("Kloridfremhevet")).toBeVisible();
      await expect(page.getByText(/Ca 100 · Cl 150 mg\/L/)).toBeVisible();
      await expect(page.getByText(/Salt: Gips/)).toBeVisible();
    });

    const me = (await (await request.get("/api/me")).json()) as { memberships: { brewery: { id: string } }[] };
    const created = await request.post(`/api/breweries/${me.memberships[0]!.brewery.id}/batches`, { data: { recipeId: recipe.id } });
    expect(created.status()).toBe(201);
    const { id } = (await created.json()) as { id: string };

    await page.goto(`/batcher/${id}`);
    await page.getByRole("button", { name: "Start brygg" }).click();
    await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();

    await test.step("saltet kan registreres fra planen, og loggen sier hvilket middel det var", async () => {
      const gips = page.getByRole("listitem").filter({ hasText: "10 g Gips" });
      await gips.getByRole("button", { name: "Tilsett" }).click();
      const sheet = page.getByRole("dialog", { name: "Tilsetning" });
      await expect(sheet.getByLabel("Salt eller syre i vannet")).toHaveValue("gypsum");
      await sheet.getByRole("textbox", { name: "Mengde" }).fill("11");
      await sheet.getByRole("button", { name: "Registrer tilsetning" }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: /Tilsatt: 11 g Gips/ })).toBeVisible();
      await expect(page.getByText("Salt: Gips", { exact: true })).toBeVisible();
    });

    await test.step("bryggedokumentet har en egen vann-seksjon med salt og kilde", async () => {
      await page.getByRole("button", { name: "Bryggedokument" }).click();
      const section = page.getByRole("button", { name: "Vann og pH" });
      await section.click();
      await expect(page.getByText(/Planlagt: 10 g Gips.* — TILSATT/)).toBeVisible();
      await expect(page.getByText(/Frosset i batchen|Profilen er frosset i batchen/)).toBeVisible();
    });
  });

  test("pH logges med prøvepunkt, temperatur og instrument, og en varm prøve dømmes ikke mot målet", async ({ page, batch }) => {
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start brygg" }).click();
    await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Logg mesk-ph" }).click();
    const sheet = page.getByRole("dialog", { name: "Mesk-pH" });

    await test.step("punktet leses fra steget, og pH legges inn som enkeltverdi", async () => {
      await expect(sheet.getByRole("button", { name: "Mesk", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect(sheet.getByRole("button", { name: "Før kok" })).toHaveAttribute("aria-pressed", "false");
      await sheet.getByRole("button", { name: "Enkeltverdi" }).click();
      await sheet.getByRole("textbox", { name: "pH", exact: true }).fill("5,00");
    });

    await test.step("en varm prøve er «Usikker», ikke «Lav»", async () => {
      await sheet.getByLabel("Prøvetemperatur (°C)").fill("62");
      await expect(sheet.getByText("Usikker", { exact: true })).toBeVisible();
      await expect(sheet.getByText(/Varm prøve \(over 35 °C\)/)).toBeVisible();
      await sheet.getByLabel("Prøvetemperatur (°C)").fill("22");
      await expect(sheet.getByText("Lav", { exact: true })).toBeVisible();
      await sheet.getByRole("textbox", { name: "pH", exact: true }).fill("5,3");
      await expect(sheet.getByText("OK", { exact: true })).toBeVisible();
      await expect(sheet.getByText(/Mål helst en avkjølt prøve/)).toBeVisible();
    });

    await test.step("instrument velges og målingen loggføres med alt", async () => {
      await sheet.getByLabel("Instrument").selectOption("pH-meter");
      await page.screenshot({ path: "test-results/ph-sheet.png" });
      await sheet.getByRole("button", { name: /^Logg ph$/i }).click();
      await expect(sheet).toBeHidden();
      const entry = page.getByRole("button", { name: /5,30.*Prøve 22,0 °C.*Instrument: pH-meter/ });
      await expect(entry).toBeVisible();
    });

    await test.step("en varm avlesning vises som Usikker i stegkortet", async () => {
      await page.getByRole("button", { name: "Logg mesk-ph" }).click();
      const second = page.getByRole("dialog", { name: "Mesk-pH" });
      await second.getByRole("button", { name: "Enkeltverdi" }).click();
      await second.getByRole("textbox", { name: "pH", exact: true }).fill("5,0");
      await second.getByLabel("Prøvetemperatur (°C)").fill("63");
      await second.getByRole("button", { name: /^Logg ph$/i }).click();
      await expect(second).toBeHidden();
      await expect(page.getByText("Usikker", { exact: true })).toBeVisible();
    });
  });

  test("pH før kok velges som punkt og får en merkelapp som leses tilbake", async ({ page, batch, request }) => {
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start brygg" }).click();
    await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();

    // The log menu offers pH in any stage; pick the point there.
    await page.getByRole("button", { name: "Logg", exact: true }).first().click();
    await page.getByRole("button", { name: "pH", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "pH" });
    await sheet.getByRole("button", { name: "Før kok" }).click();
    await sheet.getByRole("button", { name: "Enkeltverdi" }).click();
    await sheet.getByRole("textbox", { name: "pH", exact: true }).fill("3,8");
    await sheet.getByRole("button", { name: /^Logg ph$/i }).click();
    await expect(sheet).toBeHidden();

    const me = (await (await request.get("/api/me")).json()) as { memberships: { brewery: { id: string } }[] };
    const timeline = (await (await request.get(`/api/breweries/${me.memberships[0]!.brewery.id}/batches/${batch.id}/timeline`)).json()) as {
      stage: string | null;
      measurement: { kind: string; label: string | null; value: number } | null;
    }[];
    const ph = timeline.find((item) => item.measurement?.kind === "ph");
    expect(ph?.measurement).toMatchObject({ value: 3.8, label: "pH før kok" });
    expect(ph?.stage).toBe("mash");
  });
});
