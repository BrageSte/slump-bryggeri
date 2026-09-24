import type { MeasurementKind } from "../model/brewing.ts";
import {
  brixToSg,
  refractometerBrixFromFinalGravity,
  refractometerFinalGravity,
  sgToBrix,
  sgToPlato,
  platoToSg,
} from "./gravity.ts";
import { celsiusToFahrenheit, fahrenheitToCelsius, kgToPounds, usGallonsToLiters, litersToUsGallons, ouncesToGrams, gramsToOunces, KG_PER_POUND, PSI_PER_BAR } from "./units.ts";

export const measurementUnitOptions: Record<MeasurementKind, readonly string[]> = {
  temperature: ["°C", "°F"],
  ph: ["pH"],
  sg: ["SG", "°P"],
  brix: ["°Bx"],
  pressure: ["bar", "psi"],
  volume: ["L", "US gal"],
  flow: ["L/min"],
  weight: ["g", "kg", "oz", "lb"],
  custom: [],
};

export function isSupportedMeasurementUnit(kind: MeasurementKind, unit: string): boolean {
  return kind === "custom" ? unit.trim().length > 0 : measurementUnitOptions[kind].includes(unit);
}

export function defaultMeasurementUnit(kind: MeasurementKind): string {
  return measurementUnitOptions[kind][0] ?? "";
}

/** Converts a user-entered measurement to the canonical unit stored in `measurements.value/unit`. */
export function measurementToCanonical(kind: MeasurementKind, value: number, unit: string): number | null {
  if (!isSupportedMeasurementUnit(kind, unit) || !Number.isFinite(value)) return null;
  switch (kind) {
    case "temperature":
      return unit === "°F" ? fahrenheitToCelsius(value) : value;
    case "volume":
      return unit === "US gal" ? usGallonsToLiters(value) : value;
    case "weight":
      if (unit === "kg") return value * 1000;
      if (unit === "oz") return ouncesToGrams(value);
      if (unit === "lb") return value * KG_PER_POUND * 1000;
      return value;
    case "pressure":
      return unit === "psi" ? value / PSI_PER_BAR : value;
    case "sg":
      return unit === "°P" ? platoToSg(value) : value;
    default:
      return value;
  }
}

/** Converts a canonical measurement into a supported display or entry unit. */
export function measurementFromCanonical(kind: MeasurementKind, value: number, unit: string): number | null {
  if (!isSupportedMeasurementUnit(kind, unit) || !Number.isFinite(value)) return null;
  switch (kind) {
    case "temperature":
      return unit === "°F" ? celsiusToFahrenheit(value) : value;
    case "volume":
      return unit === "US gal" ? litersToUsGallons(value) : value;
    case "weight":
      if (unit === "kg") return value / 1000;
      if (unit === "oz") return gramsToOunces(value);
      if (unit === "lb") return kgToPounds(value / 1000);
      return value;
    case "pressure":
      return unit === "psi" ? value * PSI_PER_BAR : value;
    case "sg":
      return unit === "°P" ? sgToPlato(value) : value;
    default:
      return value;
  }
}

export interface UnitConversionContext {
  wcf?: number;
  fermentationStarted?: boolean;
  originalBrix?: number | null;
}

/** Converts between supported units for the brew-day conversion tool. */
export function convertUnitValue(value: number, fromUnit: string, toUnit: string, context: UnitConversionContext = {}): number | null {
  if (!Number.isFinite(value)) return null;
  if (fromUnit === toUnit) return value;
  if (fromUnit === "°Bx" && toUnit === "SG") {
    const wcf = context.wcf ?? 1;
    if (wcf <= 0) return null;
    if (context.fermentationStarted) {
      if (context.originalBrix === undefined || context.originalBrix === null) return null;
      return refractometerFinalGravity({ originalBrix: context.originalBrix, finalBrix: value, wcf });
    }
    return brixToSg(value, wcf);
  }
  if (fromUnit === "SG" && toUnit === "°Bx") {
    const wcf = context.wcf ?? 1;
    if (wcf <= 0) return null;
    if (context.fermentationStarted) {
      if (context.originalBrix === undefined || context.originalBrix === null) return null;
      return refractometerBrixFromFinalGravity({ originalBrix: context.originalBrix, finalSg: value, wcf });
    }
    return sgToBrix(value, wcf);
  }

  const kind = (Object.keys(measurementUnitOptions) as MeasurementKind[]).find(
    (candidate) => candidate !== "custom" && measurementUnitOptions[candidate].includes(fromUnit) && measurementUnitOptions[candidate].includes(toUnit),
  );
  if (!kind) return null;
  const canonical = measurementToCanonical(kind, value, fromUnit);
  return canonical === null ? null : measurementFromCanonical(kind, canonical, toUnit);
}
