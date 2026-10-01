import { assumptionNames, buildBrewPlan, brewPlanPhaseLabels, brewPlanPhaseStatus, registeredIngredientIds, type BrewPlanItem, type PlanQuantity } from "../brew-day/brew-plan.ts";
import { resultNumbers } from "../brew-day/outcome.ts";
import { deriveBrewDayState, deviationFromTarget, type TargetStatus, type TargetValue } from "../brew-day/state.ts";
import { toBrewDayLog } from "../brew-day/timeline.ts";
import { dateTimeOslo as time, num } from "../format.ts";
import { packagingLabels, type BatchDetail, type TimelineItem } from "../model/api.ts";
import { batchStatusLabels, brewStageLabels, eventTypeLabels, formatMeasurementValue, measurementKindSpecs } from "../model/brewing.ts";
import { getProfileParameter } from "../model/equipment-profile.ts";
import { isTotalBrewingWaterAssumed, summarizeBatchWater, totalBrewingWaterL } from "../water/batch-water.ts";
import { reviewCalibration } from "./tuning.ts";
import { buildWaterSectionLines } from "./water-section.ts";

/**
 * The brew document (M10): one plain-text (Markdown) account of a batch — plan, equipment
 * snapshot, where the brew stands, and every log entry in order. Deterministic and built only from
 * the batch's own data; it is what the brewer copies, and what the assistant reads as context.
 * Planned values are labelled as plan, calculated ones with "≈", and nothing unmeasured is filled in.
 */

const targetStatusLabels: Record<TargetStatus, string> = {
  ok: "OK",
  low: "Lav",
  high: "Høy",
  uncertain: "Usikker",
  missing: "Ikke målt",
};

function quantity(q: PlanQuantity | undefined, unit: string): string | null {
  if (!q) return null;
  const value = unit === "SG" ? formatMeasurementValue("sg", q.value) : `${num(q.value)} ${unit}`;
  const prefix = q.source === "recipe" ? "" : q.source === "calculated" ? "≈ " : `≈ antatt${q.assumptions?.length ? ` (${assumptionNames(q.assumptions)})` : ""} `;
  return `${prefix}${value}${unit === "SG" ? " SG" : ""}`;
}

function target(kind: Parameters<typeof formatMeasurementValue>[0], value: TargetValue): string {
  return value.kind === "range"
    ? `${formatMeasurementValue(kind, value.min)}–${formatMeasurementValue(kind, value.max)}`
    : formatMeasurementValue(kind, value.value);
}

function planItem(item: BrewPlanItem): string {
  const parts = [
    item.amount ? `${num(item.amount.value, 2)} ${item.amount.unit}` : null,
    item.title,
    item.timing ? `(${item.timing})` : null,
  ].filter(Boolean);
  const details = [
    item.temperatureC
      ? item.temperatureMaxC !== undefined && item.temperatureMaxC !== item.temperatureC.value
        ? `${num(item.temperatureC.value)}–${num(item.temperatureMaxC)} °C`
        : quantity(item.temperatureC, "°C")
      : null,
    quantity(item.volumeL, "L"),
    item.gravitySg ? quantity(item.gravitySg, "SG") : null,
    item.durationMin !== undefined ? `${num(item.durationMin, 0)} min` : null,
    item.durationDays !== undefined ? `${num(item.durationDays, 0)} d` : null,
    item.variant ? `variant ${item.variant}` : null,
    item.addition ? (item.done ? "TILSATT" : "ikke registrert tilsatt") : null,
  ].filter(Boolean);
  return `- ${parts.join(" ")}${details.length > 0 ? ` — ${details.join(", ")}` : ""}${item.note ? ` (${item.note})` : ""}`;
}

function logLine(item: TimelineItem, splits: BatchDetail["splits"]): string {
  const who = item.createdBy.name;
  const stage = item.stage ? `[${brewStageLabels[item.stage]}] ` : "";
  const split = item.splitId ? ` (${splits.find((s) => s.id === item.splitId)?.name ?? "variant"})` : "";
  let what: string;
  if (item.measurement) {
    const m = item.measurement;
    const spec = measurementKindSpecs[m.kind];
    const label = m.label ?? spec.label;
    const value = m.valueMin !== null && m.valueMax !== null
      ? `${formatMeasurementValue(m.kind, m.valueMin)}–${formatMeasurementValue(m.kind, m.valueMax)}`
      : formatMeasurementValue(m.kind, m.value);
    const entered = m.enteredUnit !== m.unit ? ` (skrevet inn ${num(m.enteredValue, 3)} ${m.enteredUnit})` : "";
    what = `Måling ${label}: ${value} ${m.kind === "sg" ? "" : m.unit}${entered}${m.instrument ? `, ${m.instrument}` : ""}${m.comment ? ` — ${m.comment}` : ""}`;
  } else if (item.comment) {
    what = `Kommentar: ${item.comment.body}`;
  } else if (item.attachment) {
    what = `Bilde: ${item.attachment.caption ?? item.attachment.filename}`;
  } else {
    const data = item.data ?? {};
    const label = eventTypeLabels[item.type] ?? item.type;
    if ((item.type === "ingredient_added" || item.type === "yeast_pitched") && typeof data.name === "string") {
      what = `${label}: ${typeof data.amount === "number" ? `${num(data.amount, 2)} ${String(data.unit ?? "")} ` : ""}${data.name}`;
    } else if (typeof data.title === "string") {
      what = `${label}: ${data.title}`;
    } else {
      what = label;
    }
    if (typeof data.note === "string") what += ` — ${data.note}`;
  }
  return `- ${time(item.occurredAt)} ${stage}${what.trim()}${split} · ${who}`;
}

export interface BrewDocumentSections {
  header: string;
  plan: string;
  water: string;
  equipment: string;
  status: string;
  results: string;
  calibration: string;
  log: string;
}

export interface BrewDocumentInput {
  batch: BatchDetail;
  timeline: TimelineItem[];
  now: number;
}

function sectionText(lines: string[]): string {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end).join("\n");
}

export function buildBrewDocumentSections({ batch, timeline, now }: BrewDocumentInput): BrewDocumentSections {
  const recipe = batch.recipeSnapshot;
  const log = toBrewDayLog(timeline);
  const equipment = batch.equipmentSnapshot.values;
  const plan = buildBrewPlan({ recipe, equipment, equipmentSources: batch.equipmentSnapshot.sources, doneIngredientIds: registeredIngredientIds(log) });
  const state = deriveBrewDayState({
    recipe,
    stage: batch.currentStage,
    stageStartedAt: batch.stageStartedAt,
    log,
    now,
    wcf: equipment.refractometer_wcf,
    equipment,
    equipmentSources: batch.equipmentSnapshot.sources,
    completed: batch.status === "completed",
  });

  const headerLines: string[] = [];
  headerLines.push(`# Bryggedokument: ${batch.name} (#${batch.number})`, "");
  headerLines.push(
    `- Oppskrift: ${recipe.name} v${batch.recipeVersion.version}${recipe.style ? `, ${recipe.style}` : ""}`,
    `- Batchstørrelse ${num(recipe.batchSizeL)} L, kok ${num(recipe.boilTimeMin, 0)} min, planlagt effektivitet ${num(recipe.efficiencyPct, 0)} %`,
    `- Status: ${batchStatusLabels[batch.status]}${batch.currentStage ? `, steg ${brewStageLabels[batch.currentStage]}` : ", ikke startet"}${batch.brewDate ? `, bryggedato ${batch.brewDate}` : ""}`,
  );
  if (batch.splits.length > 0) {
    headerLines.push(`- Varianter: ${batch.splits.map((s) => `${s.name}${s.vessel ? ` (${s.vessel}${s.volumeL ? `, ${num(s.volumeL)} L` : ""})` : ""}`).join("; ")}`);
  }
  headerLines.push(`- Dokumentet er laget ${time(now)}.`);

  const summary = plan.summary;
  const planLines: string[] = ["## Plan og mål", ""];
  const targets = [
    summary.og !== null ? `${summary.og.source === "recipe" ? "Oppskriftsmål" : "≈ beregnet"} OG ${formatMeasurementValue("sg", summary.og.value)}` : null,
    summary.fg !== null ? `${summary.fg.source === "recipe" ? "Oppskriftsmål" : "≈ beregnet"} FG ${formatMeasurementValue("sg", summary.fg.value)}` : null,
    recipe.targets.ibu !== undefined ? `IBU ${num(recipe.targets.ibu)}` : null,
    recipe.targets.abvPct !== undefined ? `ABV ${num(recipe.targets.abvPct)} %` : null,
    recipe.targets.colorEbc !== undefined ? `farge ${num(recipe.targets.colorEbc)} EBC` : null,
  ].filter(Boolean);
  if (targets.length > 0) planLines.push(`${targets.join(", ")}.`, "");
  if (summary.assumptions.length > 0) {
    planLines.push("Antakelser brukt (ikke kalibrerte verdier):");
    for (const assumption of summary.assumptions) {
      planLines.push(`- ${assumption.label}: ${num(assumption.value, 2)} ${assumption.unit}. ${assumption.explanation} Mål for å erstatte: ${assumption.measureToReplace}`);
    }
    planLines.push("");
  }
  for (const phase of plan.phases) {
    const status = brewPlanPhaseStatus(phase, batch.currentStage);
    planLines.push(`### ${brewPlanPhaseLabels[phase.key]} (${status === "done" ? "ferdig" : status === "current" ? "nå" : "senere"})`);
    for (const item of phase.items) planLines.push(planItem(item));
    planLines.push("");
  }
  planLines.push("Kilde: oppskrift/import = oppgitt verdi; ≈ = beregnet fra eksplisitt profilverdi; ≈ antatt = dokumentert standardverdi; faktisk/loggført = måling.", "");

  const waterLines = buildWaterSectionLines(
    summarizeBatchWater({
      recipe,
      water: batch.equipmentSnapshot.water,
      timeline,
      totalWaterL: totalBrewingWaterL(summary),
      totalWaterAssumed: isTotalBrewingWaterAssumed(summary),
    }),
    registeredIngredientIds(log),
  );

  const equipmentLines: string[] = [`## Utstyrsprofil i batchen${batch.equipmentSnapshot.profileVersion ? ` (v${batch.equipmentSnapshot.profileVersion})` : ""}`, ""];
  const profileLines = Object.entries(equipment).flatMap(([key, value]) => {
    const parameter = getProfileParameter(key);
    return parameter && value !== undefined ? [`- ${parameter.label}: ${num(value, 2)} ${parameter.unit}`.trimEnd()] : [];
  });
  equipmentLines.push(...(profileLines.length > 0 ? profileLines : ["- Ingen verdier satt."]), "");

  const statusLines: string[] = ["## Status nå", ""];
  if (!state.stage) {
    statusLines.push(batch.status === "completed" ? "- Batchen er avsluttet." : "- Brygget er ikke startet.");
  } else {
    statusLines.push(`- Steg: ${brewStageLabels[state.stage]}${state.step ? ` — ${state.step.label}` : ""}`);
    if (state.step?.remainingMin !== null && state.step?.remainingMin !== undefined) {
      statusLines.push(`- Gjenstår i steget: ${num(Math.max(0, state.step.remainingMin), 0)} min`);
    }
    if (state.fermentationDay !== null) statusLines.push(`- Gjæringsdag ${state.fermentationDay}`);
    for (const t of state.targets) {
      const actual = t.actual
        ? `${formatMeasurementValue(t.measurementKind, t.actual.value)}${t.actual.derivedFrom === "brix" ? " (fra Brix)" : ""}`
        : "ikke målt";
      const deviation = t.actual && (t.status === "low" || t.status === "high") ? deviationFromTarget(t.target, t.actual) : null;
      const deviationText = deviation === null
        ? ""
        : ` (avvik ${deviation > 0 ? "+" : "−"}${formatMeasurementValue(t.measurementKind, Math.abs(deviation))} ${t.unit})`;
      const source = t.source === "recipe"
        ? "oppskrift/import"
        : t.source === "calculated"
          ? "≈ beregnet"
          : t.source === "assumed"
            ? `≈ antatt${t.assumptions?.length ? ` (${assumptionNames(t.assumptions)})` : ""}`
            : "";
      statusLines.push(`- ${t.label}: mål ${target(t.measurementKind, t.target)} ${t.unit}${source ? ` (${source})` : ""}, faktisk ${actual} → ${targetStatusLabels[t.status]}${deviationText}`);
    }
    if (state.forecast) {
      const volume = state.forecast.postBoilVolumeL;
      const volumeText = `${num(volume.value)} L`;
      const volumeValue = volume.source === "measured"
        ? `Målt ${volumeText}`
        : volume.source === "assumed"
          ? `≈ antatt${volume.assumptions?.length ? ` (${assumptionNames(volume.assumptions)})` : ""} ${volumeText}`
          : `≈ ${volumeText}`;
      statusLines.push(`- ${volume.source === "measured" ? "Målt volum etter kok" : "Forventet volum etter kok"}: ${volumeValue}${state.forecast.plannedPostBoilVolumeL ? ` (plan ${quantity(state.forecast.plannedPostBoilVolumeL, "L")})` : ""}${volume.basis ? `; grunnlag: ${volume.basis}` : ""}`);
      const gravity = state.forecast.postBoilOg;
      if (gravity) {
        const gravityText = formatMeasurementValue("sg", gravity.value);
        const gravityValue = gravity.source === "measured"
          ? `Målt ${gravityText}`
          : gravity.source === "assumed"
            ? `≈ antatt${gravity.assumptions?.length ? ` (${assumptionNames(gravity.assumptions)})` : ""} ${gravityText}`
            : `≈ ${gravityText}`;
        statusLines.push(`- ${gravity.source === "measured" ? "Målt OG etter kok" : "Forventet OG etter kok"}: ${gravityValue}${state.forecast.plannedOg ? ` (plan ${quantity(state.forecast.plannedOg, "SG")})` : ""}${gravity.basis ? `; grunnlag: ${gravity.basis}` : ""}`);
      }
    }
    if (state.nextAction) statusLines.push(`- Neste handling: ${state.nextAction.label}`);
  }
  statusLines.push("");

  const resultsLines: string[] = [];
  if (batch.outcomes.length > 0) {
    resultsLines.push("## Resultat", "");
    for (const o of batch.outcomes) {
      const variant = o.splitId ? (batch.splits.find((split) => split.id === o.splitId)?.name ?? "Variant") : "Hele batchen";
      const gravity = (sg: number | null, source: string | null) => (sg === null ? "ikke målt" : `${formatMeasurementValue("sg", sg)}${source === "brix" ? " (fra Brix)" : source === "manual" ? " (skrevet inn)" : ""}`);
      const { abvPct, attenuationPct } = resultNumbers(o.og, o.fg);
      const parts = [
        `OG ${gravity(o.og, o.ogSource)}`,
        `FG ${gravity(o.fg, o.fgSource)}`,
        abvPct !== null ? `ABV ${num(abvPct)} %` : null,
        attenuationPct !== null ? `forgjæring ${num(attenuationPct, 0)} %` : null,
        o.packagedVolumeL !== null ? `pakket ${num(o.packagedVolumeL)} L` : null,
        o.packaging ? packagingLabels[o.packaging] : null,
        o.carbonationVols !== null ? `${num(o.carbonationVols)} vol CO₂` : null,
        o.rating !== null ? `vurdering ${o.rating}/5` : null,
      ].filter(Boolean);
      resultsLines.push(`- ${variant}: ${parts.join(", ")}`);
      if (o.tastingNotes) resultsLines.push(`  - Smak: ${o.tastingNotes}`);
      if (o.nextTime) resultsLines.push(`  - Neste gang: ${o.nextTime}`);
    }
    resultsLines.push("");
  }

  const calibration = reviewCalibration({ batch, timeline });
  const calibrationLines: string[] = ["## Hva brygget sier om kalibreringen", ""];
  for (const o of calibration.observations) {
    const current = o.current === undefined ? "ikke satt" : `${num(o.current, 2)} ${o.unit}`;
    const value = o.suggested !== undefined ? `avvik ${num(o.observed)} ${o.unit}, foreslått ny verdi ${num(o.suggested)} ${o.unit}` : `${num(o.observed, 2)} ${o.unit}`;
    calibrationLines.push(`- ${o.label}: ${value} (profilen: ${current}). Grunnlag: ${o.basis}.`);
  }
  for (const reason of calibration.missing) calibrationLines.push(`- Ikke nok data. ${reason}`);
  calibrationLines.push("- Én batch er svakt grunnlag. En administrator avgjør og lagrer eventuelt en ny profilversjon.", "");

  const logLines: string[] = ["## Logg", ""];
  const ordered = [...timeline].sort((a, b) => a.occurredAt - b.occurredAt);
  logLines.push(...(ordered.length > 0 ? ordered.map((item) => logLine(item, batch.splits)) : ["- Ingenting logget ennå."]));

  return {
    header: sectionText(headerLines),
    plan: sectionText(planLines),
    water: sectionText(waterLines),
    equipment: sectionText(equipmentLines),
    status: sectionText(statusLines),
    results: sectionText(resultsLines),
    calibration: sectionText(calibrationLines),
    log: sectionText(logLines),
  };
}

const documentSectionOrder: (keyof BrewDocumentSections)[] = ["header", "plan", "water", "equipment", "status", "results", "calibration", "log"];

export function buildBrewDocument(input: BrewDocumentInput): string {
  const sections = buildBrewDocumentSections(input);
  return `${documentSectionOrder.map((key) => sections[key]).filter(Boolean).join("\n\n")}\n`;
}

function assistantPlanLine(batch: BatchDetail): string {
  const recipe = batch.recipeSnapshot;
  const equipment = batch.equipmentSnapshot.values;
  const summary = buildBrewPlan({ recipe, equipment, equipmentSources: batch.equipmentSnapshot.sources }).summary;
  const figures = [
    `${num(recipe.batchSizeL)} L batch`,
    `${num(recipe.boilTimeMin, 0)} min kok`,
    `${num(recipe.efficiencyPct, 0)} % planlagt effektivitet`,
    summary.og !== null ? `${summary.og.source === "recipe" ? "oppskriftsmål" : "≈ beregnet"} OG ${formatMeasurementValue("sg", summary.og.value)}` : null,
    summary.fg !== null ? `${summary.fg.source === "recipe" ? "oppskriftsmål" : "≈ beregnet"} FG ${formatMeasurementValue("sg", summary.fg.value)}` : null,
    summary.strikeVolumeL ? `${quantity(summary.strikeVolumeL, "L")} innmeskingsvann` : null,
    summary.spargeVolumeL ? `${quantity(summary.spargeVolumeL, "L")} skyllevann` : null,
    summary.spargeTemperatureC ? `${quantity(summary.spargeTemperatureC, "°C")} skyllevanntemperatur` : null,
    summary.preBoilVolumeL ? `${quantity(summary.preBoilVolumeL, "L")} før kok` : null,
  ].filter(Boolean);
  const assumptions = summary.assumptions.map((assumption) => `${assumption.label} ≈ antatt ${num(assumption.value, 2)} ${assumption.unit}`);
  return [`- Plan: ${figures.join(", ")}.`, assumptions.length > 0 ? `- Antakelser (ikke kalibrert): ${assumptions.join("; ")}.` : null].filter(Boolean).join("\n");
}

export function buildAssistantBrief(input: BrewDocumentInput, sections = buildBrewDocumentSections(input)): string {
  const logLines = sections.log.split(/\r?\n/).slice(2).filter((line) => line.trim());
  const recentLog = logLines.slice(-8);
  const retrievableSections: (keyof BrewDocumentSections)[] = ["plan", "water", "equipment", "status", "results", "calibration", "log"];
  const recentLines = recentLog.length > 0 ? recentLog : ["- Ingenting logget ennå."];

  return [
    sections.header,
    sections.status,
    assistantPlanLine(input.batch),
    "## Siste logg",
    ...recentLines,
    `Hentbare seksjoner: ${retrievableSections.join(", ")}. Loggen har ${input.timeline.length} oppføringer.`,
  ].join("\n\n");
}
