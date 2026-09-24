import { Link } from "react-router";
import { calculateRecipeMetrics, expectedGravities } from "../../domain/brewing-calculations/index.ts";
import { resultNumbers } from "../../domain/brew-day/outcome.ts";
import { packagingLabels, type BatchDetail } from "../../domain/model/api.ts";
import { buttonClasses, Card, MetricCard, Section } from "../../design-system/index.ts";
import { formatDate, formatNumber, formatSg } from "../../lib/format.ts";

/** Plan against actual for each recorded result (B6). Nothing here is filled from recipe targets. */
export function ResultSummary({ batch, editable = true }: { batch: BatchDetail; editable?: boolean }) {
  if (batch.outcomes.length === 0) return null;
  const plan = expectedGravities(batch.recipeSnapshot);
  const planAbv = batch.recipeSnapshot.targets.abvPct ?? calculateRecipeMetrics(batch.recipeSnapshot).abvPct;

  return (
    <Section
      title="Resultat"
      action={
        editable ? (
          <Link to={`/batcher/${batch.id}/resultat`} className={buttonClasses("ghost", "sm")}>
            Endre
          </Link>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {batch.outcomes.map((outcome) => {
          const name = batch.splits.find((s) => s.id === outcome.splitId)?.name ?? "Hele batchen";
          const { abvPct, attenuationPct } = resultNumbers(outcome.og, outcome.fg);
          const packaged = [
            outcome.packaging ? packagingLabels[outcome.packaging] : null,
            outcome.packagedVolumeL === null ? null : `${formatNumber(outcome.packagedVolumeL, 1)} L`,
            outcome.packagedOn ? `pakket ${formatDate(outcome.packagedOn)}` : null,
            outcome.carbonationVols === null ? null : `${formatNumber(outcome.carbonationVols, 1)} vol CO₂`,
          ].filter(Boolean);
          return (
            <Card key={outcome.id} as="article" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <h3 className="font-semibold">{name}</h3>
                {outcome.rating !== null && <p className="text-small font-semibold">Karakter {outcome.rating}/5</p>}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <MetricCard label="OG" value={formatSg(outcome.og)} hint={`plan ${formatSg(plan.og)}`} />
                <MetricCard label="FG" value={formatSg(outcome.fg)} hint={`plan ${formatSg(plan.fg)}`} />
                <MetricCard
                  label="ABV"
                  value={abvPct === null ? "–" : formatNumber(abvPct, 1)}
                  unit={abvPct === null ? null : "%"}
                  hint={[planAbv === null ? null : `plan ${formatNumber(planAbv, 1)} %`, attenuationPct === null ? null : `forgj. ${formatNumber(attenuationPct, 0)} %`]
                    .filter(Boolean)
                    .join(" · ")}
                />
              </div>
              {packaged.length > 0 && <p className="text-small text-muted">{packaged.join(" · ")}</p>}
              {outcome.tastingNotes && <p className="text-small whitespace-pre-line">{outcome.tastingNotes}</p>}
              {outcome.nextTime && (
                <p className="text-small whitespace-pre-line">
                  <span className="font-semibold">Neste gang: </span>
                  {outcome.nextTime}
                </p>
              )}
            </Card>
          );
        })}
      </div>
    </Section>
  );
}
