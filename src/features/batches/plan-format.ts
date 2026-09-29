import type { BrewPlanItem, BrewPlanPhase, PlanQuantity } from "../../domain/brew-day/brew-plan.ts";
import { formatAmount, formatNumber, formatSg } from "../../lib/format.ts";

/**
 * Recipe values are unprefixed; calculations get "≈" and assumptions "≈ … antatt". Which
 * assumptions were used is listed once in the assumptions sheet, not on every number.
 */
export function withSource(source: PlanQuantity["source"], text: string, compact = false): string {
  if (source === "recipe") return text;
  return source === "calculated" || compact ? `≈ ${text}` : `≈ ${text} antatt`;
}

export function quantity(q: PlanQuantity | undefined, unit: string, decimals = 1, compact = false): string | null {
  if (!q) return null;
  const formatted = unit === "SG" ? formatSg(q.value) : formatNumber(q.value, decimals);
  return withSource(q.source, `${formatted}${unit === "SG" ? "" : ` ${unit}`}`, compact);
}

export function temperature(q: PlanQuantity | undefined, maxC?: number, compact = false): string | null {
  if (!q) return null;
  if (maxC !== undefined && maxC !== q.value) {
    return withSource(q.source, `${formatNumber(q.value, 1)}–${formatNumber(maxC, 1)} °C`, compact);
  }
  return quantity(q, "°C", 1, compact);
}

function planItemDetails(item: BrewPlanItem, compact: boolean): string[] {
  return [
    item.timing ?? null,
    temperature(item.temperatureC, item.temperatureMaxC, compact),
    item.durationMin !== undefined ? `${formatNumber(item.durationMin, 0)} min` : null,
    item.durationDays !== undefined ? `${formatNumber(item.durationDays, 0)} ${item.durationDays === 1 ? "dag" : "dager"}` : null,
    quantity(item.volumeL, "L", 1, compact),
    quantity(item.gravitySg, "SG", 1, compact),
  ].filter((detail): detail is string => detail !== null);
}

/** The details shown under an item in an open phase, e.g. "60 min · 80,0 °C". */
export function planItemDetail(item: BrewPlanItem): string[] {
  return planItemDetails(item, false);
}

/** One short line for an item: "65 g Simcoe T90 60 min" or "Mesk 66,5 °C, 60 min". */
export function planItemSummary(item: BrewPlanItem): string {
  const name = item.amount ? `${formatAmount(item.amount.value, item.amount.unit)} ${item.title}` : item.title;
  const variant = item.variant ? ` (${item.variant})` : "";
  const details = planItemDetails(item, true);
  return details.length > 0 ? `${name}${variant} ${details.join(", ")}` : `${name}${variant}`;
}

/**
 * What a collapsed phase shows under its title, so upcoming steps are readable without opening them:
 * the first few items, then "+N til".
 */
export function phasePreview(phase: Pick<BrewPlanPhase, "items">, maxItems = 3): string {
  const shown = phase.items.slice(0, maxItems).map(planItemSummary);
  const rest = phase.items.length - shown.length;
  return rest > 0 ? `${shown.join(" · ")} · +${rest} til` : shown.join(" · ");
}
