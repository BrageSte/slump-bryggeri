import type { IonKey } from "../model/water.ts";

/**
 * General brewing-water guidance as structured data. These are windows brewers commonly use, taken from
 * published sources that disagree at the edges; they are "recommended brewing targets", never source
 * values, calculations or measurements, and never rules. A recipe's own plan or Slump's measured
 * results overrule them. No style-specific targets are encoded on purpose.
 */

export const guidanceDisclaimer =
  "Veiledende vinduer fra bryggelitteratur, ikke regler. Kildene er uenige i kantene, og mange gode øl brytes med dem. Egne målinger fra Slump veier tyngre enn dette.";

export const guidanceSources = {
  aha: {
    title: "American Homebrewers Association: Understanding Water for Homebrewing",
    url: "https://homebrewersassociation.org/how-to-brew/understanding-water-for-homebrewing/",
  },
  brewfather: {
    title: "Brewfather docs: Water Chemistry & Adjustments",
    url: "https://docs.brewfather.app/brewing-knowledge/water-chemistry",
  },
} as const;
export type GuidanceSourceId = keyof typeof guidanceSources;

export interface GuidanceRange {
  min: number;
  max: number;
}

export interface IonGuidance {
  ion: IonKey;
  /** The window commonly used for mash and brewing water, mg/L. Absent where sources give none. */
  typical?: GuidanceRange;
  /** Level above which a source reports harshness or off-flavour, mg/L. */
  cautionAbove?: number;
  /** What the ion does, Norwegian, for display. */
  effect: string;
  /** Where sources differ or the window does not apply. */
  note?: string;
  sourceIds: readonly GuidanceSourceId[];
}

export const ionGuidance: readonly IonGuidance[] = [
  {
    ion: "ca",
    typical: { min: 50, max: 150 },
    effect: "Senker mesk-pH ved å reagere med fosfater i malten, og støtter enzymer, klaring og gjær.",
    note: "Brewfather: 50–150, minst 50 anbefales sterkt. AHA: 50–200. Enkelte bløtvanns-tradisjoner (lys lager) brygger med mindre.",
    sourceIds: ["brewfather", "aha"],
  },
  {
    ion: "mg",
    typical: { min: 10, max: 30 },
    cautionAbove: 30,
    effect: "Næring for gjæren i små mengder. Mye gir sur, bitter og metallisk smak.",
    note: "AHA: 10–30 hjelper, sur bitterhet og snerp over 50. Brewfather: hardt, surt eller metallisk over 30.",
    sourceIds: ["aha", "brewfather"],
  },
  {
    ion: "na",
    typical: { min: 0, max: 150 },
    cautionAbove: 200,
    effect: "Gir rundhet i små mengder sammen med klorid. Mye gir salt og hardt preg.",
    note: "Kildene er uenige om hva som er ideelt: Brewfather 0–100 (opp til 150 for maltbetonte øl), AHA 70–150. AHA: skarpt salt-surt over 200.",
    sourceIds: ["brewfather", "aha"],
  },
  {
    ion: "cl",
    typical: { min: 50, max: 200 },
    effect: "Fremhever fylde, rundhet og maltsødme.",
    note: "Brewfather: 50–200. Lyse, tørre øl brygges ofte under 50.",
    sourceIds: ["brewfather"],
  },
  {
    ion: "so4",
    typical: { min: 50, max: 350 },
    effect: "Fremhever humlebitterhet og gir tørrhet.",
    note: "Brewfather: 50–350 etter stil. Høyt sulfat med mye humle kan bli hardt.",
    sourceIds: ["brewfather"],
  },
  {
    ion: "hco3",
    effect: "Alkalitet: løfter mesk-pH. Lyse malter trenger lite, mørk og ristet malt syrner selv og tåler mer.",
    note: "Ingen felles tallvindu: hvor mye som passer avhenger av kornblandingen. Mål mesk-pH.",
    sourceIds: ["brewfather"],
  },
];

export function ionGuidanceFor(ion: IonKey): IonGuidance {
  const entry = ionGuidance.find((item) => item.ion === ion);
  if (!entry) throw new Error(`No guidance for ${ion}`);
  return entry;
}

/** Below this, an ion is under the lowest flavour-active level any source gives. */
export function isBelowTypical(ion: IonKey, mgPerL: number): boolean {
  const typical = ionGuidanceFor(ion).typical;
  return typical !== undefined && mgPerL < typical.min;
}

export const mashPhGuidance = {
  /** Window most sources call acceptable for the mash. Brewfather 5.2–5.6; AHA ideally 5.1–5.8, optimal 5.2–5.5. */
  window: { min: 5.2, max: 5.6 } satisfies GuidanceRange,
  /** Slump's planning target when a recipe states none: the conservative part of the window. */
  planningTarget: { min: 5.2, max: 5.4 } satisfies GuidanceRange,
  /** The temperature the window refers to, °C. */
  referenceTemperatureC: 20,
  /** A hot sample reads this much lower than the same sample at room temperature (Brewfather). */
  hotReadingOffset: { min: 0.2, max: 0.35 } satisfies GuidanceRange,
  /** Samples warmer than this are not comparable with the window without cooling. */
  hotSampleAboveC: 35,
  note: "Mål helst en avkjølt prøve (ca. 20–25 °C). En varm prøve leser omtrent 0,2–0,35 pH lavere, så den kan ikke dømmes mot målet.",
  sourceIds: ["brewfather", "aha"] as readonly GuidanceSourceId[],
};

/** Sulfate to chloride ratio bands (Brewfather). The ratio only says something when the ions are in flavour range. */
export const sulfateToChlorideBands: readonly { upTo: number; label: string }[] = [
  { upTo: 0.5, label: "svært malt-/rundt" },
  { upTo: 1, label: "maltbetont" },
  { upTo: 2, label: "balansert" },
  { upTo: 4, label: "humlebetont og tørt" },
  { upTo: Number.POSITIVE_INFINITY, label: "svært humlebetont og tørt" },
];
/** Both ions must reach this, mg/L, before the ratio means anything. */
export const ratioMeaningfulFrom = 50;

export function describeSulfateToChlorideRatio(ratio: number | null, ions: { so4: number; cl: number }): string {
  if (ratio === null) return "ikke definert uten klorid";
  if (ions.so4 < ratioMeaningfulFrom && ions.cl < ratioMeaningfulFrom) return "sier lite: begge ionene er under smaksnivå";
  return sulfateToChlorideBands.find((band) => ratio <= band.upTo)!.label;
}
