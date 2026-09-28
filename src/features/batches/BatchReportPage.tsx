import type { ReactNode } from "react";
import { Link, useParams } from "react-router";
import { brixToSg, calculateRecipeMetrics, expectedGravities, grainBillPercentages } from "../../domain/brewing-calculations/index.ts";
import { buildFermentationSeries } from "../../domain/brew-day/fermentation.ts";
import { brewhouseNumbers, resultNumbers } from "../../domain/brew-day/outcome.ts";
import { packagingLabels, type BatchDetail, type TimelineItem } from "../../domain/model/api.ts";
import { brewStageLabels, eventTypeLabels, fermentationHasStarted, measurementKindSpecs } from "../../domain/model/brewing.ts";
import { hopUseLabels, type HopAddition } from "../../domain/model/recipe.ts";
import { Button, buttonClasses, ErrorState, LoadingState, PageHeader } from "../../design-system/index.ts";
import { formatAmount, formatDate, formatNumber, formatSg } from "../../lib/format.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useBatch, useTimeline } from "./api.ts";
import { FermentationChart } from "./FermentationChart.tsx";
import { formatMeasurement, formatMeasurementInUnit, formatMeasurementRange, statusLabel, toBrewDayLog } from "./helpers.ts";

/**
 * Brew report (B8, plan step 4): everything the brewery logged for one batch, on screen and on A4.
 * «Lagre som PDF» is the browser's own print dialog. Missing data says «ikke målt»; nothing is
 * filled in from the recipe except where a column is explicitly the plan.
 */
export function BatchReportPage() {
  const { batchId } = useParams();
  const batch = useBatch(batchId);
  const timeline = useTimeline(batchId, false);

  if (batch.isPending || timeline.isPending) {
    return (
      <>
        <PageHeader back={`/batcher/${batchId}`} title="Rapport" />
        <LoadingState />
      </>
    );
  }
  if (batch.error || timeline.error) {
    return (
      <>
        <PageHeader back={`/batcher/${batchId}`} title="Rapport" />
        <ErrorState error={batch.error ?? timeline.error} onRetry={() => void (batch.refetch(), timeline.refetch())} />
      </>
    );
  }
  return <Report batch={batch.data} timeline={timeline.data} />;
}

/** Compact for tables: "23.09 11:05". */
const dateTime = (timestamp: number) => {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "1.012" for one fermenter, "1.012–1.017" (or "5,8–6,4 %") across several. */
function spread(values: number[], format: (value: number) => string, unit = ""): string {
  if (values.length === 0) return "ikke målt";
  const low = format(Math.min(...values));
  const high = format(Math.max(...values));
  return `${low === high ? low : `${low}–${high}`}${unit}`;
}

function Report({ batch, timeline }: { batch: BatchDetail; timeline: TimelineItem[] }) {
  const { breweryName } = useBrewery();
  const recipe = batch.recipeSnapshot;
  const wcf = batch.equipmentSnapshot.values.refractometer_wcf ?? 1;
  const log = toBrewDayLog(timeline);
  const variants = buildFermentationSeries({ log, splits: batch.splits, wcf, recipe: batch.recipeSnapshot });
  const numbers = brewhouseNumbers({ recipe, log, splits: batch.splits, wcf });
  const plan = expectedGravities(recipe);
  const metrics = calculateRecipeMetrics(recipe);
  const planAbv = recipe.targets.abvPct ?? metrics.abvPct;
  const splitName = (splitId: string | null) => batch.splits.find((s) => s.id === splitId)?.name ?? "Hele batchen";
  const outcomes = batch.outcomes.map((o) => ({ ...o, name: splitName(o.splitId), ...resultNumbers(o.og, o.fg) }));
  const perVariant = (values: string[]) => (values.length === 0 ? "ikke målt" : values.join(" · "));
  const shares = grainBillPercentages(recipe.fermentables);

  const brewDayReadings = timeline.filter((t) => t.measurement && !fermentationHasStarted(t.stage));
  const pitched = timeline.filter((t) => t.type === "yeast_pitched");
  const notes = timeline.filter((t) => t.comment || ["custom", "transfer_started", "transfer_completed", "cold_crash_started", "packaged"].includes(t.type));
  const uncertainties = [
    numbers.og?.source === "brix" ? `OG er regnet fra refraktometer (Brix) med WCF ${formatNumber(wcf, 2)}.` : null,
    timeline.some((t) => t.measurement?.kind === "ph" && t.measurement.valueMin !== null) ? "pH er avlest med strips som intervall, ikke med pH-meter." : null,
    variants.some((v) => v.gravity.some((p) => p.source === "brix")) ? "SG under gjæring fra refraktometer er alkoholkorrigert (Terrill) og er et anslag." : null,
    numbers.missing.length > 0 ? `Mangler for bryggeri-tall: ${numbers.missing.join(", ")}.` : null,
    batch.status !== "completed" ? "Batchen er ikke avsluttet; tall etter gjæring kan komme til." : null,
  ].filter((note): note is string => note !== null);

  return (
    <article className="space-y-6 text-body print:space-y-4 print:text-[10pt]">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link to={`/batcher/${batch.id}`} className={buttonClasses("ghost")}>
          ← Til brygget
        </Link>
        <Button variant="primary" icon="file" onClick={() => window.print()}>
          Lagre som PDF
        </Button>
      </div>

      <header className="border-b border-border pb-4 text-center">
        <p className="text-caption font-semibold tracking-[.2em] text-muted uppercase">{breweryName} · Bryggerapport</p>
        <h1 className="mt-1 text-title font-bold">{batch.name}</h1>
        <p className="text-small text-muted">
          #{batch.number} · {recipe.style ? `${recipe.style} · ` : ""}oppskrift v{batch.recipeVersion.version}
          {batch.brewDate ? ` · brygget ${formatDate(batch.brewDate)}` : ""} · {statusLabel(batch.status)}
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:grid-cols-4">
        <Figure label="Til gjæring" value={numbers.fermenterVolumeL === null ? "–" : `${formatNumber(numbers.fermenterVolumeL, 0)} L`} />
        <Figure label="OG" value={formatSg(numbers.og?.sg)} hint={numbers.og?.source === "brix" ? "fra Brix" : undefined} />
        <Figure label="FG" value={spread(outcomes.flatMap((o) => (o.fg === null ? [] : [o.fg])), formatSg)} />
        <Figure label="ABV" value={spread(outcomes.flatMap((o) => (o.abvPct === null ? [] : [o.abvPct])), (v) => formatNumber(v, 1), " %")} />
      </dl>

      {recipe.description && <p>{recipe.description}</p>}

      <ReportSection title="Plan mot faktisk">
        <Table head={["", "Plan", "Faktisk"]}>
          <Row cells={["OG", formatSg(plan.og), numbers.og ? `${formatSg(numbers.og.sg)}${numbers.og.source === "brix" ? " (fra Brix)" : ""}` : "ikke målt"]} />
          <Row cells={["FG", formatSg(plan.fg), perVariant(outcomes.flatMap((o) => (o.fg === null ? [] : [`${o.name}: ${formatSg(o.fg)}`])))]} />
          <Row
            cells={[
              "ABV",
              planAbv === null ? "–" : `${formatNumber(planAbv, 1)} %`,
              perVariant(outcomes.flatMap((o) => (o.abvPct === null ? [] : [`${o.name}: ${formatNumber(o.abvPct, 1)} %`]))),
            ]}
          />
          <Row cells={["Volum til gjæring", `${formatNumber(recipe.batchSizeL, 0)} L`, numbers.fermenterVolumeL === null ? "ikke målt" : `${formatNumber(numbers.fermenterVolumeL, 1)} L`]} />
          <Row cells={["Volum før kok", "–", numbers.preBoilVolumeL === null ? "ikke målt" : `${formatNumber(numbers.preBoilVolumeL, 1)} L`]} />
          <Row
            cells={[
              "Fordampning",
              batch.equipmentSnapshot.values.boil_off_l_per_h === undefined ? "–" : `${formatNumber(batch.equipmentSnapshot.values.boil_off_l_per_h, 1)} L/t`,
              numbers.boilOffLPerHour === null ? "ikke målt" : `${formatNumber(numbers.boilOffLPerHour, 1)} L/t`,
            ]}
          />
          <Row
            cells={[
              "Brygghuseffektivitet",
              `${formatNumber(recipe.efficiencyPct, 0)} %`,
              numbers.efficiencyPct === null ? "ikke målt" : `${formatNumber(numbers.efficiencyPct, 0)} %`,
            ]}
          />
          <Row cells={["IBU", metrics.ibu === null ? "–" : formatNumber(recipe.targets.ibu ?? metrics.ibu, 0), "ikke målt"]} />
        </Table>
      </ReportSection>

      <ReportSection title="Malt">
        <Table head={["Malt", "Mengde", "Andel", "Farge"]}>
          {recipe.fermentables.map((f, i) => (
            <Row
              key={f.id}
              cells={[
                f.name,
                formatAmount(f.amountKg, "kg"),
                `${formatNumber(shares[i], 1)} %`,
                f.colorEbc === undefined ? "–" : `${formatNumber(f.colorEbc, 0)} EBC`,
              ]}
            />
          ))}
          <Row cells={["Totalt", formatAmount(recipe.fermentables.reduce((sum, f) => sum + f.amountKg, 0), "kg"), "100 %", ""]} strong />
        </Table>
      </ReportSection>

      <ReportSection title="Humle og tilsetninger">
        <Table head={["Når", "Hva", "Plan", "Faktisk", "Merknad"]}>
          {recipe.hops.map((hop) => (
            <Row key={hop.id} cells={[hopTiming(hop), hopName(hop), nb(formatAmount(hop.amountG, "g")), actualAmount(timeline, hop.id), hop.notes ?? ""]} />
          ))}
          {recipe.miscs.map((misc) => (
            <Row key={misc.id} cells={[misc.use === "boil" && misc.timeMin !== undefined ? `${misc.timeMin} min kok` : misc.use, misc.name, formatAmount(misc.amount, misc.unit), actualAmount(timeline, misc.id), misc.notes ?? ""]} />
          ))}
          {timeline
            .filter((t) => t.type === "ingredient_added" && !isPlanned(batch, t.data?.ingredientId))
            .map((t) => (
              <Row key={t.id} cells={[dateTime(t.occurredAt), String(t.data?.name ?? "Tilsetning"), "ikke planlagt", amountOf(t), String(t.data?.note ?? "")]} />
            ))}
        </Table>
      </ReportSection>

      <ReportSection title="Gjær og fordeling">
        <Table head={["Variant", "Kar", "Volum", "Gjær tilsatt"]}>
          {batch.splits.map((split) => (
            <Row
              key={split.id}
              cells={[split.name, split.vessel ?? "–", split.volumeL === null ? "–" : `${formatNumber(split.volumeL, 1)} L`, yeastText(pitched, split.id)]}
            />
          ))}
          {(batch.splits.length === 0 || pitched.some((t) => t.splitId === null)) && (
            <Row cells={["Hele batchen", "–", numbers.fermenterVolumeL === null ? "–" : `${formatNumber(numbers.fermenterVolumeL, 1)} L`, yeastText(pitched, null)]} />
          )}
        </Table>
      </ReportSection>

      <ReportSection title="Mesk, kok og gjæringsplan">
        <ul className="space-y-1">
          {recipe.mashSteps.map((step) => (
            <li key={step.id}>
              {step.name}: {formatNumber(step.temperatureC, 1)} °C i {step.durationMin} min
              {step.infusionL !== undefined ? ` · ${formatNumber(step.infusionL, 1)} L vann` : ""}
              {step.infusionTemperatureC !== undefined ? ` ved ${formatNumber(step.infusionTemperatureC, 1)} °C` : ""}
            </li>
          ))}
          {recipe.spargeTemperatureC !== undefined && <li>Skyllevann: {formatNumber(recipe.spargeTemperatureC, 1)} °C</li>}
          <li>Kok: {recipe.boilTimeMin} min</li>
          {recipe.fermentationSteps.map((step) => (
            <li key={step.id}>
              {step.name}
              {step.temperatureC !== undefined ? `: ${formatNumber(step.temperatureC, 1)}${step.temperatureMaxC !== undefined ? `–${formatNumber(step.temperatureMaxC, 1)}` : ""} °C` : ""}
              {step.durationDays !== undefined ? `, ${formatNumber(step.durationDays, 0)} d` : ""}
              {step.notes ? ` – ${step.notes}` : ""}
            </li>
          ))}
        </ul>
      </ReportSection>

      <ReportSection title="Bryggedagsmålinger">
        {brewDayReadings.length === 0 ? (
          <p className="text-muted">Ingen målinger logget før gjæring.</p>
        ) : (
          <Table head={["Tid", "Steg", "Måling", "Verdi", "Merknad"]}>
            {brewDayReadings.map((t) => (
              <Row
                key={t.id}
                cells={[
                  dateTime(t.occurredAt),
                  t.stage ? brewStageLabels[t.stage] : "–",
                  [t.measurement!.label, t.measurement!.kind === "custom" ? null : measurementKindSpecs[t.measurement!.kind].label].filter(Boolean).join(" · "),
                  readingText(t, wcf),
                  [t.measurement!.instrument, t.measurement!.comment, t.splitId ? splitName(t.splitId) : null].filter(Boolean).join(" · "),
                ]}
              />
            ))}
          </Table>
        )}
      </ReportSection>

      <ReportSection title="Gjæring">
        {variants.some((v) => v.gravity.length + v.temperature.length > 0) ? (
          <FermentationChart variants={variants} until={batch.completedAt ?? Date.now()} printable />
        ) : (
          <p className="text-muted">Ingen målinger under gjæring ennå.</p>
        )}
      </ReportSection>

      <ReportSection title="Resultater og smaksnotater">
        {outcomes.length === 0 ? (
          <p className="text-muted">Ingen resultat registrert ennå.</p>
        ) : (
          <div className="space-y-3">
            {outcomes.map((o) => (
              <div key={o.id} className="break-inside-avoid">
                <h3 className="font-semibold">
                  {o.name}
                  {o.rating !== null ? ` · karakter ${o.rating}/5` : ""}
                </h3>
                <p className="text-small">
                  {[
                    `OG ${formatSg(o.og)}`,
                    `FG ${formatSg(o.fg)}`,
                    o.abvPct === null ? null : `ABV ${formatNumber(o.abvPct, 1)} %`,
                    o.attenuationPct === null ? null : `forgjæring ${formatNumber(o.attenuationPct, 0)} %`,
                    o.packaging ? packagingLabels[o.packaging] : null,
                    o.packagedVolumeL === null ? null : `${formatNumber(o.packagedVolumeL, 1)} L`,
                    o.packagedOn ? `pakket ${formatDate(o.packagedOn)}` : null,
                    o.carbonationVols === null ? null : `${formatNumber(o.carbonationVols, 1)} vol CO₂`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                {o.tastingNotes && <p className="whitespace-pre-line">{o.tastingNotes}</p>}
                {o.nextTime && <p className="whitespace-pre-line">Neste gang: {o.nextTime}</p>}
              </div>
            ))}
          </div>
        )}
      </ReportSection>

      {notes.length > 0 && (
        <ReportSection title="Kommentarer og hendelser">
          <ul className="space-y-1.5">
            {notes.map((t) => (
              <li key={t.id} className="break-inside-avoid">
                <span className="text-muted tabular">{dateTime(t.occurredAt)}</span>{" "}
                {t.comment ? t.comment.body : String(t.data?.title ?? eventTypeLabels[t.type] ?? t.type)}
                {typeof t.data?.note === "string" ? ` – ${t.data.note}` : ""}
                <span className="text-muted">
                  {" "}
                  · {t.createdBy.name}
                  {t.splitId ? ` · ${splitName(t.splitId)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      <ReportSection title="Notater og usikkerheter">
        <ul className="list-disc space-y-1 pl-5">
          {uncertainties.map((note) => (
            <li key={note}>{note}</li>
          ))}
          {recipe.notes && <li className="whitespace-pre-line">{recipe.notes}</li>}
        </ul>
      </ReportSection>

      <footer className="border-t border-border pt-3 text-caption text-muted">
        Laget {formatDate(Date.now())} fra bryggeloggen i Slump. Oppskrift v{batch.recipeVersion.version}
        {batch.equipmentSnapshot.profileVersion !== null ? `, kalibrering v${batch.equipmentSnapshot.profileVersion}` : ""}.
      </footer>
    </article>
  );
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-section font-bold print:break-after-avoid">{title}</h2>
      {children}
    </section>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border bg-surface-2 px-3 py-2 text-center">
      <dt className="text-caption font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className="text-section font-bold">{value}</dd>
      {hint && <dd className="text-caption text-muted">{hint}</dd>}
    </div>
  );
}

/** Rows never split across pages; the numeric columns never wrap. */
function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-left text-small print:min-w-0">
        <thead>
          <tr className="border-b-2 border-border">
            {head.map((cell, i) => (
              <th key={i} className="py-1.5 pr-3 font-semibold">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

function Row({ cells, strong = false }: { cells: ReactNode[]; strong?: boolean }) {
  return (
    <tr className={strong ? "font-semibold break-inside-avoid" : "break-inside-avoid"}>
      {cells.map((cell, i) => (
        <td key={i} className={i === 0 && typeof cell === "string" && /^\d{2}\.\d{2} /.test(cell) ? "py-1.5 pr-3 align-top whitespace-nowrap tabular" : "py-1.5 pr-3 align-top"}>
          {cell}
        </td>
      ))}
    </tr>
  );
}

function hopTiming(hop: HopAddition): string {
  switch (hop.use) {
    case "boil":
      return `${hop.timeMin ?? 0} min kok`;
    case "whirlpool":
      return `Whirlpool${hop.temperatureC !== undefined ? ` ${formatNumber(hop.temperatureC, 0)} °C` : ""}${hop.timeMin !== undefined ? `, ${hop.timeMin} min` : ""}`;
    case "dry_hop":
      return `Tørrhumle${hop.dayOfFermentation !== undefined ? ` dag ${hop.dayOfFermentation}` : ""}${hop.variant ? ` · ${hop.variant}` : ""}`;
    default:
      return hopUseLabels[hop.use];
  }
}

function hopName(hop: HopAddition): string {
  const details = [hop.cropYear ? String(hop.cropYear) : null, hop.alphaPct !== undefined ? `${formatNumber(hop.alphaPct, 1)} % AA` : null].filter(Boolean);
  return details.length > 0 ? `${hop.name} (${details.join(" / ")})` : hop.name;
}

function yeastText(pitched: TimelineItem[], splitId: string | null): string {
  const yeast = pitched.filter((t) => (t.splitId ?? null) === splitId);
  return yeast.length === 0 ? "ikke registrert" : yeast.map((t) => `${amountOf(t)} ${String(t.data?.name ?? "")} (${dateTime(t.occurredAt)})`).join(", ");
}

function amountOf(item: TimelineItem): string {
  const { amount, unit } = item.data ?? {};
  return typeof amount === "number" && typeof unit === "string" ? nb(formatAmount(amount, unit)) : "–";
}

/** Keeps "84,6 g" and "20,0 US gal" on one line. */
function nb(text: string): string {
  return text.replace(/ /g, "\u00a0");
}

/** What was logged as added for a planned ingredient; «ikke registrert» when nothing was. */
function actualAmount(timeline: TimelineItem[], ingredientId: string): string {
  const added = timeline.filter((t) => (t.type === "ingredient_added" || t.type === "yeast_pitched") && t.data?.ingredientId === ingredientId);
  return added.length === 0 ? "ikke registrert" : added.map(amountOf).join(" + ");
}

function isPlanned(batch: BatchDetail, ingredientId: unknown): boolean {
  if (typeof ingredientId !== "string") return false;
  const recipe = batch.recipeSnapshot;
  return [...recipe.hops, ...recipe.miscs, ...recipe.fermentables].some((item) => item.id === ingredientId);
}

function readingText(item: TimelineItem, wcf: number): string {
  const m = item.measurement!;
  if (m.valueMin !== null && m.valueMax !== null) return `${formatMeasurementRange(m.kind, m.valueMin, m.valueMax, m.enteredUnit)} ${m.enteredUnit}`;
  const entered = nb(`${formatMeasurementInUnit(m.kind, m.enteredValue, m.enteredUnit)} ${m.enteredUnit}`);
  const canonical = m.enteredUnit !== m.unit ? ` ${nb(`(${formatMeasurement(m.kind, m.value)} ${m.unit})`)}` : "";
  const brix = m.kind === "brix" ? ` ${nb(`≈ SG ${formatSg(brixToSg(m.value, wcf))}`)}` : "";
  return `${entered}${canonical}${brix}`;
}
