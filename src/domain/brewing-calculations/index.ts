/**
 * Deterministic brewing calculations. Pure functions only: no React, no database, no AI.
 * The UI and API call these; no language model computes brewing numbers.
 * See docs/calculations.md for formulas and sources.
 */
export * from "./abv.ts";
export * from "./boil-forecast.ts";
export * from "./calibration.ts";
export * from "./color.ts";
export * from "./gravity.ts";
export * from "./hops.ts";
export * from "./ibu.ts";
export * from "./measurement-units.ts";
export * from "./recipe-metrics.ts";
export * from "./scaling.ts";
export * from "./units.ts";
export * from "./water.ts";
export * from "./water-chemistry.ts";
