import { useState, type FormEvent } from "react";
import { useLocation, useNavigate } from "react-router";
import { compareBsmxEquipmentWithProfile, type ProfileSuggestion } from "../../domain/import/bsmx-equipment.ts";
import type { ProfileValues } from "../../domain/model/equipment-profile.ts";
import { profileGroupLabels, profileGroups, profileParameters } from "../../domain/model/equipment-profile.ts";
import { Button, Card, EmptyState, ErrorState, InlineError, inputClasses, LoadingState, PageHeader, parseDecimal, Section, StatusChip, TextInput, useToast } from "../../design-system/index.ts";
import { formatDate, formatNumber } from "../../lib/format.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useEquipmentProfile, useProfileVersions, useSaveProfileVersion } from "../equipment/api.ts";

const sourceLabels = { manual: "Manuell", calibration: "Kalibrert", default: "Standard" } as const;

/**
 * Brewery calibration (spec §10, §39). Lives under "Mer" — never in the way on brew day.
 * Saving always creates a new profile version; existing batches keep their snapshot.
 */
export function CalibrationPage() {
  const profile = useEquipmentProfile();
  const versions = useProfileVersions();
  const { isAdmin } = useBrewery();
  const location = useLocation();
  const navigate = useNavigate();
  // Set by the BeerSmith import; only an admin can turn it into a profile version.
  const suggestion = isAdmin ? (location.state as { profileSuggestion?: ProfileSuggestion } | null)?.profileSuggestion : undefined;
  const [editing, setEditing] = useState(Boolean(suggestion));
  const finishEditing = () => {
    setEditing(false);
    if (suggestion) void navigate(location.pathname, { replace: true, state: null });
  };

  if (profile.isPending) return <LoadingState />;
  if (profile.error) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  if (!profile.data) return <EmptyState title="Ingen profil">Bryggeriet mangler en utstyrsprofil.</EmptyState>;

  const values = profile.data.values;

  return (
    <div className="space-y-6">
      <PageHeader
        back="/mer"
        title="Kalibrering"
        subtitle={`${profile.data.name} · endret ${formatDate(profile.data.createdAt)} av ${profile.data.createdBy.name}`}
        actions={
          isAdmin && !editing ? (
            <Button icon="edit" onClick={() => setEditing(true)}>
              Rediger
            </Button>
          ) : undefined
        }
      />

      {editing ? (
        <ProfileForm initial={values} suggestion={suggestion} onDone={finishEditing} />
      ) : (
        profileGroups.map((group) => (
          <Section key={group} title={profileGroupLabels[group]}>
            <dl className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
              {profileParameters
                .filter((p) => p.group === group)
                .map((p) => {
                  const entry = values[p.key];
                  return (
                    <div key={p.key} className="flex items-center gap-3 px-4 py-3">
                      <dt className="min-w-0 flex-1">
                        <span className="block">{p.label}</span>
                        {"description" in p && p.description ? <span className="block text-small text-muted">{p.description}</span> : "defaultExplanation" in p ? <span className="block text-small text-muted">{p.defaultExplanation}</span> : null}
                      </dt>
                      <dd className="tabular flex shrink-0 items-center gap-2 text-right">
                        {entry ? (
                          <>
                            <span className="font-bold">
                              {formatNumber(entry.value, p.unit === "" ? 2 : Number.isInteger(entry.value) ? 0 : 1)} {p.unit}
                            </span>
                            {entry.source !== "manual" && <StatusChip>{sourceLabels[entry.source]}</StatusChip>}
                          </>
                        ) : (
                          <span className="text-muted">Ikke satt</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
            </dl>
          </Section>
        ))
      )}

      {!editing && versions.data && versions.data.length > 1 && (
        <Section title="Historikk">
          <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {versions.data.map((v) => (
              <li key={v.id} className="flex items-baseline gap-3 px-4 py-3 text-small">
                <span className="tabular font-semibold">v{v.version}</span>
                <span className="flex-1">
                  {v.changeNote ?? "Endret"}
                  <span className="block text-muted">
                    {v.createdBy.name} · {formatDate(v.createdAt)}
                  </span>
                </span>
                {v.isActive && <StatusChip tone="primary">Aktiv</StatusChip>}
              </li>
            ))}
          </ol>
        </Section>
      )}
      {!isAdmin && <p className="text-small text-muted">Bare administratorer kan endre kalibreringen.</p>}
    </div>
  );
}

const plain = (value: number | undefined) => formatNumber(value, value !== undefined && Number.isInteger(value) ? 0 : 2);
const decimalText = (value: number | undefined) => (value === undefined ? "" : String(value).replace(".", ","));

function ProfileForm({
  initial,
  suggestion,
  onDone,
}: {
  initial: Record<string, { value: number }>;
  suggestion?: ProfileSuggestion;
  onDone: () => void;
}) {
  const save = useSaveProfileVersion();
  const toast = useToast();
  const suggested = (key: string) => (suggestion?.values as Record<string, number | undefined> | undefined)?.[key];
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(profileParameters.map((p) => [p.key, decimalText(suggested(p.key) ?? initial[p.key]?.value)])),
  );
  const [note, setNote] = useState(suggestion ? `Startpunkt fra BeerSmith: ${suggestion.sourceName}` : "");
  const changes = suggestion
    ? profileParameters.filter((p) => suggested(p.key) !== undefined && suggested(p.key) !== initial[p.key]?.value)
    : [];
  const activeValues = Object.fromEntries(Object.entries(initial).map(([key, entry]) => [key, entry.value])) as ProfileValues;
  const warning = suggestion ? compareBsmxEquipmentWithProfile(suggestion, activeValues, Date.now()) : null;
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const values: Record<string, number | null> = {};
    for (const p of profileParameters) {
      const parsed = parseDecimal(draft[p.key]);
      if (parsed !== undefined && Number.isNaN(parsed)) return setError(`${p.label}: ugyldig tall`);
      values[p.key] = parsed ?? null;
    }
    setError(null);
    save.mutate(
      { values, changeNote: note.trim() || undefined },
      { onSuccess: () => (toast("Ny profilversjon er aktiv"), onDone()) },
    );
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {suggestion && (
        <Card highlight className="space-y-2">
          <p className="font-semibold">Forslag fra BeerSmith: {suggestion.sourceName}</p>
          {warning && (
            <div role="status" className="rounded-md border border-warning bg-warning-soft p-3 text-small">
              <p className="font-semibold text-warning">Sjekk utstyret</p>
              <p className="mt-1">{warning}</p>
            </div>
          )}
          {changes.length === 0 ? (
            <p className="text-small text-muted">Profilen har allerede disse verdiene.</p>
          ) : (
            <ul className="tabular space-y-1 text-small">
              {changes.map((p) => (
                <li key={p.key}>
                  {p.label}: <span className="text-muted">{initial[p.key] ? plain(initial[p.key]?.value) : "ikke satt"}</span> →{" "}
                  <strong>
                    {plain(suggested(p.key))} {p.unit}
                  </strong>
                </li>
              ))}
            </ul>
          )}
          <p className="text-small text-muted">Verdiene er fylt inn under. Endre det som ikke stemmer med anlegget i dag, og lagre.</p>
        </Card>
      )}
      {profileGroups.map((group) => (
        <Section key={group} title={profileGroupLabels[group]}>
          <Card className="grid gap-3 sm:grid-cols-2">
            {profileParameters
              .filter((p) => p.group === group)
              .map((p) => (
                <label key={p.key} className="block space-y-1">
                  <span className="block text-small font-semibold">{p.label}</span>
                  {"defaultExplanation" in p && <span className="block text-caption text-muted">{p.defaultExplanation}</span>}
                  <span className="relative block">
                    <input
                      inputMode="decimal"
                      value={draft[p.key] ?? ""}
                      onChange={(e) => setDraft({ ...draft, [p.key]: e.target.value })}
                      className={`${inputClasses} tabular pr-14`}
                      placeholder={"defaultValue" in p ? String(p.defaultValue).replace(".", ",") : ""}
                    />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-small text-muted">{p.unit}</span>
                  </span>
                </label>
              ))}
          </Card>
        </Section>
      ))}
      <Card>
        <label className="block space-y-1">
          <span className="block text-small font-semibold">Hva endret du?</span>
          <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Målt fordampning på Sunset IPA" />
        </label>
      </Card>
      {(error || save.error) && <InlineError>{error ?? save.error?.message}</InlineError>}
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" onClick={onDone}>
          Avbryt
        </Button>
        <Button type="submit" variant="primary" size="lg" loading={save.isPending}>
          Lagre ny versjon
        </Button>
      </div>
      <p className="text-center text-small text-muted">Eksisterende batcher beholder profilen de ble opprettet med.</p>
    </form>
  );
}
