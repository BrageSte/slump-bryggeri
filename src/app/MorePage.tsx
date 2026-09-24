import { Link } from "react-router";
import { Icon, ListCard, ListLink, PageHeader, Section, type IconName } from "../design-system/index.ts";
import { useLeavePerson, useMode } from "../features/auth/mode.ts";
import { useMe, useSignOut } from "../features/auth/session.ts";
import { useBrewery } from "../features/breweries/BreweryContext.tsx";

export function MorePage() {
  const me = useMe();
  const signOut = useSignOut();
  const leavePerson = useLeavePerson();
  const breweryMode = useMode().data?.breweryMode ?? false;
  const { breweryName, memberships, switchBrewery, breweryId, isAdmin } = useBrewery();
  const icon = (name: IconName) => <Icon name={name} className="shrink-0 text-primary-strong" />;

  return (
    <div className="space-y-6">
      <PageHeader title="Mer" subtitle={breweryMode ? `Du er ${me.data?.user.name ?? ""}` : me.data?.user.email} />

      <Section title={breweryName}>
        <ListCard>
          <ListLink to="/mer/utstyr" title="Utstyr" icon={icon("wrench")} />
          <ListLink to="/mer/kalibrering" title="Kalibrering" subtitle="Volumtap, effektivitet, temperaturer" icon={icon("sliders")} />
          <ListLink to="/mer/medlemmer" title="Medlemmer" icon={icon("users")} />
          {isAdmin && <ListLink to="/mer/eksport" title="Eksport" subtitle="Last ned sikkerhetskopi" icon={icon("file")} />}
          <ListLink to="/assistent" title="Bryggeassistent" subtitle="Kommer i fase 6" icon={icon("sparkles")} />
        </ListCard>
      </Section>

      {memberships.length > 1 && (
        <Section title="Bytt bryggeri">
          <ListCard>
            {memberships.map((m) => (
              <button
                key={m.brewery.id}
                type="button"
                onClick={() => switchBrewery(m.brewery.id)}
                aria-current={m.brewery.id === breweryId}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left font-semibold hover:bg-surface-2"
              >
                <span className="flex-1">{m.brewery.name}</span>
                {m.brewery.id === breweryId && <Icon name="check" className="text-success" />}
              </button>
            ))}
          </ListCard>
        </Section>
      )}

      <Section title="Konto">
        <ListCard>
          <ListLink to="/mer/innstillinger" title="Innstillinger" subtitle="Navn og tema" icon={icon("settings")} />
          {!breweryMode && <ListLink to="/velkommen" title="Opprett eller bli med i bryggeri" icon={icon("plus")} />}
          <button
            type="button"
            onClick={() => void (breweryMode ? leavePerson() : signOut())}
            className="flex min-h-14 w-full items-center gap-3 px-4 text-left font-semibold text-danger hover:bg-surface-2"
          >
            <Icon name={breweryMode ? "users" : "logout"} />
            {breweryMode ? "Bytt person" : "Logg ut"}
          </button>
        </ListCard>
      </Section>
      <p className="text-center text-caption text-muted">
        Slump v0.1 · <Link to="/brygg" className="underline">historikk</Link>
      </p>
    </div>
  );
}
