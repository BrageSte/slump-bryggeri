import type { BrewDayLogEntry, TargetValue } from "../../domain/brew-day/state.ts";
import type { TimelineItem } from "../../domain/model/api.ts";
import { batchStatusLabels, measurementKindSpecs, type BatchStatus, type MeasurementKind } from "../../domain/model/brewing.ts";
import type { Tone } from "../../design-system/index.ts";
import { formatNumber, formatSg } from "../../lib/format.ts";

export function toBrewDayLog(items: TimelineItem[]): BrewDayLogEntry[] {
  return items.map((item) => ({
    type: item.type,
    stage: item.stage,
    occurredAt: item.occurredAt,
    data: item.data,
    measurement: item.measurement ? { kind: item.measurement.kind, value: item.measurement.value } : null,
  }));
}

export const statusTones: Record<BatchStatus, Tone> = {
  planned: "neutral",
  brewing: "accent",
  fermenting: "info",
  conditioning: "primary",
  completed: "success",
};

export function statusLabel(status: BatchStatus): string {
  return batchStatusLabels[status];
}

export function formatMeasurement(kind: MeasurementKind, value: number): string {
  if (kind === "sg") return formatSg(value);
  return formatNumber(value, measurementKindSpecs[kind].decimals);
}

export function formatTarget(kind: MeasurementKind, target: TargetValue): string {
  if (target.kind === "range") return `${formatMeasurement(kind, target.min)}–${formatMeasurement(kind, target.max)}`;
  return formatMeasurement(kind, target.value);
}

/** SG typed as "1061" or "61" is expanded to 1.061. */
export function normalizeMeasurementValue(kind: MeasurementKind, value: number): number {
  if (kind === "sg") {
    if (value >= 1000 && value < 1200) return value / 1000;
    if (value >= 2 && value < 200 && Number.isInteger(value)) return 1 + value / 1000;
  }
  return value;
}
