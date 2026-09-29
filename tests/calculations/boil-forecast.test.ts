import { describe, expect, it } from "vitest";
import { brixToSg, forecastBoilEnd } from "../../src/domain/brewing-calculations/index.ts";

describe("boil-end forecast", () => {
  it("forecasts Sunset IPA from pre-boil Brix and the planned evaporation rate", () => {
    const forecast = forecastBoilEnd({
      preBoilVolumeL: 75.7,
      preBoilSg: brixToSg(12.1),
      boilOffLPerH: 13.2,
      boilTimeMin: 60,
    });

    expect(forecast.postBoilVolumeL).toBeCloseTo(62.5, 1);
    // The app converts 12.1 °Bx to about SG 1.049 (49 points); 49 × 75.7 / 62.5 = 59.3 points, or about 1.059.
    expect(forecast.postBoilSg).toBeCloseTo(1.059, 3);
  });

  it("uses the observed boil-off rate for the remaining boil time", () => {
    const forecast = forecastBoilEnd({
      preBoilVolumeL: 75.7,
      preBoilSg: brixToSg(12.1),
      boilOffLPerH: 5,
      observedBoilOffLPerH: 13.2,
      boilTimeMin: 60,
      currentVolumeL: 69.1,
      remainingBoilMin: 30,
    });

    expect(forecast.postBoilVolumeL).toBeCloseTo(62.5, 1);
    expect(forecast.postBoilSg).toBeCloseTo(1.059, 3);
    expect(forecast.boilOffLPerH).toBe(13.2);
  });
});
