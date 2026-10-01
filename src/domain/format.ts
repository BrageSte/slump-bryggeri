/**
 * Small formatting helpers shared by domain modules that produce Norwegian text (the brew
 * document, calibration review, brewery history and BeerSmith import). Kept separate from
 * `src/lib/format.ts`, which domain code must not import (AGENTS.md).
 */

/** Rounds to a fixed number of decimals (plain `Math.round`, not banker's rounding). */
export function round(value: number, decimals: number): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals;
}

/** Norwegian (bokmål) decimal formatting, e.g. `num(1.5)` → "1,5". */
export function num(value: number, decimals = 1): string {
  return value.toLocaleString("nb-NO", { maximumFractionDigits: decimals });
}

const TIME_ZONE = "Europe/Oslo";

/** Norwegian date and time in the brewery's time zone, e.g. "23.09.2026, 13:25". */
export function dateTimeOslo(timestamp: number): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}
