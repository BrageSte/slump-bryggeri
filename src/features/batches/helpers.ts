import type { BrewDayLogEntry, TargetValue } from "../../domain/brew-day/state.ts";
import type { TimelineItem } from "../../domain/model/api.ts";
import { measurementFromCanonical } from "../../domain/brewing-calculations/measurement-units.ts";
import { batchStatusLabels, measurementKindSpecs, type BatchStatus, type MeasurementKind } from "../../domain/model/brewing.ts";
import type { Tone } from "../../design-system/index.ts";
import { formatNumber, formatSg } from "../../lib/format.ts";

export function toBrewDayLog(items: TimelineItem[]): BrewDayLogEntry[] {
  return items.map((item) => ({
    type: item.type,
    stage: item.stage,
    splitId: item.splitId,
    occurredAt: item.occurredAt,
    data: item.data,
    measurement: item.measurement
      ? {
          kind: item.measurement.kind,
          value: item.measurement.value,
          valueMin: item.measurement.valueMin,
          valueMax: item.measurement.valueMax,
        }
      : null,
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

export function formatMeasurementInUnit(kind: MeasurementKind, value: number, unit: string): string {
  if (unit === "SG") return formatSg(value);
  const decimals = unit === "pH" ? 2 : ["°P", "°Bx", "°C", "°F", "US gal", "kg", "oz", "lb", "psi"].includes(unit) ? 1 : measurementKindSpecs[kind].decimals;
  return formatNumber(value, decimals);
}

export function formatMeasurementRange(kind: MeasurementKind, min: number, max: number, unit: string): string {
  if (kind === "ph") return `${formatNumber(min, 1)}–${formatNumber(max, 1)}`;
  return `${formatMeasurementInUnit(kind, min, unit)}–${formatMeasurementInUnit(kind, max, unit)}`;
}

export function formatTarget(kind: MeasurementKind, target: TargetValue): string {
  if (target.kind === "range") return `${formatMeasurement(kind, target.min)}–${formatMeasurement(kind, target.max)}`;
  return formatMeasurement(kind, target.value);
}

export function formatTargetInUnit(kind: MeasurementKind, target: TargetValue, unit: string): string {
  const convert = (value: number) => kind === "custom" ? value : measurementFromCanonical(kind, value, unit) ?? value;
  if (target.kind === "range") return `${formatMeasurementInUnit(kind, convert(target.min), unit)}–${formatMeasurementInUnit(kind, convert(target.max), unit)} ${unit}`;
  return `${formatMeasurementInUnit(kind, convert(target.value), unit)} ${unit}`;
}

/** SG typed as "1061" or "61" is expanded to 1.061. */
export function normalizeMeasurementValue(kind: MeasurementKind, value: number): number {
  if (kind === "sg") {
    if (value >= 1000 && value < 1200) return value / 1000;
    if (value >= 2 && value < 200 && Number.isInteger(value)) return 1 + value / 1000;
  }
  return value;
}
