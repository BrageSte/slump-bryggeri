import { apparentAttenuationSoFar, fermentationDayOf, plannedFermentationTemperature, type FermentationVariant } from "../../domain/brew-day/fermentation.ts";
import { compareMeasurementToTarget, type BrewDayState } from "../../domain/brew-day/state.ts";
import type { BatchDetail } from "../../domain/model/api.ts";
import { brewStageLabels } from "../../domain/model/brewing.ts";
import { Button, Card, MetricCard, SectionLabel, TargetStatusChip } from "../../design-system/index.ts";
import { formatLogTime, formatNumber, formatSg } from "../../lib/format.ts";
import { formatTarget } from "./helpers.ts";
import type { LogIntent } from "./LogSheet.tsx";

/**
 * Fermentation and conditioning: one block per fermenter with OG → current gravity → apparent
 * attenuation and the latest temperature. Gravity is not judged against the FG target while the
 * yeast is still working; temperature is compared with the fermentation plan for the day.
 */
export function FermentationCard({
  batch,
  state,
  variants,
  now,
  onLog,
}: {
  batch: BatchDetail;
  state: BrewDayState;
  variants: FermentationVariant[];
  now: number;
  onLog: (intent: LogIntent) => void;
}) {
  const step = state.step;
  return (
    <Card>
      <SectionLabel>{state.stage ? brewStageLabels[state.stage] : "Gjæring"}</SectionLabel>
      {step && (
        <div className="mt-1">
          <p className="text-section font-semibold">{step.label}</p>
          {step.detail && <p className="text-small text-muted">{step.detail}</p>}
        </div>
      )}
      <div className="mt-3 divide-y divide-border">
        {variants.map((variant) => (
          <VariantBlock key={variant.splitId ?? "batch"} batch={batch} variant={variant} now={now} onLog={onLog} />
        ))}
      </div>
    </Card>
  );
}

function VariantBlock({
  batch,
  variant,
  now,
  onLog,
}: {
  batch: BatchDetail;
  variant: FermentationVariant;
  now: number;
  onLog: (intent: LogIntent) => void;
}) {
  const split = batch.splits.find((s) => s.id === variant.splitId);
  const day = fermentationDayOf(variant.pitchedAt, now);
  const current = variant.gravity.at(-1) ?? null;
  const attenuation = apparentAttenuationSoFar(variant.og, current);
  const temperature = variant.temperature.at(-1) ?? null;
  const plannedTemperature = day === null ? null : plannedFermentationTemperature(batch.recipeSnapshot, day);
  const facts = [day === null ? null : `dag ${day}`, split?.vessel, split?.volumeL ? `${formatNumber(split.volumeL, 0)} L` : null].filter(Boolean);

  return (
    <section aria-label={variant.name} className="py-4 first:pt-1 last:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-semibold">{variant.name}</h3>
        {facts.length > 0 && <p className="text-small text-muted">{facts.join(" · ")}</p>}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <MetricCard label="OG" value={formatSg(variant.og?.sg)} hint={variant.og?.source === "brix" ? "fra Brix" : variant.og ? "målt" : "ikke målt"} />
        <MetricCard
          label="SG nå"
          value={formatSg(current?.sg)}
          hint={current ? `${formatLogTime(current.at, now)}${current.source === "brix" ? " · fra Brix" : ""}` : "ikke målt"}
        />
        <MetricCard label="Forgjæring" value={attenuation === null ? "–" : formatNumber(attenuation, 0)} unit={attenuation === null ? null : "%"} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-small">
        <span className="text-muted">Temperatur</span>
        <span className="tabular font-semibold">{temperature ? `${formatNumber(temperature.value, 1)} °C` : "–"}</span>
        {temperature && <span className="text-muted">{formatLogTime(temperature.at, now)}</span>}
        {plannedTemperature && (
          <>
            <span className="text-muted">· plan {formatTarget("temperature", plannedTemperature)} °C</span>
            <TargetStatusChip
              status={temperature ? compareMeasurementToTarget("temperature", plannedTemperature, { value: temperature.value }) : "missing"}
            />
          </>
        )}
      </div>
      {variant.uncorrectedBrix > 0 && (
        <p className="mt-1 text-caption text-muted">
          Brix etter gjærstart kan ikke regnes om til SG uten en Brix-måling fra før gjæringen.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="sm"
          icon="flask"
          onClick={() =>
            onLog({
              kind: "measurement",
              measurementKind: "sg",
              splitId: variant.splitId,
              previous: current?.source === "sg" ? { value: current.sg, occurredAt: current.at } : null,
            })
          }
        >
          Logg SG
        </Button>
        <Button
          size="sm"
          icon="thermometer"
          onClick={() =>
            onLog({
              kind: "measurement",
              measurementKind: "temperature",
              splitId: variant.splitId,
              target: plannedTemperature ?? undefined,
              previous: temperature ? { value: temperature.value, occurredAt: temperature.at } : null,
            })
          }
        >
          Logg temp
        </Button>
      </div>
    </section>
  );
}
