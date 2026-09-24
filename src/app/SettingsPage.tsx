import { useState, type FormEvent } from "react";
import { Button, Card, Field, InlineError, PageHeader, Select, SegmentedControl, TextInput, useToast } from "../design-system/index.ts";
import { useMe } from "../features/auth/session.ts";
import { useUpdateBreweryUnitPreference, useUpdateMyName } from "../features/breweries/api.ts";
import { useBrewery } from "../features/breweries/BreweryContext.tsx";
import { getThemePreference, setThemePreference, type ThemePreference } from "../lib/theme.ts";

export function SettingsPage() {
  const me = useMe();
  const { isAdmin, unitPreference } = useBrewery();
  const updateName = useUpdateMyName();
  const updateUnits = useUpdateBreweryUnitPreference();
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
        <h2 className="font-semibold">Måleenheter</h2>
        {isAdmin ? (
          <Field label="Standard for bryggeriet" hint="Brukes som startvalg når noen logger en måling.">
            {(p) => (
              <Select
                {...p}
                value={unitPreference}
                disabled={updateUnits.isPending}
                onChange={(event) =>
                  updateUnits.mutate(event.target.value as typeof unitPreference, {
                    onSuccess: () => toast("Standardmåleenheter oppdatert"),
                  })
                }
              >
                <option value="metric">Metrisk</option>
                <option value="us_volume">US-enheter</option>
                <option value="mixed">Blandet (°C og US gal)</option>
              </Select>
            )}
          </Field>
        ) : (
          <p className="text-small text-muted">
            Standard: {unitPreference === "metric" ? "Metrisk" : unitPreference === "us_volume" ? "US-enheter" : "Blandet (°C og US gal)"}.
            Bare administratorer kan endre dette.
          </p>
        )}
        {updateUnits.error && <InlineError>{updateUnits.error.message}</InlineError>}
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
