import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Wordmark } from "../../components/AppShell.tsx";
import { Button, Card, ErrorState, Field, InlineError, LoadingState, SectionLabel, TextInput } from "../../design-system/index.ts";
import { api } from "../../lib/api.ts";
import { meQueryKey, useMe } from "../auth/session.ts";
import { modeQueryKey, useMode } from "../auth/mode.ts";

/**
 * Brewery mode entry: the shared brewery code (once per device), then "who am I".
 * No accounts, no email — see worker/auth/brewery-mode.ts.
 */
export function BreweryModePage() {
  const mode = useMode();
  const me = useMe();

  if (mode.isPending || me.isPending) {
    return (
      <Shell>
        <LoadingState rows={2} />
      </Shell>
    );
  }
  if (mode.error) {
    return (
      <Shell>
        <ErrorState error={mode.error} onRetry={() => void mode.refetch()} />
      </Shell>
    );
  }
  if (me.data) return <Navigate to="/" replace />;
  if (!mode.data.breweryMode) return <Navigate to="/logg-inn" replace />;

  return <Shell>{mode.data.unlocked ? <ChoosePerson /> : <EnterCode />}</Shell>;
}

function Shell({ children }: { children: React.ReactNode }) {
  const mode = useMode();
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <Wordmark className="text-4xl text-primary-strong" />
        <p className="mt-2 text-muted">{mode.data?.breweryName ?? "Bryggeassistent"}</p>
      </div>
      {children}
    </div>
  );
}

function EnterCode() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/brewery-mode/unlock", { code });
      await queryClient.invalidateQueries({ queryKey: modeQueryKey });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="space-y-4">
        <h1 className="text-section font-semibold">Bryggerikode</h1>
        <Field label="Kode" hint="Du trenger den bare én gang på denne enheten. Spør de andre i bryggeriet.">
          {(p) => (
            <TextInput
              {...p}
              required
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        {error && <InlineError>{error}</InlineError>}
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Fortsett
        </Button>
      </form>
    </Card>
  );
}

function ChoosePerson() {
  const mode = useMode();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const people = mode.data?.people ?? [];

  async function choose(body: { userId: string } | { name: string }, key: string) {
    setBusy(key);
    setError(null);
    try {
      await api.post("/brewery-mode/person", body);
      await queryClient.invalidateQueries({ queryKey: meQueryKey });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Noe gikk galt.");
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      {people.length > 0 && (
        <section className="space-y-3">
          <h1 className="text-title font-bold">Hvem er du?</h1>
          <div className="grid gap-2">
            {people.map((person) => (
              <Button key={person.id} size="lg" block loading={busy === person.id} onClick={() => void choose({ userId: person.id }, person.id)}>
                {person.name}
              </Button>
            ))}
          </div>
        </section>
      )}

      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void choose({ name: name.trim() }, "new");
          }}
          className="space-y-4"
        >
          {people.length === 0 ? (
            <>
              <h1 className="text-title font-bold">Velkommen!</h1>
              <p className="text-muted">Du er den første. Hva heter du? Navnet vises i bryggeloggen.</p>
            </>
          ) : (
            <SectionLabel>Ny i bryggeriet?</SectionLabel>
          )}
          <Field label="Navn">
            {(p) => <TextInput {...p} required autoComplete="given-name" value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Button type="submit" variant={people.length === 0 ? "primary" : "secondary"} size="lg" block loading={busy === "new"} disabled={!name.trim()}>
            {people.length === 0 ? "Start" : "Legg meg til"}
          </Button>
        </form>
      </Card>
      {error && <InlineError>{error}</InlineError>}
    </div>
  );
}
