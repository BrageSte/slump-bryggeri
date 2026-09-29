import {
  getProfileParameter,
  type ProfileParameterKey,
  type ProfileValues,
  type ProfileValueSources,
} from "../model/equipment-profile.ts";

/**
 * What the brewer should know about the equipment profile frozen into a batch before starting: the
 * values that shape the brew day, where each came from, and what to be careful about. Read-only —
 * a profile is changed as a new version under Kalibrering, never per batch.
 */

/** `calibrated` = measured/calibrated, `manual` = typed in, `assumed` = a documented default, `missing` = no value and no default. */
export type EquipmentValueStatus = "calibrated" | "manual" | "assumed" | "missing";

export interface EquipmentOverviewRow {
  key: ProfileParameterKey;
  label: string;
  unit: string;
  value: number | null;
  status: EquipmentValueStatus;
}

export interface EquipmentOverview {
  rows: EquipmentOverviewRow[];
  /** Norwegian sentences about what to be careful about, most important first. Empty when nothing stands out. */
  warnings: string[];
}

/** The values that matter most on brew day, in the order they are shown. */
export const equipmentOverviewKeys = [
  "batch_volume_l",
  "brewhouse_efficiency_pct",
  "boil_off_l_per_h",
  "mash_thickness_l_per_kg",
  "grain_absorption_l_per_kg",
  "strike_temp_offset_c",
] as const satisfies readonly ProfileParameterKey[];

function statusOf(key: ProfileParameterKey, values: ProfileValues, sources: ProfileValueSources | undefined): EquipmentValueStatus {
  const source = sources?.[key];
  const hasDefault = getProfileParameter(key)?.defaultValue !== undefined;
  if (source === "default" || (values[key] === undefined && hasDefault)) return "assumed";
  if (values[key] === undefined) return "missing";
  // Snapshots from before sources were stored only kept explicit values: those were typed in.
  return source === "calibration" ? "calibrated" : "manual";
}

/** "Fordampning", "Brygghuseffektivitet og fordampning", "Brygghuseffektivitet, fordampning og 3 til". */
function names(labels: string[]): string {
  const lower = labels.map((label) => label.toLowerCase());
  const text = lower.length <= 2 ? lower.join(" og ") : `${lower.slice(0, 2).join(", ")} og ${lower.length - 2} til`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function equipmentOverview({
  values,
  sources,
  recipeBatchSizeL,
}: {
  values: ProfileValues;
  sources?: ProfileValueSources;
  recipeBatchSizeL: number;
}): EquipmentOverview {
  const rows = equipmentOverviewKeys.map((key): EquipmentOverviewRow => {
    const parameter = getProfileParameter(key);
    const status = statusOf(key, values, sources);
    return {
      key,
      label: parameter?.label ?? key,
      unit: parameter?.unit ?? "",
      value: status === "missing" ? null : (values[key] ?? parameter?.defaultValue ?? null),
      status,
    };
  });

  const warnings: string[] = [];
  const assumed = rows.filter((row) => row.status === "assumed").map((row) => row.label);
  if (assumed.length > 0) {
    warnings.push(
      assumed.length === 1
        ? `${names(assumed)} er en standardverdi, ikke målt. Planen bruker den til du har målt.`
        : `${names(assumed)} er standardverdier, ikke målt. Planen bruker dem til du har målt.`,
    );
  }
  const batchVolume = rows.find((row) => row.key === "batch_volume_l");
  if (batchVolume?.value != null && Math.abs(batchVolume.value - recipeBatchSizeL) > 0.5) {
    warnings.push(`Oppskriften gjelder ${recipeBatchSizeL} L, men utstyret er satt opp for ${batchVolume.value} L.`);
  }
  return { rows, warnings };
}
