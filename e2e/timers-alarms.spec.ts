import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

/**
 * Countdowns that tick, and an alarm that can be heard. The sound tests replace `AudioContext` with one
 * that follows iOS Safari's rule (checked on iOS 26: `resume()` works inside `touchend`, `click` and
 * `keydown`, not inside `pointerdown`), and count the beeps that would have played.
 */

const seconds = (text: string | null) => {
  const parts = (text ?? "").replace(/\s*igjen$/, "").split(":").map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
};

async function useIosLikeAudio(page: Page, { unlockAllowed }: { unlockAllowed: boolean }) {
  await page.addInitScript((allowed) => {
    const w = window as unknown as { __audio: { beeps: number; allow: boolean }; __gesture: boolean; AudioContext: unknown };
    w.__audio = { beeps: 0, allow: allowed };
    w.__gesture = false;
    // Registered before the app's own listeners, so the flag is set while the app's handler runs.
    for (const type of ["touchend", "click", "keydown"]) {
      window.addEventListener(type, () => {
        w.__gesture = true;
        setTimeout(() => (w.__gesture = false), 0);
      }, { capture: true });
    }
    class FakeAudioContext extends EventTarget {
      state = "suspended";
      currentTime = 0;
      destination = {};
      resume() {
        if (w.__gesture && w.__audio.allow) {
          this.state = "running";
          this.dispatchEvent(new Event("statechange"));
        }
        return Promise.resolve();
      }
      createOscillator() {
        return { frequency: { value: 0 }, connect: (node: unknown) => node, start: () => void (w.__audio.beeps += 1), stop: () => undefined };
      }
      createGain() {
        return { gain: { setValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined }, connect: (node: unknown) => node };
      }
    }
    w.AudioContext = FakeAudioContext;
  }, unlockAllowed);
}

const beeps = (page: Page) => page.evaluate(() => (window as unknown as { __audio: { beeps: number } }).__audio.beeps);

test.describe("nedtelling og alarm på mobil", () => {
  test("nedtellingen i stegkortet teller ned per sekund, ikke bare per minutt", async ({ page, batch }) => {
    await page.clock.install();
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start brygg" }).click();

    const countdown = page.getByText(/^\d+:\d{2}(:\d{2})? igjen$/);
    await expect(countdown).toBeVisible();
    const start = seconds(await countdown.textContent());
    expect(start).toBeGreaterThan(59 * 60);
    expect(start).toBeLessThanOrEqual(60 * 60);

    // The first minute used to read "60 min igjen" throughout. Now every second shows.
    await page.clock.runFor(3_000);
    await expect.poll(async () => seconds(await countdown.textContent())).toBeLessThanOrEqual(start - 2);

    await page.clock.fastForward("10:00");
    await expect.poll(async () => seconds(await countdown.textContent())).toBeLessThanOrEqual(start - 10 * 60);
    // "Neste" counts down to the same moment.
    await expect(page.getByText(/^Om \d+:\d{2}(:\d{2})?$/)).toBeVisible();
  });

  test("en tapp låser opp lyden, alarmen ringer og gjentas til den kvitteres", async ({ page, batch }) => {
    await useIosLikeAudio(page, { unlockAllowed: true });
    await page.clock.install();
    await page.goto(batch.path);

    // The tap on "Start brygg" is the gesture that unlocks the sound.
    await page.getByRole("button", { name: "Start brygg" }).click();
    await expect(page.getByRole("button", { name: "Lyd på" })).toBeVisible();

    await page.getByRole("button", { name: "Ny timer" }).click();
    await page.getByRole("button", { name: "5 min", exact: true }).click();
    await expect(page.getByRole("button", { name: "Stopp 5 min" })).toBeVisible();
    expect(await beeps(page)).toBe(0);

    await page.clock.fastForward("05:05");
    const alarm = page.getByRole("alert");
    await expect(alarm.getByText("5 min er ferdig")).toBeVisible();
    await expect.poll(() => beeps(page)).toBeGreaterThanOrEqual(4);

    // Still unanswered: it rings again.
    const first = await beeps(page);
    await page.clock.fastForward(10_000);
    await expect.poll(() => beeps(page)).toBeGreaterThan(first);

    // Answered: it stops.
    await alarm.getByRole("button", { name: "Kvitter" }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    const answered = await beeps(page);
    await page.clock.fastForward(30_000);
    expect(await beeps(page)).toBe(answered);
  });

  test("blokkert lyd vises som «Aktiver lyd», og ett trykk slår den på uten å slå den av", async ({ page, batch }) => {
    await useIosLikeAudio(page, { unlockAllowed: false });
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start brygg" }).click();

    // The browser has not let the sound start, and the screen does not pretend it has.
    const enable = page.getByRole("button", { name: "Aktiver lyd" });
    await expect(enable).toBeVisible();
    await expect(page.getByRole("button", { name: "Lyd på" })).toHaveCount(0);
    expect(await beeps(page)).toBe(0);

    // From here on the browser allows it. The tap starts the sound and beeps once, and leaves it on.
    await page.evaluate(() => void ((window as unknown as { __audio: { allow: boolean } }).__audio.allow = true));
    await enable.click();
    await expect.poll(() => beeps(page)).toBeGreaterThanOrEqual(4);
    const on = page.getByRole("button", { name: "Lyd på" });
    await expect(on).toBeVisible();
    await expect(on).toHaveAttribute("aria-pressed", "true");

    // Tapping it again turns the sound off, and off stays off.
    await on.click();
    await expect(page.getByRole("button", { name: "Lyd av" })).toHaveAttribute("aria-pressed", "false");
  });

  test("blokkert lyd vises også i alarmen, og knappen der slår lyden på", async ({ page, batch }) => {
    await useIosLikeAudio(page, { unlockAllowed: false });
    await page.clock.install();
    await page.goto(batch.path);
    await page.getByRole("button", { name: "Start brygg" }).click();
    await page.getByRole("button", { name: "Ny timer" }).click();
    await page.getByRole("button", { name: "5 min", exact: true }).click();

    await page.clock.fastForward("05:05");
    const alarm = page.getByRole("alert");
    await expect(alarm.getByText("5 min er ferdig")).toBeVisible();
    expect(await beeps(page)).toBe(0);

    await page.evaluate(() => void ((window as unknown as { __audio: { allow: boolean } }).__audio.allow = true));
    await alarm.getByRole("button", { name: "Aktiver lyd" }).click();
    await expect.poll(() => beeps(page), { timeout: 3_000 }).toBeGreaterThanOrEqual(4);
    await expect(page.getByRole("button", { name: "Lyd på" })).toBeVisible();
    await expect(alarm.getByRole("button", { name: "Aktiver lyd" })).toHaveCount(0);
  });
});
