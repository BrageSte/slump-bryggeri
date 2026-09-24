import type { BatchSummary } from "../../domain/model/api.ts";
import { brewStageLabels } from "../../domain/model/brewing.ts";
import { ListCard, ListLink, StatusChip } from "../../design-system/index.ts";
import { formatDate } from "../../lib/format.ts";
import { statusLabel, statusTones } from "./helpers.ts";

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
