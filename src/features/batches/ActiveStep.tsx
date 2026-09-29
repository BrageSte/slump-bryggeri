import type { BrewDayLogEntry, BrewDayState, NextAction } from "../../domain/brew-day/state.ts";
import type { BatchDetail, TimelineItem } from "../../domain/model/api.ts";
import { brewStageLabels } from "../../domain/model/brewing.ts";
import type { ProfileValues } from "../../domain/model/equipment-profile.ts";
import { Button, SectionLabel, TargetVsActual } from "../../design-system/index.ts";
import { formatAmount, formatDuration } from "../../lib/format.ts";
import { formatMeasurement, formatMeasurementRange, formatTarget } from "./helpers.ts";
import type { LogIntent } from "./LogSheet.tsx";
import { MashAdjustmentHint } from "./MashAdjustmentHint.tsx";

/**
 * The active step: what is happening now (target, measurements, mash tip), what to do next and the
 * timers, in one card at the top of the brew-day screen. The rest of the brew is the plan below it.
 */

export function StageBody({
  state,
  onLog,
  timeline,
  recipe,
  equipment,
  equipmentSources,
  log,
  now,
  onAddMashWater,
  loggingMashWater,
}: {
  state: BrewDayState;
  onLog: (intent: LogIntent) => void;
  timeline: TimelineItem[];
  recipe: BatchDetail["recipeSnapshot"];
  equipment: ProfileValues;
  equipmentSources: BatchDetail["equipmentSnapshot"]["sources"];
  log: BrewDayLogEntry[];
  now: number;
  onAddMashWater: (volumeL: number, temperatureC: number) => void;
  loggingMashWater: boolean;
}) {
  if (!state.stage) return null;
  const step = state.step;
  const progress = step?.totalMin && step.remainingMin !== null ? 1 - step.remainingMin / step.totalMin : null;
  const previousOf = (kind: string) => {
    const item = timeline.findLast((t) => t.measurement?.kind === kind);
    return item?.measurement ? { value: item.measurement.value, occurredAt: item.occurredAt } : null;
  };

  return (
    <div>
      <SectionLabel>{brewStageLabels[state.stage]}</SectionLabel>
      {step && (
        <div className="mt-1">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <p className="text-section font-semibold">{step.label}</p>
            {step.remainingMin !== null && (
              <p className="tabular text-section font-bold" aria-live="off">
                {step.remainingMin > 0 ? `${formatDuration(step.remainingMin)} igjen` : "Tiden er ute"}
              </p>
            )}
          </div>
          {step.detail && <p className="text-small text-muted">{step.detail}</p>}
          {progress !== null && (
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label="Fremdrift i steget"
            >
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.min(100, progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}
      {state.targets.length > 0 && (
        <div className="mt-2 divide-y divide-border">
          {state.targets.map((target) => (
            <div key={target.key}>
              <TargetVsActual
                label={target.label}
                unit={target.unit}
                target={formatTarget(target.measurementKind, target.target)}
                actual={target.actual
                  ? target.actual.valueMin !== undefined && target.actual.valueMax !== undefined
                    ? formatMeasurementRange(target.measurementKind, target.actual.valueMin, target.actual.valueMax, target.unit)
                    : formatMeasurement(target.measurementKind, target.actual.value)
                  : null}
                status={target.status}
                detail={
                  [
                    target.actual?.derivedFrom === "brix" ? "fra Brix" : null,
                    target.source === "recipe" ? "oppskrift/import" : null,
                    target.source === "calculated" ? "≈ beregnet" : null,
                    target.source === "assumed" ? "≈ antatt" : null,
                  ].filter(Boolean).join(" · ") || undefined
                }
                action={
                  <Button
                    size="sm"
                    aria-label={`Logg ${target.label.toLowerCase()}`}
                    onClick={() =>
                      onLog({
                        kind: "measurement",
                        measurementKind: target.measurementKind,
                        label: target.label,
                        target: target.target,
                        previous: previousOf(target.measurementKind),
                      })
                    }
                  >
                    Logg
                  </Button>
                }
              />
              {target.key === "mash-temp" && state.stage === "mash" && (
                <MashAdjustmentHint
                  recipe={recipe}
                  equipment={equipment}
                  equipmentSources={equipmentSources}
                  log={log}
                  stage={state.stage}
                  stageStartedAt={state.stageStartedAt}
                  now={now}
                  onAddWater={onAddMashWater}
                  busy={loggingMashWater}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NextActionBody({ action, remainingMin }: { action: NextAction; remainingMin: number | null }) {
  if (action.kind === "add_ingredient") {
    const a = action.addition;
    return (
      <div className="mt-1">
        <p className="text-title font-bold">
          {formatAmount(a.amount, a.unit)} {a.name}
        </p>
        <p className="text-muted">
          {a.dueLabel}
          {a.variant ? ` · ${a.variant}` : ""} · {action.inMin > 0 ? `om ${formatDuration(action.inMin)}` : "nå"}
        </p>
      </div>
    );
  }
  if (action.kind === "log_measurement") {
    return <p className="mt-1 text-title font-bold">{action.label}</p>;
  }
  return (
    <div className="mt-1">
      <p className="text-title font-bold">{action.kind === "start_stage" ? brewStageLabels[action.stage] : action.label}</p>
      {action.kind === "start_stage" && remainingMin !== null && (
        <p className="text-muted">{remainingMin > 0 ? `Om ${formatDuration(remainingMin)}` : "Klar når du er det"}</p>
      )}
    </div>
  );
}

/** "Neste" with its one primary button; the card it sits in supplies the frame. */
export function NextBlock({
  action,
  remainingMin,
  loading,
  onRun,
}: {
  action: NextAction;
  remainingMin: number | null;
  loading: boolean;
  onRun: (action: NextAction) => void;
}) {
  return (
    <div className="mt-4 rounded-md bg-primary-soft p-3">
      <SectionLabel>Neste</SectionLabel>
      <NextActionBody action={action} remainingMin={remainingMin} />
      <Button variant="primary" size="lg" block className="mt-3" loading={loading} onClick={() => onRun(action)}>
        {action.kind === "add_ingredient" ? "Registrer tilsatt" : action.label}
      </Button>
    </div>
  );
}
