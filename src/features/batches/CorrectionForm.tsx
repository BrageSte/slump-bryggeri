import { useState } from "react";
import type { BatchDetail, TimelineItem } from "../../domain/model/api.ts";
import { brewStageLabels, brewStages, type BrewStage } from "../../domain/model/brewing.ts";
import { Button, Field, InlineError, parseDecimal, Select, TextInput } from "../../design-system/index.ts";
import { toDateTimeLocal } from "../../lib/format.ts";
import { useToast } from "../../design-system/Toast.tsx";
import { useCorrectLogEntry } from "./api.ts";
import { MeasurementInput, type MeasurementSubmit } from "./MeasurementInput.tsx";

export function CorrectionForm({
  batch,
  item,
  originalBrix,
  onCancel,
  onSaved,
}: {
  batch: BatchDetail;
  item: TimelineItem;
  originalBrix?: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  if (item.measurement) {
    return (
      <MeasurementCorrection
        batch={batch}
        item={item}
        originalBrix={originalBrix}
        onCancel={onCancel}
        onSaved={onSaved}
      />
    );
  }
  return <EventCorrection item={item} batch={batch} onCancel={onCancel} onSaved={onSaved} />;
}

function MeasurementCorrection({
  batch,
  item,
  originalBrix,
  onCancel,
  onSaved,
}: {
  batch: BatchDetail;
  item: TimelineItem;
  originalBrix?: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const update = useCorrectLogEntry(batch.id);
  const toast = useToast();
  const measurement = item.measurement!;
  const [stage, setStage] = useState<BrewStage | null>(item.stage);

  function submit(input: MeasurementSubmit) {
    update.mutate(
      {
        eventId: item.id,
        entryKind: "measurement",
        baseUpdatedAt: item.updatedAt ?? item.createdAt,
        value: input.value,
        valueMin: input.valueMin,
        valueMax: input.valueMax,
        unit: input.unit ?? measurement.unit,
        // A custom measurement needs its name; for the rest an emptied label clears it (e.g. a pH sample point the stage already implies).
        label: measurement.kind === "custom" ? (input.label ?? measurement.label) : (input.label ?? null),
        occurredAt: input.measuredAt ?? item.occurredAt,
        stage,
        splitId: input.splitId,
        // Only pH asks for the temperature; other kinds keep what the entry had.
        sampleTempC: input.sampleTempC === undefined ? measurement.sampleTempC : input.sampleTempC,
        instrument: input.instrument === undefined ? measurement.instrument : input.instrument,
        comment: input.comment ?? null,
      },
      { onSuccess: () => (toast("Loggføringen er korrigert"), onSaved()) },
    );
  }

  return (
    <div className="space-y-4">
      <Field label="Steg">
        {(props) => (
          <Select {...props} value={stage ?? ""} onChange={(event) => setStage(event.target.value ? event.target.value as BrewStage : null)}>
            <option value="">Uten steg</option>
            {brewStages.map((brewStage) => <option key={brewStage} value={brewStage}>{brewStageLabels[brewStage]}</option>)}
          </Select>
        )}
      </Field>
      <MeasurementInput
        kind={measurement.kind}
        stage={stage}
        originalBrix={originalBrix}
        label={measurement.label ?? undefined}
        previous={null}
        wcf={batch.equipmentSnapshot.values.refractometer_wcf ?? 1}
        splits={batch.splits}
        defaultSplitId={item.splitId}
        submitting={update.isPending}
        error={update.error?.message}
        submitLabel="Lagre korrigering"
        initial={{
          value: measurement.value,
          enteredValue: measurement.enteredValue,
          enteredUnit: measurement.enteredUnit,
          valueMin: measurement.valueMin,
          valueMax: measurement.valueMax,
          occurredAt: item.occurredAt,
          splitId: item.splitId,
          label: measurement.label,
          comment: measurement.comment,
          instrument: measurement.instrument,
          sampleTempC: measurement.sampleTempC,
        }}
        onSubmit={submit}
      />
      <Button variant="ghost" block onClick={onCancel}>Avbryt korrigering</Button>
    </div>
  );
}

function EventCorrection({
  item,
  batch,
  onCancel,
  onSaved,
}: {
  item: TimelineItem;
  batch: BatchDetail;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const update = useCorrectLogEntry(batch.id);
  const toast = useToast();
  const data = item.data ?? {};
  const amountKey = typeof data.amount === "number" ? "amount" : Object.entries(data).find(([, value]) => typeof value === "number")?.[0] ?? "value";
  const initialValue = data[amountKey];
  const [rawValue, setRawValue] = useState(typeof initialValue === "number" ? String(initialValue) : "");
  const [unit, setUnit] = useState(typeof data.unit === "string" ? data.unit : "");
  const [note, setNote] = useState(typeof data.note === "string" ? data.note : "");
  const [stage, setStage] = useState<BrewStage | null>(item.stage);
  const [splitId, setSplitId] = useState<string | null>(item.splitId);
  const [occurredAt, setOccurredAt] = useState(toDateTimeLocal(item.occurredAt));
  const [validation, setValidation] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsedValue = parseDecimal(rawValue);
    if (rawValue.trim() && (parsedValue === undefined || Number.isNaN(parsedValue))) return setValidation("Skriv inn et gyldig tall.");
    if (!occurredAt || Number.isNaN(new Date(occurredAt).getTime())) return setValidation("Velg et gyldig tidspunkt.");

    const nextData: Record<string, unknown> = { ...data, note: note.trim() || null };
    if (rawValue.trim() && parsedValue !== undefined) nextData[amountKey] = parsedValue;
    else delete nextData[amountKey];
    if (unit.trim()) nextData.unit = unit.trim();
    else delete nextData.unit;

    setValidation(null);
    update.mutate(
      {
        eventId: item.id,
        entryKind: "event",
        baseUpdatedAt: item.updatedAt ?? item.createdAt,
        occurredAt: new Date(occurredAt).getTime(),
        stage,
        splitId,
        data: nextData,
      },
      { onSuccess: () => (toast("Loggføringen er korrigert"), onSaved()) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label={amountKey === "amount" ? "Mengde" : "Verdi"}>
          {(props) => <TextInput {...props} inputMode="decimal" value={rawValue} onChange={(event) => setRawValue(event.target.value)} />}
        </Field>
        <Field label="Enhet">
          {(props) => <TextInput {...props} value={unit} onChange={(event) => setUnit(event.target.value)} />}
        </Field>
      </div>
      <Field label="Steg">
        {(props) => (
          <Select {...props} value={stage ?? ""} onChange={(event) => setStage(event.target.value ? event.target.value as BrewStage : null)}>
            <option value="">Uten steg</option>
            {brewStages.map((brewStage) => <option key={brewStage} value={brewStage}>{brewStageLabels[brewStage]}</option>)}
          </Select>
        )}
      </Field>
      {batch.splits.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-small font-semibold">Variant</legend>
          <div className="flex flex-wrap gap-2">
            {[{ id: null, name: "Hele batchen" }, ...batch.splits].map((split) => (
              <button
                key={split.id ?? "all"}
                type="button"
                aria-pressed={splitId === split.id}
                onClick={() => setSplitId(split.id)}
                className={`min-h-11 rounded-full border px-4 text-small font-semibold ${splitId === split.id ? "border-primary bg-primary text-on-primary" : "border-border bg-surface"}`}
              >
                {split.name}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <Field label="Tidspunkt">{(props) => <TextInput {...props} type="datetime-local" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} />}</Field>
      <Field label="Notat">{(props) => <TextInput {...props} value={note} onChange={(event) => setNote(event.target.value)} />}</Field>
      {(validation || update.error) && <InlineError>{validation ?? update.error?.message}</InlineError>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" loading={update.isPending}>Lagre korrigering</Button>
        <Button variant="ghost" onClick={onCancel}>Avbryt</Button>
      </div>
    </form>
  );
}
