import { expect, test } from "./fixtures.ts";

/**
 * The brew-day flow on a phone: start the mash, log a temperature, read the mash tip, register an
 * addition from the brew plan and start a timer. Numbers that come from the calculations are covered
 * by unit tests; these tests check that the screens wire them up and that everything is reachable.
 */
test.describe("bryggedagen på mobil", () => {
  test("mesk, temperatur, mesketips, tilsetning og timer", async ({ page, batch }) => {
    await page.goto(batch.path);

    await test.step("start mesking", async () => {
      await expect(page.getByRole("heading", { name: batch.name, level: 1 })).toBeVisible();
      await page.getByRole("button", { name: "Start mesking" }).click();
      await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();
      await expect(page.getByText("Mesk · 66,5 °C", { exact: true })).toBeVisible();
      await expect(page.getByText("Ikke målt").first()).toBeVisible();
    });

    await test.step("logg en for lav mesketemperatur", async () => {
      await page.getByRole("button", { name: "Logg mesketemperatur" }).click();
      const sheet = page.getByRole("dialog", { name: "Mesketemperatur" });
      await sheet.getByRole("textbox", { name: "Temperatur" }).fill("62,0");
      await sheet.getByRole("button", { name: "Logg temperatur" }).click();
      await expect(sheet).toBeHidden();
      await expect(page.getByText("Lav", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /62,0°C Temperatur · Mesketemperatur/ })).toBeVisible();
    });

    await test.step("mesketipset foreslår varmt vann, som kan loggføres", async () => {
      await expect(page.getByText(/^Tilsett ca\. [\d,]+ L vann på 95 °C for å nå 66,5 °C$/)).toBeVisible();
      await page.getByRole("button", { name: "Velg vann på 100 °C" }).click();
      await expect(page.getByText(/^Tilsett ca\. [\d,]+ L vann på 100 °C for å nå 66,5 °C$/)).toBeVisible();

      await page.getByRole("button", { name: "Logg tilsatt vann" }).click();
      await expect(page.getByText(/L vann tilsatt kl\. \d{2}:\d{2}\. Rør om og logg mesketemperaturen på nytt/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Logg tilsatt vann" })).toBeHidden();
      await expect(page.getByRole("button", { name: /Vann tilsatt: [\d,]+ L ved 100 °C/ })).toBeVisible();
    });

    await test.step("registrer en tilsetning fra bryggeplanen", async () => {
      // Kok is a coming phase, so it is folded; a tap opens it and the addition can be registered early.
      const kok = page.getByRole("button", { name: /^Kok .*0\/1 tilsatt/ });
      await expect(kok).toHaveAttribute("aria-expanded", "false");
      await kok.click();
      await expect(kok).toHaveAttribute("aria-expanded", "true");
      const simcoe = page.getByRole("listitem").filter({ hasText: "65 g Simcoe T90" });
      await simcoe.getByRole("button", { name: "Tilsett" }).click();

      const sheet = page.getByRole("dialog", { name: "Tilsetning" });
      await expect(sheet.getByRole("textbox", { name: "Navn" })).toHaveValue("Simcoe T90");
      await expect(sheet.getByRole("textbox", { name: "Mengde" })).toHaveValue("65");
      await sheet.getByRole("button", { name: "Registrer tilsetning" }).click();

      await expect(sheet).toBeHidden();
      await expect(page.getByRole("button", { name: /^Kok .*1\/1 tilsatt/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /Tilsatt: 65 g Simcoe T90/ })).toBeVisible();
    });

    await test.step("start en timer som overlever en omlasting", async () => {
      await page.getByRole("button", { name: "Ny timer" }).click();
      await page.getByRole("button", { name: "10 min", exact: true }).click();
      await expect(page.getByRole("button", { name: "10 min", exact: true })).toBeHidden();
      await expect(page.getByRole("button", { name: "Stopp 10 min" })).toBeVisible();
      await expect(page.getByText(/^(10:00|9:\d{2})$/)).toBeVisible();

      // Timers are events in the shared log, so another phone (or a reload) sees the same countdown.
      await page.reload();
      await expect(page.getByRole("button", { name: "Stopp 10 min" })).toBeVisible();
      await expect(page.getByText(/^9:\d{2}$/)).toBeVisible();

      await page.getByRole("button", { name: "Stopp 10 min" }).click();
      await expect(page.getByRole("button", { name: "Stopp 10 min" })).toBeHidden();
    });
  });

  test("ingen mesketips når temperaturen er på mål", async ({ page, batch }) => {
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start mesking" }).click();

    await page.getByRole("button", { name: "Logg mesketemperatur" }).click();
    const sheet = page.getByRole("dialog", { name: "Mesketemperatur" });
    await sheet.getByRole("textbox", { name: "Temperatur" }).fill("66,5");
    await sheet.getByRole("button", { name: "Logg temperatur" }).click();
    await expect(sheet).toBeHidden();

    // Wait for the reading to be shown before checking that the tip is absent.
    await expect(page.getByText("OK", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /66,5°C Temperatur · Mesketemperatur/ })).toBeVisible();
    await expect(page.getByText(/^Tilsett ca\./)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Logg tilsatt vann" })).toHaveCount(0);
  });

  test("aktivt steg øverst, resten av brygget som oversikt under", async ({ page, batch }) => {
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start mesking" }).click();
    await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();

    await test.step("aktivt steg, neste og timere kommer før planen og loggen", async () => {
      const top = async (name: string) => {
        const box = await page.getByRole("heading", { name, level: 2, exact: true }).first().boundingBox();
        expect(box, `${name} is laid out`).not.toBeNull();
        return box!.y;
      };
      const [step, next, timers, plan, log] = [await top("Mesk"), await top("Neste"), await top("Timere"), await top("Bryggeplan"), await top("Logg")];
      expect(step).toBeLessThan(next);
      expect(next).toBeLessThan(timers);
      expect(timers).toBeLessThan(plan);
      expect(plan).toBeLessThan(log);
    });

    await test.step("bare gjeldende fase er åpen, kommende faser viser hva de inneholder", async () => {
      await expect(page.getByRole("button", { name: /^Mesk Nå/ })).toHaveAttribute("aria-expanded", "true");
      const whirlpool = page.getByRole("button", { name: /^Whirlpool Senere/ });
      await expect(whirlpool).toHaveAttribute("aria-expanded", "false");
      await expect(whirlpool).toContainText("84,6 g Citra T90");
      await expect(page.getByRole("button", { name: /^Gjæring Senere/ })).toHaveAttribute("aria-expanded", "false");
    });

    await test.step("antakelsene ligger i ett ark, ikke i planen", async () => {
      await expect(page.getByText(/^Antakelser i planen$/)).toHaveCount(0);
      await page.getByRole("button", { name: /verdier er antatt/ }).click();
      const sheet = page.getByRole("dialog", { name: "Antakelser i planen" });
      await expect(sheet.getByText(/^Fordampning:/)).toBeVisible();
      await expect(sheet.getByText(/^Mesketykkelse:/)).toBeVisible();
      await sheet.getByRole("button", { name: "Lukk" }).click();
      await expect(sheet).toBeHidden();
    });
  });

  test("bryggedokumentet ligger sammenbrettet og åpnes fra batchmenyen", async ({ page, batch }) => {
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start mesking" }).click();
    await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();

    const document = page.getByRole("button", { name: /^Bryggedokument/ });
    await expect(document).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: "Status nå" })).toHaveCount(0);

    await page.getByRole("button", { name: "Flere valg" }).click();
    await page.getByRole("dialog", { name: "Batch" }).getByRole("button", { name: "Bryggedokument" }).click();

    await expect(document).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("button", { name: "Status nå" })).toBeVisible();
  });
});
