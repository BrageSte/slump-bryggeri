import { useState, type FormEvent } from "react";
import { Button, Card, Field, InlineError, PageHeader, SegmentedControl, TextInput, useToast } from "../design-system/index.ts";
import { useMe } from "../features/auth/session.ts";
import { useUpdateMyName } from "../features/breweries/api.ts";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme.ts";

export function SettingsPage() {
  const me = useMe();
  const updateName = useUpdateMyName();
  const toast = useToast();
  const [name, setName] = useState(me.data?.user.name ?? "");
  const [theme, setTheme] = useState<ThemePreference>(getThemePreference());

  function submit(event: FormEvent) {
    event.preventDefault();
    updateName.mutate(name.trim(), { onSuccess: () => toast("Navnet er oppdatert") });
  }

  return (
    <div className="space-y-5">
      <PageHeader back="/mer" title="Innstillinger" />
      <Card>
        <form onSubmit={submit} className="space-y-4">
          <Field label="Navn" hint="Vises i bryggeloggen.">
            {(p) => <TextInput {...p} required value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          {updateName.error && <InlineError>{updateName.error.message}</InlineError>}
          <Button type="submit" variant="primary" loading={updateName.isPending}>
            Lagre
          </Button>
        </form>
      </Card>
      <Card className="space-y-3">
        <h2 className="font-semibold">Tema</h2>
        <SegmentedControl
          label="Tema"
          value={theme}
          onChange={(value) => {
            setTheme(value);
            setThemePreference(value);
          }}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Lyst" },
            { value: "dark", label: "Mørkt" },
          ]}
        />
        <p className="text-small text-muted">Mørkt tema er nyttig i mørke bryggerom.</p>
      </Card>
    </div>
  );
}
