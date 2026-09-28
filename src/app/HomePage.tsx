import { useMemo } from "react";
import { Link } from "react-router";
import { deriveBrewDayState } from "../domain/brew-day/state.ts";
import type { BatchSummary } from "../domain/model/api.ts";
import { brewStageLabels, measurementKindSpecs } from "../domain/model/brewing.ts";
import { buttonClasses, Card, EmptyState, ErrorState, Icon, LoadingState, Measurement, Section, SectionLabel, StatusChip, type IconName } from "../design-system/index.ts";
import { useMe } from "../features/auth/session.ts";
import { ACTIVE_STATUSES, useBatch, useBatches, useTimeline } from "../features/batches/api.ts";
import { BatchList } from "../features/batches/BatchList.tsx";
import { formatMeasurement, statusLabel, statusTones, toBrewDayLog } from "../features/batches/helpers.ts";
import { useBrewery } from "../features/breweries/BreweryContext.tsx";
import { formatLogTime } from "../lib/format.ts";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "God natt";
  if (hour < 10) return "God morgen";
  return "God bryggedag";
}

export function HomePage() {
  const me = useMe();
  const { breweryName } = useBrewery();
  const batches = useBatches();
  const firstName = me.data?.user.name.split(" ")[0];

  const active = batches.data?.filter((b) => ACTIVE_STATUSES.includes(b.status)) ?? [];
  const planned = batches.data?.filter((b) => b.status === "planned") ?? [];
  const recent = batches.data?.filter((b) => b.status === "completed").slice(0, 3) ?? [];

  return (
    <div className="space-y-6">
      <header>
        <p className="text-small font-semibold text-muted md:hidden">{breweryName}</p>
        <h1 className="text-title font-bold">
          {greeting()}
          {firstName ? `, ${firstName}` : ""}
        </h1>
      </header>

      {batches.isPending ? (
        <LoadingState rows={2} />
      ) : batches.error ? (
        <ErrorState error={batches.error} onRetry={() => void batches.refetch()} />
      ) : (
        <>
          {active.length > 0 ? (
            <Section title={active.length > 1 ? "Aktive brygg" : "Aktivt brygg"}>
              {active.map((batch) => (
                <ActiveBatchCard key={batch.id} summary={batch} />
              ))}
            </Section>
          ) : (
            <EmptyState
              icon="kettle"
              title="Ingen brygg i gang"
              action={
                <Link to="/brygg" className={buttonClasses("primary")}>
                  Gå til brygg
                </Link>
              }
            >
              {planned.length > 0 ? "Du har planlagte batcher klare til å starte." : "Legg inn en oppskrift og opprett en batch for å komme i gang."}
            </EmptyState>
          )}

          <nav aria-label="Snarveier" className="grid grid-cols-2 gap-2">
            {(
              [
                { to: "/oppskrifter", label: "Oppskrifter", icon: "book" },
                { to: "/mer/kalibrering", label: "Kalibrering", icon: "wrench" },
                { to: "/mer/omregner", label: "Omregner", icon: "sliders" },
                { to: "/brygg", label: "Historikk", icon: "history" },
              ] satisfies { to: string; label: string; icon: IconName }[]
            ).map((item) => (
              <Link
                key={item.label}
                to={item.to}
                className="flex min-h-14 items-center gap-3 rounded-card border border-border bg-surface px-4 font-semibold hover:bg-surface-2"
              >
                <Icon name={item.icon} className="text-primary-strong" />
                {item.label}
              </Link>
            ))}
          </nav>

          {planned.length > 0 && (
            <Section title="Planlagt">
              <BatchList batches={planned} />
            </Section>
          )}
          {recent.length > 0 && (
            <Section title="Nylige brygg">
              <BatchList batches={recent} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

/** Home card for a batch in progress (wireframe §34): status, key readings, what's next. */
function ActiveBatchCard({ summary }: { summary: BatchSummary }) {
  const batch = useBatch(summary.id);
  const timeline = useTimeline(summary.id);

  const state = useMemo(
    () =>
      batch.data && timeline.data
        ? deriveBrewDayState({
            recipe: batch.data.recipeSnapshot,
            stage: batch.data.currentStage,
            stageStartedAt: batch.data.stageStartedAt,
            log: toBrewDayLog(timeline.data),
            now: Date.now(),
            wcf: batch.data.equipmentSnapshot.values.refractometer_wcf,
          })
        : null,
    [batch.data, timeline.data],
  );

  // The batch detail is polled; the list summary is not, so it can lag behind a stage change.
  const currentStage = batch.data?.currentStage ?? summary.currentStage;
  const status = batch.data?.status ?? summary.status;

  // Only readings from the current stage: yesterday's whirlpool temperature says nothing about fermentation.
  const latest = (["temperature", "pressure", "sg"] as const).flatMap((kind) => {
    const item = timeline.data?.findLast((t) => t.measurement?.kind === kind && t.stage === currentStage);
    return item?.measurement ? [{ kind, value: item.measurement.value, unit: item.measurement.unit, at: item.occurredAt }] : [];
  });

  return (
    <Card className="space-y-4">
      <div>
        <p className="text-section font-bold">{summary.name}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-small text-muted">
          <StatusChip tone={statusTones[status]}>{statusLabel(status)}</StatusChip>
          {currentStage && <span>{brewStageLabels[currentStage]}</span>}
          {state?.fermentationDay !== null && state?.fermentationDay !== undefined && <span>· dag {state.fermentationDay}</span>}
        </div>
      </div>

      {latest.length > 0 && (
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          {latest.slice(0, 2).map((m) => (
            <div key={m.kind}>
              <Measurement value={formatMeasurement(m.kind, m.value)} unit={m.kind === "sg" ? null : m.unit} size="title" />
              <p className="text-caption text-muted">
                {measurementKindSpecs[m.kind].label} · {formatLogTime(m.at)}
              </p>
            </div>
          ))}
        </div>
      )}

      {state?.nextAction && (
        <div>
          <SectionLabel>Neste</SectionLabel>
          <p className="font-semibold">{state.nextAction.label}</p>
        </div>
      )}

      <Link to={`/batcher/${summary.id}`} className={buttonClasses("primary", "lg", true)}>
        Åpne brygget
      </Link>
    </Card>
  );
}
