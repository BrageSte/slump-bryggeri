export const LITERS_PER_US_GALLON = 3.785411784;
export const GRAMS_PER_OUNCE = 28.349523125;
export const KG_PER_POUND = 0.45359237;

export function usGallonsToLiters(gallons: number): number {
  return gallons * LITERS_PER_US_GALLON;
}

export function litersToUsGallons(liters: number): number {
  return liters / LITERS_PER_US_GALLON;
}

export function ouncesToGrams(ounces: number): number {
  return ounces * GRAMS_PER_OUNCE;
}

export function gramsToOunces(grams: number): number {
  return grams / GRAMS_PER_OUNCE;
}

export function poundsToKg(pounds: number): number {
  return pounds * KG_PER_POUND;
}

export function kgToPounds(kg: number): number {
  return kg / KG_PER_POUND;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return ((fahrenheit - 32) * 5) / 9;
}

export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

/** Round half away from zero to a fixed number of decimals. */
export function round(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}
