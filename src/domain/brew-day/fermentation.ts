import { brixToSg, calculateApparentAttenuation, refractometerFinalGravity } from "../brewing-calculations/index.ts";
import { fermentationHasStarted, type BrewStage } from "../model/brewing.ts";
import type { RecipeDocument } from "../model/recipe.ts";
import { currentFermentationStep, temperatureTarget, type BrewDayLogEntry, type TargetValue } from "./state.ts";

/**
 * Fermentation per variant (batch split): OG, gravity/temperature/pressure series from the brewery's
 * own readings, and the numbers the fermentation card and chart show. Pure: the caller passes `now`.
 *
 * Only real readings become points. Missing readings stay missing (no interpolation), and a Brix
 * reading taken after pitching is only converted to SG when a Brix reading from before fermentation
 * exists to correct it against.
 */

export interface GravityPoint {
  at: number;
  sg: number;
  /** "brix": derived from a refractometer reading, not measured with a hydrometer. */
  source: "sg" | "brix";
}

export interface ReadingPoint {
  at: number;
  value: number;
}

export interface FermentationVariant {
  /** null: the whole batch (no split, or readings logged for "Hele batchen"). */
  splitId: string | null;
  name: string;
  og: GravityPoint | null;
  gravity: GravityPoint[];
  temperature: ReadingPoint[];
  pressure: ReadingPoint[];
  pitchedAt: number | null;
  /** Brix readings after pitching that could not be corrected (no Brix reading from before fermentation). */
  uncorrectedBrix: number;
}

export interface FermentationInput {
  log: BrewDayLogEntry[];
  splits: { id: string; name: string }[];
  /** Refractometer wort correction factor from the equipment snapshot. */
  wcf?: number;
}

const DAY = 86_400_000;
/** Readings from these stages describe the finished wort, i.e. the OG. */
const HOT_SIDE: readonly BrewStage[] = ["boil", "whirlpool", "cooling"];

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function buildFermentationSeries(input: FermentationInput): FermentationVariant[] {
  const wcf = input.wcf ?? 1;
  const log = [...input.log].sort((a, b) => a.occurredAt - b.occurredAt);
  const splitOf = (entry: BrewDayLogEntry) => entry.splitId ?? null;
  const fermenting = log.filter((e) => fermentationHasStarted(e.stage));

  const variant = (splitId: string | null, name: string): FermentationVariant => {
    // A reading for this fermenter wins over one for the whole batch.
    const own = (entries: BrewDayLogEntry[]) => entries.filter((e) => splitOf(e) === splitId);
    const shared = (entries: BrewDayLogEntry[]) => entries.filter((e) => splitOf(e) === null);
    const preferOwn = <T>(pick: (entries: BrewDayLogEntry[]) => T | null, entries: BrewDayLogEntry[]): T | null =>
      pick(own(entries)) ?? (splitId === null ? null : pick(shared(entries)));

    const og = findOriginalGravity(log, splitId, wcf);

    const beforeFermentation = log.filter((e) => !fermentationHasStarted(e.stage));
    const originalBrix = preferOwn((entries) => entries.findLast((e) => e.measurement?.kind === "brix")?.measurement?.value ?? null, beforeFermentation);

    const readings = own(fermenting);
    const gravity: GravityPoint[] = [];
    let uncorrectedBrix = 0;
    for (const entry of readings) {
      if (entry.measurement?.kind === "sg") {
        gravity.push({ at: entry.occurredAt, sg: entry.measurement.value, source: "sg" });
      } else if (entry.measurement?.kind === "brix") {
        if (originalBrix === null) {
          uncorrectedBrix += 1;
          continue;
        }
        gravity.push({
          at: entry.occurredAt,
          sg: round3(refractometerFinalGravity({ originalBrix, finalBrix: entry.measurement.value, wcf })),
          source: "brix",
        });
      }
    }
    const series = (kind: "temperature" | "pressure") =>
      readings.flatMap((e) => (e.measurement?.kind === kind ? [{ at: e.occurredAt, value: e.measurement.value }] : []));

    const pitched = preferOwn((entries) => entries.find((e) => e.type === "yeast_pitched")?.occurredAt ?? null, log);
    const pitchedAt = pitched ?? log.find((e) => e.type === "fermentation_started")?.occurredAt ?? null;

    return { splitId, name, og, gravity, temperature: series("temperature"), pressure: series("pressure"), pitchedAt, uncorrectedBrix };
  };

  if (input.splits.length === 0) return [variant(null, "Hele batchen")];
  const variants = input.splits.map((split) => variant(split.id, split.name));
  const sharedReadings = fermenting.some(
    (e) => splitOf(e) === null && (e.measurement?.kind === "sg" || e.measurement?.kind === "brix" || e.measurement?.kind === "temperature" || e.measurement?.kind === "pressure"),
  );
  return sharedReadings ? [...variants, variant(null, "Hele batchen")] : variants;
}

/**
 * The OG: the latest SG or Brix reading from the boil, whirlpool or cooling. A reading for the
 * fermenter wins over one for the whole batch; gravity from before the boil is never the OG.
 */
export function findOriginalGravity(log: BrewDayLogEntry[], splitId: string | null, wcf = 1): GravityPoint | null {
  const hotSide = log
    .filter((e) => e.stage !== null && HOT_SIDE.includes(e.stage) && (e.measurement?.kind === "sg" || e.measurement?.kind === "brix"))
    .sort((a, b) => a.occurredAt - b.occurredAt);
  const entry =
    hotSide.findLast((e) => (e.splitId ?? null) === splitId) ?? (splitId === null ? undefined : hotSide.findLast((e) => (e.splitId ?? null) === null));
  if (!entry?.measurement) return null;
  return entry.measurement.kind === "sg"
    ? { at: entry.occurredAt, sg: entry.measurement.value, source: "sg" }
    : { at: entry.occurredAt, sg: round3(brixToSg(entry.measurement.value, wcf)), source: "brix" };
}

/** Apparent attenuation from OG to the latest gravity; null when it cannot be computed. */
export function apparentAttenuationSoFar(og: GravityPoint | null, current: GravityPoint | null): number | null {
  if (!og || !current || og.sg <= 1) return null;
  return calculateApparentAttenuation(og.sg, current.sg);
}

/** Whole days since pitching; 0 on pitch day. */
export function fermentationDayOf(pitchedAt: number | null, now: number): number | null {
  return pitchedAt === null ? null : Math.max(0, Math.floor((now - pitchedAt) / DAY));
}

/** The planned fermentation temperature for a fermentation day, from the recipe's fermentation plan. */
export function plannedFermentationTemperature(recipe: RecipeDocument, day: number): TargetValue | null {
  const step = currentFermentationStep(recipe, day);
  return temperatureTarget(step?.temperatureC, step?.temperatureMaxC);
}
