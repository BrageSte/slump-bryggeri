import { useState } from "react";
import { Button, Card, EmptyState, InlineError, PageHeader } from "../../design-system/index.ts";
import { api } from "../../lib/api.ts";
import { saveFile } from "../../lib/save-file.ts";
import { useBrewery } from "./BreweryContext.tsx";

export function ExportPage() {
  const { breweryId, breweryName, isAdmin } = useBrewery();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadBackup() {
    setDownloading(true);
    setError(null);
    try {
      const { blob, filename } = await api.download(`/breweries/${breweryId}/export`);
      saveFile(blob, filename);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Kunne ikke laste ned sikkerhetskopien.");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader back="/mer" title="Eksport" subtitle={breweryName} />
      {!isAdmin ? (
        <EmptyState title="Bare administratorer kan eksportere">
          Be en administrator laste ned bryggeriets sikkerhetskopi.
        </EmptyState>
      ) : (
        <Card className="space-y-4">
          <div className="space-y-2">
            <h2 className="font-semibold">Sikkerhetskopi av bryggeriet</h2>
            <p className="text-small text-muted">
              JSON-filen inneholder bryggeriet, medlemmer, utstyr, oppskrifter, batcher og bryggeloggen med relasjoner og
              tidsstempler. Den inneholder ikke bilde- eller PDF-bytes. Aktive vedlegg listes med nedlastingslenker som
              fungerer mens du er logget inn.
            </p>
            <p className="text-small text-muted">Gjenoppretting fra fil støttes ikke ennå.</p>
          </div>
          {error && <InlineError>{error}</InlineError>}
          <Button variant="primary" icon="file" loading={downloading} onClick={() => void downloadBackup()}>
            Last ned JSON
          </Button>
        </Card>
      )}
    </div>
  );
}
