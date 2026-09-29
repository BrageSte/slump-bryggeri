import { useState } from "react";
import {
  brewPlanPhaseLabels,
  brewPlanPhaseStatus,
  type BrewPlan,
  type BrewPlanItem,
  type BrewPlanPhase,
  type PlanAssumption,
  type PhaseStatus,
  type PlanAddition,
  type PlanQuantity,
} from "../../domain/brew-day/brew-plan.ts";
import type { BrewDayForecast, PlannedAddition } from "../../domain/brew-day/state.ts";
import { fermentationHasStarted, type BrewStage } from "../../domain/model/brewing.ts";
import { Button, Card, cx, Icon, Section, StatusChip } from "../../design-system/index.ts";
import { formatAmount, formatDuration, formatNumber, formatSg } from "../../lib/format.ts";

/**
 * Recipe values are unprefixed; calculations get "≈" and assumptions "≈ … antatt". Which
 * assumptions were used is listed once under "Antakelser i planen", not on every number.
 */
function withSource(source: PlanQuantity["source"], text: string): string {
  if (source === "recipe") return text;
  return source === "calculated" ? `≈ ${text}` : `≈ ${text} antatt`;
}

function quantity(q: PlanQuantity | undefined, unit: string, decimals = 1): string | null {
  if (!q) return null;
  const formatted = unit === "SG" ? formatSg(q.value) : formatNumber(q.value, decimals);
  return withSource(q.source, `${formatted}${unit === "SG" ? "" : ` ${unit}`}`);
}

function temperature(q: PlanQuantity | undefined, maxC?: number): string | null {
  if (!q) return null;
  if (maxC !== undefined && maxC !== q.value) {
    const range = `${formatNumber(q.value, 1)}–${formatNumber(maxC, 1)} °C`;
    return withSource(q.source, range);
  }
  return quantity(q, "°C");
}

function forecastValue(value: BrewDayForecast["postBoilVolumeL"], unit: string): string {
  const formatted = unit === "SG" ? formatSg(value.value) : `${formatNumber(value.value, 1)} ${unit}`;
  if (value.source === "measured") return `Målt ${formatted}`;
  return withSource(value.source === "assumed" ? "assumed" : "calculated", formatted);
}

const statusChip: Record<PhaseStatus, { tone: "success" | "primary" | "neutral"; label: string }> = {
  done: { tone: "success", label: "Ferdig" },
  current: { tone: "primary", label: "Nå" },
  upcoming: { tone: "neutral", label: "Senere" },
};

/**
 * The whole brew day on one screen: water, mash, sparge, boil, hops, pitching and
 * fermentation. The current phase is highlighted, but every phase stays readable and every
 * planned addition can be registered whenever it actually happens.
 */
export function BrewPlanOverview({
  plan,
  forecast,
  currentStage,
  liveAdditions,
  elapsedMin,
  onAdd,
  busy,
}: {
  plan: BrewPlan;
  forecast: BrewDayForecast | null;
  currentStage: BrewStage | null;
  /** Due/upcoming status for the current stage, from `deriveBrewDayState`. */
  liveAdditions: PlannedAddition[];
  /** Minutes into the current stage; drives "om 12 min" for boil and whirlpool additions. */
  elapsedMin: number | null;
  onAdd: (addition: PlanAddition) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState<Partial<Record<string, boolean>>>({});

  if (plan.phases.length === 0) return null;

  return (
    <Section title="Bryggeplan">
      <KeyFigures summary={plan.summary} currentStage={currentStage} forecast={forecast} />

      <nav aria-label="Faser i bryggeplanen" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {plan.phases.map((phase) => {
          const status = brewPlanPhaseStatus(phase, currentStage);
          return (
            <a
              key={phase.key}
              href={`#plan-${phase.key}`}
              onClick={() => setExpanded((current) => ({ ...current, [phase.key]: true }))}
              aria-current={status === "current" ? "step" : undefined}
              className={cx(
                "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3 text-small font-semibold whitespace-nowrap",
                status === "current" ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
                status === "done" && "text-muted",
              )}
            >
              {status === "done" && <Icon name="check" size={16} />}
              {brewPlanPhaseLabels[phase.key]}
            </a>
          );
        })}
      </nav>

      <div className="space-y-3">
        {plan.phases.map((phase) => {
          const status = brewPlanPhaseStatus(phase, currentStage);
          const open = expanded[phase.key] ?? status !== "done";
          return (
            <PhaseCard
              key={phase.key}
              phase={phase}
              status={status}
              open={open}
              onToggle={() => setExpanded((current) => ({ ...current, [phase.key]: !open }))}
              assumptions={phase.key === "water" ? plan.summary.assumptions : undefined}
              liveAdditions={status === "current" ? liveAdditions : []}
              countdownFrom={status === "current" && currentStage !== "fermentation" && currentStage !== "conditioning" ? elapsedMin : null}
              canRegister={currentStage !== null}
              onAdd={onAdd}
              busy={busy}
            />
          );
        })}
      </div>

      <p className="text-caption text-muted">
        Oppskrift = oppgitt av oppskriften/importen · ≈ = beregnet fra oppskrifts- eller profilverdier · ≈ … antatt = dokumentert standardverdi som fortsatt bør måles (se Antakelser i planen) · Målt = loggført verdi.
      </p>
    </Section>
  );
}

function KeyFigures({ summary, currentStage, forecast }: { summary: BrewPlan["summary"]; currentStage: BrewStage | null; forecast: BrewDayForecast | null }) {
  // Once the wort is in the fermenter, strike water and boil times are history.
  const brewDayDone = fermentationHasStarted(currentStage);
  const brewDayFigures = brewDayDone ? [] : [
    summary.strikeVolumeL || summary.strikeTemperatureC
      ? { label: "Innmesking", value: quantity(summary.strikeTemperatureC, "°C") ?? "–", detail: quantity(summary.strikeVolumeL, "L") }
      : null,
    summary.mashTemperatureC !== undefined
      ? {
          label: "Mesk",
          value: `${formatNumber(summary.mashTemperatureC, 1)} °C`,
          detail: summary.mashDurationMin !== undefined ? `${formatNumber(summary.mashDurationMin, 0)} min` : null,
        }
      : null,
    summary.spargeVolumeL || summary.spargeTemperatureC !== undefined
      ? {
          label: "Skyllevann",
          value: quantity(summary.spargeTemperatureC, "°C") ?? "–",
          detail: quantity(summary.spargeVolumeL, "L"),
        }
      : null,
    summary.boilTimeMin > 0
      ? {
          label: "Kok",
          value: `${formatNumber(summary.boilTimeMin, 0)} min`,
          detail: [summary.preBoilVolumeL ? `før kok ${quantity(summary.preBoilVolumeL, "L")}` : null, summary.preBoilSg ? `SG før kok ${quantity(summary.preBoilSg, "SG")}` : null].filter(Boolean).join(" · ") || null,
        }
      : null,
    summary.grainKg > 0 ? { label: "Malt", value: `${formatNumber(summary.grainKg, 2)} kg`, detail: null } : null,
    summary.hopTotalG > 0 ? { label: "Humle totalt", value: formatAmount(summary.hopTotalG, "g"), detail: null } : null,
  ];
  const figures = [
    ...brewDayFigures,
    brewDayDone && summary.dryHopTotalG > 0 ? { label: "Tørrhumling", value: formatAmount(summary.dryHopTotalG, "g"), detail: null } : null,
    summary.pitchTemperatureC !== undefined
      ? { label: "Gjærtilsetting", value: `${formatNumber(summary.pitchTemperatureC, 1)} °C`, detail: null }
      : null,
    summary.og !== null
      ? { label: "OG → FG", value: quantity(summary.og, "SG"), detail: summary.fg !== null ? `→ ${quantity(summary.fg, "SG")}` : null }
      : null,
    forecast
      ? {
          label: forecast.postBoilVolumeL.source === "measured" ? "Målt volum etter kok" : "Forventet volum etter kok",
          value: forecastValue(forecast.postBoilVolumeL, "L"),
          detail: summary.postBoilVolumeL ? `Plan ${quantity(summary.postBoilVolumeL, "L")}` : null,
        }
      : null,
    forecast?.postBoilOg
      ? {
          label: forecast.postBoilOg.source === "measured" ? "Målt OG etter kok" : "Forventet OG etter kok",
          value: forecastValue(forecast.postBoilOg, "SG"),
          detail: forecast.plannedOg ? `Plan ${quantity(forecast.plannedOg, "SG")}` : null,
        }
      : null,
  ].filter((figure) => figure !== null);

  if (figures.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {figures.map((figure) => (
        <div key={figure.label} className="rounded-md border border-border bg-surface px-3 py-2">
          <dt className="text-caption font-semibold text-muted">{figure.label}</dt>
          <dd className="tabular text-section font-bold">{figure.value}</dd>
          {figure.detail && <dd className="tabular text-small text-muted">{figure.detail}</dd>}
        </div>
      ))}
    </dl>
  );
}

function PhaseCard({
  phase,
  status,
  open,
  onToggle,
  assumptions,
  liveAdditions,
  countdownFrom,
  canRegister,
  onAdd,
  busy,
}: {
  phase: BrewPlanPhase;
  status: PhaseStatus;
  open: boolean;
  onToggle: () => void;
  assumptions?: PlanAssumption[];
  liveAdditions: PlannedAddition[];
  countdownFrom: number | null;
  canRegister: boolean;
  onAdd: (addition: PlanAddition) => void;
  busy: boolean;
}) {
  const additions = phase.items.filter((item) => item.addition);
  const doneCount = additions.filter((item) => item.done).length;
  const chip = statusChip[status];
  const contentId = `plan-${phase.key}-content`;

  return (
    <div id={`plan-${phase.key}`} className="scroll-mt-20">
      <Card highlight={status === "current"} flush>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={contentId}
          className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left md:px-5"
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{brewPlanPhaseLabels[phase.key]}</span>
              <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
            </span>
            {additions.length > 0 && (
              <span className="text-small text-muted">
                {doneCount}/{additions.length} tilsatt
              </span>
            )}
          </span>
          <Icon name="chevronDown" size={20} className={cx("shrink-0 text-muted transition-transform", open && "rotate-180")} />
        </button>
        {open && (
          <ul id={contentId} className="divide-y divide-border border-t border-border px-4 md:px-5">
            {assumptions && assumptions.length > 0 && (
              <li className="flex gap-2 py-3 text-small text-muted">
                <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
                <div>
                  <p className="font-semibold">Antakelser i planen</p>
                  <ul className="mt-1 space-y-2">
                    {assumptions.map((assumption) => (
                      <li key={assumption.key}>
                        {assumption.label}: {formatNumber(assumption.value, 2)} {assumption.unit}. {assumption.explanation} {assumption.measureToReplace}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            )}
            {phase.items.map((item) => (
              <PlanItemRow
                key={item.id}
                item={item}
                live={item.addition ? liveAdditions.find((a) => a.ingredientId === item.addition?.ingredientId) : undefined}
                countdownFrom={countdownFrom}
                canRegister={canRegister}
                onAdd={onAdd}
                busy={busy}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function PlanItemRow({
  item,
  live,
  countdownFrom,
  canRegister,
  onAdd,
  busy,
}: {
  item: BrewPlanItem;
  live?: PlannedAddition;
  countdownFrom: number | null;
  /** Additions can only be registered once the brew has started. */
  canRegister: boolean;
  onAdd: (addition: PlanAddition) => void;
  busy: boolean;
}) {
  const details = [
    item.timing ?? null,
    temperature(item.temperatureC, item.temperatureMaxC),
    item.durationMin !== undefined ? `${formatNumber(item.durationMin, 0)} min` : null,
    item.durationDays !== undefined ? `${formatNumber(item.durationDays, 0)} ${item.durationDays === 1 ? "dag" : "dager"}` : null,
    quantity(item.volumeL, "L"),
    quantity(item.gravitySg, "SG"),
  ].filter(Boolean);
  const due = !live || live.status === "done" || item.done
    ? null
    : live.status === "due"
      ? "nå"
      : countdownFrom !== null
        ? `om ${formatDuration(Math.max(0, live.dueAt - countdownFrom))}`
        : null;

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {item.amount && <span className="tabular">{formatAmount(item.amount.value, item.amount.unit)} </span>}
          {item.title}
          {item.variant && <span className="ml-2 text-small font-normal text-muted">· {item.variant}</span>}
        </p>
        {(details.length > 0 || due) && (
          <p className="tabular text-small text-muted">
            {details.join(" · ")}
            {due && (
              <span className={cx(live?.status === "due" && "font-semibold text-primary-strong")}>
                {details.length > 0 ? " · " : ""}
                {due}
              </span>
            )}
          </p>
        )}
        {item.note && <p className="text-small text-muted">{item.note}</p>}
      </div>
      {item.addition &&
        (item.done ? (
          <StatusChip tone="success" icon="check">
            Tilsatt
          </StatusChip>
        ) : canRegister ? (
          <Button
            size="sm"
            variant={live?.status === "due" ? "primary" : "secondary"}
            disabled={busy}
            onClick={() => item.addition && onAdd(item.addition)}
          >
            Tilsett
          </Button>
        ) : null)}
    </li>
  );
}
