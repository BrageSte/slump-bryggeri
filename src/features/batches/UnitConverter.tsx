import { useEffect, useState } from "react";
import { convertUnitValue } from "../../domain/brewing-calculations/index.ts";
import { Button, Card, ErrorState, Field, InlineError, LoadingState, PageHeader, Select, TextInput, parseDecimal } from "../../design-system/index.ts";
import { useEquipmentProfile } from "../equipment/api.ts";

const groups = {
  volume: { label: "Volum", units: ["US gal", "L"], from: "US gal", to: "L" },
  temperature: { label: "Temperatur", units: ["°F", "°C"], from: "°F", to: "°C" },
  weight: { label: "Vekt", units: ["oz", "lb", "g", "kg"], from: "oz", to: "g" },
  pressure: { label: "Trykk", units: ["psi", "bar"], from: "psi", to: "bar" },
  gravity: { label: "SG og Plato", units: ["SG", "°P"], from: "SG", to: "°P" },
  refractometer: { label: "Brix og SG", units: ["°Bx", "SG"], from: "°Bx", to: "SG" },
} as const;

type Group = keyof typeof groups;

function formatResult(value: number, unit: string): string {
  const digits = unit === "SG" ? 3 : unit === "bar" || unit === "psi" ? 2 : 1;
  return value.toLocaleString("nb-NO", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function UnitConverter({ initialWcf = 1, onBack }: { initialWcf?: number; onBack?: () => void }) {
  const [group, setGroup] = useState<Group>("volume");
  const [fromUnit, setFromUnit] = useState<string>(groups.volume.from);
  const [toUnit, setToUnit] = useState<string>(groups.volume.to);
  const [raw, setRaw] = useState("");
  const [wcfRaw, setWcfRaw] = useState(String(initialWcf));
  const [originalBrixRaw, setOriginalBrixRaw] = useState("");
  const [fermentationStarted, setFermentationStarted] = useState(false);

  useEffect(() => setWcfRaw(String(initialWcf)), [initialWcf]);

  const inputValue = parseDecimal(raw);
  const wcf = parseDecimal(wcfRaw);
  const originalBrix = parseDecimal(originalBrixRaw);
  const result = inputValue === undefined || Number.isNaN(inputValue) || wcf === undefined || Number.isNaN(wcf)
    ? null
    : convertUnitValue(inputValue, fromUnit, toUnit, {
        wcf,
        fermentationStarted,
        originalBrix: originalBrix === undefined || Number.isNaN(originalBrix) ? null : originalBrix,
      });

  function changeGroup(next: Group) {
    setGroup(next);
    setFromUnit(groups[next].from);
    setToUnit(groups[next].to);
    setRaw("");
  }

  return (
    <div className="space-y-4">
      {onBack && <Button variant="ghost" icon="chevronLeft" onClick={onBack}>Tilbake til logging</Button>}
      <Field label="Hva vil du regne om?">
        {(p) => (
          <Select {...p} value={group} onChange={(event) => changeGroup(event.target.value as Group)}>
            {(Object.keys(groups) as Group[]).map((key) => <option key={key} value={key}>{groups[key].label}</option>)}
          </Select>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Fra">
          {(p) => (
            <Select {...p} value={fromUnit} onChange={(event) => setFromUnit(event.target.value)}>
              {groups[group].units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Til">
          {(p) => (
            <Select {...p} value={toUnit} onChange={(event) => setToUnit(event.target.value)}>
              {groups[group].units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
            </Select>
          )}
        </Field>
      </div>

      <Field label={`Verdi (${fromUnit})`}>
        {(p) => <TextInput {...p} inputMode="decimal" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="Skriv inn en verdi" />}
      </Field>

      {group === "refractometer" && (
        <Card className="space-y-3">
          <Field label="Refraktometer WCF" hint="Hentes fra utstyrsprofilen. Endringen gjelder bare denne omregningen.">
            {(p) => <TextInput {...p} inputMode="decimal" value={wcfRaw} onChange={(event) => setWcfRaw(event.target.value)} />}
          </Field>
          <label className="flex min-h-11 items-center gap-3 text-small font-semibold">
            <input type="checkbox" checked={fermentationStarted} onChange={(event) => setFermentationStarted(event.target.checked)} />
            Gjæring har startet
          </label>
          {fermentationStarted && (
            <Field label="Opprinnelig Brix før gjæring">
              {(p) => <TextInput {...p} inputMode="decimal" value={originalBrixRaw} onChange={(event) => setOriginalBrixRaw(event.target.value)} />}
            </Field>
          )}
        </Card>
      )}

      <Card highlight className="space-y-1" aria-live="polite">
        <p className="text-caption font-semibold uppercase tracking-wide text-muted">Resultat</p>
        {result === null ? (
          <p className="text-small text-muted">
            {group === "refractometer" && fermentationStarted && (originalBrix === undefined || Number.isNaN(originalBrix))
              ? "Oppgi opprinnelig Brix for å beregne SG etter gjæring."
              : "Skriv inn en verdi for å se omregningen."}
          </p>
        ) : (
          <p className="tabular text-title font-bold">{formatResult(result, toUnit)} {toUnit}</p>
        )}
        {group === "refractometer" && result !== null && (
          <p className="text-small text-muted">
            {fermentationStarted
              ? `FG-estimat med Terrill 2011. WCF ${wcf}; usikkerheten avhenger av refraktometerets nøyaktighet.`
              : `Omregnet med WCF ${wcf}. Etter gjærstart kreves opprinnelig Brix.`}
          </p>
        )}
      </Card>
      {group === "refractometer" && (wcf === undefined || Number.isNaN(wcf) || wcf <= 0) && <InlineError>Skriv inn en WCF større enn 0.</InlineError>}
      {raw.trim() !== "" && (inputValue === undefined || Number.isNaN(inputValue)) && <InlineError>Skriv inn et gyldig tall.</InlineError>}
    </div>
  );
}

export function UnitConverterPage() {
  const profile = useEquipmentProfile();
  if (profile.isPending) return <div className="space-y-5"><PageHeader back="/mer" title="Omregner" /><LoadingState /></div>;
  if (profile.error) {
    return (
      <div className="space-y-5">
        <PageHeader back="/mer" title="Omregner" />
        <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader back="/mer" title="Omregner" subtitle="Raske bryggeenheter" />
      <UnitConverter initialWcf={profile.data?.values.refractometer_wcf?.value ?? 1} />
    </div>
  );
}
