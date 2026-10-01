import { zodResolver } from "@hookform/resolvers/zod";
import { useState, type ReactNode } from "react";
import { useFieldArray, useForm, useWatch, type Control, type FieldError, type UseFormRegister } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { calculateRecipeMetrics } from "../../domain/brewing-calculations/index.ts";
import { ionInfo, ionKeys, isAcidAgent, getWaterAgent, waterAgents } from "../../domain/model/water.ts";
import { slumpBaseWater } from "../../domain/water/slump-water.ts";
import {
  cultureForms,
  emptyRecipe,
  fermentableTypeLabels,
  fermentableTypes,
  hopUseLabels,
  hopUses,
  miscUses,
  recipeDocumentSchema,
  type RecipeDocument,
} from "../../domain/model/recipe.ts";
import { Button, Card, cx, ErrorState, IconButton, InlineError, inputClasses, LoadingState, MetricCard, PageHeader, parseDecimal, SectionLabel, useToast } from "../../design-system/index.ts";
import { ApiError } from "../../lib/api.ts";
import { formatNumber, formatSg } from "../../lib/format.ts";
import { useCreateRecipe, useRecipe, useSaveRecipeVersion } from "./api.ts";

const numeric = { setValueAs: parseDecimal };
const optionalText = { setValueAs: (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v) };
const newId = () => crypto.randomUUID();

export function RecipeEditorPage() {
  const { recipeId } = useParams();
  const existing = useRecipe(recipeId);
  if (recipeId && existing.isPending) return <LoadingState />;
  if (recipeId && existing.error) return <ErrorState error={existing.error} onRetry={() => void existing.refetch()} />;
  return (
    <RecipeForm
      key={existing.data?.current.id ?? "new"}
      initial={existing.data?.current.data ?? emptyRecipe({ mashSteps: [{ id: newId(), name: "Mesk", temperatureC: 67, durationMin: 60 }] })}
      recipeId={recipeId}
      baseVersionId={existing.data?.current.id}
      version={existing.data?.current.version}
    />
  );
}

type Register = UseFormRegister<RecipeDocument>;

function Input({
  label,
  error,
  unit,
  className,
  children,
}: {
  label: string;
  error?: FieldError;
  unit?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cx("block space-y-1", className)}>
      <span className="block text-small font-semibold">{label}</span>
      <span className="relative block">
        {children}
        {unit && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-small text-muted">{unit}</span>}
      </span>
      {error?.message && <span className="block text-small text-danger">{error.message}</span>}
    </label>
  );
}

function num(register: Register, name: Parameters<Register>[0], error?: FieldError, placeholder?: string) {
  return (
    <input
      {...register(name, numeric)}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      className={cx(inputClasses, "tabular pr-12")}
    />
  );
}

function text(register: Register, name: Parameters<Register>[0], error?: FieldError, optional = false, placeholder?: string) {
  return (
    <input
      {...register(name, optional ? optionalText : undefined)}
      autoComplete="off"
      placeholder={placeholder}
      aria-invalid={error ? true : undefined}
      className={inputClasses}
    />
  );
}

function ItemCard({ title, onRemove, children }: { title: string; onRemove: () => void; children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-surface-2/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-small font-semibold text-muted">{title}</span>
        <IconButton icon="trash" label={`Fjern ${title.toLowerCase()}`} onClick={onRemove} className="-my-2 -mr-2 text-muted" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{children}</div>
    </div>
  );
}

function EditorSection({ title, onAdd, addLabel, children }: { title: string; onAdd?: () => void; addLabel?: string; children: ReactNode }) {
  return (
    <Card className="space-y-3">
      <SectionLabel>{title}</SectionLabel>
      {children}
      {onAdd && (
        <Button icon="plus" variant="ghost" onClick={onAdd}>
          {addLabel}
        </Button>
      )}
    </Card>
  );
}

/** Metrics from whatever parts of the form are already valid, so the numbers update while typing. */
function LiveMetrics({ control }: { control: Control<RecipeDocument> }) {
  const values = useWatch({ control }) as Partial<RecipeDocument>;
  let metrics: ReturnType<typeof calculateRecipeMetrics> | null = null;
  const positive = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;
  if (positive(values.batchSizeL) && positive(values.efficiencyPct)) {
    try {
      metrics = calculateRecipeMetrics({
        ...emptyRecipe(),
        ...values,
        targets: {},
        fermentables: (values.fermentables ?? []).filter((f) => f && positive(f.amountKg)),
        hops: (values.hops ?? []).filter((h) => h && positive(h.amountG)),
        cultures: (values.cultures ?? []).filter((c) => c && positive(c.amount)),
      } as RecipeDocument);
    } catch {
      metrics = null;
    }
  }
  return (
    <div className="sticky top-0 z-10 -mx-4 bg-bg/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8">
      <div className="grid grid-cols-4 gap-2">
        <MetricCard label="OG" value={formatSg(metrics?.og)} />
        <MetricCard label="ABV" value={formatNumber(metrics?.abvPct, 1)} unit="%" />
        <MetricCard label="IBU" value={formatNumber(metrics?.ibu, 0)} />
        <MetricCard label="EBC" value={formatNumber(metrics?.colorEbc, 0)} />
      </div>
    </div>
  );
}

function HopRow({ index, register, control, errors, onRemove }: { index: number; register: Register; control: Control<RecipeDocument>; errors: any; onRemove: () => void }) {
  const use = useWatch({ control, name: `hops.${index}.use` });
  const e = errors?.hops?.[index];
  return (
    <ItemCard title={`Humle ${index + 1}`} onRemove={onRemove}>
      <Input label="Navn" error={e?.name} className="col-span-2">
        {text(register, `hops.${index}.name`, e?.name)}
      </Input>
      <Input label="Mengde" unit="g" error={e?.amountG}>
        {num(register, `hops.${index}.amountG`, e?.amountG)}
      </Input>
      <Input label="Alfasyre" unit="%" error={e?.alphaPct}>
        {num(register, `hops.${index}.alphaPct`, e?.alphaPct)}
      </Input>
      <Input label="Bruk" error={e?.use}>
        <select {...register(`hops.${index}.use`)} className={inputClasses}>
          {hopUses.map((u) => (
            <option key={u} value={u}>
              {hopUseLabels[u]}
            </option>
          ))}
        </select>
      </Input>
      {(use === "boil" || use === "whirlpool") && (
        <Input label={use === "boil" ? "Minutter igjen av kok" : "Varighet"} unit="min" error={e?.timeMin}>
          {num(register, `hops.${index}.timeMin`, e?.timeMin)}
        </Input>
      )}
      {use === "whirlpool" && (
        <Input label="Temperatur" unit="°C" error={e?.temperatureC}>
          {num(register, `hops.${index}.temperatureC`, e?.temperatureC)}
        </Input>
      )}
      {use === "dry_hop" && (
        <Input label="Gjæringsdag" error={e?.dayOfFermentation}>
          {num(register, `hops.${index}.dayOfFermentation`, e?.dayOfFermentation)}
        </Input>
      )}
      <Input label="Variant (split)" error={e?.variant}>
        {text(register, `hops.${index}.variant`, e?.variant, true)}
      </Input>
    </ItemCard>
  );
}

/** Salt/acid marker for an «Andre tilsetninger» row, with the strength an acid needs. */
function MiscWaterAgent({ index, register, control, errors }: { index: number; register: Register; control: Control<RecipeDocument>; errors: any }) {
  const agent = getWaterAgent(useWatch({ control, name: `miscs.${index}.waterAgent` }));
  return (
    <>
      <Input label="Salt eller syre i vannet" className="col-span-2">
        <select {...register(`miscs.${index}.waterAgent`, optionalText)} className={inputClasses}>
          <option value="">Ingen</option>
          {waterAgents.map((option) => (
            <option key={option.id} value={option.id}>
              {option.shortLabel}
            </option>
          ))}
        </select>
      </Input>
      {isAcidAgent(agent) && (
        <Input label="Styrke" unit="%" error={errors.miscs?.[index]?.acidStrengthPct}>
          {num(register, `miscs.${index}.acidStrengthPct`, errors.miscs?.[index]?.acidStrengthPct, String(agent.typicalStrengthsPct[0]))}
        </Input>
      )}
    </>
  );
}

/**
 * An untouched water card stays out of the saved recipe instead of becoming an empty object, and an acid
 * strength left behind on a row that is no longer an acid is dropped.
 */
function withoutEmptyWater(recipe: RecipeDocument): RecipeDocument {
  const target = Object.fromEntries(Object.entries(recipe.water?.target ?? {}).filter(([, value]) => value !== undefined));
  const water = {
    ...(Object.keys(target).length > 0 ? { target } : {}),
    ...(recipe.water?.profileName ? { profileName: recipe.water.profileName } : {}),
    ...(recipe.water?.notes ? { notes: recipe.water.notes } : {}),
  };
  const { water: _water, ...rest } = recipe;
  const miscs = rest.miscs.map(({ acidStrengthPct, ...misc }) => (isAcidAgent(getWaterAgent(misc.waterAgent)) && acidStrengthPct !== undefined ? { ...misc, acidStrengthPct } : misc));
  return Object.keys(water).length > 0 ? { ...rest, miscs, water } : { ...rest, miscs };
}

function RecipeForm({
  initial,
  recipeId,
  baseVersionId,
  version,
}: {
  initial: RecipeDocument;
  recipeId?: string;
  baseVersionId?: string;
  version?: number;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const create = useCreateRecipe();
  const save = useSaveRecipeVersion(recipeId ?? "");
  const [changeNote, setChangeNote] = useState("");
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RecipeDocument>({ resolver: zodResolver(recipeDocumentSchema), defaultValues: initial, mode: "onBlur" });

  const fermentables = useFieldArray({ control, name: "fermentables" });
  const hops = useFieldArray({ control, name: "hops" });
  const cultures = useFieldArray({ control, name: "cultures" });
  const miscs = useFieldArray({ control, name: "miscs" });
  const mashSteps = useFieldArray({ control, name: "mashSteps" });
  const fermentationSteps = useFieldArray({ control, name: "fermentationSteps" });
  const e = errors as any;

  async function onSubmit(parsed: RecipeDocument) {
    setServerError(null);
    const recipe = withoutEmptyWater(parsed);
    try {
      if (recipeId && baseVersionId) {
        await save.mutateAsync({ recipe, baseVersionId, changeNote: changeNote.trim() || undefined });
        toast(`Lagret som v${(version ?? 0) + 1}`);
        navigate(`/oppskrifter/${recipeId}`);
      } else {
        const { id } = await create.mutateAsync({ recipe, source: { kind: "manual" } });
        toast("Oppskriften er lagret");
        navigate(`/oppskrifter/${id}`, { replace: true });
      }
    } catch (error) {
      setServerError(error instanceof ApiError || error instanceof Error ? error.message : "Kunne ikke lagre.");
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4">
      <PageHeader
        back={recipeId ? `/oppskrifter/${recipeId}` : "/oppskrifter/importer"}
        title={recipeId ? "Rediger oppskrift" : "Ny oppskrift"}
        subtitle={recipeId ? `Lagring oppretter versjon ${(version ?? 0) + 1}. Tidligere batcher påvirkes ikke.` : undefined}
      />
      <LiveMetrics control={control} />

      <EditorSection title="Grunnleggende">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input label="Navn" error={e.name} className="col-span-2">
            {text(register, "name", e.name, false, "West Coast IPA")}
          </Input>
          <Input label="Stil" error={e.style} className="col-span-2">
            {text(register, "style", e.style, true, "American IPA")}
          </Input>
          <Input label="Batchvolum" unit="L" error={e.batchSizeL}>
            {num(register, "batchSizeL", e.batchSizeL)}
          </Input>
          <Input label="Koketid" unit="min" error={e.boilTimeMin}>
            {num(register, "boilTimeMin", e.boilTimeMin)}
          </Input>
          <Input label="Effektivitet" unit="%" error={e.efficiencyPct}>
            {num(register, "efficiencyPct", e.efficiencyPct)}
          </Input>
          <Input label="Skyllevann" unit="°C" error={e.spargeTemperatureC}>
            {num(register, "spargeTemperatureC", e.spargeTemperatureC)}
          </Input>
        </div>
      </EditorSection>

      <EditorSection
        title="Malt og sukker"
        addLabel="Legg til malt"
        onAdd={() => fermentables.append({ id: newId(), name: "", type: "grain", amountKg: undefined as unknown as number })}
      >
        {fermentables.fields.map((field, i) => (
          <ItemCard key={field.id} title={`Malt ${i + 1}`} onRemove={() => fermentables.remove(i)}>
            <Input label="Navn" error={e.fermentables?.[i]?.name} className="col-span-2">
              {text(register, `fermentables.${i}.name`, e.fermentables?.[i]?.name)}
            </Input>
            <Input label="Mengde" unit="kg" error={e.fermentables?.[i]?.amountKg}>
              {num(register, `fermentables.${i}.amountKg`, e.fermentables?.[i]?.amountKg)}
            </Input>
            <Input label="Type">
              <select {...register(`fermentables.${i}.type`)} className={inputClasses}>
                {fermentableTypes.map((t) => (
                  <option key={t} value={t}>
                    {fermentableTypeLabels[t]}
                  </option>
                ))}
              </select>
            </Input>
            <Input label="Farge" unit="EBC" error={e.fermentables?.[i]?.colorEbc}>
              {num(register, `fermentables.${i}.colorEbc`, e.fermentables?.[i]?.colorEbc)}
            </Input>
            <Input label="Utbytte" unit="%" error={e.fermentables?.[i]?.yieldPct}>
              {num(register, `fermentables.${i}.yieldPct`, e.fermentables?.[i]?.yieldPct, "80")}
            </Input>
          </ItemCard>
        ))}
      </EditorSection>

      <EditorSection
        title="Humle"
        addLabel="Legg til humle"
        onAdd={() => hops.append({ id: newId(), name: "", amountG: undefined as unknown as number, use: "boil", timeMin: 60 })}
      >
        {hops.fields.map((field, i) => (
          <HopRow key={field.id} index={i} register={register} control={control} errors={e} onRemove={() => hops.remove(i)} />
        ))}
      </EditorSection>

      <EditorSection
        title="Gjær"
        addLabel="Legg til gjær"
        onAdd={() => cultures.append({ id: newId(), name: "", form: "dry", amount: 1, unit: "pkg" })}
      >
        {cultures.fields.map((field, i) => (
          <ItemCard key={field.id} title={`Gjær ${i + 1}`} onRemove={() => cultures.remove(i)}>
            <Input label="Navn" error={e.cultures?.[i]?.name} className="col-span-2">
              {text(register, `cultures.${i}.name`, e.cultures?.[i]?.name)}
            </Input>
            <Input label="Mengde" error={e.cultures?.[i]?.amount}>
              {num(register, `cultures.${i}.amount`, e.cultures?.[i]?.amount)}
            </Input>
            <Input label="Enhet">
              <select {...register(`cultures.${i}.unit`)} className={inputClasses}>
                <option value="pkg">pakker</option>
                <option value="g">g</option>
                <option value="ml">ml</option>
                <option value="l">L</option>
              </select>
            </Input>
            <Input label="Form">
              <select {...register(`cultures.${i}.form`)} className={inputClasses}>
                {cultureForms.map((f) => (
                  <option key={f} value={f}>
                    {{ dry: "Tørrgjær", liquid: "Flytende", slurry: "Slurry", other: "Annet" }[f]}
                  </option>
                ))}
              </select>
            </Input>
            <Input label="Forgjæring" unit="%" error={e.cultures?.[i]?.attenuationPct}>
              {num(register, `cultures.${i}.attenuationPct`, e.cultures?.[i]?.attenuationPct, "75")}
            </Input>
            <Input label="Variant (split)" className="col-span-2">
              {text(register, `cultures.${i}.variant`, undefined, true)}
            </Input>
          </ItemCard>
        ))}
      </EditorSection>

      <EditorSection
        title="Andre tilsetninger"
        addLabel="Legg til tilsetning"
        onAdd={() => miscs.append({ id: newId(), name: "", amount: undefined as unknown as number, unit: "g", use: "boil" })}
      >
        {miscs.fields.map((field, i) => (
          <ItemCard key={field.id} title={`Tilsetning ${i + 1}`} onRemove={() => miscs.remove(i)}>
            <Input label="Navn" error={e.miscs?.[i]?.name} className="col-span-2">
              {text(register, `miscs.${i}.name`, e.miscs?.[i]?.name, false, "Protafloc")}
            </Input>
            <Input label="Mengde" error={e.miscs?.[i]?.amount}>
              {num(register, `miscs.${i}.amount`, e.miscs?.[i]?.amount)}
            </Input>
            <Input label="Enhet" error={e.miscs?.[i]?.unit}>
              {text(register, `miscs.${i}.unit`, e.miscs?.[i]?.unit)}
            </Input>
            <Input label="Bruk">
              <select {...register(`miscs.${i}.use`)} className={inputClasses}>
                {miscUses.map((u) => (
                  <option key={u} value={u}>
                    {{ mash: "Mesk", boil: "Kok", whirlpool: "Whirlpool", fermentation: "Gjæring", packaging: "Pakking", other: "Annet" }[u]}
                  </option>
                ))}
              </select>
            </Input>
            <Input label="Minutter igjen av kok" unit="min" error={e.miscs?.[i]?.timeMin}>
              {num(register, `miscs.${i}.timeMin`, e.miscs?.[i]?.timeMin)}
            </Input>
            <MiscWaterAgent index={i} register={register} control={control} errors={e} />
          </ItemCard>
        ))}
      </EditorSection>

      <EditorSection
        title="Mesk"
        addLabel="Legg til meskesteg"
        onAdd={() => mashSteps.append({ id: newId(), name: "Mesk", temperatureC: 67, durationMin: 60 })}
      >
        {mashSteps.fields.map((field, i) => (
          <ItemCard key={field.id} title={`Steg ${i + 1}`} onRemove={() => mashSteps.remove(i)}>
            <Input label="Navn" error={e.mashSteps?.[i]?.name} className="col-span-2">
              {text(register, `mashSteps.${i}.name`, e.mashSteps?.[i]?.name)}
            </Input>
            <Input label="Temperatur" unit="°C" error={e.mashSteps?.[i]?.temperatureC}>
              {num(register, `mashSteps.${i}.temperatureC`, e.mashSteps?.[i]?.temperatureC)}
            </Input>
            <Input label="Varighet" unit="min" error={e.mashSteps?.[i]?.durationMin}>
              {num(register, `mashSteps.${i}.durationMin`, e.mashSteps?.[i]?.durationMin)}
            </Input>
          </ItemCard>
        ))}
        <div className="grid grid-cols-2 gap-3">
          <Input label="Mesk-pH mål fra" error={e.targets?.mashPhMin}>
            {num(register, "targets.mashPhMin", e.targets?.mashPhMin, "5,2")}
          </Input>
          <Input label="til" error={e.targets?.mashPhMax}>
            {num(register, "targets.mashPhMax", e.targets?.mashPhMax, "5,4")}
          </Input>
        </div>
      </EditorSection>

      <EditorSection title="Vann">
        <p className="text-small text-muted">
          Valgfritt. Planlagt vann er et mål, ikke en måling. Basisvannet er {slumpBaseWater.name}: svært bløtt og mineralfattig, så kalsium, sulfat og klorid må tilsettes.
          Salter og syre legger du inn under «Andre tilsetninger» og merker som salt eller syre.
        </p>
        <Input label="Navn på planen (valgfritt)" error={e.water?.profileName}>
          {text(register, "water.profileName", e.water?.profileName, true, "Kloridfremhevet")}
        </Input>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {ionKeys.map((ion) => (
            <Input key={ion} label={`${ionInfo[ion].name} (${ionInfo[ion].symbol})`} unit="mg/L" error={e.water?.target?.[ion]}>
              {num(register, `water.target.${ion}`, e.water?.target?.[ion])}
            </Input>
          ))}
        </div>
        <Input label="Vannnotat (valgfritt)" error={e.water?.notes}>
          {text(register, "water.notes", e.water?.notes, true)}
        </Input>
      </EditorSection>

      <EditorSection
        title="Gjæringsplan"
        addLabel="Legg til gjæringssteg"
        onAdd={() => fermentationSteps.append({ id: newId(), name: "Primær", temperatureC: 19, durationDays: 7 })}
      >
        {fermentationSteps.fields.map((field, i) => (
          <ItemCard key={field.id} title={`Steg ${i + 1}`} onRemove={() => fermentationSteps.remove(i)}>
            <Input label="Navn" error={e.fermentationSteps?.[i]?.name} className="col-span-2">
              {text(register, `fermentationSteps.${i}.name`, e.fermentationSteps?.[i]?.name)}
            </Input>
            <Input label="Temp. fra" unit="°C" error={e.fermentationSteps?.[i]?.temperatureC}>
              {num(register, `fermentationSteps.${i}.temperatureC`, e.fermentationSteps?.[i]?.temperatureC)}
            </Input>
            <Input label="Temp. til" unit="°C" error={e.fermentationSteps?.[i]?.temperatureMaxC}>
              {num(register, `fermentationSteps.${i}.temperatureMaxC`, e.fermentationSteps?.[i]?.temperatureMaxC)}
            </Input>
            <Input label="Varighet" unit="dager" error={e.fermentationSteps?.[i]?.durationDays}>
              {num(register, `fermentationSteps.${i}.durationDays`, e.fermentationSteps?.[i]?.durationDays)}
            </Input>
            <Input label="Notat" className="col-span-2 sm:col-span-3">
              {text(register, `fermentationSteps.${i}.notes`, undefined, true)}
            </Input>
          </ItemCard>
        ))}
      </EditorSection>

      <EditorSection title="Mål og notater">
        <p className="text-small text-muted">Valgfritt. Uten mål viser appen beregnede verdier.</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Input label="OG" error={e.targets?.og}>
            {num(register, "targets.og", e.targets?.og, "1.050")}
          </Input>
          <Input label="FG" error={e.targets?.fg}>
            {num(register, "targets.fg", e.targets?.fg, "1.010")}
          </Input>
          <Input label="IBU" error={e.targets?.ibu}>
            {num(register, "targets.ibu", e.targets?.ibu)}
          </Input>
          <Input label="ABV" unit="%" error={e.targets?.abvPct}>
            {num(register, "targets.abvPct", e.targets?.abvPct)}
          </Input>
        </div>
        <Input label="Notater" error={e.notes}>
          <textarea {...register("notes", optionalText)} className={cx(inputClasses, "min-h-28 py-2")} />
        </Input>
      </EditorSection>

      {recipeId && (
        <Card>
          <Input label="Hva endret du? (valgfritt)">
            <input value={changeNote} onChange={(ev) => setChangeNote(ev.target.value)} className={inputClasses} placeholder="Byttet Mosaic med Citra" />
          </Input>
        </Card>
      )}

      {Object.keys(errors).length > 0 && <InlineError>Noen felter må rettes før du kan lagre.</InlineError>}
      {serverError && <InlineError>{serverError}</InlineError>}
      <div className="sticky bottom-20 z-10 md:bottom-4">
        <Button type="submit" variant="primary" size="lg" block loading={isSubmitting} className="shadow-lg">
          {recipeId ? "Lagre ny versjon" : "Lagre oppskrift"}
        </Button>
      </div>
    </form>
  );
}
