import { round } from "./units.ts";

/** Observed temperature change across a transfer (negative = loss). */
export function calculateTemperatureOffset(input: { fromC: number; toC: number }): number {
  return input.toC - input.fromC;
}

export interface CalibrationSummary {
  count: number;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
  /** `null` until there are enough observations to suggest a value. */
  suggested: number | null;
  /** Suggested minus current value, when both exist. */
  changeFromCurrent: number | null;
}

/**
 * Aggregates calibration observations into a suggestion. Never applies anything —
 * an admin must explicitly accept the suggestion.
 */
export function summarizeCalibrationObservations(
  values: number[],
  options: { current?: number; decimals?: number; minObservations?: number } = {},
): CalibrationSummary | null {
  if (values.length === 0) return null;
  const decimals = options.decimals ?? 1;
  const minObservations = options.minObservations ?? 3;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.length > 1 ? values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1) : 0;
  const suggested = values.length >= minObservations ? round(mean, decimals) : null;
  return {
    count: values.length,
    mean,
    stdDev: Math.sqrt(variance),
    min: Math.min(...values),
    max: Math.max(...values),
    suggested,
    changeFromCurrent: suggested !== null && options.current !== undefined ? round(suggested - options.current, decimals) : null,
  };
}

/**
 * Strike-temperature system offset suggested by one mash reading. From Palmer's strike formula
 * Tw = (0.41 / r)(T − Tgrain) + T, a mash that lands ΔT off target needs the strike water moved by
 * ΔT · (r + 0.41) / r. Assumes the strike water was heated to the planned temperature.
 */
export function suggestStrikeOffsetFromMash(input: {
  targetMashTempC: number;
  measuredMashTempC: number;
  mashThicknessLPerKg: number;
  currentOffsetC: number;
}): { suggestedOffsetC: number; strikeCorrectionC: number } {
  if (input.mashThicknessLPerKg <= 0) throw new RangeError("mashThicknessLPerKg must be positive");
  const r = input.mashThicknessLPerKg;
  const strikeCorrectionC = (input.targetMashTempC - input.measuredMashTempC) * ((r + 0.41) / r);
  return { suggestedOffsetC: input.currentOffsetC + strikeCorrectionC, strikeCorrectionC };
}
