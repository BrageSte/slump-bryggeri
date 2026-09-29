import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import {
  calculateRecipeMetrics,
  calculateRecipeScaling,
  calculateStrikeTemperature,
  calculateWaterVolumes,
} from "../../domain/brewing-calculations/index.ts";
import { getProfileParameter, profileValue, type ProfileValueSources, type ProfileValues } from "../../domain/model/equipment-profile.ts";
import { Button, Card, ErrorState, Field, InlineError, LoadingState, PageHeader, parseDecimal, Section, SectionLabel, TextInput, useToast } from "../../design-system/index.ts";
import { formatAmount, formatNumber, formatSg } from "../../lib/format.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useEquipmentProfile } from "../equipment/api.ts";
import { useRecipe, useSaveRecipeVersion } from "./api.ts";

function Compare({ label, before, after, unit }: { label: string; before: ReactNode; after: ReactNode; unit?: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto_auto] items-baseline gap-x-3 py-2">
      <span className="text-small text-muted">{label}</span>
      <span className="tabular text-right text-muted">{before}</span>
      <span className="text-muted">→</span>
      <span className="tabular text-right text-section font-bold">
        {after}
        {unit && <span className="ml-1 text-small text-muted">{unit}</span>}
      </span>
    </div>
  );
}

/** "Tilpass til bryggeriet" (wireframe §37): scale to our volume/efficiency and show why (§56). */
export function AdaptRecipePage() {
  const { recipeId } = useParams();
  const recipe = useRecipe(recipeId);
  const profile = useEquipmentProfile();

  if (recipe.isPending || profile.isPending) return <LoadingState />;
  if (recipe.error || profile.error) return <ErrorState error={recipe.error ?? profile.error} />;

  const values = Object.fromEntries(Object.entries(profile.data?.values ?? {}).map(([k, v]) => [k, v.value])) as ProfileValues;
  const sources = Object.fromEntries(Object.entries(profile.data?.values ?? {}).map(([k, v]) => [k, v.source])) as ProfileValueSources;
  return (
    <Adapt
      recipeId={recipe.data.id}
      baseVersionId={recipe.data.current.id}
      original={recipe.data.current.data}
      profileVersion={profile.data?.version ?? null}
      values={values}
      sources={sources}
    />
  );
}

function Adapt({
  recipeId,
  baseVersionId,
  original,
  profileVersion,
  values,
  sources,
}: {
  recipeId: string;
  baseVersionId: string;
  original: Parameters<typeof calculateRecipeScaling>[0];
  profileVersion: number | null;
  values: ProfileValues;
  sources: ProfileValueSources;
}) {
  const { breweryName } = useBrewery();
  const save = useSaveRecipeVersion(recipeId);
  const navigate = useNavigate();
  const toast = useToast();
  const [volumeRaw, setVolumeRaw] = useState(String(profileValue(values, "batch_volume_l") ?? original.batchSizeL));
  const [efficiencyRaw, setEfficiencyRaw] = useState(String(profileValue(values, "brewhouse_efficiency_pct") ?? original.efficiencyPct));

  const volume = parseDecimal(volumeRaw);
  const efficiency = parseDecimal(efficiencyRaw);
  const valid = volume !== undefined && volume > 0 && efficiency !== undefined && efficiency > 0 && efficiency <= 100;
  const scaled = valid ? calculateRecipeScaling(original, { batchSizeL: volume, efficiencyPct: efficiency }) : null;
  const before = calculateRecipeMetrics(original);
  const after = scaled ? calculateRecipeMetrics(scaled.recipe) : null;

  const mashStep = original.mashSteps[0];
  const strike =
    mashStep && scaled
      ? calculateStrikeTemperature({
          targetMashTempC: mashStep.temperatureC,
          grainTempC: profileValue(values, "grain_temperature_c") ?? 18,
          mashThicknessLPerKg: profileValue(values, "mash_thickness_l_per_kg") ?? 3,
          systemOffsetC: profileValue(values, "strike_temp_offset_c") ?? 0,
        })
      : null;

  const boilOff = profileValue(values, "boil_off_l_per_h");
  const water =
    scaled && after && after.totalFermentablesKg > 0 && boilOff !== undefined
      ? calculateWaterVolumes({
          batchVolumeL: scaled.recipe.batchSizeL,
          grainKg: after.totalFermentablesKg,
          boilTimeMin: scaled.recipe.boilTimeMin,
          boilOffLPerH: boilOff,
          grainAbsorptionLPerKg: profileValue(values, "grain_absorption_l_per_kg") ?? 0.8,
          mashThicknessLPerKg: profileValue(values, "mash_thickness_l_per_kg") ?? 3,
          mashDeadSpaceL: profileValue(values, "mash_dead_space_l"),
          pumpPipeLossL: profileValue(values, "pump_pipe_loss_l"),
          kettleLossL: profileValue(values, "kettle_loss_l"),
          chillerLossL: profileValue(values, "chiller_loss_l"),
          transferLossL: profileValue(values, "transfer_loss_l"),
          coolingShrinkagePct: profileValue(values, "cooling_shrinkage_pct"),
        })
      : null;

  const waterKeys = [
    "boil_off_l_per_h",
    "grain_absorption_l_per_kg",
    "mash_thickness_l_per_kg",
    "mash_dead_space_l",
    "pump_pipe_loss_l",
    "kettle_loss_l",
    "chiller_loss_l",
    "transfer_loss_l",
    "cooling_shrinkage_pct",
  ] as const;
  const waterAssumptions = waterKeys.flatMap((key) => {
    const parameter = getProfileParameter(key);
    return parameter && (sources[key] === "default" || (values[key] === undefined && parameter.defaultValue !== undefined)) ? [parameter] : [];
  });
  const waterSource = waterAssumptions.length > 0
    ? `≈ antatt (${waterAssumptions.map((parameter) => parameter.label).join(", ")})`
    : "≈ beregnet";
  const strikeAssumptions = (["grain_temperature_c", "mash_thickness_l_per_kg", "strike_temp_offset_c"] as const)
    .flatMap((key) => {
      const parameter = getProfileParameter(key);
      return parameter && (sources[key] === "default" || (values[key] === undefined && parameter.defaultValue !== undefined)) ? [parameter.label] : [];
    });

  function saveAdaptation() {
    if (!scaled) return;
    save.mutate(
      {
        recipe: scaled.recipe,
        baseVersionId,
        kind: "adaptation",
        changeNote: `Tilpasset ${breweryName}${profileVersion ? ` (profil v${profileVersion})` : ""}: ${formatNumber(scaled.recipe.batchSizeL, 0)} L, ${formatNumber(scaled.recipe.efficiencyPct, 0)} %`,
      },
      {
        onSuccess: () => {
          toast("Tilpasset versjon lagret");
          navigate(`/oppskrifter/${recipeId}`);
        },
      },
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader back={`/oppskrifter/${recipeId}`} title={`Tilpass til ${breweryName}`} subtitle={original.name} />

      <Card>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Volum til gjæring" hint={`Oppskrift: ${formatNumber(original.batchSizeL, 0)} L`}>
            {(p) => <TextInput {...p} inputMode="decimal" value={volumeRaw} onChange={(e) => setVolumeRaw(e.target.value)} className="tabular" />}
          </Field>
          <Field label="Brygghuseffektivitet %" hint={`Oppskrift: ${formatNumber(original.efficiencyPct, 0)} %`}>
            {(p) => <TextInput {...p} inputMode="decimal" value={efficiencyRaw} onChange={(e) => setEfficiencyRaw(e.target.value)} className="tabular" />}
          </Field>
        </div>
        {!valid && <InlineError>Oppgi volum og effektivitet mellom 1 og 100 %.</InlineError>}
      </Card>

      {scaled && after && (
        <>
          <Card>
            <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 pb-1 text-caption font-semibold text-muted uppercase">
              <span />
              <span>Original</span>
              <span />
              <span>{breweryName}</span>
            </div>
            <div className="divide-y divide-border">
              <Compare label="Volum" before={`${formatNumber(original.batchSizeL, 0)} L`} after={formatNumber(scaled.recipe.batchSizeL, 0)} unit="L" />
              <Compare label="OG" before={formatSg(before.og)} after={formatSg(after.og)} />
              <Compare label="ABV" before={`${formatNumber(before.abvPct, 1)} %`} after={formatNumber(after.abvPct, 1)} unit="%" />
              <Compare label="IBU" before={formatNumber(before.ibu, 0)} after={formatNumber(after.ibu, 0)} />
              <Compare label="Malt" before={formatAmount(before.totalFermentablesKg, "kg")} after={formatAmount(after.totalFermentablesKg, "kg")} />
              <Compare label="Humle" before={formatAmount(before.totalHopsG, "g")} after={formatAmount(after.totalHopsG, "g")} />
            </div>
          </Card>

          {strike && mashStep && (
            <Card>
              <SectionLabel>Innmeskingstemperatur</SectionLabel>
              <p className="tabular text-display font-bold">
                <span className="mr-2 text-small font-semibold text-muted">
                  {strikeAssumptions.length > 0 ? `≈ antatt (${strikeAssumptions.join(", ")})` : "≈ beregnet"}
                </span>
                {formatNumber(strike.strikeTempC, 1)}
                <span className="ml-1 text-section text-muted">°C</span>
              </p>
              <details className="mt-1">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary-strong">Hvorfor?</summary>
                <dl className="tabular grid grid-cols-[1fr_auto] gap-y-1 text-small">
                  <dt className="text-muted">Mesketemperatur (oppskrift)</dt>
                  <dd>{formatNumber(mashStep.temperatureC, 1)} °C</dd>
                  <dt className="text-muted">Korntemperatur</dt>
                  <dd>{formatNumber(profileValue(values, "grain_temperature_c") ?? 18, 1)} °C</dd>
                  <dt className="text-muted">Mesketykkelse</dt>
                  <dd>{formatNumber(profileValue(values, "mash_thickness_l_per_kg") ?? 3, 1)} L/kg</dd>
                  <dt className="text-muted">Beregnet (Palmer)</dt>
                  <dd>{formatNumber(strike.baseStrikeTempC, 1)} °C</dd>
                  <dt className="text-muted">Systemkorreksjon (kalibrering)</dt>
                  <dd>
                    {strike.systemOffsetC >= 0 ? "+" : ""}
                    {formatNumber(strike.systemOffsetC, 1)} °C
                  </dd>
                </dl>
              </details>
            </Card>
          )}

          <Card>
            <SectionLabel>Vannvolumer</SectionLabel>
            {water ? (
              <div>
                <dl className="tabular mt-2 grid grid-cols-[1fr_auto] gap-y-1.5">
                  <dt className="text-muted">Meskevann</dt>
                  <dd className="font-semibold">{waterSource} {formatNumber(water.mashWaterL, 1)} L</dd>
                  <dt className="text-muted">Skyllevann</dt>
                  <dd className="font-semibold">{waterSource} {formatNumber(water.spargeWaterL, 1)} L</dd>
                  <dt className="text-muted">Før kok</dt>
                  <dd className="font-semibold">{waterSource} {formatNumber(water.preBoilVolumeL, 1)} L</dd>
                  <dt className="text-muted">Etter kok (varmt)</dt>
                  <dd className="font-semibold">{waterSource} {formatNumber(water.postBoilVolumeL, 1)} L</dd>
                </dl>
                {waterAssumptions.length > 0 && (
                  <ul className="mt-3 space-y-2 text-small text-muted">
                    {waterAssumptions.map((parameter) => (
                      <li key={parameter.key}>
                        {parameter.label}: {parameter.defaultExplanation ?? "Standardverdi fordi kalibrering mangler."} {parameter.measureToReplaceDefault ?? "Mål verdien under bryggingen."}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="mt-1 text-small text-muted">Vannvolumer krever meskede råvarer i oppskriften.</p>
            )}
          </Card>

          <Section title="Ingredienser">
            <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
              {[
                ...original.fermentables.map((f, i) => ({ id: f.id, name: f.name, before: formatAmount(f.amountKg, "kg"), after: formatAmount(scaled.recipe.fermentables[i]?.amountKg ?? 0, "kg") })),
                ...original.hops.map((h, i) => ({ id: h.id, name: h.name, before: formatAmount(h.amountG, "g"), after: formatAmount(scaled.recipe.hops[i]?.amountG ?? 0, "g") })),
                ...original.cultures.map((c, i) => ({ id: c.id, name: c.name, before: `${c.amount} ${c.unit}`, after: `${scaled.recipe.cultures[i]?.amount} ${c.unit}` })),
              ].map((row) => (
                <li key={row.id} className="tabular flex items-baseline gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1 truncate">{row.name}</span>
                  <span className="text-small text-muted">{row.before}</span>
                  <span className="text-muted">→</span>
                  <span className="font-semibold">{row.after}</span>
                </li>
              ))}
            </ul>
            <details>
              <summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary-strong">Se beregninger</summary>
              <p className="text-small text-muted">
                Volumfaktor {formatNumber(scaled.volumeFactor, 3)} brukes på humle, gjær og tilsetninger. Maltmengder ganges med{" "}
                {formatNumber(scaled.mashedFactor, 3)} (volum × {formatNumber(original.efficiencyPct, 0)} / {formatNumber(scaled.recipe.efficiencyPct, 0)}{" "}
                effektivitet) slik at OG holdes lik. Gjær i hele pakker rundes opp.
              </p>
            </details>
          </Section>

          {save.error && <InlineError>{save.error.message}</InlineError>}
          <Button variant="primary" size="lg" block onClick={saveAdaptation} loading={save.isPending}>
            Lagre som ny versjon
          </Button>
          <p className="text-center text-small text-muted">Originalen beholdes som tidligere versjon.</p>
        </>
      )}
    </div>
  );
}
