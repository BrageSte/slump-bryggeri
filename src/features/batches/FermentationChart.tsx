import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { FermentationVariant } from "../../domain/brew-day/fermentation.ts";
import { cx, Section } from "../../design-system/index.ts";
import { formatLogTime, formatNumber, formatSg } from "../../lib/format.ts";

/**
 * Gravity and temperature over time, one line per fermenter (docs/design-system.md → Grafer).
 * Two panels on a shared time axis — never two y-scales on one plot. Only real readings are drawn:
 * a hollow dot is SG derived from Brix, and the table under the chart holds every value.
 */

const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)"] as const;
const DAY = 86_400_000;
const MARGIN = { left: 46, right: 12, top: 10 };
const PLOT_HEIGHT = 132;
const AXIS_BAND = 26;
/** Internal width of the printed chart; it is scaled to the paper width. */
const PRINT_WIDTH = 680;

interface ChartPoint {
  at: number;
  value: number;
  derived: boolean;
}

interface ChartSeries {
  key: string;
  name: string;
  color: string;
  gravity: ChartPoint[];
  temperature: ChartPoint[];
}

type Metric = "gravity" | "temperature";

export function FermentationChart({
  variants,
  until,
  printable = false,
}: {
  variants: FermentationVariant[];
  until: number;
  /** For the report: every variant, no filter, and the table always open. */
  printable?: boolean;
}) {
  // Colour follows the fermenter (its place in the batch), never the filter: max three validated slots.
  const all: ChartSeries[] = useMemo(
    () =>
      variants.slice(0, SERIES_COLORS.length).map((variant, index) => ({
        key: variant.splitId ?? "batch",
        name: variant.name,
        color: SERIES_COLORS[index] as string,
        gravity: [...(variant.og ? [variant.og] : []), ...variant.gravity].map((p) => ({ at: p.at, value: p.sg, derived: p.source === "brix" })),
        temperature: variant.temperature.map((p) => ({ at: p.at, value: p.value, derived: false })),
      })),
    [variants],
  );
  const [selected, setSelected] = useState<string>("all");
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [ref, width] = useElementWidth<HTMLDivElement>();

  const shown = selected === "all" ? all : all.filter((s) => s.key === selected);
  const metrics = (["gravity", "temperature"] as const).filter((metric) => shown.some((s) => s[metric].length > 0));
  const worthDrawing = all.some((s) => s.gravity.length >= 2 || s.temperature.length >= 2);
  if (!worthDrawing) return null;

  const pitchTimes = variants.flatMap((v) => (v.pitchedAt === null ? [] : [v.pitchedAt]));
  const pointTimes = shown.flatMap((s) => [...s.gravity, ...s.temperature].map((p) => p.at));
  const dayZero = pitchTimes.length > 0 ? Math.min(...pitchTimes) : pointTimes.length > 0 ? Math.min(...pointTimes) : until;
  const xMin = Math.min(dayZero, ...pointTimes);
  const xMax = Math.max(until, ...pointTimes, xMin + DAY);
  const xs = [...new Set(pointTimes)].sort((a, b) => a - b);
  const derivedShown = shown.some((s) => s.gravity.some((p) => p.derived));

  const plotWidth = Math.max(120, width - MARGIN.left - MARGIN.right);
  const x = (at: number) => MARGIN.left + ((at - xMin) / (xMax - xMin)) * plotWidth;

  const nearest = (at: number) => xs.reduce((best, candidate) => (Math.abs(candidate - at) < Math.abs(best - at) ? candidate : best), xs[0] ?? at);
  const onPointer = (event: PointerEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = xMin + ((event.clientX - box.left) / box.width) * (xMax - xMin);
    setHoverAt(nearest(at));
  };
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (xs.length === 0) return;
    const index = hoverAt === null ? xs.length : xs.indexOf(hoverAt);
    if (event.key === "ArrowLeft") setHoverAt(xs[Math.max(0, index - 1)] ?? null);
    else if (event.key === "ArrowRight") setHoverAt(xs[Math.min(xs.length - 1, hoverAt === null ? xs.length - 1 : index + 1)] ?? null);
    else if (event.key === "Escape") setHoverAt(null);
    else return;
    event.preventDefault();
  };

  const body = (
      <div className="space-y-3 rounded-card border border-border bg-surface p-3 md:p-4 print:border-0 print:p-0">
        {all.length > 1 && !printable && (
          <div role="group" aria-label="Vis variant" className="flex flex-wrap gap-2">
            {[{ key: "all", name: "Alle" }, ...all].map((option) => (
              <button
                key={option.key}
                type="button"
                aria-pressed={selected === option.key}
                onClick={() => (setSelected(option.key), setHoverAt(null))}
                className={cx(
                  "min-h-11 rounded-full border px-4 text-small font-semibold",
                  selected === option.key ? "border-primary bg-primary text-on-primary" : "border-border bg-surface",
                )}
              >
                {option.name}
              </button>
            ))}
          </div>
        )}

        <div className={printable ? "print:hidden" : undefined}>
          <Readout series={shown} metrics={metrics} at={hoverAt} dayZero={dayZero} />
        </div>

        <div
          ref={ref}
          tabIndex={0}
          role="group"
          aria-label="Gjæringsgraf. Piltastene flytter mellom målingene."
          onKeyDown={onKey}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary-strong/40"
        >
          {printable && (
            <div className="hidden break-inside-avoid print:block">
              {metrics.map((metric, index) => (
                <figure key={metric} className="m-0">
                  <figcaption className="text-caption font-semibold text-muted">{metric === "gravity" ? "SG" : "Temperatur (°C)"}</figcaption>
                  <Panel
                    metric={metric}
                    series={shown}
                    width={PRINT_WIDTH}
                    x={(at) => MARGIN.left + ((at - xMin) / (xMax - xMin)) * (PRINT_WIDTH - MARGIN.left - MARGIN.right)}
                    xMin={xMin}
                    xMax={xMax}
                    dayZero={dayZero}
                    showAxis={index === metrics.length - 1}
                    hoverAt={null}
                    onPointer={() => {}}
                    onLeave={() => {}}
                    fluid
                  />
                </figure>
              ))}
            </div>
          )}
          {width > 0 &&
            metrics.map((metric, index) => (
              <figure key={metric} className={cx("m-0", printable && "print:hidden")}>
                <figcaption className="text-caption font-semibold text-muted">{metric === "gravity" ? "SG" : "Temperatur (°C)"}</figcaption>
                <Panel
                metric={metric}
                series={shown}
                width={width}
                x={x}
                xMin={xMin}
                xMax={xMax}
                dayZero={dayZero}
                showAxis={index === metrics.length - 1}
                hoverAt={hoverAt}
                onPointer={onPointer}
                onLeave={() => setHoverAt(null)}
                />
              </figure>
            ))}
        </div>

        {shown.length > 1 || derivedShown ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-small text-muted" aria-label="Forklaring">
            {shown.length > 1 &&
              shown.map((s) => (
                <li key={s.key} className="flex items-center gap-2">
                  <LineKey color={s.color} />
                  {s.name}
                </li>
              ))}
            {derivedShown && (
              <li className="flex items-center gap-2">
                <svg width="12" height="12" aria-hidden="true">
                  <circle cx="6" cy="6" r="4" fill="var(--surface)" stroke="var(--text-muted)" strokeWidth="2" />
                </svg>
                regnet fra Brix
              </li>
            )}
          </ul>
        ) : null}

        <ReadingsTable series={shown} dayZero={dayZero} open={printable} absolute={printable} />
      </div>
  );
  return printable ? body : <Section title="Gjæringsgraf">{body}</Section>;
}

function Panel({
  metric,
  series,
  width,
  x,
  xMin,
  xMax,
  dayZero,
  showAxis,
  hoverAt,
  onPointer,
  onLeave,
  fluid = false,
}: {
  metric: Metric;
  series: ChartSeries[];
  width: number;
  x: (at: number) => number;
  xMin: number;
  xMax: number;
  dayZero: number;
  showAxis: boolean;
  hoverAt: number | null;
  onPointer: (event: PointerEvent<SVGRectElement>) => void;
  onLeave: () => void;
  /** Scale to the container (print) instead of drawing at `width` pixels. */
  fluid?: boolean;
}) {
  const values = series.flatMap((s) => s[metric].map((p) => p.value));
  const { ticks, min, max } = niceScale(values, metric === "gravity" ? [0.002, 0.005, 0.01, 0.02] : [0.5, 1, 2, 5]);
  const y = (value: number) => MARGIN.top + (1 - (value - min) / (max - min)) * PLOT_HEIGHT;
  const height = MARGIN.top + PLOT_HEIGHT + (showAxis ? AXIS_BAND : 8);
  const format = (value: number) => (metric === "gravity" ? formatSg(value) : formatNumber(value, 1));
  const span = (xMax - dayZero) / DAY;
  const dayStep = span <= 8 ? 1 : span <= 16 ? 2 : 7;
  const dayTicks: number[] = [];
  for (let day = Math.ceil((xMin - dayZero) / DAY); dayZero + day * DAY <= xMax; day += 1) {
    if (day % dayStep === 0) dayTicks.push(day);
  }

  return (
    <svg
      width={fluid ? "100%" : width}
      height={fluid ? undefined : height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={metric === "gravity" ? "SG over tid" : "Temperatur over tid"}
      className="block"
    >
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
          <text x={MARGIN.left - 6} y={y(tick) + 4} textAnchor="end" className="fill-[var(--text-muted)] text-[11px] tabular-nums">
            {format(tick)}
          </text>
        </g>
      ))}
      {showAxis &&
        dayTicks.map((day) => (
          <text key={day} x={x(dayZero + day * DAY)} y={MARGIN.top + PLOT_HEIGHT + 18} textAnchor="middle" className="fill-[var(--text-muted)] text-[11px] tabular-nums">
            {day === 0 ? "dag 0" : day}
          </text>
        ))}
      {hoverAt !== null && (
        <line x1={x(hoverAt)} x2={x(hoverAt)} y1={MARGIN.top} y2={MARGIN.top + PLOT_HEIGHT} stroke="var(--text-muted)" strokeWidth={1} />
      )}
      {series.map((s) => {
        const points = s[metric];
        if (points.length === 0) return null;
        const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
        return (
          <g key={s.key}>
            {points.length > 1 && <path d={path} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {points.map((p) => {
              const active = p.at === hoverAt;
              const r = active ? 5 : 4;
              return (
                <g key={p.at}>
                  <circle cx={x(p.at)} cy={y(p.value)} r={r + 2} fill="var(--surface)" />
                  <circle
                    cx={x(p.at)}
                    cy={y(p.value)}
                    r={p.derived ? r - 1 : r}
                    fill={p.derived ? "var(--surface)" : s.color}
                    stroke={s.color}
                    strokeWidth={p.derived ? 2 : 0}
                  />
                </g>
              );
            })}
          </g>
        );
      })}
      <rect
        x={MARGIN.left}
        y={MARGIN.top}
        width={Math.max(0, width - MARGIN.left - MARGIN.right)}
        height={PLOT_HEIGHT}
        fill="transparent"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={onLeave}
      />
    </svg>
  );
}

/** The values at the crosshair (or the latest ones): values lead, names follow. */
function Readout({ series, metrics, at, dayZero }: { series: ChartSeries[]; metrics: Metric[]; at: number | null; dayZero: number }) {
  const until = at ?? Number.POSITIVE_INFINITY;
  const latestBefore = (points: ChartPoint[]) => points.findLast((p) => p.at <= until) ?? null;
  return (
    <div aria-live="polite" className="min-h-12 text-small">
      <p className="text-caption font-semibold tracking-wide text-muted uppercase">
        {at === null ? "Siste måling" : `${dayLabel(at, dayZero)} · ${formatLogTime(at)}`}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <LineKey color={s.color} />
            {metrics.map((metric) => {
              const point = latestBefore(s[metric]);
              return (
                <strong key={metric} className="tabular-nums">
                  {point ? (metric === "gravity" ? formatSg(point.value) : `${formatNumber(point.value, 1)} °C`) : "–"}
                </strong>
              );
            })}
            {series.length > 1 && <span className="text-muted">{s.name}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadingsTable({ series, dayZero, open, absolute }: { series: ChartSeries[]; dayZero: number; open: boolean; absolute: boolean }) {
  const rows = series
    .flatMap((s) => {
      const times = [...new Set([...s.gravity, ...s.temperature].map((p) => p.at))];
      return times.map((at) => ({ at, name: s.name, gravity: s.gravity.find((p) => p.at === at), temperature: s.temperature.find((p) => p.at === at) }));
    })
    .sort((a, b) => a.at - b.at);
  return (
    <details className="text-small" open={open || undefined}>
      <summary className="min-h-11 cursor-pointer py-2 font-semibold text-primary-strong print:hidden">Vis som tabell ({rows.length})</summary>
      <table className="w-full text-left">
        <thead className="text-caption text-muted uppercase">
          <tr>
            <th className="py-1 pr-2 font-semibold">Tid</th>
            {series.length > 1 && <th className="py-1 pr-2 font-semibold">Variant</th>}
            <th className="py-1 pr-2 text-right font-semibold">SG</th>
            <th className="py-1 text-right font-semibold">°C</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={`${row.name}-${row.at}`}>
              <td className="py-1.5 pr-2">
                {dayLabel(row.at, dayZero)} · {absolute ? shortDateTime(row.at) : formatLogTime(row.at)}
              </td>
              {series.length > 1 && <td className="py-1.5 pr-2">{row.name}</td>}
              <td className="py-1.5 pr-2 text-right tabular-nums">
                {row.gravity ? `${formatSg(row.gravity.value)}${row.gravity.derived ? " (Brix)" : ""}` : "–"}
              </td>
              <td className="py-1.5 text-right tabular-nums">{row.temperature ? formatNumber(row.temperature.value, 1) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

function LineKey({ color }: { color: string }) {
  return (
    <svg width="16" height="8" aria-hidden="true" className="shrink-0">
      <line x1="1" x2="15" y1="4" y2="4" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** A padded y-domain around the data, with round ticks: the smallest step giving at most six. */
function niceScale(values: number[], steps: number[]): { ticks: number[]; min: number; max: number } {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max((high - low) * 0.08, steps[0]! / 2);
  const min = low - padding;
  const max = high + padding;
  const ticksFor = (step: number) => {
    const ticks: number[] = [];
    for (let tick = Math.ceil(min / step) * step; tick <= max + 1e-9; tick += step) ticks.push(Math.round(tick * 1e6) / 1e6);
    return ticks;
  };
  const step = steps.find((candidate) => ticksFor(candidate).length <= 6) ?? steps.at(-1)!;
  return { ticks: ticksFor(step), min, max };
}

/** "23.09 11:05": for printed reports, where "i går" would go stale. */
function shortDateTime(at: number): string {
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "dag 2", or "før gjæring" for the OG taken before the yeast was pitched. */
function dayLabel(at: number, dayZero: number): string {
  return at < dayZero ? "før gjæring" : `dag ${Math.floor((at - dayZero) / DAY)}`;
}

function useElementWidth<T extends HTMLElement>(): [(element: T | null) => void, number] {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  useEffect(() => () => observer.current?.disconnect(), []);
  const ref = useCallback((element: T | null) => {
    observer.current?.disconnect();
    if (!element) return;
    setWidth(element.clientWidth);
    observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.current.observe(element);
  }, []);
  return [ref, width];
}
