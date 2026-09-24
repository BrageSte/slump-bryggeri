import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Wordmark } from "../../components/AppShell.tsx";
import { Button, Card, Field, InlineError, LoadingState, SectionLabel, TextInput, useToast } from "../../design-system/index.ts";
import { useMe } from "../auth/session.ts";
import { useCreateBrewery, useRespondToInvite, useUpdateMyName } from "./api.ts";
import { rememberBrewery } from "./BreweryContext.tsx";

/** First run: tell us your name, then join an invited brewery or create one. */
export function OnboardingPage() {
  const me = useMe();
  const navigate = useNavigate();
  const toast = useToast();
  const updateName = useUpdateMyName();
  const createBrewery = useCreateBrewery();
  const respond = useRespondToInvite();
  const [name, setName] = useState("");
  const [breweryName, setBreweryName] = useState("");

  if (me.isPending) return <div className="mx-auto max-w-md p-4"><LoadingState rows={2} /></div>;
  if (!me.data) return <Navigate to="/logg-inn" replace />;
  const { user, memberships, pendingInvites } = me.data;
  const needsName = !user.name.trim();

  async function saveName(event: FormEvent) {
    event.preventDefault();
    await updateName.mutateAsync(name.trim());
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const { id } = await createBrewery.mutateAsync(breweryName.trim());
    rememberBrewery(id);
    toast(`${breweryName.trim()} er opprettet`);
    navigate("/", { replace: true });
  }

  async function join(inviteId: string, breweryId: string) {
    await respond.mutateAsync({ inviteId, accept: true });
    rememberBrewery(breweryId);
    navigate("/", { replace: true });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6">
        <Wordmark className="text-2xl text-primary-strong" />
      </div>

      {needsName ? (
        <Card>
          <form onSubmit={saveName} className="space-y-4">
            <h1 className="text-title font-bold">Velkommen!</h1>
            <p className="text-muted">Hva heter du? Navnet vises i bryggeloggen når du registrerer noe.</p>
            <Field label="Navn">
              {(props) => <TextInput {...props} required autoFocus autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}
            </Field>
            {updateName.error && <InlineError>{updateName.error.message}</InlineError>}
            <Button type="submit" variant="primary" size="lg" block loading={updateName.isPending}>
              Fortsett
            </Button>
          </form>
        </Card>
      ) : (
        <div className="space-y-6">
          <h1 className="text-title font-bold">Hei, {user.name.split(" ")[0]}</h1>

          {pendingInvites.length > 0 && (
            <section className="space-y-3">
              <SectionLabel>Invitasjoner</SectionLabel>
              {pendingInvites.map((invite) => (
                <Card key={invite.id} className="space-y-3">
                  <div>
                    <p className="text-section font-semibold">{invite.brewery.name}</p>
                    <p className="text-small text-muted">
                      Invitert av {invite.invitedBy.name || "en administrator"} som {invite.role === "admin" ? "administrator" : "medlem"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Button onClick={() => respond.mutate({ inviteId: invite.id, accept: false })} disabled={respond.isPending}>
                      Avslå
                    </Button>
                    <Button variant="primary" onClick={() => void join(invite.id, invite.brewery.id)} loading={respond.isPending}>
                      Bli med
                    </Button>
                  </div>
                </Card>
              ))}
            </section>
          )}

          <Card>
            <form onSubmit={create} className="space-y-4">
              <h2 className="text-section font-semibold">{pendingInvites.length > 0 ? "…eller opprett et nytt bryggeri" : "Opprett bryggeriet ditt"}</h2>
              <p className="text-small text-muted">Du blir administrator og kan invitere de andre bryggerne etterpå.</p>
              <Field label="Navn på bryggeriet">
                {(props) => (
                  <TextInput {...props} required minLength={2} placeholder="Slump Bryggeri" value={breweryName} onChange={(e) => setBreweryName(e.target.value)} />
                )}
              </Field>
              {createBrewery.error && <InlineError>{createBrewery.error.message}</InlineError>}
              <Button type="submit" variant="primary" size="lg" block loading={createBrewery.isPending}>
                Opprett bryggeri
              </Button>
            </form>
          </Card>

          {memberships.length > 0 && (
            <Link to="/" className="block text-center font-semibold text-primary-strong underline underline-offset-4">
              Tilbake til appen
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
