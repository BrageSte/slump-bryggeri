import type { ReactNode } from "react";
import {
  bsmxMeasuredFieldLabels,
  type BsmxEquipmentSnapshot,
  type BsmxSourceData,
  type BsmxWaterPlan,
} from "../../domain/import/bsmx.ts";
import { Card, Icon, SectionLabel } from "../../design-system/index.ts";
import { formatDate, formatNumber } from "../../lib/format.ts";

/**
 * What a BeerSmith file says besides the recipe: its equipment (what the brewer typed apart from
 * what BeerSmith calculated) and its water plan. Shown on the import review and on the recipe.
 * It is the file's equipment, never the brewery's profile.
 */

type Line = [label: string, value: number | undefined, unit: string, decimals: number];

const statedLines = (stated: BsmxEquipmentSnapshot["stated"]): Line[] => [
  ["Batchvolum", stated.batchVolumeL, "L", 1],
  ["Effektivitet", stated.efficiencyPct, "%", 0],
  ["Koketid", stated.boilTimeMin, "min", 0],
  ["Avkok", stated.boilOffLPerHour, "L/t", 1],
  ["Krymp ved nedkjøling", stated.coolingShrinkagePct, "%", 0],
  ["Tap i kjel", stated.trubLossL, "L", 1],
  ["Tap i gjæringstank", stated.fermenterLossL, "L", 1],
  ["Meskekar, volum", stated.mashTunVolumeL, "L", 0],
  ["Meskekar, vekt", stated.mashTunMassKg, "kg", 1],
  ["Meskekar, spesifikk varme", stated.mashTunSpecificHeat, "cal/g·°C", 2],
  ["Dødvolum i meskekar", stated.mashTunDeadspaceL, "L", 1],
  // Top-ups of zero are BeerSmith's default, not something the brewer chose.
  ["Påfyll i kjel", stated.topUpKettleL || undefined, "L", 1],
  ["Påfyll i gjæringstank", stated.topUpWaterL || undefined, "L", 1],
  ["Humleutnyttelse", stated.hopUtilizationPct, "%", 0],
];

const derivedLines = (derived: BsmxEquipmentSnapshot["derived"]): Line[] => [
  ["Volum før kok", derived.preBoilVolumeL, "L", 1],
  ["Volum til tapping", derived.bottlingVolumeL, "L", 1],
];

const waterLines = (water: BsmxWaterPlan): Line[] => [
  ["Meskevann", water.mashWaterL, "L", 1],
  ["Innmeskingstemperatur", water.strikeTemperatureC, "°C", 1],
  ["Korntemperatur", water.grainTemperatureC, "°C", 1],
  ["Skyllevann", water.spargeTemperatureC, "°C", 1],
];

function Lines({ lines }: { lines: Line[] }) {
  const shown = lines.filter(([, value]) => value !== undefined);
  if (shown.length === 0) return <p className="text-small text-muted">Ikke oppgitt i filen.</p>;
  return (
    <dl className="divide-y divide-border">
      {shown.map(([label, value, unit, decimals]) => (
        <div key={label} className="flex items-baseline justify-between gap-3 py-2 text-small">
          <dt className="text-muted">{label}</dt>
          <dd className="tabular text-right font-semibold whitespace-nowrap">
            {formatNumber(value, decimals)} {unit}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="text-small font-semibold">{title}</h4>
      {children}
    </div>
  );
}

/** "2015-10-07" → "7. oktober 2015"; anything else is shown as written. */
function sourceDateLabel(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : value;
}

export function BsmxEquipmentCard({ source }: { source: BsmxSourceData }) {
  const { equipment } = source;
  return (
    <Card className="space-y-4">
      <div>
        <SectionLabel>Utstyr i BeerSmith</SectionLabel>
        <h3 className="mt-1 font-semibold">{equipment?.name ?? "Ingen utstyrsprofil i filen"}</h3>
        <p className="text-small text-muted">
          Utstyret oppskriften ble laget for. Det endrer ikke bryggeriets utstyrsprofil; bruk «Tilpass» for å regne om til
          ditt utstyr.
        </p>
      </div>
      {equipment && (
        <>
          <Group title="Oppgitt i BeerSmith">
            <Lines lines={statedLines(equipment.stated)} />
          </Group>
          <Group title="Regnet ut av BeerSmith">
            <Lines lines={derivedLines(equipment.derived)} />
          </Group>
        </>
      )}
      <Group title="Vannplan">
        <Lines lines={waterLines(source.waterPlan)} />
      </Group>
      {source.sourceDate && <p className="text-caption text-muted">Dato i BeerSmith: {sourceDateLabel(source.sourceDate)}</p>}
    </Card>
  );
}

/** Warnings from the import and the measured values that were deliberately left out (B10). */
export function BsmxImportNotes({ source }: { source: Pick<BsmxSourceData, "warnings" | "ignoredMeasuredFields"> }) {
  const ignored = source.ignoredMeasuredFields.map((field) => bsmxMeasuredFieldLabels[field as keyof typeof bsmxMeasuredFieldLabels] ?? field);
  // The measured-values warning says the same as the list below; show it once.
  const warnings = source.warnings.filter((warning) => !(ignored.length > 0 && warning.includes("målte verdier")));
  if (warnings.length === 0 && ignored.length === 0) return null;
  return (
    <Card className="space-y-3">
      {warnings.length > 0 && (
        <div>
          <SectionLabel>Sjekk dette</SectionLabel>
          <ul className="mt-2 space-y-2">
            {warnings.map((warning) => (
              <li key={warning} className="flex gap-2 text-small">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
                <span>{warning}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {ignored.length > 0 && (
        <div>
          <SectionLabel>Ikke tatt med</SectionLabel>
          <p className="mt-1 text-small">
            Målinger fra et tidligere brygg i BeerSmith: {ignored.join(", ")}. Slump lager aldri batch, logg eller
            resultater fra en fil — de fylles bare når dere brygger.
          </p>
        </div>
      )}
    </Card>
  );
}
