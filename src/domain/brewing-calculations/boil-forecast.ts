import { calculateBoilOff } from "./water.ts";
import { pointsToSg, sgToPoints } from "./gravity.ts";

export interface BoilForecastInput {
  preBoilVolumeL: number;
  preBoilSg: number;
  boilOffLPerH: number;
  boilTimeMin: number;
  /** An observed rate replaces the profile rate after two boil volumes have been logged. */
  observedBoilOffLPerH?: number;
  /** Latest measured volume during the boil, used to forecast only the remaining time. */
  currentVolumeL?: number;
  remainingBoilMin?: number;
}

export interface BoilForecast {
  postBoilVolumeL: number;
  postBoilSg: number;
  boilOffLPerH: number;
  evaporatedL: number;
}

/** Forecasts hot volume and gravity at flameout; gravity points are conserved during a boil. */
export function forecastBoilEnd(input: BoilForecastInput): BoilForecast {
  if (input.preBoilVolumeL <= 0) throw new RangeError("preBoilVolumeL must be positive");
  if (input.boilTimeMin < 0) throw new RangeError("boilTimeMin must not be negative");
  const boilOffLPerH = input.observedBoilOffLPerH ?? input.boilOffLPerH;
  if (boilOffLPerH < 0) throw new RangeError("boilOffLPerH must not be negative");

  const postBoilVolumeL = input.currentVolumeL === undefined
    ? calculateBoilOff({ preBoilVolumeL: input.preBoilVolumeL, boilOffLPerH, boilTimeMin: input.boilTimeMin }).postBoilVolumeL
    : Math.max(0, input.currentVolumeL - boilOffLPerH * ((input.remainingBoilMin ?? 0) / 60));
  if (postBoilVolumeL <= 0) throw new RangeError("post-boil volume must be positive");

  const postBoilSg = pointsToSg((sgToPoints(input.preBoilSg) * input.preBoilVolumeL) / postBoilVolumeL);
  return {
    postBoilVolumeL,
    postBoilSg,
    boilOffLPerH,
    evaporatedL: input.preBoilVolumeL - postBoilVolumeL,
  };
}
