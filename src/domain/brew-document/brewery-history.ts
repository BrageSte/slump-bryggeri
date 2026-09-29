import { splitIdForVariant } from "../brew-day/fermentation.ts";
import { resultNumbers } from "../brew-day/outcome.ts";
import { round } from "../format.ts";
import type { BatchDetail, TimelineItem } from "../model/api.ts";
import { reviewCalibration } from "./tuning.ts";

export interface BreweryHistoryMetric {
  n: number;
  mean: number | null;
  min: number | null;
  max: number | null;
}

function metric(values: number[], decimals: number): BreweryHistoryMetric {
  if (values.length === 0) return { n: 0, mean: null, min: null, max: null };
  return {
    n: values.length,
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length, decimals),
    min: round(Math.min(...values), decimals),
    max: round(Math.max(...values), decimals),
  };
}

function roundIfPresent(value: number | undefined, decimals: number): number | undefined {
  return value !== undefined && Number.isFinite(value) ? round(value, decimals) : undefined;
}

function culturesForOutcome(batch: BatchDetail, splitId: string | null): string[] {
  const cultures = batch.recipeSnapshot.cultures.filter((culture) => {
    if (splitId === null || culture.variant === undefined) return true;
    return splitIdForVariant(batch.splits, culture.variant) === splitId;
  });
  return [...new Set(cultures.map((culture) => culture.name))];
}

function brewDateKey(batch: BatchDetail): string {
  if (batch.brewDate && Number.isFinite(Date.parse(batch.brewDate))) return batch.brewDate;
  return new Date(batch.createdAt).toISOString().slice(0, 10);
}

/** Summarizes measured results across batches without substituting recipe targets for missing data. */
export function summarizeBreweryHistory(batches: { batch: BatchDetail; timeline: TimelineItem[] }[]) {
  const boilOffValues: number[] = [];
  const efficiencyValues: number[] = [];
  const strikeDeviationValues: number[] = [];
  const attenuationValues = new Map<string, number[]>();

  const summaries = batches.map(({ batch, timeline }) => {
    const review = reviewCalibration({ batch, timeline });
    const observation = (key: string) => review.observations.find((item) => item.profileKey === key)?.observed;
    const boilOffLPerH = roundIfPresent(observation("boil_off_l_per_h"), 2);
    const brewhouseEfficiencyPct = roundIfPresent(observation("brewhouse_efficiency_pct"), 1);
    const strikeOffsetDeviationC = roundIfPresent(observation("strike_temp_offset_c"), 1);
    if (boilOffLPerH !== undefined) boilOffValues.push(boilOffLPerH);
    if (brewhouseEfficiencyPct !== undefined) efficiencyValues.push(brewhouseEfficiencyPct);
    if (strikeOffsetDeviationC !== undefined) strikeDeviationValues.push(strikeOffsetDeviationC);

    const profile = batch.equipmentSnapshot.values;
    const outcomes = batch.outcomes.map((outcome) => {
      const split = outcome.splitId === null ? undefined : batch.splits.find((item) => item.id === outcome.splitId);
      const cultures = culturesForOutcome(batch, outcome.splitId);
      const attenuation = resultNumbers(outcome.og, outcome.fg).attenuationPct;
      const apparentAttenuationPct = attenuation === null ? null : round(attenuation, 1);
      if (apparentAttenuationPct !== null) {
        for (const culture of cultures) {
          attenuationValues.set(culture, [...(attenuationValues.get(culture) ?? []), apparentAttenuationPct]);
        }
      }
      return {
        variantName: split?.name ?? null,
        cultures,
        og: outcome.og === null ? null : round(outcome.og, 3),
        fg: outcome.fg === null ? null : round(outcome.fg, 3),
        apparentAttenuationPct,
      };
    });

    const profileBoilOffLPerH = roundIfPresent(profile.boil_off_l_per_h, 2);
    const profileEfficiencyPct = roundIfPresent(profile.brewhouse_efficiency_pct, 1);
    const profileStrikeOffsetC = roundIfPresent(profile.strike_temp_offset_c, 1);
    return {
      brewDateKey: brewDateKey(batch),
      createdAt: batch.createdAt,
      number: batch.number,
      summary: {
        id: batch.id,
        number: batch.number,
        name: batch.name,
        brewDate: batch.brewDate,
        status: batch.status,
        recipeName: batch.recipe.name,
        observations: {
          ...(boilOffLPerH === undefined ? {} : { boilOffLPerH }),
          ...(brewhouseEfficiencyPct === undefined ? {} : { brewhouseEfficiencyPct }),
          ...(strikeOffsetDeviationC === undefined ? {} : { strikeOffsetDeviationC }),
        },
        equipmentProfile: {
          ...(profileBoilOffLPerH === undefined ? {} : { boilOffLPerH: profileBoilOffLPerH }),
          ...(profileEfficiencyPct === undefined ? {} : { brewhouseEfficiencyPct: profileEfficiencyPct }),
          ...(profileStrikeOffsetC === undefined ? {} : { strikeTempOffsetC: profileStrikeOffsetC }),
        },
        outcomes,
      },
    };
  });

  summaries.sort((a, b) => b.brewDateKey.localeCompare(a.brewDateKey) || b.createdAt - a.createdAt || b.number - a.number);

  return {
    batches: summaries.map(({ summary }) => summary),
    aggregates: {
      boilOffLPerH: metric(boilOffValues, 2),
      brewhouseEfficiencyPct: metric(efficiencyValues, 1),
      strikeOffsetDeviationC: metric(strikeDeviationValues, 1),
      attenuationByCulture: Object.fromEntries(
        [...attenuationValues.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([culture, values]) => [culture, metric(values, 1)]),
      ),
    },
  };
}
