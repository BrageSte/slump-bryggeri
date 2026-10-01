import type { TimelineItem } from "../model/api.ts";
import type { BrewDayLogEntry } from "./state.ts";

/**
 * Maps a batch's timeline (the API/DB shape) to the brew-day log entries that
 * `deriveBrewDayState`, `brewhouseNumbers` and the brew document build from. One place for the
 * mapping so every consumer sees the same fields (previously duplicated in the UI and in two
 * domain modules).
 */
export function toBrewDayLog(items: TimelineItem[]): BrewDayLogEntry[] {
  return items.map((item) => ({
    id: item.id,
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
          label: item.measurement.label,
          sampleTempC: item.measurement.sampleTempC,
        }
      : null,
  }));
}
