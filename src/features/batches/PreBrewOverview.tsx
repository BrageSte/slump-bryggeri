import type { ReactNode } from "react";
import { Link } from "react-router";
import { equipmentOverview, type EquipmentOverview, type EquipmentValueStatus } from "../../domain/brew-day/equipment-overview.ts";
import type { BatchDetail } from "../../domain/model/api.ts";
import { getWaterAgent, ionInfo, ionKeys, waterValueBasisLabels } from "../../domain/model/water.ts";
import { summarizeWaterOfBatch } from "../../domain/water/batch-water.ts";
import { describeSourceWater } from "../../domain/water/describe.ts";
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
      <WaterCard batch={batch} />
    </>
  );
}

/**
 * The batch's water at a glance, with the four kinds of value apart: what the supplier reports (frozen into
 * the batch), what the recipe aims for, and the salts and acids it plans. Nothing measured yet before the start.
 */
function WaterCard({ batch }: { batch: BatchDetail }) {
  const water = summarizeWaterOfBatch(batch, []);
  const { profile } = water.source;
  const description = describeSourceWater(profile);
  const lowMineral = description.lowMineral;
  // The supplier's own numbers keep the decimals it published; a plan is rounded to whole mg/L.
  const reportedIons = description.reported.filter((row) => (ionKeys as readonly string[]).includes(row.key));
  const sourceIons = reportedIons.map((row) => `${ionInfo[row.key as (typeof ionKeys)[number]].symbol} ${formatNumber(row.value, row.decimals)}`).join(" · ");
  const plannedIons = (values: Partial<Record<(typeof ionKeys)[number], number>>) =>
    ionKeys.flatMap((key) => (values[key] === undefined ? [] : [`${ionInfo[key].symbol} ${formatNumber(values[key], 0)}`])).join(" · ");
  const { plan } = water;
  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Vann</SectionLabel>
        <StatusChip tone={water.source.frozen ? "neutral" : "warning"}>{water.source.frozen ? "Kildevann frosset" : "Basisvann antatt"}</StatusChip>
      </div>
      <dl className="divide-y divide-border text-small">
        <div className="space-y-1 py-2">
          <dt className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Kildevann</span>
            <StatusChip tone="info">{waterValueBasisLabels.reported}</StatusChip>
          </dt>
          <dd>{profile.name}</dd>
          <dd className="tabular text-muted">{sourceIons} mg/L</dd>
        </div>
        <div className="space-y-1 py-2">
          <dt className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Plan</span>
            <StatusChip>{waterValueBasisLabels.target}</StatusChip>
          </dt>
          <dd>
            Mesk-pH {formatNumber(plan.mashPh.min, 1)}–{formatNumber(plan.mashPh.max, 1)}
            <span className="text-muted"> ({plan.mashPh.source === "recipe" ? "oppskrift" : "≈ antatt veiledning"})</span>
          </dd>
          {plan.target ? (
            <dd>
              {plan.profileName ? `${plan.profileName}: ` : "Vannprofil: "}
              <span className="tabular">{plannedIons(plan.target)} mg/L</span>
            </dd>
          ) : (
            <dd className="text-muted">Ingen planlagt vannprofil i oppskriften.</dd>
          )}
          {plan.additions.map((addition) => (
            <dd key={addition.ingredientId} className="tabular">
              {formatNumber(addition.amount, 1)} {addition.unit} {getWaterAgent(addition.agent)?.shortLabel ?? addition.name}
              {addition.acidStrengthPct !== null ? ` ${formatNumber(addition.acidStrengthPct, 0)} %` : ""}
            </dd>
          ))}
        </div>
      </dl>
      {lowMineral && <p className="text-small text-muted">Basisvannet er svært bløtt og mineralfattig, så kalsium må vanligvis tilsettes.</p>}
      <p className="text-small text-muted">
        pH måles på bryggedagen og vises som «{waterValueBasisLabels.measured}». Mer under{" "}
        <Link to="/mer/vann" className="font-semibold text-primary-strong underline underline-offset-4">
          Vann
        </Link>
        .
      </p>
    </Card>
  );
}

/** The locked equipment profile and what to be careful about in it; `footer` says what can be done about it. */
export function EquipmentCard({ profileVersion, overview, footer }: { profileVersion: number | null; overview: EquipmentOverview; footer?: ReactNode }) {
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
        {footer ?? (
          <>
            Profilen kan ikke endres for denne batchen. Endringer under <CalibrationLink /> gjelder neste batch.
          </>
        )}
      </p>
    </Card>
  );
}

export function CalibrationLink() {
  return (
    <Link to="/mer/kalibrering" className="font-semibold text-primary-strong underline underline-offset-4">
      Kalibrering
    </Link>
  );
}
