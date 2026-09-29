import { buildBrewPlan, brewPlanPhaseLabels, brewPlanPhaseStatus, registeredIngredientIds, type BrewPlanItem, type PlanQuantity } from "../brew-day/brew-plan.ts";
import { resultNumbers } from "../brew-day/outcome.ts";
import { deriveBrewDayState, deviationFromTarget, type BrewDayLogEntry, type TargetStatus, type TargetValue } from "../brew-day/state.ts";
import { packagingLabels, type BatchDetail, type TimelineItem } from "../model/api.ts";
import { batchStatusLabels, brewStageLabels, eventTypeLabels, formatMeasurementValue, measurementKindSpecs } from "../model/brewing.ts";
import { getProfileParameter } from "../model/equipment-profile.ts";
import { reviewCalibration } from "./tuning.ts";

/**
 * The brew document (M10): one plain-text (Markdown) account of a batch — plan, equipment
 * snapshot, where the brew stands, and every log entry in order. Deterministic and built only from
 * the batch's own data; it is what the brewer copies, and what the assistant reads as context.
 * Planned values are labelled as plan, calculated ones with "≈", and nothing unmeasured is filled in.
 */

const TIME_ZONE = "Europe/Oslo";
const targetStatusLabels: Record<TargetStatus, string> = {
  ok: "OK",
  low: "Lav",
  high: "Høy",
  uncertain: "Usikker",
  missing: "Ikke målt",
};

const num = (value: number, decimals = 1) =>
  value.toLocaleString("nb-NO", { minimumFractionDigits: 0, maximumFractionDigits: decimals });

function time(timestamp: number): string {
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function quantity(q: PlanQuantity | undefined, unit: string): string | null {
  if (!q) return null;
  return `${q.source === "calculated" ? "≈ " : ""}${num(q.value)} ${unit}`;
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
  const log: BrewDayLogEntry[] = timeline.map((item) => ({
    id: item.id,
    type: item.type,
    splitId: item.splitId,
    stage: item.stage,
    occurredAt: item.occurredAt,
    data: item.data,
    measurement: item.measurement
      ? { kind: item.measurement.kind, value: item.measurement.value, valueMin: item.measurement.valueMin, valueMax: item.measurement.valueMax }
      : null,
  }));
  const equipment = batch.equipmentSnapshot.values;
  const plan = buildBrewPlan({ recipe, equipment, doneIngredientIds: registeredIngredientIds(log) });
  const state = deriveBrewDayState({
    recipe,
    stage: batch.currentStage,
    stageStartedAt: batch.stageStartedAt,
    log,
    now,
    wcf: equipment.refractometer_wcf,
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
    summary.og !== null ? `OG ${formatMeasurementValue("sg", summary.og)}` : null,
    summary.fg !== null ? `FG ${formatMeasurementValue("sg", summary.fg)}` : null,
    recipe.targets.ibu !== undefined ? `IBU ${num(recipe.targets.ibu)}` : null,
    recipe.targets.abvPct !== undefined ? `ABV ${num(recipe.targets.abvPct)} %` : null,
    recipe.targets.colorEbc !== undefined ? `farge ${num(recipe.targets.colorEbc)} EBC` : null,
  ].filter(Boolean);
  if (targets.length > 0) planLines.push(`Mål fra oppskriften: ${targets.join(", ")}.`, "");
  if (summary.waterVolumesNeedBoilOff) {
    planLines.push("Vannmengder kan ikke beregnes: batchens utstyrsprofil mangler fordampning.", "");
  }
  for (const phase of plan.phases) {
    const status = brewPlanPhaseStatus(phase, batch.currentStage);
    planLines.push(`### ${brewPlanPhaseLabels[phase.key]} (${status === "done" ? "ferdig" : status === "current" ? "nå" : "senere"})`);
    for (const item of phase.items) planLines.push(planItem(item));
    planLines.push("");
  }
  planLines.push("Verdier merket ≈ er beregnet fra utstyrsprofilen; andre står i oppskriften.", "");

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
      statusLines.push(`- ${t.label}: mål ${target(t.measurementKind, t.target)} ${t.unit}, faktisk ${actual} → ${targetStatusLabels[t.status]}${deviationText}`);
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
    equipment: sectionText(equipmentLines),
    status: sectionText(statusLines),
    results: sectionText(resultsLines),
    calibration: sectionText(calibrationLines),
    log: sectionText(logLines),
  };
}

const documentSectionOrder: (keyof BrewDocumentSections)[] = ["header", "plan", "equipment", "status", "results", "calibration", "log"];

export function buildBrewDocument(input: BrewDocumentInput): string {
  const sections = buildBrewDocumentSections(input);
  return `${documentSectionOrder.map((key) => sections[key]).filter(Boolean).join("\n\n")}\n`;
}

function assistantPlanLine(batch: BatchDetail): string {
  const recipe = batch.recipeSnapshot;
  const equipment = batch.equipmentSnapshot.values;
  const { og, fg } = buildBrewPlan({ recipe, equipment }).summary;
  const figures = [
    `${num(recipe.batchSizeL)} L batch`,
    `${num(recipe.boilTimeMin, 0)} min kok`,
    `${num(recipe.efficiencyPct, 0)} % planlagt effektivitet`,
    recipe.targets.og !== undefined ? `oppskriftsmål OG ${formatMeasurementValue("sg", recipe.targets.og)}` : null,
    recipe.targets.fg !== undefined ? `oppskriftsmål FG ${formatMeasurementValue("sg", recipe.targets.fg)}` : null,
    og !== null ? `≈ beregnet OG ${formatMeasurementValue("sg", og)}` : null,
    fg !== null ? `≈ beregnet FG ${formatMeasurementValue("sg", fg)}` : null,
  ].filter(Boolean);
  return `- Plan: ${figures.join(", ")}.`;
}

export function buildAssistantBrief(input: BrewDocumentInput, sections = buildBrewDocumentSections(input)): string {
  const logLines = sections.log.split(/\r?\n/).slice(2).filter((line) => line.trim());
  const recentLog = logLines.slice(-8);
  const retrievableSections: (keyof BrewDocumentSections)[] = ["plan", "equipment", "status", "results", "calibration", "log"];
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
