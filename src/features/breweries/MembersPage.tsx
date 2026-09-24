import { useState, type FormEvent } from "react";
import type { Role } from "../../domain/model/api.ts";
import { Button, Card, ConfirmDialog, ErrorState, Field, InlineError, ListCard, LoadingState, PageHeader, Section, Select, StatusChip, TextInput, useToast } from "../../design-system/index.ts";
import { formatDate } from "../../lib/format.ts";
import { useMe } from "../auth/session.ts";
import { useBreweryDetail, useInvite, useRemoveMember, useRevokeInvite, useUpdateMemberRole } from "./api.ts";
import { useBrewery } from "./BreweryContext.tsx";

const roleLabel = (role: Role) => (role === "admin" ? "Administrator" : "Medlem");

export function MembersPage() {
  const detail = useBreweryDetail();
  const me = useMe();
  const { isAdmin, breweryName } = useBrewery();
  const toast = useToast();
  const invite = useInvite();
  const revoke = useRevokeInvite();
  const updateRole = useUpdateMemberRole();
  const remove = useRemoveMember();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  if (detail.isPending) return <LoadingState />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const myId = me.data?.user.id;

  function submitInvite(event: FormEvent) {
    event.preventDefault();
    invite.mutate(
      { email: email.trim().toLowerCase(), role },
      { onSuccess: () => (toast(`Invitasjon sendt til ${email.trim()}`), setEmail("")) },
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader back="/mer" title="Medlemmer" subtitle={breweryName} />

      <Section title={`${detail.data.members.length} ${detail.data.members.length === 1 ? "medlem" : "medlemmer"}`}>
        <ListCard>
          {detail.data.members.map((member) => (
            <div key={member.user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {member.user.name || member.user.email}
                  {member.user.id === myId && <span className="font-normal text-muted"> (deg)</span>}
                </p>
                <p className="truncate text-small text-muted">{member.user.email}</p>
              </div>
              {isAdmin && member.user.id !== myId ? (
                <div className="flex items-center gap-1">
                  <Select
                    aria-label={`Rolle for ${member.user.name}`}
                    value={member.role}
                    className="w-auto"
                    onChange={(e) =>
                      updateRole.mutate(
                        { userId: member.user.id, role: e.target.value as Role },
                        { onSuccess: () => toast("Rolle oppdatert"), onError: (err) => toast(err.message, "error") },
                      )
                    }
                  >
                    <option value="member">Medlem</option>
                    <option value="admin">Administrator</option>
                  </Select>
                  <Button variant="ghost" size="sm" className="text-danger" onClick={() => setRemoving({ id: member.user.id, name: member.user.name })}>
                    Fjern
                  </Button>
                </div>
              ) : (
                <StatusChip tone={member.role === "admin" ? "primary" : "neutral"}>{roleLabel(member.role)}</StatusChip>
              )}
            </div>
          ))}
        </ListCard>
      </Section>

      {isAdmin && (
        <>
          <Card>
            <form onSubmit={submitInvite} className="space-y-4">
              <h2 className="text-section font-semibold">Inviter en brygger</h2>
              <p className="text-small text-muted">Personen blir med når hen logger inn med denne e-postadressen.</p>
              <div className="grid gap-3 sm:grid-cols-[1fr_12rem]">
                <Field label="E-post">
                  {(p) => <TextInput {...p} type="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
                </Field>
                <Field label="Rolle">
                  {(p) => (
                    <Select {...p} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                      <option value="member">Medlem</option>
                      <option value="admin">Administrator</option>
                    </Select>
                  )}
                </Field>
              </div>
              {invite.error && <InlineError>{invite.error.message}</InlineError>}
              <Button type="submit" variant="primary" loading={invite.isPending}>
                Send invitasjon
              </Button>
            </form>
          </Card>

          {detail.data.invites && detail.data.invites.length > 0 && (
            <Section title="Ventende invitasjoner">
              <ListCard>
                {detail.data.invites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{inv.email}</p>
                      <p className="text-small text-muted">
                        {roleLabel(inv.role)} · utløper {formatDate(inv.expiresAt)}
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => revoke.mutate(inv.id, { onSuccess: () => toast("Invitasjonen er trukket tilbake") })}>
                      Trekk tilbake
                    </Button>
                  </div>
                ))}
              </ListCard>
            </Section>
          )}
        </>
      )}

      {!isAdmin && myId && (
        <Button variant="ghost" className="text-danger" onClick={() => setRemoving({ id: myId, name: "deg" })}>
          Forlat bryggeriet
        </Button>
      )}

      <ConfirmDialog
        open={removing !== null}
        title={removing?.id === myId ? "Forlate bryggeriet?" : `Fjerne ${removing?.name}?`}
        confirmLabel={removing?.id === myId ? "Forlat" : "Fjern"}
        danger
        loading={remove.isPending}
        onClose={() => setRemoving(null)}
        onConfirm={() =>
          removing &&
          remove.mutate(removing.id, {
            onSuccess: () => {
              setRemoving(null);
              toast("Medlemmet er fjernet");
              if (removing.id === myId) window.location.assign("/");
            },
            onError: (err) => toast(err.message, "error"),
          })
        }
      >
        Loggføringer og oppskrifter de har laget blir liggende.
      </ConfirmDialog>
    </div>
  );
}
