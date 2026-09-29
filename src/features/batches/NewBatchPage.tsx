import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { calculateRecipeMetrics, calculateRecipeScaling } from "../../domain/brewing-calculations/index.ts";
import { equipmentOverview } from "../../domain/brew-day/equipment-overview.ts";
import type { EquipmentProfile, RecipeSummary } from "../../domain/model/api.ts";
import type { ProfileValues, ProfileValueSources } from "../../domain/model/equipment-profile.ts";
import type { RecipeDocument } from "../../domain/model/recipe.ts";
import {
  Button,
  buttonClasses,
  Card,
  cx,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  LoadingState,
  PageHeader,
  parseDecimal,
  SectionLabel,
  Select,
  TextInput,
  useToast,
} from "../../design-system/index.ts";
import { formatDate, formatNumber, formatSg, todayIso } from "../../lib/format.ts";
import { useEquipmentProfile } from "../equipment/api.ts";
import { useRecipe, useRecipes } from "../recipes/api.ts";
import { Compare } from "../recipes/Compare.tsx";
import { RecipeMetrics } from "../recipes/RecipeView.tsx";
import { useCreateBatch } from "./api.ts";
import { CalibrationLink, EquipmentCard } from "./PreBrewOverview.tsx";

const steps = ["Oppskrift", "Størrelse", "Utstyr", "Oppsummering"] as const;

/**
 * A new batch in four steps: recipe → size → equipment → summary, then the overview of the planned
 * batch. Size and efficiency scale the batch's own frozen copy of the recipe; the equipment profile is
 * shown with what to be careful about, and changed (as a new version) under Kalibrering.
 */
export function NewBatchPage() {
  const recipes = useRecipes();
  const profile = useEquipmentProfile();
  const [params] = useSearchParams();

  if (recipes.isPending || profile.isPending) {
    return (
      <>
        <PageHeader back="/brygg" title="Ny batch" />
        <LoadingState />
      </>
    );
  }
  if (recipes.error || profile.error) {
    return (
      <>
        <PageHeader back="/brygg" title="Ny batch" />
        <ErrorState error={recipes.error ?? profile.error} onRetry={() => void (recipes.refetch(), profile.refetch())} />
      </>
    );
  }
  if (recipes.data.length === 0) {
    return (
      <>
        <PageHeader back="/brygg" title="Ny batch" />
        <EmptyState
          icon="book"
          title="Ingen oppskrifter ennå"
          action={
            <Link to="/oppskrifter" className={buttonClasses("primary")}>
              Legg inn en oppskrift først
            </Link>
          }
        >
          En batch er ett konkret brygg av en oppskrift.
        </EmptyState>
      </>
    );
  }
  const preset = params.get("oppskrift");
  const first = recipes.data.find((recipe) => recipe.id === preset) ?? recipes.data[0]!;
  return <Wizard recipes={recipes.data} profile={profile.data} initialRecipeId={first.id} />;
}

function profileValuesOf(profile: EquipmentProfile | null): { values: ProfileValues; sources: ProfileValueSources } {
  const entries = Object.entries(profile?.values ?? {});
  return {
    values: Object.fromEntries(entries.map(([key, entry]) => [key, entry.value])) as ProfileValues,
    sources: Object.fromEntries(entries.map(([key, entry]) => [key, entry.source])) as ProfileValueSources,
  };
}

function Wizard({ recipes, profile, initialRecipeId }: { recipes: RecipeSummary[]; profile: EquipmentProfile | null; initialRecipeId: string }) {
  const navigate = useNavigate();
  const toast = useToast();
  const createBatch = useCreateBatch();
  const [step, setStep] = useState(0);
  const [recipeId, setRecipeId] = useState(initialRecipeId);
  const [brewDate, setBrewDate] = useState(todayIso());
  // null = not touched: the field shows the recipe's own value.
  const [sizeText, setSizeText] = useState<string | null>(null);
  const [efficiencyText, setEfficiencyText] = useState<string | null>(null);
  const recipe = useRecipe(recipeId);

  const original = recipe.data?.current.data;
  const size = parseDecimal(sizeText ?? original?.batchSizeL);
  const efficiency = parseDecimal(efficiencyText ?? original?.efficiencyPct);
  const sizeError = size === undefined ? "Skriv inn volum" : Number.isNaN(size) || size <= 0 || size > 10_000 ? "Skriv inn et volum mellom 1 og 10 000 L" : undefined;
  const efficiencyError =
    efficiency === undefined ? "Skriv inn effektivitet" : Number.isNaN(efficiency) || efficiency < 1 || efficiency > 100 ? "Skriv inn en effektivitet mellom 1 og 100 %" : undefined;
  const scaled = original && !sizeError && !efficiencyError ? calculateRecipeScaling(original, { batchSizeL: size!, efficiencyPct: efficiency! }).recipe : null;
  const rescaled = original !== undefined && scaled !== null && (scaled.batchSizeL !== original.batchSizeL || scaled.efficiencyPct !== original.efficiencyPct);
  const planned = scaled ?? original;
  const { values, sources } = profileValuesOf(profile);
  const equipment = equipmentOverview({ values, sources, recipeBatchSizeL: planned?.batchSizeL ?? 0 });

  function chooseRecipe(id: string) {
    setRecipeId(id);
    setSizeText(null);
    setEfficiencyText(null);
  }

  function create() {
    if (!scaled || !original) return;
    createBatch.mutate(
      {
        recipeId,
        brewDate: brewDate || undefined,
        batchSizeL: scaled.batchSizeL !== original.batchSizeL ? scaled.batchSizeL : undefined,
        efficiencyPct: scaled.efficiencyPct !== original.efficiencyPct ? scaled.efficiencyPct : undefined,
      },
      {
        onSuccess: ({ id }) => {
          toast("Batch opprettet");
          navigate(`/batcher/${id}`);
        },
      },
    );
  }

  const canContinue = step === 0 ? Boolean(recipeId) : step === 1 ? scaled !== null : true;

  return (
    <div className="space-y-5">
      <PageHeader back="/brygg" title="Ny batch" subtitle={`Steg ${step + 1} av ${steps.length}`} />

      {/* Only the current step shows its name, so all four fit on a phone. */}
      <nav aria-label="Steg i ny batch" className="flex gap-2">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            disabled={index > step}
            onClick={() => setStep(index)}
            aria-label={`${index + 1}. ${label}`}
            aria-current={index === step ? "step" : undefined}
            className={cx(
              "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-small font-semibold whitespace-nowrap",
              index === step ? "border-primary bg-primary px-4 text-on-primary" : "border-border bg-surface",
              index < step && "text-muted",
              index > step && "opacity-50",
            )}
          >
            {index === step ? `${index + 1}. ${label}` : index + 1}
          </button>
        ))}
      </nav>

      {step === 0 && (
        <Card className="space-y-4">
          <Field label="Oppskrift">
            {(p) => (
              <Select {...p} value={recipeId} onChange={(e) => chooseRecipe(e.target.value)}>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (v{r.version}, {r.batchSizeL} L)
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Bryggedato">{(p) => <TextInput {...p} type="date" value={brewDate} onChange={(e) => setBrewDate(e.target.value)} />}</Field>
          <p className="text-small text-muted">Oppskriften og utstyret låses i batchen. Senere endringer påvirker ikke dette brygget.</p>
        </Card>
      )}

      {step > 0 && recipe.isPending && <LoadingState />}
      {step > 0 && recipe.error && <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />}

      {step === 1 && original && (
        <SizeStep
          original={original}
          scaled={scaled}
          sizeText={sizeText ?? String(original.batchSizeL)}
          efficiencyText={efficiencyText ?? String(original.efficiencyPct)}
          sizeError={sizeError}
          efficiencyError={efficiencyError}
          onSize={setSizeText}
          onEfficiency={setEfficiencyText}
          profileValues={values}
          profileSources={sources}
        />
      )}

      {step === 2 && original && (
        <EquipmentCard
          profileVersion={profile?.version ?? null}
          overview={equipment}
          footer={
            <>
              Profilen låses i batchen når du oppretter den. Vil du endre noe først, gjør det under <CalibrationLink />.
            </>
          }
        />
      )}

      {step === 3 && original && planned && (
        <Card className="space-y-4">
          <div>
            <SectionLabel>Oppsummering</SectionLabel>
            <p className="mt-1 text-muted">Slik blir batchen. Du får hele planen å se gjennom før du starter.</p>
          </div>
          <dl className="divide-y divide-border">
            <SummaryRow label="Oppskrift" value={`${original.name} (v${recipe.data?.current.version})`} />
            <SummaryRow label="Bryggedato" value={brewDate ? formatDate(brewDate) : "Ikke satt"} />
            <SummaryRow
              label="Størrelse"
              value={`${formatNumber(planned.batchSizeL, planned.batchSizeL % 1 === 0 ? 0 : 1)} L${rescaled ? ` (oppskriften: ${formatNumber(original.batchSizeL, 0)} L)` : ""}`}
            />
            <SummaryRow label="Utstyr" value={profile ? `Profil v${profile.version}` : "Ingen profil"} />
          </dl>
          <RecipeMetrics recipe={planned} />
          {equipment.warnings.map((warning) => (
            <p key={warning} className="rounded-md bg-surface-2 p-3 text-small">
              {warning}
            </p>
          ))}
          {createBatch.error && <InlineError>{createBatch.error.message}</InlineError>}
        </Card>
      )}

      <div className="flex gap-2">
        {step > 0 && (
          <Button size="lg" onClick={() => setStep(step - 1)}>
            Tilbake
          </Button>
        )}
        {step < steps.length - 1 ? (
          <Button variant="primary" size="lg" className="flex-1" disabled={!canContinue} onClick={() => setStep(step + 1)}>
            Neste
          </Button>
        ) : (
          <Button variant="primary" size="lg" icon="kettle" className="flex-1" disabled={!scaled} loading={createBatch.isPending} onClick={create}>
            Opprett batch
          </Button>
        )}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2">
      <dt className="text-small text-muted">{label}</dt>
      <dd className="text-right font-semibold">{value}</dd>
    </div>
  );
}

function SizeStep({
  original,
  scaled,
  sizeText,
  efficiencyText,
  sizeError,
  efficiencyError,
  onSize,
  onEfficiency,
  profileValues,
  profileSources,
}: {
  original: RecipeDocument;
  scaled: RecipeDocument | null;
  sizeText: string;
  efficiencyText: string;
  sizeError?: string;
  efficiencyError?: string;
  onSize: (text: string) => void;
  onEfficiency: (text: string) => void;
  profileValues: ProfileValues;
  profileSources: ProfileValueSources;
}) {
  const before = calculateRecipeMetrics(original);
  const after = scaled ? calculateRecipeMetrics(scaled) : null;
  const profileVolume = profileValues.batch_volume_l;
  const profileEfficiency = profileValues.brewhouse_efficiency_pct;
  const profileEfficiencyIsDefault = profileSources.brewhouse_efficiency_pct === "default";
  const unchanged = scaled !== null && scaled.batchSizeL === original.batchSizeL && scaled.efficiencyPct === original.efficiencyPct;

  return (
    <Card className="space-y-4">
      <p className="text-muted">
        Oppskriften er på {formatNumber(original.batchSizeL, 0)} L. Velg størrelsen du skal brygge: malt, humle og gjær skaleres for denne batchen. Selve
        oppskriften endres ikke.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Batchvolum (L)" error={sizeError}>
          {(p) => <TextInput {...p} inputMode="decimal" className="tabular" value={sizeText} onChange={(e) => onSize(e.target.value)} />}
        </Field>
        <Field label="Effektivitet (%)" error={efficiencyError}>
          {(p) => <TextInput {...p} inputMode="decimal" className="tabular" value={efficiencyText} onChange={(e) => onEfficiency(e.target.value)} />}
        </Field>
      </div>
      <div className="flex flex-wrap gap-2">
        {profileVolume !== undefined && profileVolume !== scaled?.batchSizeL && (
          <Button size="sm" onClick={() => onSize(String(profileVolume))}>
            Bruk {formatNumber(profileVolume, 0)} L (utstyret)
          </Button>
        )}
        {profileEfficiency !== undefined && profileEfficiency !== scaled?.efficiencyPct && (
          <Button size="sm" onClick={() => onEfficiency(String(profileEfficiency))}>
            Bruk {formatNumber(profileEfficiency, 0)} % ({profileEfficiencyIsDefault ? "standard" : "utstyret"})
          </Button>
        )}
      </div>
      {scaled && after && (
        <div className="divide-y divide-border">
          <Compare label="Volum" before={formatNumber(original.batchSizeL, 0)} after={formatNumber(scaled.batchSizeL, scaled.batchSizeL % 1 === 0 ? 0 : 1)} unit="L" />
          <Compare label="Malt" before={formatNumber(before.totalFermentablesKg, 2)} after={formatNumber(after.totalFermentablesKg, 2)} unit="kg" />
          <Compare label="Humle" before={formatNumber(before.totalHopsG, 0)} after={formatNumber(after.totalHopsG, 0)} unit="g" />
          <Compare label="OG" before={formatSg(before.og)} after={formatSg(after.og)} />
          <Compare label="IBU" before={formatNumber(before.ibu, 0)} after={formatNumber(after.ibu, 0)} />
        </div>
      )}
      {unchanged && <p className="text-small text-muted">Uendret fra oppskriften.</p>}
    </Card>
  );
}
