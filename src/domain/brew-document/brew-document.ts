import { buildBrewPlan, brewPlanPhaseLabels, brewPlanPhaseStatus, registeredIngredientIds, type BrewPlanItem, type PlanQuantity } from "../brew-day/brew-plan.ts";
import { deriveBrewDayState, type BrewDayLogEntry, type TargetValue } from "../brew-day/state.ts";
import type { BatchDetail, TimelineItem } from "../model/api.ts";
import { brewStageLabels, eventTypeLabels, formatMeasurementValue, measurementKindSpecs } from "../model/brewing.ts";
import { getProfileParameter } from "../model/equipment-profile.ts";

/**
 * The brew document (M10): one plain-text (Markdown) account of a batch — plan, equipment
 * snapshot, where the brew stands, and every log entry in order. Deterministic and built only from
 * the batch's own data; it is what the brewer copies, and what the assistant reads as context.
 * Planned values are labelled as plan, calculated ones with "≈", and nothing unmeasured is filled in.
 */

const TIME_ZONE = "Europe/Oslo";

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

export function buildBrewDocument({ batch, timeline, now }: { batch: BatchDetail; timeline: TimelineItem[]; now: number }): string {
  const recipe = batch.recipeSnapshot;
  const log: BrewDayLogEntry[] = timeline.map((item) => ({
    type: item.type,
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

  const lines: string[] = [];
  lines.push(`# Bryggedokument: ${batch.name} (#${batch.number})`, "");
  lines.push(
    `- Oppskrift: ${recipe.name} v${batch.recipeVersion.version}${recipe.style ? `, ${recipe.style}` : ""}`,
    `- Batchstørrelse ${num(recipe.batchSizeL)} L, kok ${num(recipe.boilTimeMin, 0)} min, planlagt effektivitet ${num(recipe.efficiencyPct, 0)} %`,
    `- Status: ${batch.status}${batch.currentStage ? `, steg ${brewStageLabels[batch.currentStage]}` : ", ikke startet"}${batch.brewDate ? `, bryggedato ${batch.brewDate}` : ""}`,
  );
  if (batch.splits.length > 0) {
    lines.push(`- Varianter: ${batch.splits.map((s) => `${s.name}${s.vessel ? ` (${s.vessel}${s.volumeL ? `, ${num(s.volumeL)} L` : ""})` : ""}`).join("; ")}`);
  }
  lines.push(`- Dokumentet er laget ${time(now)}.`, "");

  const summary = plan.summary;
  lines.push("## Plan og mål", "");
  const targets = [
    summary.og !== null ? `OG ${formatMeasurementValue("sg", summary.og)}` : null,
    summary.fg !== null ? `FG ${formatMeasurementValue("sg", summary.fg)}` : null,
    recipe.targets.ibu !== undefined ? `IBU ${num(recipe.targets.ibu)}` : null,
    recipe.targets.abvPct !== undefined ? `ABV ${num(recipe.targets.abvPct)} %` : null,
    recipe.targets.colorEbc !== undefined ? `farge ${num(recipe.targets.colorEbc)} EBC` : null,
  ].filter(Boolean);
  if (targets.length > 0) lines.push(`Mål fra oppskriften: ${targets.join(", ")}.`, "");
  if (summary.waterVolumesNeedBoilOff) {
    lines.push("Vannmengder kan ikke beregnes: batchens utstyrsprofil mangler fordampning.", "");
  }
  for (const phase of plan.phases) {
    const status = brewPlanPhaseStatus(phase, batch.currentStage);
    lines.push(`### ${brewPlanPhaseLabels[phase.key]} (${status === "done" ? "ferdig" : status === "current" ? "nå" : "senere"})`);
    for (const item of phase.items) lines.push(planItem(item));
    lines.push("");
  }
  lines.push("Verdier merket ≈ er beregnet fra utstyrsprofilen; andre står i oppskriften.", "");

  lines.push(`## Utstyrsprofil i batchen${batch.equipmentSnapshot.profileVersion ? ` (v${batch.equipmentSnapshot.profileVersion})` : ""}`, "");
  const profileLines = Object.entries(equipment).flatMap(([key, value]) => {
    const parameter = getProfileParameter(key);
    return parameter && value !== undefined ? [`- ${parameter.label}: ${num(value, 2)} ${parameter.unit}`.trimEnd()] : [];
  });
  lines.push(...(profileLines.length > 0 ? profileLines : ["- Ingen verdier satt."]), "");

  lines.push("## Status nå", "");
  if (!state.stage) {
    lines.push(batch.status === "completed" ? "- Batchen er avsluttet." : "- Brygget er ikke startet.");
  } else {
    lines.push(`- Steg: ${brewStageLabels[state.stage]}${state.step ? ` — ${state.step.label}` : ""}`);
    if (state.step?.remainingMin !== null && state.step?.remainingMin !== undefined) {
      lines.push(`- Gjenstår i steget: ${num(Math.max(0, state.step.remainingMin), 0)} min`);
    }
    if (state.fermentationDay !== null) lines.push(`- Gjæringsdag ${state.fermentationDay}`);
    for (const t of state.targets) {
      const actual = t.actual
        ? `${formatMeasurementValue(t.measurementKind, t.actual.value)}${t.actual.derivedFrom === "brix" ? " (fra Brix)" : ""}`
        : "ikke målt";
      lines.push(`- ${t.label}: mål ${target(t.measurementKind, t.target)} ${t.unit}, faktisk ${actual} → ${t.status}`);
    }
    if (state.nextAction) lines.push(`- Neste handling: ${state.nextAction.label}`);
  }
  lines.push("");

  lines.push("## Logg", "");
  const ordered = [...timeline].sort((a, b) => a.occurredAt - b.occurredAt);
  lines.push(...(ordered.length > 0 ? ordered.map((item) => logLine(item, batch.splits)) : ["- Ingenting logget ennå."]));
  return `${lines.join("\n")}\n`;
}
