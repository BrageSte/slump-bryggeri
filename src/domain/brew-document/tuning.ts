import { suggestStrikeOffsetFromMash } from "../brewing-calculations/index.ts";
import { brewhouseNumbers } from "../brew-day/outcome.ts";
import type { BrewDayLogEntry } from "../brew-day/state.ts";
import type { BatchDetail, TimelineItem } from "../model/api.ts";
import { profileValue, type ProfileParameterKey } from "../model/equipment-profile.ts";

/**
 * What one batch's own measurements say about the brewery's calibration (M10). Boil-off and
 * brewhouse efficiency come from `brewhouseNumbers` (the same "bryggeri-tall" as the result page);
 * the strike offset is added here. Each observation names the profile value it points to, the
 * observed figure and the evidence. Nothing is applied: an admin decides, and one batch is weak
 * evidence. Missing measurements are listed instead of guessed.
 */

export interface CalibrationObservation {
  profileKey: ProfileParameterKey;
  label: string;
  unit: string;
  observed: number;
  /** Value in the batch's equipment snapshot (or the parameter default). */
  current: number | undefined;
  /** Suggested new profile value when it differs from `observed` (e.g. an offset). */
  suggested?: number;
  basis: string;
}

export interface CalibrationReview {
  observations: CalibrationObservation[];
  /** Observations that could not be made, and what to measure next time. */
  missing: string[];
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const num = (value: number, decimals = 1) => value.toLocaleString("nb-NO", { maximumFractionDigits: decimals });

function toLog(timeline: TimelineItem[]): BrewDayLogEntry[] {
  return timeline.map((item) => ({
    id: item.id,
    type: item.type,
    stage: item.stage,
    splitId: item.splitId,
    occurredAt: item.occurredAt,
    data: item.data,
    measurement: item.measurement
      ? { kind: item.measurement.kind, value: item.measurement.value, valueMin: item.measurement.valueMin, valueMax: item.measurement.valueMax }
      : null,
  }));
}

export function reviewCalibration({ batch, timeline }: { batch: BatchDetail; timeline: TimelineItem[] }): CalibrationReview {
  const recipe = batch.recipeSnapshot;
  const values = batch.equipmentSnapshot.values;
  const observations: CalibrationObservation[] = [];
  const missing: string[] = [];
  const numbers = brewhouseNumbers({ recipe, log: toLog(timeline), splits: batch.splits, wcf: values.refractometer_wcf });

  if (numbers.boilOffLPerHour !== null && numbers.preBoilVolumeL !== null && numbers.postBoilVolumeL !== null) {
    observations.push({
      profileKey: "boil_off_l_per_h",
      label: "Fordampning",
      unit: "L/h",
      observed: round(numbers.boilOffLPerHour, 2),
      current: values.boil_off_l_per_h,
      basis: `${num(numbers.preBoilVolumeL)} L før kok → ${num(numbers.postBoilVolumeL)} L etter ${num(recipe.boilTimeMin, 0)} min planlagt kok (målt varmt)`,
    });
  } else {
    missing.push("Fordampning: logg volum før kok og volum rett etter kok.");
  }

  if (numbers.efficiencyPct !== null && numbers.og && numbers.fermenterVolumeL !== null) {
    observations.push({
      profileKey: "brewhouse_efficiency_pct",
      label: "Brygghuseffektivitet",
      unit: "%",
      observed: round(numbers.efficiencyPct, 1),
      current: profileValue(values, "brewhouse_efficiency_pct"),
      basis: `OG ${numbers.og.sg.toFixed(3)}${numbers.og.source === "brix" ? " (fra Brix)" : ""} og ${num(numbers.fermenterVolumeL)} L til gjæring; oppskriften planla ${num(recipe.efficiencyPct, 0)} %`,
    });
  } else {
    missing.push("Effektivitet: logg OG (SG eller Brix) etter kok og volum til gjæring.");
  }

  // Strike temperature: the first mash reading against the first mash step.
  const firstStep = recipe.mashSteps[0];
  const mashReading = timeline
    .filter((item) => item.stage === "mash" && item.measurement?.kind === "temperature")
    .sort((a, b) => a.occurredAt - b.occurredAt)[0]?.measurement;
  if (firstStep && mashReading) {
    const currentOffset = profileValue(values, "strike_temp_offset_c") ?? 0;
    const { suggestedOffsetC } = suggestStrikeOffsetFromMash({
      targetMashTempC: firstStep.temperatureC,
      measuredMashTempC: mashReading.value,
      mashThicknessLPerKg: profileValue(values, "mash_thickness_l_per_kg") ?? 3,
      currentOffsetC: currentOffset,
    });
    observations.push({
      profileKey: "strike_temp_offset_c",
      label: "Systemkorreksjon innmesking",
      unit: "°C",
      observed: round(mashReading.value - firstStep.temperatureC, 1),
      current: currentOffset,
      suggested: round(suggestedOffsetC, 1),
      basis: `Mesken ble ${num(mashReading.value)} °C mot mål ${num(firstStep.temperatureC)} °C; forutsetter at innmeskingsvannet hadde planlagt temperatur`,
    });
  } else if (firstStep) {
    missing.push("Innmesking: logg mesketemperaturen rett etter innmesking.");
  }

  return { observations, missing };
}
