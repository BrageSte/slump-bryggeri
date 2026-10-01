import { dateTimeOslo, num } from "../format.ts";
import { brewStageLabels, formatMeasurementValue } from "../model/brewing.ts";
import {
  getWaterAgent,
  ionInfo,
  ionKeys,
  phSamplePointLabels,
  waterSourceKindLabels,
  type IonConcentrations,
  type PartialIonConcentrations,
} from "../model/water.ts";
import type { BatchWaterSummary } from "../water/batch-water.ts";
import { describeSourceWater, hardnessClassLabels } from "../water/describe.ts";
import { isHotPhSample, type PhReading } from "../water/ph.ts";

/**
 * The "Vann og pH" section of the brew document. Four labelled parts, one per kind of value, so a
 * reader (or the assistant) never mistakes a calculation or a target for something that was measured.
 */

function ions(values: IonConcentrations | PartialIonConcentrations, decimals: (key: (typeof ionKeys)[number]) => number): string {
  return ionKeys
    .flatMap((key) => (values[key] === undefined ? [] : [`${ionInfo[key].symbol} ${num(values[key]!, decimals(key))}`]))
    .join(" · ");
}

function agentAmount(addition: { name: string; amount: number; unit: string; agent: string; acidStrengthPct: number | null }): string {
  const agent = getWaterAgent(addition.agent);
  const strength = addition.acidStrengthPct !== null ? ` ${num(addition.acidStrengthPct, 0)} %` : "";
  const label = agent && agent.shortLabel !== addition.name ? `${addition.name} (${agent.shortLabel}${strength})` : `${addition.name}${strength}`;
  return `${num(addition.amount, 2)} ${addition.unit} ${label}`;
}

function phReadingLine(reading: PhReading): string {
  const value = reading.valueMin !== null && reading.valueMax !== null
    ? `${formatMeasurementValue("ph", reading.valueMin)}–${formatMeasurementValue("ph", reading.valueMax)}`
    : formatMeasurementValue("ph", reading.value);
  const point = reading.point ? phSamplePointLabels[reading.point] : "punkt ikke angitt";
  const temperature = reading.sampleTempC === null
    ? "prøvetemperatur ikke oppgitt"
    : `prøve ${num(reading.sampleTempC, 1)} °C${isHotPhSample(reading.sampleTempC) ? " (varm: leser lavere enn ved romtemperatur)" : ""}`;
  const stage = reading.stage ? `[${brewStageLabels[reading.stage]}] ` : "";
  return `- ${dateTimeOslo(reading.at)} ${stage}${point}: pH ${value}, ${temperature}${reading.instrument ? `, ${reading.instrument}` : ", instrument ikke oppgitt"}${reading.comment ? ` — ${reading.comment}` : ""}`;
}

export function buildWaterSectionLines(water: BatchWaterSummary, registeredIngredientIds: ReadonlySet<string>): string[] {
  const { profile } = water.source;
  const description = describeSourceWater(profile);
  const lines: string[] = ["## Vann og pH", ""];

  lines.push("### Kildevann (oppgitt)");
  lines.push(`- ${profile.name}: ${ions(profile.ions, (key) => (key === "mg" || key === "ca" ? 2 : 1))} mg/L${profile.alkalinityMmolL !== undefined ? `; alkalitet ${num(profile.alkalinityMmolL)} mmol/L` : ""}${profile.hardnessDh !== undefined ? `; hardhet ${num(profile.hardnessDh)} °dH` : ""}${profile.ph !== undefined ? `; vannets pH ${num(profile.ph)}` : ""}`);
  lines.push(`- Kilde: ${waterSourceKindLabels[profile.source.kind]}, ${profile.source.organization}, ${profile.source.url}. Hentet ${profile.source.retrievedAt}; ${profile.source.publishedAt ? `publisert ${profile.source.publishedAt}` : "ingen prøvedato oppgitt"}.`);
  lines.push(water.source.frozen ? "- Profilen er frosset i batchen." : "- Batchen har ingen frosset profil (laget før vannkjemi ble registrert): bryggeriets basisvann er antatt brukt.");
  if (profile.confirmedUse) {
    lines.push(`- Bekreftet i bruk: ${profile.confirmedUse.confirmedBy} ${profile.confirmedUse.confirmedAt}${profile.confirmedUse.note ? `. ${profile.confirmedUse.note}` : "."}`);
  }
  if (description.other.length > 0) {
    lines.push(`- Øvrige oppgitte verdier (${description.other.length}): ${description.other.map((row) => `${row.label} ${num(row.value, row.decimals)}${row.unit ? ` ${row.unit}` : ""}`).join("; ")}.`);
  }
  lines.push(`- ${hardnessClassLabels[description.hardnessClass]}${description.lowMineral ? " og mineralfattig: et nøytralt utgangspunkt der alt kalsium, all sulfat og alt klorid må tilsettes" : ""}.`);
  lines.push("");

  lines.push("### Beregnet fra kildevannet (≈)");
  const derived = water.source.derived;
  lines.push(`- Alkalitet som CaCO₃ ≈ ${num(derived.alkalinityAsCaCO3MgL, 1)} mg/L, restalkalitet (RA) ≈ ${num(derived.residualAlkalinityAsCaCO3MgL, 1)} mg/L, hardhet ≈ ${num(derived.hardnessDh, 2)} °dH. RA er en indeks, ikke en pH-prediksjon.`);
  lines.push("");

  lines.push("### Plan (mål)");
  const { plan } = water;
  lines.push(`- Mesk-pH mål ${formatMeasurementValue("ph", plan.mashPh.min)}–${formatMeasurementValue("ph", plan.mashPh.max)} (${plan.mashPh.source === "recipe" ? "oppskrift" : "≈ antatt veiledning, målt på avkjølt prøve"})`);
  if (plan.target) lines.push(`- Planlagt vannprofil${plan.profileName ? ` «${plan.profileName}»` : ""} (mål, mg/L): ${ions(plan.target, () => 0)}`);
  else if (plan.profileName) lines.push(`- Planlagt vannprofil: «${plan.profileName}» (ingen ionmål oppgitt)`);
  else lines.push("- Ingen planlagt vannprofil i oppskriften.");
  if (plan.notes) lines.push(`- Vannnotat: ${plan.notes}`);
  if (plan.additions.length === 0) lines.push("- Ingen salter eller syrer planlagt.");
  for (const addition of plan.additions) {
    lines.push(`- Planlagt: ${agentAmount(addition)}${registeredIngredientIds.has(addition.ingredientId) ? " — TILSATT" : " — ikke registrert tilsatt"}`);
  }
  if (water.calculated.afterPlannedSalts) {
    lines.push(`- ≈ Profil etter planlagte salter i ${water.calculated.totalWaterAssumed ? "≈ antatt " : ""}${num(water.calculated.totalWaterL ?? 0, 1)} L (mg/L): ${ions(water.calculated.afterPlannedSalts, () => 0)}`);
    const after = water.calculated.derivedAfterPlannedSalts!;
    lines.push(`- ≈ Restalkalitet etter salter ${num(after.residualAlkalinityAsCaCO3MgL, 1)} mg/L${after.sulfateToChlorideRatio !== null ? `, sulfat:klorid ${num(after.sulfateToChlorideRatio, 2)}` : ""}`);
  }
  if (water.calculated.note) lines.push(`- Merk: ${water.calculated.note}`);
  lines.push("");

  lines.push("### Målt i brygget");
  if (water.measured.ph.length === 0) lines.push("- Ingen pH-målinger registrert.");
  for (const reading of water.measured.ph) lines.push(phReadingLine(reading));
  if (water.measured.additions.length === 0) lines.push("- Ingen salter eller syrer registrert tilsatt.");
  for (const addition of water.measured.additions) {
    lines.push(`- ${dateTimeOslo(addition.at)} Tilsatt: ${agentAmount(addition)}`);
  }
  lines.push("- Ingen mesk-pH er beregnet: det finnes ingen validert modell for Slump ennå. Mål, og sammenlign med målet.", "");
  return lines;
}
