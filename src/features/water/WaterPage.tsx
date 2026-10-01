import { Card, MetricCard, PageHeader, Section, StatusChip } from "../../design-system/index.ts";
import { ionInfo, ionKeys, waterSourceKindLabels, waterValueBasisLabels } from "../../domain/model/water.ts";
import { describeSourceWater, hardnessClassLabels, numericLimit } from "../../domain/water/describe.ts";
import { guidanceDisclaimer, guidanceSources, ionGuidance, mashPhGuidance } from "../../domain/water/guidance.ts";
import { slumpBaseWater } from "../../domain/water/slump-water.ts";
import { formatNumber } from "../../lib/format.ts";

function Basis({ basis }: { basis: keyof typeof waterValueBasisLabels }) {
  return (
    <StatusChip tone={basis === "reported" ? "info" : basis === "calculated" ? "accent" : "neutral"}>{waterValueBasisLabels[basis]}</StatusChip>
  );
}

/**
 * Slump's source water and the brewing-water guidance around it. Everything shown is read from
 * `src/domain/water/` (one canonical copy); the four kinds of value are labelled apart so a source
 * value is never mistaken for a calculation, a target or a measurement.
 */
export function WaterPage() {
  const profile = slumpBaseWater;
  const description = describeSourceWater(profile);
  const { derived } = description;
  const source = profile.source;
  const alkalinityCheck = description.checks.find((check) => check.key === "alkalinity");
  const hardnessCheck = description.checks.find((check) => check.key === "hardness");
  const consistent = description.checks.length > 0 && description.checks.every((check) => check.withinRounding);
  const ca = ionGuidance.find((entry) => entry.ion === "ca")!;
  // Quote the supplier's numbers with the decimals it published.
  const reported = (key: string) => {
    const row = description.reported.find((candidate) => candidate.key === key);
    return row ? formatNumber(row.value, row.decimals) : "–";
  };

  return (
    <div className="space-y-6">
      <PageHeader back="/mer" title="Vann" subtitle="Slumps basisvann, vannkjemi og pH" />

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Basis basis="reported" />
          {profile.confirmedUse && <StatusChip tone="success" icon="check">Bekreftet i bruk</StatusChip>}
          <StatusChip tone="success">{hardnessClassLabels[description.hardnessClass]}</StatusChip>
          {description.lowMineral && <StatusChip tone="neutral">Mineralfattig</StatusChip>}
        </div>
        <div>
          <h2 className="text-section font-semibold">{profile.name}</h2>
          {profile.description && <p className="mt-1 text-small text-muted">{profile.description}</p>}
        </div>
        {/* Shown with the decimals the source publishes: padding "6,6" to "6,60" would invent precision. */}
        <div className="grid grid-cols-3 gap-2">
          {description.reported.map((row) => {
            const ion = ionKeys.find((key) => key === row.key);
            return (
              <MetricCard
                key={row.key}
                label={ion ? ionInfo[ion].name : row.label}
                hint={ion ? ionInfo[ion].symbol : undefined}
                value={formatNumber(row.value, row.decimals)}
                unit={row.unit || null}
              />
            );
          })}
        </div>
        <div className="space-y-1 text-small">
          <p>
            <span className="font-semibold">{waterSourceKindLabels[source.kind]}:</span> {source.organization}.{" "}
            <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
              Åpne kilden
            </a>
          </p>
          {profile.confirmedUse && (
            <p>
              Bekreftet av {profile.confirmedUse.confirmedBy} {profile.confirmedUse.confirmedAt}
              {profile.confirmedUse.note ? `: ${profile.confirmedUse.note}` : "."}
            </p>
          )}
          <p className="text-muted">
            Hentet {source.retrievedAt}. {source.publishedAt ? `Publisert ${source.publishedAt}.` : "Kilden oppgir ingen prøvedato."}
            {source.lastModifiedAt ? ` Siden ble sist endret ${source.lastModifiedAt}.` : ""}
          </p>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-small text-muted">
          {profile.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </Card>

      {description.other.length > 0 && (
        <Section title="Øvrige oppgitte verdier">
          <Card className="space-y-3">
            <Basis basis="reported" />
            <details>
              <summary className="min-h-11 cursor-pointer py-2 text-small font-semibold">Vis alle {description.other.length} verdier fra ABV</summary>
              <dl className="divide-y divide-border text-small">
                {description.other.map((row) => (
                  <div key={row.key} className="flex items-baseline justify-between gap-3 py-2">
                    <dt>
                      {row.label}
                      {row.limit && <span className="block text-caption text-muted">Grenseverdi: {row.limit}{numericLimit(row.limit) !== null && row.unit ? ` ${row.unit}` : ""}</span>}
                    </dt>
                    <dd className="tabular shrink-0 font-semibold">
                      {formatNumber(row.value, row.decimals)}
                      {row.unit ? ` ${row.unit}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="text-small text-muted">
              Verdiene står slik ABV skriver dem. Grenseverdien er ABVs egen grense for drikkevann, ikke et bryggemål.
              {description.limits.checked > 0 && description.limits.allBelow && ` Alle ${description.limits.checked} verdier med tallfestet grenseverdi ligger under den.`}
            </p>
          </Card>
        </Section>
      )}

      <Section title="Beregnet fra kildevannet">
        <Card className="space-y-3">
          <Basis basis="calculated" />
          <dl className="space-y-2 text-small">
            {description.calculated.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-3">
                <dt>
                  {row.label}
                  {row.note && <span className="block text-caption text-muted">{row.note}</span>}
                </dt>
                <dd className="tabular shrink-0 font-semibold">
                  {formatNumber(row.value, row.decimals)} {row.unit}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-small text-muted">Sulfat:klorid {description.ratioText}.</p>
          {consistent && alkalinityCheck && hardnessCheck && (
            <p className="text-small text-muted">
              Stemmer med kildens egne tall innenfor avrunding: alkalitet {formatNumber(alkalinityCheck.calculated, 2)} mot oppgitt {formatNumber(alkalinityCheck.reported, 1)} mmol/L,
              hardhet {formatNumber(hardnessCheck.calculated, 2)} mot oppgitt {formatNumber(hardnessCheck.reported, 1)} °dH.
            </p>
          )}
        </Card>
      </Section>

      <Section title="Hva det betyr for brygging">
        <Card className="space-y-2 text-small">
          <p>
            Vannet er {hardnessClassLabels[description.hardnessClass].toLowerCase()}
            {description.lowMineral ? " og mineralfattig, et nøytralt utgangspunkt der du bygger vannprofilen selv" : ""}. Klorid og sulfat er så lave at de ikke
            påvirker smaken, så balansen mellom dem bestemmer du helt.
          </p>
          {ca.typical && description.belowGuidance.includes("ca") && (
            <p>
              Kalsium ({reported("ca")} mg/L) ligger under det vanlige vinduet på {ca.typical.min}–{ca.typical.max} mg/L. De fleste oppskrifter
              får nytte av kalsium fra gips (gir sulfat) eller kalsiumklorid (gir klorid), som også senker mesk-pH.
            </p>
          )}
          <p>
            Lite alkalitet (≈ {formatNumber(derived.alkalinityAsCaCO3MgL, 1)} mg/L som CaCO₃) betyr at vannet selv skyver mesk-pH lite opp. Hvor mye syre, om noe,
            som trengs avgjør kornblandingen. Vannets egen pH ({reported("ph")}) sier lite om mesk-pH. Mål mesk-pH på en avkjølt prøve.
          </p>
          <p className="text-muted">Mer om dette, og om hva som mangler: docs/water.md i prosjektet.</p>
        </Card>
      </Section>

      <Section title="Veiledning, ikke regler">
        <Card className="space-y-3">
          <Basis basis="target" />
          <p className="text-small text-muted">{guidanceDisclaimer}</p>
          <div className="rounded-md bg-surface-2 p-3 text-small">
            <p className="font-semibold">
              Mesk-pH {formatNumber(mashPhGuidance.window.min, 1)}–{formatNumber(mashPhGuidance.window.max, 1)} ved ca. {mashPhGuidance.referenceTemperatureC} °C
            </p>
            <p className="text-muted">
              Slumps standardmål når en oppskrift ikke har et eget: {formatNumber(mashPhGuidance.planningTarget.min, 1)}–{formatNumber(mashPhGuidance.planningTarget.max, 1)}.{" "}
              {mashPhGuidance.note}
            </p>
          </div>
          <ul className="divide-y divide-border text-small">
            {ionGuidance.map((entry) => (
              <li key={entry.ion} className="py-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{ionInfo[entry.ion].name}</span>
                  <span className="tabular shrink-0 text-muted">
                    {entry.typical ? `${entry.typical.min}–${entry.typical.max} mg/L` : "ingen fast vindu"}
                  </span>
                </div>
                <p>{entry.effect}</p>
                {entry.note && <p className="text-muted">{entry.note}</p>}
              </li>
            ))}
          </ul>
          <p className="text-small text-muted">
            Kilder:{" "}
            {Object.values(guidanceSources).map((guidanceSource, index) => (
              <span key={guidanceSource.url}>
                {index > 0 && " · "}
                <a href={guidanceSource.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                  {guidanceSource.title}
                </a>
              </span>
            ))}
          </p>
        </Card>
      </Section>

      <Section title="Slik loggfører vi vann og pH">
        <Card className="space-y-2 text-small">
          <p>
            <span className="font-semibold">pH:</span> logg fra bryggedagen (Logg → pH). Velg hvor i brygget prøven er tatt (mesk, før kok, etter kok, under gjæring, ferdig øl), skriv
            prøvetemperaturen og velg instrument. Målt pH er alltid «Målt i brygget», aldri en beregning.
          </p>
          <p>
            <span className="font-semibold">Salter og syre:</span> legg dem i oppskriften under «Andre tilsetninger» og merk dem som salt eller syre, eller logg dem på bryggedagen. Da
            vet loggen hva som faktisk ble tilsatt, og med hvilken styrke.
          </p>
          <p>
            <span className="font-semibold">Planlagt vann:</span> målprofilen legges inn under «Vann» i oppskriften. Hvert brygg fryser kildevannet det ble brygget med.
          </p>
        </Card>
      </Section>
    </div>
  );
}
