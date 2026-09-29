import { bottomNav, expect, test } from "./fixtures.ts";

/**
 * On a phone, Veileder and Logg float above the bottom navigation. They were once partly hidden behind
 * it: the fixed offset ignored the iPhone home-indicator inset, which the navigation adds as padding.
 * So the test emulates that inset and checks that both buttons sit clear of the navigation and can
 * actually be tapped (the offset is `5rem + env(safe-area-inset-bottom)` in VeilederPanel.tsx and
 * BatchPage.tsx).
 */
const IPHONE_HOME_INDICATOR_PX = 34;

test.describe("flytende knapper på mobil", () => {
  test("Veileder og Logg ligger over bunnmenyen og kan trykkes", async ({ page, batch }) => {
    // Chromium-only DevTools call; it needs viewport-fit=cover, which index.html sets.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 0, left: 0, bottom: IPHONE_HOME_INDICATOR_PX, right: 0 } });

    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start mesking" }).click();
    await expect(page.getByText("Brygger nå", { exact: true })).toBeVisible();

    const nav = await bottomNav(page).boundingBox();
    const veileder = page.getByRole("button", { name: /^Åpne Veileder/ });
    // The brew document has collapsible sections called "Logg" too; the floating button is in a fixed wrapper.
    const logg = page.locator(".fixed").getByRole("button", { name: "Logg", exact: true });

    for (const button of [veileder, logg]) {
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box, "button is laid out").not.toBeNull();
      expect(nav, "bottom navigation is laid out").not.toBeNull();
      expect(box!.y + box!.height).toBeLessThanOrEqual(nav!.y);
      expect(box!.height, "touch target of at least 44 px").toBeGreaterThanOrEqual(44);
    }

    // Playwright only clicks an element that receives the click, so this fails if something covers it.
    await logg.click();
    await expect(page.getByRole("dialog", { name: /logg/i })).toBeVisible();
    await page.getByRole("button", { name: "Lukk" }).click();

    await veileder.click();
    await expect(page.getByRole("dialog", { name: "Veileder" })).toBeVisible();
  });
});
