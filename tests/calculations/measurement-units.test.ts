import { describe, expect, it } from "vitest";
import {
  convertUnitValue,
  defaultMeasurementUnit,
  isSupportedMeasurementUnit,
  measurementFromCanonical,
  measurementToCanonical,
} from "../../src/domain/brewing-calculations/index.ts";

describe("measurement unit conversion", () => {
  it("converts common entries to canonical units and back", () => {
    expect(measurementToCanonical("volume", 20, "US gal")).toBeCloseTo(75.7082, 3);
    expect(measurementFromCanonical("volume", 75.7082, "US gal")).toBeCloseTo(20, 4);
    expect(measurementToCanonical("temperature", 152, "°F")).toBeCloseTo(66.6667, 3);
    expect(measurementFromCanonical("temperature", 66.6667, "°F")).toBeCloseTo(152, 3);
    expect(measurementToCanonical("weight", 16, "oz")).toBeCloseTo(453.5924, 3);
    expect(measurementToCanonical("weight", 1, "lb")).toBeCloseTo(453.5924, 3);
    expect(measurementToCanonical("pressure", 14.5038, "psi")).toBeCloseTo(1, 4);
  });

  it("converts Plato to canonical SG and Brix with a WCF", () => {
    expect(measurementToCanonical("sg", 15, "°P")).toBeCloseTo(1.061, 3);
    expect(convertUnitValue(15, "°Bx", "SG", { wcf: 1.04 })).toBeCloseTo(1.0587, 4);
    expect(convertUnitValue(1.0587, "SG", "°Bx", { wcf: 1.04 })).toBeCloseTo(15, 1);
  });

  it("requires original Brix for alcohol-corrected SG after fermentation", () => {
    expect(convertUnitValue(7.5, "°Bx", "SG", { fermentationStarted: true, wcf: 1.04 })).toBeNull();
    const finalGravity = convertUnitValue(7.5, "°Bx", "SG", { fermentationStarted: true, originalBrix: 15, wcf: 1.04 });
    expect(finalGravity).toBeCloseTo(1.0131, 4);
    expect(convertUnitValue(finalGravity as number, "SG", "°Bx", { fermentationStarted: true, originalBrix: 15, wcf: 1.04 })).toBeCloseTo(7.5, 6);
  });

  it("rejects unsupported units and starts every input in metric", () => {
    expect(isSupportedMeasurementUnit("temperature", "°K")).toBe(false);
    expect(measurementToCanonical("volume", 10, "bar")).toBeNull();
    expect(defaultMeasurementUnit("volume")).toBe("L");
    expect(defaultMeasurementUnit("temperature")).toBe("°C");
    expect(defaultMeasurementUnit("weight")).toBe("g");
  });
});
