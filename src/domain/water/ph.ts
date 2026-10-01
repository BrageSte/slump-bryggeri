import type { TimelineItem } from "../model/api.ts";
import type { BrewStage } from "../model/brewing.ts";
import { phSamplePointByStage, phSamplePointMeasurementLabels, type PhSamplePoint } from "../model/water.ts";
import { mashPhGuidance } from "./guidance.ts";

/**
 * Which point in the brew a pH reading belongs to. The point is not stored as its own field: the
 * stage and the measurement label already carry it, so readings logged before water chemistry
 * existed (a bare "pH" in the boil stage, a label like "Før kok") are read the same way, and nothing
 * historical is rewritten.
 */

const labelPatterns: readonly [PhSamplePoint, RegExp][] = [
  ["pre_boil", /pre[\s-]?boil|f[øo]r[\s-]*kok/i],
  ["post_boil", /post[\s-]?boil|etter[\s-]*kok/i],
  ["final", /slutt|final|ferdig|pakk/i],
  ["mash", /mesk|mash/i],
  ["fermentation", /gj[æa]r|ferment/i],
];

/** The point named by a label, or null when the label says nothing about it. */
export function phSamplePointFromLabel(label: string | null | undefined): PhSamplePoint | null {
  if (!label) return null;
  return labelPatterns.find(([, pattern]) => pattern.test(label))?.[0] ?? null;
}

/**
 * The sample point of a pH reading: a clear label wins, otherwise the stage decides. Null when neither
 * says (a reading during the boil or conditioning without a label).
 */
export function classifyPhSamplePoint(input: { stage: BrewStage | null; label?: string | null }): PhSamplePoint | null {
  return phSamplePointFromLabel(input.label) ?? (input.stage ? phSamplePointByStage[input.stage] : null);
}

/**
 * The label to write on a pH measurement so that `classifyPhSamplePoint` finds `point`: none when the
 * stage already implies it, so a plain mash pH keeps its plain log line.
 */
export function labelForPhSamplePoint(point: PhSamplePoint, stage: BrewStage | null): string | undefined {
  return classifyPhSamplePoint({ stage }) === point ? undefined : phSamplePointMeasurementLabels[point];
}

/** True when the sample was too warm to compare with a room-temperature pH window. */
export function isHotPhSample(sampleTempC: number | null | undefined): boolean {
  return sampleTempC !== null && sampleTempC !== undefined && sampleTempC > mashPhGuidance.hotSampleAboveC;
}

export interface PhReading {
  /** Id of the timeline entry. */
  id: string;
  point: PhSamplePoint | null;
  stage: BrewStage | null;
  label: string | null;
  /** The reading, or the midpoint of a strip interval. */
  value: number;
  valueMin: number | null;
  valueMax: number | null;
  sampleTempC: number | null;
  instrument: string | null;
  comment: string | null;
  splitId: string | null;
  at: number;
}

/** Every pH reading in a batch's timeline, in time order, as recorded. */
export function phReadings(timeline: readonly TimelineItem[]): PhReading[] {
  return timeline
    .flatMap((item): PhReading[] => {
      const m = item.measurement;
      if (!m || m.kind !== "ph") return [];
      return [
        {
          id: item.id,
          point: classifyPhSamplePoint({ stage: item.stage, label: m.label }),
          stage: item.stage,
          label: m.label,
          value: m.value,
          valueMin: m.valueMin,
          valueMax: m.valueMax,
          sampleTempC: m.sampleTempC,
          instrument: m.instrument,
          comment: m.comment,
          splitId: item.splitId,
          at: item.occurredAt,
        },
      ];
    })
    .sort((a, b) => a.at - b.at);
}
