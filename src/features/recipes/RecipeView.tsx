import type { ReactNode } from "react";
import { calculateRecipeMetrics, expectedGravities } from "../../domain/brewing-calculations/index.ts";
import { fermentableTypeLabels, hopUseLabels, hopUses, type HopAddition, type RecipeDocument } from "../../domain/model/recipe.ts";
import { getWaterAgent, ionInfo, ionKeys, waterValueBasisLabels } from "../../domain/model/water.ts";
import { MetricCard, Section } from "../../design-system/index.ts";
import { formatAmount, formatNumber, formatSg } from "../../lib/format.ts";

/** Key numbers. Explicit recipe targets are shown when set; otherwise the calculated estimate. */
export function RecipeMetrics({ recipe }: { recipe: RecipeDocument }) {
  const metrics = calculateRecipeMetrics(recipe);
  const { og, fg } = expectedGravities(recipe);
  const est = (target: number | undefined) => (target === undefined ? "estimert" : "mål");
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
      <MetricCard label="Volum" value={formatNumber(recipe.batchSizeL, 0)} unit="L" />
      <MetricCard label="OG" value={formatSg(og)} hint={est(recipe.targets.og)} />
      <MetricCard label="FG" value={formatSg(fg)} hint={est(recipe.targets.fg)} />
      <MetricCard
        label="ABV"
        value={formatNumber(recipe.targets.abvPct ?? metrics.abvPct, 1)}
        unit="%"
        hint={est(recipe.targets.abvPct)}
      />
      <MetricCard
        label="IBU"
        value={formatNumber(recipe.targets.ibu ?? metrics.ibu, 0)}
        hint={metrics.hopsMissingAlpha.length > 0 && recipe.targets.ibu === undefined ? "mangler alfasyre" : est(recipe.targets.ibu)}
      />
      <MetricCard label="Farge" value={formatNumber(recipe.targets.colorEbc ?? metrics.colorEbc, 0)} unit="EBC" hint={est(recipe.targets.colorEbc)} />
    </div>
  );
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">{children}</ul>;
}

function Row({ primary, secondary, trailing }: { primary: ReactNode; secondary?: ReactNode; trailing?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{primary}</div>
        {secondary && <div className="text-small text-muted">{secondary}</div>}
      </div>
      {trailing && <div className="tabular shrink-0 text-right font-semibold">{trailing}</div>}
    </li>
  );
}

function hopTiming(hop: HopAddition): string {
  switch (hop.use) {
    case "boil":
      return `${hop.timeMin ?? 0} min`;
    case "whirlpool":
      return [hop.timeMin !== undefined ? `${hop.timeMin} min` : null, hop.temperatureC !== undefined ? `${hop.temperatureC} °C` : null]
        .filter(Boolean)
        .join(" @ ");
    case "dry_hop":
      return hop.dayOfFermentation !== undefined ? `dag ${hop.dayOfFermentation}` : "";
    default:
      return "";
  }
}

export function RecipeIngredients({ recipe }: { recipe: RecipeDocument }) {
  const metrics = calculateRecipeMetrics(recipe);
  return (
    <div className="space-y-6">
      {recipe.fermentables.length > 0 && (
        <Section title={`Malt · ${formatNumber(metrics.totalFermentablesKg, 2)} kg`}>
          <Rows>
            {recipe.fermentables.map((f, i) => (
              <Row
                key={f.id}
                primary={f.name}
                secondary={[
                  f.type !== "grain" ? fermentableTypeLabels[f.type] : null,
                  f.colorEbc !== undefined ? `${formatNumber(f.colorEbc, 0)} EBC` : null,
                  `${formatNumber(metrics.grainBillPct[i], 1)} %`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={formatAmount(f.amountKg, "kg")}
              />
            ))}
          </Rows>
        </Section>
      )}

      {hopUses.map((use) => {
        const hops = recipe.hops.filter((h) => h.use === use);
        if (hops.length === 0) return null;
        return (
          <Section key={use} title={`Humle · ${hopUseLabels[use]}`}>
            <Rows>
              {hops.map((h) => (
                <Row
                  key={h.id}
                  primary={h.name}
                  secondary={[
                    hopTiming(h),
                    h.alphaPct !== undefined ? `${formatNumber(h.alphaPct, 1)} % AA` : "alfasyre mangler",
                    h.variant,
                    h.cropYear,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  trailing={formatAmount(h.amountG, "g")}
                />
              ))}
            </Rows>
          </Section>
        );
      })}

      {recipe.cultures.length > 0 && (
        <Section title="Gjær">
          <Rows>
            {recipe.cultures.map((c) => (
              <Row
                key={c.id}
                primary={c.name}
                secondary={[c.producer, c.variant, c.attenuationPct !== undefined ? `${c.attenuationPct} % att.` : null, c.notes].filter(Boolean).join(" · ")}
                trailing={formatAmount(c.amount, c.unit === "pkg" ? "pk" : c.unit)}
              />
            ))}
          </Rows>
        </Section>
      )}

      {recipe.miscs.length > 0 && (
        <Section title="Andre tilsetninger">
          <Rows>
            {recipe.miscs.map((m) => (
              <Row
                key={m.id}
                primary={m.name}
                secondary={[
                  m.timeMin !== undefined ? `${m.timeMin} min` : m.use,
                  (() => {
                    const agent = getWaterAgent(m.waterAgent);
                    return agent ? `${agent.kind === "acid" ? "Syre" : "Salt"}: ${agent.shortLabel}${m.acidStrengthPct !== undefined ? ` ${formatNumber(m.acidStrengthPct, 0)} %` : ""}` : null;
                  })(),
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={formatAmount(m.amount, m.unit)}
              />
            ))}
          </Rows>
        </Section>
      )}

      {recipe.water && (recipe.water.profileName || recipe.water.notes || recipe.water.target) && (
        <Section title={`Vann · ${waterValueBasisLabels.target.toLowerCase()}`}>
          <Rows>
            <Row
              primary={recipe.water.profileName ?? "Planlagt vannprofil"}
              secondary={recipe.water.notes}
              trailing={
                recipe.water.target
                  ? ionKeys.flatMap((ion) => (recipe.water?.target?.[ion] === undefined ? [] : [`${ionInfo[ion].symbol} ${formatNumber(recipe.water.target[ion], 0)}`])).join(" · ") + " mg/L"
                  : "ingen ionmål"
              }
            />
          </Rows>
        </Section>
      )}

      {recipe.mashSteps.length > 0 && (
        <Section title="Mesk">
          <Rows>
            {recipe.mashSteps.map((s) => (
              <Row
                key={s.id}
                primary={s.name}
                secondary={[
                  s.infusionL !== undefined
                    ? `${formatNumber(s.infusionL, 1)} L vann${s.infusionTemperatureC !== undefined ? ` ved ${formatNumber(s.infusionTemperatureC, 1)} °C` : ""}`
                    : null,
                  s.notes,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={`${formatNumber(s.temperatureC, 1)} °C · ${s.durationMin} min`}
              />
            ))}
            {recipe.spargeTemperatureC !== undefined && <Row primary="Skyllevann" trailing={`${formatNumber(recipe.spargeTemperatureC, 1)} °C`} />}
          </Rows>
        </Section>
      )}

      {recipe.fermentationSteps.length > 0 && (
        <Section title="Gjæring">
          <Rows>
            {recipe.fermentationSteps.map((s) => (
              <Row
                key={s.id}
                primary={s.name}
                secondary={s.notes}
                trailing={[
                  s.temperatureC !== undefined
                    ? `${formatNumber(s.temperatureC, 0)}${s.temperatureMaxC !== undefined ? `–${formatNumber(s.temperatureMaxC, 0)}` : ""} °C`
                    : null,
                  s.durationDays !== undefined ? `${formatNumber(s.durationDays, 0)} d` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              />
            ))}
          </Rows>
        </Section>
      )}

      {recipe.notes && (
        <Section title="Notater">
          <p className="rounded-card border border-border bg-surface p-4 whitespace-pre-line">{recipe.notes}</p>
        </Section>
      )}
    </div>
  );
}
