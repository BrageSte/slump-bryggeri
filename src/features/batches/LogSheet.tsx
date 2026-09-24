import { useState, type FormEvent } from "react";
import type { PlannedAddition, TargetValue } from "../../domain/brew-day/state.ts";
import type { BatchDetail } from "../../domain/model/api.ts";
import { eventTypeLabels, ingredientKinds, measurementKindSpecs, type BrewStage, type IngredientKind, type MeasurementKind } from "../../domain/model/brewing.ts";
import { BottomSheet, Button, cx, Field, Icon, InlineError, parseDecimal, Select, TextArea, TextInput, useToast, type IconName } from "../../design-system/index.ts";
import { prepareImageForUpload } from "../../lib/image.ts";
import { formatAmount } from "../../lib/format.ts";
import { UnitConverter } from "./UnitConverter.tsx";
import { useAddComment, useLogEvent, useLogMeasurement, useUploadPhoto } from "./api.ts";
import { MeasurementInput } from "./MeasurementInput.tsx";

export type LogIntent =
  | { kind: "menu" }
  | { kind: "measurement"; measurementKind: MeasurementKind; label?: string; target?: TargetValue; previous?: { value: number; occurredAt: number } | null }
  | { kind: "comment" }
  | { kind: "photo" }
  | { kind: "converter" }
  | { kind: "addition"; addition?: PlannedAddition }
  | { kind: "event" };

const menu: { label: string; icon: IconName; intent: LogIntent }[] = [
  { label: "Temperatur", icon: "thermometer", intent: { kind: "measurement", measurementKind: "temperature" } },
  { label: "pH", icon: "droplet", intent: { kind: "measurement", measurementKind: "ph" } },
  { label: "SG", icon: "flask", intent: { kind: "measurement", measurementKind: "sg" } },
  { label: "Brix", icon: "flask", intent: { kind: "measurement", measurementKind: "brix" } },
  { label: "Trykk", icon: "gauge", intent: { kind: "measurement", measurementKind: "pressure" } },
  { label: "Volum", icon: "kettle", intent: { kind: "measurement", measurementKind: "volume" } },
  { label: "Kommentar", icon: "comment", intent: { kind: "comment" } },
  { label: "Bilde", icon: "camera", intent: { kind: "photo" } },
  { label: "Tilsetning", icon: "leaf", intent: { kind: "addition" } },
  { label: "Hendelse", icon: "flag", intent: { kind: "event" } },
  { label: "Annen måling", icon: "sliders", intent: { kind: "measurement", measurementKind: "custom" } },
  { label: "Omregner", icon: "sliders", intent: { kind: "converter" } },
];

function titleFor(intent: LogIntent): string {
  switch (intent.kind) {
    case "menu":
      return "Logg noe";
    case "measurement":
      return intent.label ?? measurementKindSpecs[intent.measurementKind].label;
    case "comment":
      return "Kommentar";
    case "photo":
      return "Bilde";
    case "addition":
      return "Tilsetning";
    case "event":
      return "Hendelse";
    case "converter":
      return "Omregner";
  }
}

export function LogSheet({
  batch,
  stage,
  originalBrix,
  intent,
  onIntent,
  onClose,
  pendingAdditions,
  currentUser,
}: {
  batch: BatchDetail;
  stage: BrewStage | null;
  originalBrix?: number;
  intent: LogIntent | null;
  onIntent: (intent: LogIntent) => void;
  onClose: () => void;
  pendingAdditions: PlannedAddition[];
  currentUser: { id: string; name: string };
}) {
  const toast = useToast();
  const logMeasurement = useLogMeasurement(batch.id, currentUser);

  return (
    <BottomSheet open={intent !== null} onClose={onClose} title={intent ? titleFor(intent) : ""}>
      {intent?.kind === "menu" && (
        <div className="grid grid-cols-3 gap-2">
          {menu.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => onIntent(item.intent)}
              className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-md border border-border bg-surface-2/50 px-2 text-small font-semibold hover:bg-surface-2"
            >
              <Icon name={item.icon} className="text-primary-strong" />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {intent?.kind === "measurement" && (
        <MeasurementInput
          key={intent.measurementKind + (intent.label ?? "")}
          kind={intent.measurementKind}
          stage={stage}
          target={intent.target}
          previous={intent.previous}
          wcf={batch.equipmentSnapshot.values.refractometer_wcf ?? 1}
          originalBrix={originalBrix}
          splits={batch.splits}
          submitting={logMeasurement.isPending}
          error={logMeasurement.error?.message}
          onSubmit={(input) => {
            logMeasurement.mutate(
              { ...input, stage, unit: input.unit ?? measurementKindSpecs[input.kind].unit ?? undefined },
              {
                onSuccess: () => {
                  toast(`${measurementKindSpecs[input.kind].label} logget`);
                  onClose();
                },
              },
            );
          }}
        />
      )}

      {intent?.kind === "comment" && <CommentForm batch={batch} stage={stage} onDone={onClose} />}
      {intent?.kind === "photo" && <PhotoForm batch={batch} stage={stage} onDone={onClose} />}
      {intent?.kind === "addition" && (
        <AdditionForm batch={batch} stage={stage} preset={intent.addition} pending={pendingAdditions} onDone={onClose} />
      )}
      {intent?.kind === "event" && <EventForm batch={batch} stage={stage} onDone={onClose} />}
      {intent?.kind === "converter" && (
        <UnitConverter initialWcf={batch.equipmentSnapshot.values.refractometer_wcf ?? 1} onBack={() => onIntent({ kind: "menu" })} />
      )}
    </BottomSheet>
  );
}

function SplitChooser({ batch, value, onChange }: { batch: BatchDetail; value: string | null; onChange: (id: string | null) => void }) {
  if (batch.splits.length === 0) return null;
  return (
    <fieldset>
      <legend className="mb-2 text-small font-semibold">Gjelder</legend>
      <div className="flex flex-wrap gap-2">
        {[{ id: null, name: "Hele batchen" }, ...batch.splits].map((split) => (
          <button
            key={split.id ?? "all"}
            type="button"
            aria-pressed={value === split.id}
            onClick={() => onChange(split.id)}
            className={cx(
              "min-h-11 rounded-full border px-4 text-small font-semibold",
              value === split.id ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
            )}
          >
            {split.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CommentForm({ batch, stage, onDone }: { batch: BatchDetail; stage: BrewStage | null; onDone: () => void }) {
  const toast = useToast();
  const addComment = useAddComment(batch.id);
  const [body, setBody] = useState("");
  const [splitId, setSplitId] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    addComment.mutate({ body: body.trim(), stage, splitId }, { onSuccess: () => (toast("Kommentar lagt til"), onDone()) });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="Kommentar">
        {(p) => <TextArea {...p} autoFocus required value={body} onChange={(e) => setBody(e.target.value)} placeholder="Lukt, smak, observasjoner …" />}
      </Field>
      <SplitChooser batch={batch} value={splitId} onChange={setSplitId} />
      {addComment.error && <InlineError>{addComment.error.message}</InlineError>}
      <Button type="submit" variant="primary" size="lg" block loading={addComment.isPending} disabled={!body.trim()}>
        Legg til
      </Button>
    </form>
  );
}

function PhotoForm({ batch, stage, onDone }: { batch: BatchDetail; stage: BrewStage | null; onDone: () => void }) {
  const toast = useToast();
  const upload = useUploadPhoto(batch.id);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [preparing, setPreparing] = useState(false);

  async function choose(selected: File | undefined) {
    if (!selected) return;
    setPreparing(true);
    const prepared = await prepareImageForUpload(selected);
    setPreparing(false);
    setFile(prepared);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(prepared.type.startsWith("image/") ? URL.createObjectURL(prepared) : null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData();
    form.set("file", file);
    if (caption.trim()) form.set("caption", caption.trim());
    if (stage) form.set("stage", stage);
    upload.mutate(form, { onSuccess: () => (toast("Bilde lagt til"), onDone()) });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-card border-2 border-dashed border-border bg-surface-2/50 text-muted">
        {preview ? (
          <img src={preview} alt="Forhåndsvisning" className="max-h-64 w-full object-contain" />
        ) : (
          <>
            <Icon name="camera" size={32} />
            <span className="font-semibold">{preparing ? "Forbereder …" : "Ta bilde eller velg fil"}</span>
          </>
        )}
        <input
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="sr-only"
          onChange={(e) => void choose(e.target.files?.[0])}
        />
      </label>
      <Field label="Bildetekst (valgfritt)">{(p) => <TextInput {...p} value={caption} onChange={(e) => setCaption(e.target.value)} />}</Field>
      {upload.error && <InlineError>{upload.error.message}</InlineError>}
      <Button type="submit" variant="primary" size="lg" block loading={upload.isPending || preparing} disabled={!file}>
        Last opp
      </Button>
    </form>
  );
}

const unitsFor: Record<IngredientKind, string[]> = {
  hop: ["g", "kg"],
  fermentable: ["kg", "g"],
  culture: ["pkg", "g", "ml"],
  misc: ["g", "ml", "stk", "ts"],
};

const kindLabels: Record<IngredientKind, string> = { hop: "Humle", fermentable: "Malt/sukker", culture: "Gjær", misc: "Annet" };

function AdditionForm({
  batch,
  stage,
  preset,
  pending,
  onDone,
}: {
  batch: BatchDetail;
  stage: BrewStage | null;
  preset?: PlannedAddition;
  pending: PlannedAddition[];
  onDone: () => void;
}) {
  const toast = useToast();
  const logEvent = useLogEvent(batch.id);
  const [selected, setSelected] = useState<PlannedAddition | null>(preset ?? null);
  const [ingredientKind, setIngredientKind] = useState<IngredientKind>(preset?.ingredientKind ?? "hop");
  const [name, setName] = useState(preset?.name ?? "");
  const [amount, setAmount] = useState(preset ? String(preset.amount).replace(".", ",") : "");
  const [unit, setUnit] = useState(preset?.unit ?? "g");
  const [note, setNote] = useState("");
  const [splitId, setSplitId] = useState<string | null>(null);

  function pick(addition: PlannedAddition) {
    setSelected(addition);
    setIngredientKind(addition.ingredientKind);
    setName(addition.name);
    setAmount(String(addition.amount).replace(".", ","));
    setUnit(addition.unit);
  }

  const parsedAmount = parseDecimal(amount);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsedAmount || Number.isNaN(parsedAmount)) return;
    logEvent.mutate(
      {
        type: "ingredient_added",
        stage,
        splitId,
        data: {
          ingredientKind,
          ingredientId: selected && selected.name === name ? selected.ingredientId : undefined,
          name: name.trim(),
          amount: parsedAmount,
          unit,
          note: note.trim() || undefined,
        },
      },
      { onSuccess: () => (toast(`${name} lagt til`), onDone()) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {pending.length > 0 && !preset && (
        <div>
          <p className="mb-2 text-small font-semibold">Fra oppskriften</p>
          <div className="flex flex-wrap gap-2">
            {pending.map((addition) => (
              <button
                key={addition.ingredientId}
                type="button"
                onClick={() => pick(addition)}
                aria-pressed={selected?.ingredientId === addition.ingredientId}
                className={cx(
                  "min-h-11 rounded-full border px-4 text-small font-semibold",
                  selected?.ingredientId === addition.ingredientId ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
                )}
              >
                {addition.name} · {formatAmount(addition.amount, addition.unit)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Type">
          {(p) => (
            <Select
              {...p}
              value={ingredientKind}
              onChange={(e) => {
                const kind = e.target.value as IngredientKind;
                setIngredientKind(kind);
                setUnit(unitsFor[kind][0] as string);
              }}
            >
              {ingredientKinds.map((k) => (
                <option key={k} value={k}>
                  {kindLabels[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Navn">{(p) => <TextInput {...p} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Mengde">
          {(p) => <TextInput {...p} required inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="tabular" />}
        </Field>
        <Field label="Enhet">
          {(p) => (
            <Select {...p} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {unitsFor[ingredientKind].map((u) => (
                <option key={u}>{u}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Notat (valgfritt)">{(p) => <TextInput {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <SplitChooser batch={batch} value={splitId} onChange={setSplitId} />
      {logEvent.error && <InlineError>{logEvent.error.message}</InlineError>}
      <Button type="submit" variant="primary" size="lg" block loading={logEvent.isPending} disabled={!name.trim() || !parsedAmount}>
        Registrer tilsetning
      </Button>
    </form>
  );
}

const eventOptions = ["yeast_pitched", "transfer_started", "transfer_completed", "cold_crash_started", "pressure_changed", "packaged", "custom"];

function EventForm({ batch, stage, onDone }: { batch: BatchDetail; stage: BrewStage | null; onDone: () => void }) {
  const toast = useToast();
  const logEvent = useLogEvent(batch.id);
  const [type, setType] = useState("transfer_started");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [splitId, setSplitId] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const data: Record<string, unknown> = {};
    if (type === "custom") data.title = title.trim();
    if (note.trim()) data.note = note.trim();
    if (type === "yeast_pitched") {
      // yeast_pitched carries an ingredient payload; use the first planned culture when there is one.
      const culture = batch.recipeSnapshot.cultures[0];
      Object.assign(data, {
        ingredientKind: "culture",
        ingredientId: culture?.id,
        name: culture?.name ?? "Gjær",
        amount: culture?.amount ?? 1,
        unit: culture?.unit ?? "pkg",
      });
    }
    logEvent.mutate(
      { type, stage, splitId, data: Object.keys(data).length > 0 ? data : undefined },
      { onSuccess: () => (toast("Hendelse logget"), onDone()) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {eventOptions.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={type === option}
            onClick={() => setType(option)}
            className={cx(
              "min-h-12 rounded-md border px-3 text-left text-small font-semibold",
              type === option ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
            )}
          >
            {option === "custom" ? "Annet …" : eventTypeLabels[option]}
          </button>
        ))}
      </div>
      {type === "custom" && (
        <Field label="Hva skjedde?">{(p) => <TextInput {...p} required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />}</Field>
      )}
      <Field label="Notat (valgfritt)">{(p) => <TextInput {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      <SplitChooser batch={batch} value={splitId} onChange={setSplitId} />
      {logEvent.error && <InlineError>{logEvent.error.message}</InlineError>}
      <Button type="submit" variant="primary" size="lg" block loading={logEvent.isPending} disabled={type === "custom" && !title.trim()}>
        Logg hendelse
      </Button>
    </form>
  );
}
