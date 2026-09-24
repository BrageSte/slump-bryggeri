import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import { buildFermentationSeries, type FermentationVariant, type GravityPoint } from "../../domain/brew-day/fermentation.ts";
import { brewhouseNumbers, resultNumbers } from "../../domain/brew-day/outcome.ts";
import {
  packagingKinds,
  packagingLabels,
  type BatchDetail,
  type BatchOutcome,
  type GravitySource,
  type PackagingKind,
} from "../../domain/model/api.ts";
import {
  Button,
  Card,
  ConfirmDialog,
  cx,
  ErrorState,
  Field,
  InlineError,
  LoadingState,
  PageHeader,
  parseDecimal,
  SectionLabel,
  TextArea,
  TextInput,
  useToast,
} from "../../design-system/index.ts";
import { formatDate, formatLogTime, formatNumber, formatSg, todayIso } from "../../lib/format.ts";
import { useBatch, useSaveOutcome, useTimeline, useUpdateBatch } from "./api.ts";
import { normalizeMeasurementValue, toBrewDayLog } from "./helpers.ts";

/**
 * «Avslutt batch» (B6): the actual result per fermenter, prefilled only from the brewery's own
 * readings with their source shown. Recipe targets are never used as actual values; anything not
 * measured stays empty ("ikke målt").
 */
export function BatchResultPage() {
  const { batchId } = useParams();
  const batch = useBatch(batchId);
  const timeline = useTimeline(batchId, false);

  if (batch.isPending || timeline.isPending) {
    return (
      <>
        <PageHeader back={`/batcher/${batchId}`} title="Resultat" />
        <LoadingState />
      </>
    );
  }
  if (batch.error || timeline.error) {
    return (
      <>
        <PageHeader back={`/batcher/${batchId}`} title="Resultat" />
        <ErrorState error={batch.error ?? timeline.error} onRetry={() => void (batch.refetch(), timeline.refetch())} />
      </>
    );
  }
  return <ResultForms batch={batch.data} log={toBrewDayLog(timeline.data)} />;
}

function ResultForms({ batch, log }: { batch: BatchDetail; log: ReturnType<typeof toBrewDayLog> }) {
  const navigate = useNavigate();
  const toast = useToast();
  const updateBatch = useUpdateBatch(batch.id);
  const [confirm, setConfirm] = useState(false);
  const wcf = batch.equipmentSnapshot.values.refractometer_wcf;
  const variants = useMemo(() => buildFermentationSeries({ log, splits: batch.splits, wcf }), [log, batch.splits, wcf]);
  // With a split, results are recorded per fermenter; readings for the whole batch are not a result.
  const forms = batch.splits.length > 0 ? variants.filter((v) => v.splitId !== null) : variants;
  const numbers = useMemo(() => brewhouseNumbers({ recipe: batch.recipeSnapshot, log, splits: batch.splits, wcf }), [batch, log, wcf]);
  const withoutResult = forms.filter((v) => !batch.outcomes.some((o) => o.splitId === v.splitId)).map((v) => v.name);

  return (
    <div className="space-y-5">
      <PageHeader back={`/batcher/${batch.id}`} title="Resultat" subtitle={`#${batch.number} · ${batch.name}`} />
      <p className="text-small text-muted">
        Fyll inn det dere har målt. Tomme felt lagres som «ikke målt»; oppskriftens mål brukes aldri som faktisk verdi.
      </p>

      {forms.map((variant) => (
        <VariantResultForm
          key={variant.splitId ?? "batch"}
          batch={batch}
          variant={variant}
          saved={batch.outcomes.find((o) => o.splitId === variant.splitId) ?? null}
        />
      ))}

      <BrewhouseCard numbers={numbers} boilTimeMin={batch.recipeSnapshot.boilTimeMin} />

      {batch.status === "completed" ? (
        <p className="text-center text-small text-muted">Batchen er avsluttet. Resultatene kan fortsatt endres.</p>
      ) : (
        <Button variant="primary" size="lg" block icon="check" onClick={() => setConfirm(true)}>
          Avslutt batch
        </Button>
      )}

      <ConfirmDialog
        open={confirm}
        title="Avslutte batchen?"
        confirmLabel="Avslutt"
        loading={updateBatch.isPending}
        onClose={() => setConfirm(false)}
        onConfirm={() =>
          updateBatch.mutate(
            { status: "completed" },
            {
              onSuccess: () => {
                setConfirm(false);
                toast("Batchen er avsluttet og ligger i historikken");
                navigate(`/batcher/${batch.id}`);
              },
            },
          )
        }
      >
        {withoutResult.length > 0
          ? `${withoutResult.join(" og ")} har ikke lagret resultat ennå. Du kan legge det inn senere.`
          : "Batchen flyttes til historikken. Resultatene kan fortsatt endres, og batchen kan gjenåpnes."}
      </ConfirmDialog>
    </div>
  );
}

interface GravityField {
  raw: string;
  source: GravitySource | null;
  /** Where a prefilled value came from, shown under the field. */
  from: string | null;
}

function gravityField(saved: number | null, savedSource: GravitySource | null, logged: GravityPoint | null, label: string): GravityField {
  if (saved !== null) return { raw: formatSg(saved), source: savedSource, from: savedSource === "manual" ? "skrevet inn" : "lagret" };
  if (logged) {
    return {
      raw: formatSg(logged.sg),
      source: logged.source,
      from: `${label} ${formatLogTime(logged.at)}${logged.source === "brix" ? " · fra Brix" : " · SG"}`,
    };
  }
  return { raw: "", source: null, from: null };
}

function VariantResultForm({ batch, variant, saved }: { batch: BatchDetail; variant: FermentationVariant; saved: BatchOutcome | null }) {
  const toast = useToast();
  const save = useSaveOutcome(batch.id);
  const split = batch.splits.find((s) => s.id === variant.splitId);
  const [og, setOg] = useState(() => gravityField(saved?.og ?? null, saved?.ogSource ?? null, variant.og, "målt"));
  const [fg, setFg] = useState(() => gravityField(saved?.fg ?? null, saved?.fgSource ?? null, variant.gravity.at(-1) ?? null, "siste måling"));
  const [volume, setVolume] = useState(saved?.packagedVolumeL == null ? "" : formatNumber(saved.packagedVolumeL, 1));
  const [packagedOn, setPackagedOn] = useState(saved?.packagedOn ?? todayIso());
  const [packaging, setPackaging] = useState<PackagingKind | null>(saved?.packaging ?? null);
  const [co2, setCo2] = useState(saved?.carbonationVols == null ? "" : formatNumber(saved.carbonationVols, 1));
  const [notes, setNotes] = useState(saved?.tastingNotes ?? "");
  const [rating, setRating] = useState<number | null>(saved?.rating ?? null);
  const [nextTime, setNextTime] = useState(saved?.nextTime ?? "");
  const [validation, setValidation] = useState<string | null>(null);

  const parseGravity = (raw: string) => {
    const value = parseDecimal(raw);
    return value === undefined || Number.isNaN(value) ? value : normalizeMeasurementValue("sg", value);
  };
  const ogValue = parseGravity(og.raw);
  const fgValue = parseGravity(fg.raw);
  const live = resultNumbers(typeof ogValue === "number" && !Number.isNaN(ogValue) ? ogValue : null, typeof fgValue === "number" && !Number.isNaN(fgValue) ? fgValue : null);
  const plannedCo2 = batch.recipeSnapshot.carbonationVols;

  function submit(event: FormEvent) {
    event.preventDefault();
    const volumeValue = parseDecimal(volume);
    const co2Value = parseDecimal(co2);
    if ([ogValue, fgValue, volumeValue, co2Value].some((v) => typeof v === "number" && Number.isNaN(v))) {
      return setValidation("Sjekk tallene: bruk tall som 1.012 eller 34,5.");
    }
    if (ogValue !== undefined && fgValue !== undefined && fgValue >= ogValue) return setValidation("FG må være lavere enn OG.");
    setValidation(null);
    save.mutate(
      {
        splitId: variant.splitId,
        og: ogValue ?? null,
        ogSource: ogValue === undefined ? null : (og.source ?? "manual"),
        fg: fgValue ?? null,
        fgSource: fgValue === undefined ? null : (fg.source ?? "manual"),
        packagedVolumeL: volumeValue ?? null,
        packagedOn: packagedOn || null,
        packaging,
        carbonationVols: co2Value ?? null,
        tastingNotes: notes.trim() || null,
        rating,
        nextTime: nextTime.trim() || null,
        baseUpdatedAt: saved?.updatedAt,
      },
      { onSuccess: () => toast(`Resultat for ${variant.name} lagret`) },
    );
  }

  const facts = [split?.vessel, split?.volumeL ? `${formatNumber(split.volumeL, 0)} L til gjæring` : null].filter(Boolean);
  return (
    <form onSubmit={submit} aria-label={`Resultat ${variant.name}`}>
    <Card className="space-y-4">
      <div>
        <h2 className="text-section font-bold">{variant.name}</h2>
        {facts.length > 0 && <p className="text-small text-muted">{facts.join(" · ")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="OG" hint={og.from ?? "ikke målt"}>
          {(p) => (
            <TextInput
              {...p}
              inputMode="decimal"
              placeholder="1.060"
              value={og.raw}
              onChange={(e) => setOg({ raw: e.target.value, source: "manual", from: "skrevet inn" })}
              className="tabular"
            />
          )}
        </Field>
        <Field label="FG" hint={fg.from ?? "ikke målt"}>
          {(p) => (
            <TextInput
              {...p}
              inputMode="decimal"
              placeholder="1.012"
              value={fg.raw}
              onChange={(e) => setFg({ raw: e.target.value, source: "manual", from: "skrevet inn" })}
              className="tabular"
            />
          )}
        </Field>
      </div>
      <p className="rounded-md bg-surface-2 px-3 py-2 text-small">
        {live.abvPct === null ? (
          <span className="text-muted">ABV og forgjæring regnes ut når OG og FG er fylt inn.</span>
        ) : (
          <>
            ABV <strong className="tabular">{formatNumber(live.abvPct, 1)} %</strong> · forgjæring{" "}
            <strong className="tabular">{formatNumber(live.attenuationPct, 0)} %</strong>
          </>
        )}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Pakket volum (L)">
          {(p) => <TextInput {...p} inputMode="decimal" value={volume} onChange={(e) => setVolume(e.target.value)} className="tabular" />}
        </Field>
        <Field label="Pakkedato">{(p) => <TextInput {...p} type="date" value={packagedOn} onChange={(e) => setPackagedOn(e.target.value)} />}</Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-small font-semibold">Pakning</legend>
        <div className="flex flex-wrap gap-2">
          {packagingKinds.map((kind) => (
            <ToggleChip key={kind} pressed={packaging === kind} onClick={() => setPackaging(packaging === kind ? null : kind)}>
              {packagingLabels[kind]}
            </ToggleChip>
          ))}
        </div>
      </fieldset>

      <Field label="Karbonering (vol CO₂)" hint={plannedCo2 === undefined ? undefined : `Plan ${formatNumber(plannedCo2, 1)}`}>
        {(p) => <TextInput {...p} inputMode="decimal" value={co2} onChange={(e) => setCo2(e.target.value)} className="tabular" />}
      </Field>

      <Field label="Smaksnotat">
        {(p) => <TextArea {...p} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Aroma, smak, munnfølelse …" />}
      </Field>

      <fieldset>
        <legend className="mb-2 text-small font-semibold">Karakter</legend>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((value) => (
            <ToggleChip key={value} pressed={rating === value} onClick={() => setRating(rating === value ? null : value)} label={`${value} av 5`}>
              {value}
            </ToggleChip>
          ))}
        </div>
      </fieldset>

      <Field label="Neste gang">
        {(p) => <TextArea {...p} value={nextTime} onChange={(e) => setNextTime(e.target.value)} placeholder="Hva gjør vi annerledes?" />}
      </Field>

      {(validation || save.error) && <InlineError>{validation ?? save.error?.message}</InlineError>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {saved && (
          <p className="text-small text-muted">
            Lagret {formatDate(saved.updatedAt)} av {saved.updatedBy.name}
          </p>
        )}
        <Button type="submit" variant="primary" loading={save.isPending} className="ml-auto">
          Lagre {variant.name}
        </Button>
      </div>
    </Card>
    </form>
  );
}

function ToggleChip({ pressed, onClick, children, label }: { pressed: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={cx(
        "min-h-11 min-w-11 rounded-full border px-4 text-small font-semibold tabular",
        pressed ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
      )}
    >
      {children}
    </button>
  );
}

function BrewhouseCard({ numbers, boilTimeMin }: { numbers: ReturnType<typeof brewhouseNumbers>; boilTimeMin: number }) {
  return (
    <Card className="space-y-2">
      <SectionLabel>Bryggeri-tall</SectionLabel>
      <dl className="grid gap-2 text-small">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted">Fordampning</dt>
          <dd className="tabular font-semibold">
            {numbers.boilOffLPerHour === null
              ? "–"
              : `${formatNumber(numbers.boilOffLPerHour, 1)} L/t (${formatNumber(numbers.preBoilVolumeL, 1)} → ${formatNumber(numbers.postBoilVolumeL, 1)} L, ${boilTimeMin} min)`}
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="text-muted">Brygghuseffektivitet</dt>
          <dd className="tabular font-semibold">
            {numbers.efficiencyPct === null
              ? "–"
              : `${formatNumber(numbers.efficiencyPct, 0)} % (OG ${formatSg(numbers.og?.sg)}, ${formatNumber(numbers.fermenterVolumeL, 1)} L)`}
          </dd>
        </div>
      </dl>
      {numbers.missing.length > 0 && <p className="text-caption text-muted">Mangler for å regne ut: {numbers.missing.join(", ")}.</p>}
      <p className="text-caption text-muted">Bruk tallene når dere oppdaterer kalibreringen under Mer.</p>
    </Card>
  );
}
