import { useId, useState, type FormEvent } from "react";
import {
  brixToSg,
  defaultMeasurementUnit,
  measurementFromCanonical,
  measurementToCanonical,
  measurementUnitOptions,
  refractometerFinalGravity,
} from "../../domain/brewing-calculations/index.ts";
import { compareMeasurementToTarget, type TargetValue } from "../../domain/brew-day/state.ts";
import type { BatchSplit } from "../../domain/model/api.ts";
import { commonPhStripIntervals, fermentationHasStarted, measurementKindSpecs, type BrewStage, type MeasurementKind } from "../../domain/model/brewing.ts";
import { phSamplePointLabels, phSamplePoints, type PhSamplePoint } from "../../domain/model/water.ts";
import { mashPhGuidance } from "../../domain/water/guidance.ts";
import { classifyPhSamplePoint, isHotPhSample, labelForPhSamplePoint } from "../../domain/water/ph.ts";
import { Button, cx, Field, InlineError, parseDecimal, Select, TargetStatusChip, TextInput } from "../../design-system/index.ts";
import { formatLogTime, formatSg, toDateTimeLocal } from "../../lib/format.ts";
import { formatMeasurement, formatMeasurementInUnit, formatTargetInUnit, normalizeMeasurementValue } from "./helpers.ts";
import { OccurredAtInput, occurredAtOf } from "./OccurredAtInput.tsx";

export interface MeasurementSubmit {
  kind: MeasurementKind;
  value: number;
  valueMin?: number;
  valueMax?: number;
  unit?: string;
  label?: string;
  instrument?: string | null;
  /** Temperature of the sample, °C. Only pH asks for it; null means «ikke oppgitt», absent means not asked. */
  sampleTempC?: number | null;
  stage: BrewStage | null;
  splitId: string | null;
  measuredAt?: number;
  comment?: string;
}

function formatPh(value: number): string {
  return value.toLocaleString("nb-NO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/**
 * Brew-day measurement entry (spec §33): big numeric field with the unit, the target,
 * the previous reading and the time pre-filled to "now".
 */
export function MeasurementInput({
  kind,
  stage,
  originalBrix,
  label: presetLabel,
  target,
  previous,
  wcf = 1,
  splits = [],
  defaultSplitId = null,
  submitting,
  error,
  submitLabel,
  initial,
  onSubmit,
}: {
  kind: MeasurementKind;
  stage: BrewStage | null;
  label?: string;
  target?: TargetValue;
  previous?: { value: number; occurredAt: number } | null;
  wcf?: number;
  originalBrix?: number;
  splits?: BatchSplit[];
  defaultSplitId?: string | null;
  submitting?: boolean;
  error?: string | null;
  submitLabel?: string;
  initial?: {
    value: number;
    enteredValue: number;
    enteredUnit: string;
    valueMin: number | null;
    valueMax: number | null;
    occurredAt: number;
    splitId: string | null;
    label: string | null;
    comment: string | null;
    instrument: string | null;
    sampleTempC?: number | null;
  };
  onSubmit: (value: MeasurementSubmit) => void;
}) {
  const spec = measurementKindSpecs[kind];
  const valueId = useId();
  const unitId = useId();
  const [raw, setRaw] = useState(() => initial ? String(initial.enteredValue) : "");
  const [unit, setUnit] = useState(() => {
    if (initial?.enteredUnit && measurementUnitOptions[kind].includes(initial.enteredUnit)) return initial.enteredUnit;
    return defaultMeasurementUnit(kind);
  });
  const [customUnit, setCustomUnit] = useState(initial && kind === "custom" ? initial.enteredUnit : "");
  const [phMode, setPhMode] = useState<"point" | "strips">(() =>
    initial ? initial.valueMin !== null && initial.valueMax !== null ? "strips" : "point" : "strips",
  );
  const [stripMinRaw, setStripMinRaw] = useState(initial?.valueMin == null ? "" : String(initial.valueMin));
  const [stripMaxRaw, setStripMaxRaw] = useState(initial?.valueMax == null ? "" : String(initial.valueMax));
  const [selectedStripRange, setSelectedStripRange] = useState<string | null>(() => {
    const range = commonPhStripIntervals.find((candidate) => candidate.min === initial?.valueMin && candidate.max === initial?.valueMax);
    return range ? `${range.min.toFixed(1)}-${range.max.toFixed(1)}` : null;
  });
  const [label, setLabel] = useState(initial?.label ?? presetLabel ?? "");
  // Where the pH sample was taken. Read from the stage and label, so older entries show their point too;
  // the label is only rewritten when the brewer picks a point.
  const [phPoint, setPhPoint] = useState<PhSamplePoint | null>(() => classifyPhSamplePoint({ stage, label: initial?.label ?? presetLabel }));
  const [sampleTempRaw, setSampleTempRaw] = useState(initial?.sampleTempC == null ? "" : String(initial.sampleTempC).replace(".", ","));
  const [instrument, setInstrument] = useState(initial?.instrument && initial.instrument !== "pH-strips" ? initial.instrument : "");
  const [comment, setComment] = useState(initial?.comment ?? "");
  const [showMore, setShowMore] = useState(Boolean(initial?.comment));
  const [customTime, setCustomTime] = useState<string | null>(initial ? toDateTimeLocal(initial.occurredAt) : null);
  const [splitId, setSplitId] = useState<string | null>(initial?.splitId ?? defaultSplitId);
  const [validation, setValidation] = useState<string | null>(null);

  const parsed = parseDecimal(raw);
  const isPhStrips = kind === "ph" && phMode === "strips";
  const stripMin = parseDecimal(stripMinRaw);
  const stripMax = parseDecimal(stripMaxRaw);
  const hasPhRange = isPhStrips && stripMin !== undefined && stripMax !== undefined && !Number.isNaN(stripMin) && !Number.isNaN(stripMax);
  const intervalMin = hasPhRange ? stripMin : undefined;
  const intervalMax = hasPhRange ? stripMax : undefined;
  const typedValue = isPhStrips ? hasPhRange ? (stripMin + stripMax) / 2 : undefined : parsed;
  const enteredValue = typedValue === undefined || Number.isNaN(typedValue)
    ? undefined
    : kind === "sg" && unit === "SG"
      ? normalizeMeasurementValue(kind, typedValue)
      : typedValue;
  const value = enteredValue === undefined
    ? undefined
    : kind === "custom"
      ? enteredValue
      : measurementToCanonical(kind, enteredValue, unit) ?? undefined;
  const sampleTemp = parseDecimal(sampleTempRaw);
  const sampleTempValid = sampleTemp === undefined || (!Number.isNaN(sampleTemp) && sampleTemp >= -10 && sampleTemp <= 110);
  const hotSample = kind === "ph" && sampleTemp !== undefined && !Number.isNaN(sampleTemp) && isHotPhSample(sampleTemp);
  const orderedPhRange = !isPhStrips || (intervalMin !== undefined && intervalMax !== undefined && intervalMin <= intervalMax);
  const boundsInRange = !isPhStrips || (intervalMin !== undefined && intervalMax !== undefined && intervalMin >= spec.min && intervalMax <= spec.max);
  const inRange = value !== undefined && value >= spec.min && value <= spec.max && orderedPhRange && boundsInRange;
  const fermentationStarted = fermentationHasStarted(stage);
  const brixEstimate = kind !== "brix" || value === undefined || !inRange
    ? undefined
    : fermentationStarted
      ? originalBrix === undefined
        ? undefined
        : refractometerFinalGravity({ originalBrix, finalBrix: value, wcf })
      : brixToSg(value, wcf);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (isPhStrips && !hasPhRange) return setValidation("Velg eller skriv inn et pH-intervall.");
    if (isPhStrips && !orderedPhRange) return setValidation("Fra-verdien må være lik eller lavere enn til-verdien.");
    if (enteredValue === undefined) return setValidation("Skriv inn en verdi.");
    if (!inRange) {
      const min = kind === "custom" ? spec.min : measurementFromCanonical(kind, spec.min, unit) ?? spec.min;
      const max = kind === "custom" ? spec.max : measurementFromCanonical(kind, spec.max, unit) ?? spec.max;
      return setValidation(`Verdien må være mellom ${formatMeasurementInUnit(kind, min, unit)} og ${formatMeasurementInUnit(kind, max, unit)} ${unit}.`);
    }
    if (kind === "custom" && (!customUnit.trim() || !label.trim())) return setValidation("Egendefinerte målinger trenger navn og enhet.");
    if (kind === "ph" && !sampleTempValid) return setValidation("Prøvetemperaturen må være mellom −10 og 110 °C.");
    setValidation(null);
    onSubmit({
      kind,
      value: enteredValue,
      valueMin: isPhStrips ? intervalMin : undefined,
      valueMax: isPhStrips ? intervalMax : undefined,
      unit: kind === "custom" ? customUnit.trim() : unit,
      label: label.trim() || undefined,
      instrument: isPhStrips ? "pH-strips" : kind === "ph" ? instrument || null : initial?.instrument ?? null,
      ...(kind === "ph" ? { sampleTempC: sampleTemp === undefined || Number.isNaN(sampleTemp) ? null : sampleTemp } : {}),
      stage,
      splitId,
      // "Nå" while correcting an entry means the current time, not the entry's original one.
      measuredAt: occurredAtOf(customTime) ?? (initial ? Date.now() : undefined),
      comment: comment.trim() || undefined,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {kind === "custom" && (
        <div className="grid grid-cols-[1fr_7rem] gap-3">
          <Field label="Hva måles?">
            {(p) => <TextInput {...p} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Oppløst O₂" />}
          </Field>
          <Field label="Enhet">{(p) => <TextInput {...p} value={customUnit} onChange={(e) => setCustomUnit(e.target.value)} placeholder="ppm" />}</Field>
        </div>
      )}

      {kind === "ph" && (
        <div role="group" aria-label="pH-registrering" className="grid grid-cols-2 gap-2">
          {(["point", "strips"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={phMode === mode}
              onClick={() => {
                setPhMode(mode);
                setValidation(null);
              }}
              className={cx(
                "min-h-11 rounded-md border px-3 text-small font-semibold",
                phMode === mode ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface",
              )}
            >
              {mode === "point" ? "Enkeltverdi" : "Intervall (strips)"}
            </button>
          ))}
        </div>
      )}

      {isPhStrips && (
        <fieldset className="space-y-3">
          <legend className="mb-2 text-small font-semibold">Intervall fra pH-strips</legend>
          <div className="grid grid-cols-3 gap-2">
            {commonPhStripIntervals.map((range) => {
              const key = `${range.min.toFixed(1)}-${range.max.toFixed(1)}`;
              const selected = selectedStripRange === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setStripMinRaw(range.min.toFixed(1));
                    setStripMaxRaw(range.max.toFixed(1));
                    setSelectedStripRange(key);
                    setValidation(null);
                  }}
                  className={cx(
                    "min-h-11 rounded-md border px-2 text-small font-semibold tabular",
                    selected ? "border-primary bg-primary-soft text-primary-strong" : "border-border bg-surface",
                  )}
                >
                  {formatPh(range.min)}–{formatPh(range.max)}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fra pH">
              {(p) => <TextInput {...p} inputMode="decimal" value={stripMinRaw} onChange={(event) => { setStripMinRaw(event.target.value); setSelectedStripRange(null); }} placeholder="5,8" />}
            </Field>
            <Field label="Til pH">
              {(p) => <TextInput {...p} inputMode="decimal" value={stripMaxRaw} onChange={(event) => { setStripMaxRaw(event.target.value); setSelectedStripRange(null); }} placeholder="6,0" />}
            </Field>
          </div>
        </fieldset>
      )}

      {!isPhStrips && <div>
        <label htmlFor={valueId} className="sr-only">
          {spec.label}
        </label>
        <div className="flex items-center gap-2 rounded-card border-2 border-border bg-surface px-3 py-2 focus-within:border-primary-strong">
          <input
            id={valueId}
            autoFocus
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder={kind === "sg" ? "1.050" : "0"}
            className="tabular min-w-0 flex-1 bg-transparent px-1 text-display font-bold tracking-tight outline-none placeholder:text-muted/40"
          />
          {kind === "custom" ? (
            <span className="max-w-24 truncate text-section font-semibold text-muted">{customUnit}</span>
          ) : measurementUnitOptions[kind].length === 1 ? (
            <span className="shrink-0 text-section font-semibold text-muted">{unit}</span>
          ) : (
            // The width lives on a wrapper: Select's own `w-full` would win over a width class
            // (cx does not merge Tailwind classes) and squeeze the number field to nothing.
            <div className="w-28 shrink-0">
              <label htmlFor={unitId} className="sr-only">Måleenhet</label>
              <Select
                id={unitId}
                aria-label="Måleenhet"
                className="font-semibold"
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              >
                {measurementUnitOptions[kind].map((option) => <option key={option} value={option}>{option}</option>)}
              </Select>
            </div>
          )}
        </div>
        <div className="mt-2 flex min-h-7 flex-wrap items-center gap-x-4 gap-y-1 text-small text-muted">
          {target && (
            <span className="tabular">
              Mål <strong className="text-text">{formatTargetInUnit(kind, target, unit)}</strong>
            </span>
          )}
          {target && value !== undefined && inRange && (
            <TargetStatusChip status={hotSample ? "uncertain" : compareMeasurementToTarget(kind, target, { value, valueMin: intervalMin, valueMax: intervalMax })} />
          )}
          {kind !== "custom" && unit !== spec.unit && value !== undefined && inRange && (
            <span className="tabular">{formatMeasurementInUnit(kind, enteredValue ?? value, unit)} {unit} = {formatMeasurement(kind, value)} {spec.unit}</span>
          )}
          {kind === "brix" && value !== undefined && inRange && !fermentationStarted && (
            <span className="tabular">≈ SG <strong className="text-text">{formatSg(brixEstimate ?? 0)}</strong>{wcf !== 1 && ` (WCF ${wcf})`}</span>
          )}
          {kind === "brix" && value !== undefined && inRange && fermentationStarted && originalBrix !== undefined && (
            <span className="tabular">
              FG-anslag <strong className="text-text">{formatSg(brixEstimate ?? 0)}</strong> · Terrill 2011 · WCF {wcf};
              usikkerhet avhenger av WCF og målerens nøyaktighet
            </span>
          )}
          {kind === "brix" && value !== undefined && inRange && fermentationStarted && originalBrix === undefined && (
            <span>SG etter gjæring krever en målt Brix-verdi fra før gjæring.</span>
          )}
          {previous && (
            <button
              type="button"
              className="tabular min-h-7 underline decoration-dotted underline-offset-4"
              onClick={() => {
                const previousValue = kind === "custom" ? previous.value : measurementFromCanonical(kind, previous.value, unit) ?? previous.value;
                setRaw(formatMeasurementInUnit(kind, previousValue, unit));
              }}
            >
              Forrige: {formatMeasurementInUnit(kind, kind === "custom" ? previous.value : measurementFromCanonical(kind, previous.value, unit) ?? previous.value, unit)} {unit} ({formatLogTime(previous.occurredAt)})
            </button>
          )}
        </div>
      </div>
      }

      {kind === "ph" && (
        <div className="space-y-3">
          <fieldset>
            <legend className="mb-2 text-small font-semibold">Hvor i brygget?</legend>
            <div className="flex flex-wrap gap-2">
              {phSamplePoints.map((point) => (
                <button
                  key={point}
                  type="button"
                  aria-pressed={phPoint === point}
                  onClick={() => {
                    setPhPoint(point);
                    // The stage already implies some points; then no label is needed (and an old one is dropped).
                    setLabel(labelForPhSamplePoint(point, stage) ?? "");
                  }}
                  className={cx(
                    "min-h-11 rounded-full border px-4 text-small font-semibold",
                    phPoint === point ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
                  )}
                >
                  {phSamplePointLabels[point]}
                </button>
              ))}
            </div>
            {phPoint === null && <p className="mt-2 text-small text-muted">Ikke angitt. Velg et punkt så målingen kan sammenlignes med andre brygg.</p>}
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Prøvetemperatur (°C)" error={sampleTempValid ? undefined : "Mellom −10 og 110 °C"}>
              {(p) => (
                <TextInput {...p} inputMode="decimal" value={sampleTempRaw} onChange={(e) => setSampleTempRaw(e.target.value)} placeholder="22" className="tabular" />
              )}
            </Field>
            {!isPhStrips && (
              <Field label="Instrument">
                {(p) => (
                  <Select {...p} value={instrument} onChange={(e) => setInstrument(e.target.value)}>
                    <option value="">Ikke oppgitt</option>
                    <option value="pH-meter">pH-meter</option>
                    {instrument && instrument !== "pH-meter" && <option value={instrument}>{instrument}</option>}
                  </Select>
                )}
              </Field>
            )}
          </div>
          <p className={cx("text-small", hotSample ? "font-semibold text-warning" : "text-muted")}>
            {hotSample
              ? `Varm prøve (over ${mashPhGuidance.hotSampleAboveC} °C): leser lavere enn ved romtemperatur, så den dømmes ikke mot målet.`
              : mashPhGuidance.note}
          </p>
        </div>
      )}

      {splits.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-small font-semibold">Gjelder</legend>
          <div className="flex flex-wrap gap-2">
            {[{ id: null, name: "Hele batchen" }, ...splits].map((split) => (
              <button
                key={split.id ?? "all"}
                type="button"
                aria-pressed={splitId === split.id}
                onClick={() => setSplitId(split.id)}
                className={cx(
                  "min-h-11 rounded-full border px-4 text-small font-semibold",
                  splitId === split.id ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
                )}
              >
                {split.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <div className="flex flex-wrap items-center gap-2 text-small">
        <OccurredAtInput value={customTime} onChange={setCustomTime} />
        {!showMore && (
          <button type="button" onClick={() => setShowMore(true)} className="min-h-11 text-muted underline underline-offset-4">
            + notat
          </button>
        )}
      </div>

      {showMore && (
        <div className="grid gap-3 sm:grid-cols-2">
          {kind !== "custom" && (
            <Field label="Merkelapp" hint="F.eks. «Etter pumpe» eller «Før kok»">
              {(p) => <TextInput {...p} value={label} onChange={(e) => setLabel(e.target.value)} />}
            </Field>
          )}
          <Field label="Notat">{(p) => <TextInput {...p} value={comment} onChange={(e) => setComment(e.target.value)} />}</Field>
        </div>
      )}

      {(validation || error) && <InlineError>{validation ?? error}</InlineError>}
      <Button type="submit" variant="primary" size="lg" block loading={submitting}>
        {submitLabel ?? `Logg ${spec.label.toLowerCase()}`}
      </Button>
    </form>
  );
}
