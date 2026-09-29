import { Link } from "react-router";
import { equipmentOverview, type EquipmentOverview, type EquipmentValueStatus } from "../../domain/brew-day/equipment-overview.ts";
import type { BatchDetail } from "../../domain/model/api.ts";
import { Button, Card, Icon, SectionLabel, StatusChip, type Tone } from "../../design-system/index.ts";
import { formatNumber } from "../../lib/format.ts";
import { RecipeMetrics } from "../recipes/RecipeView.tsx";

const statusChips: Record<EquipmentValueStatus, { tone: Tone; label: string }> = {
  calibrated: { tone: "success", label: "Kalibrert" },
  manual: { tone: "neutral", label: "Satt manuelt" },
  assumed: { tone: "warning", label: "Standard" },
  missing: { tone: "neutral", label: "Mangler" },
};

/**
 * Before the brew starts: the numbers to expect, the equipment profile that is locked into the batch
 * (and what to be careful about in it), and the one button that starts the mash. The whole plan is
 * right below, with every phase open.
 */
export function PreBrewOverview({ batch, onStart, starting }: { batch: BatchDetail; onStart: () => void; starting: boolean }) {
  const recipe = batch.recipeSnapshot;
  const equipment = equipmentOverview({
    values: batch.equipmentSnapshot.values,
    sources: batch.equipmentSnapshot.sources,
    recipeBatchSizeL: recipe.batchSizeL,
  });
  return (
    <>
      <Card className="space-y-4">
        <div>
          <SectionLabel>Klar til å brygge</SectionLabel>
          <p className="mt-1 text-muted">Oppskrift og utstyr er låst for denne batchen. Se gjennom planen under før du starter.</p>
        </div>
        <RecipeMetrics recipe={recipe} />
        <Button variant="primary" size="lg" block icon="play" onClick={onStart} loading={starting}>
          Start brygg
        </Button>
      </Card>
      <EquipmentCard profileVersion={batch.equipmentSnapshot.profileVersion} overview={equipment} />
    </>
  );
}

function EquipmentCard({ profileVersion, overview }: { profileVersion: number | null; overview: EquipmentOverview }) {
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Utstyr</SectionLabel>
        <StatusChip>{profileVersion === null ? "Ingen profil" : `Profil v${profileVersion}`}</StatusChip>
      </div>
      <dl className="divide-y divide-border">
        {overview.rows.map((row) => {
          const chip = statusChips[row.status];
          return (
            <div key={row.key} className="flex items-center gap-3 py-2">
              <dt className="min-w-0 flex-1 text-small">{row.label}</dt>
              <dd className="tabular font-semibold">
                {row.value === null ? "–" : `${formatNumber(row.value, Number.isInteger(row.value) ? 0 : 1)}${row.unit ? ` ${row.unit}` : ""}`}
              </dd>
              <dd className="w-28 text-right">
                <StatusChip tone={chip.tone}>{chip.label}</StatusChip>
              </dd>
            </div>
          );
        })}
      </dl>
      {overview.warnings.map((warning) => (
        <p key={warning} className="flex gap-2 rounded-md bg-surface-2 p-3 text-small">
          <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-warning" />
          <span>{warning}</span>
        </p>
      ))}
      <p className="text-small text-muted">
        Profilen kan ikke endres for denne batchen. Endringer under{" "}
        <Link to="/mer/kalibrering" className="font-semibold text-primary-strong underline underline-offset-4">
          Kalibrering
        </Link>{" "}
        gjelder neste batch.
      </p>
    </Card>
  );
}
