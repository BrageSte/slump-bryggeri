import type { BatchSummary } from "../../domain/model/api.ts";
import { brewStageLabels } from "../../domain/model/brewing.ts";
import { ListCard, ListLink, StatusChip } from "../../design-system/index.ts";
import { formatDate, formatNumber } from "../../lib/format.ts";
import { statusLabel, statusTones } from "./helpers.ts";

/** "6,4 % · 4/5" for the history: the actual ABV (a range for split batches) and the average rating. */
function resultLabel(result: BatchSummary["result"]): string | null {
  if (!result) return null;
  const [low, high] = result.abvPct ?? [null, null];
  const abv = low === null || high === null ? null : Math.abs(high - low) < 0.05 ? `${formatNumber(low, 1)} %` : `${formatNumber(low, 1)}–${formatNumber(high, 1)} %`;
  const rating = result.rating === null ? null : `${formatNumber(result.rating, Number.isInteger(result.rating) ? 0 : 1)}/5`;
  return [abv, rating].filter(Boolean).join(" · ") || null;
}

export function BatchList({ batches }: { batches: BatchSummary[] }) {
  return (
    <ListCard>
      {batches.map((batch) => (
        <ListLink
          key={batch.id}
          to={`/batcher/${batch.id}`}
          title={
            <>
              <span className="text-muted tabular">#{batch.number}</span> {batch.name}
            </>
          }
          subtitle={[
            batch.currentStage && batch.status !== "completed" ? brewStageLabels[batch.currentStage] : null,
            resultLabel(batch.result),
            batch.brewDate ? formatDate(batch.brewDate) : null,
          ]
            .filter(Boolean)
            .join(" · ") || batch.recipe.name}
          trailing={<StatusChip tone={statusTones[batch.status]}>{statusLabel(batch.status)}</StatusChip>}
        />
      ))}
    </ListCard>
  );
}
