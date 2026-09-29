import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { buildBrewDocument } from "../../domain/brew-document/brew-document.ts";
import type { AssistantStatus, BatchSummary } from "../../domain/model/api.ts";
import { Button, Card, EmptyState, ErrorState, Field, LoadingState, PageHeader, Select, useToast } from "../../design-system/index.ts";
import { useBatch, useBatches, useTimeline } from "../batches/api.ts";
import { AssistantThread } from "./AssistantThread.tsx";
import { useAssistantStatus } from "./api.ts";

function usd(value: number | null): string {
  if (value === null) return "ukjent pris";
  return `ca. ${value.toLocaleString("nb-NO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function SetupCard() {
  return (
    <Card className="space-y-3">
      <p className="font-semibold">Assistenten er ikke satt opp ennå</p>
      <p className="text-small text-muted">
        Den bruker Claude fra Anthropic, og dere betaler bare for spørsmålene som faktisk stilles. En administrator gjør dette én gang:
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-small">
        <li>Lag en konto på <strong>console.anthropic.com</strong>, kjøp kreditt under Billing og sett et månedlig forbrukstak.</li>
        <li>Lag en nøkkel under API keys.</li>
        <li>
          Legg den inn i produksjon:
          <code className="mt-1 block rounded-md bg-surface-2 px-2 py-1 font-mono text-caption">npx wrangler secret put ANTHROPIC_API_KEY --env production</code>
          Lokalt: sett <code className="font-mono">ANTHROPIC_API_KEY</code> i <code className="font-mono">.dev.vars</code> og start dev-serveren på nytt.
        </li>
      </ol>
    </Card>
  );
}

function UsageLine({ status }: { status: AssistantStatus }) {
  return (
    <p className="tabular text-caption text-muted">
      I dag {status.today.requests} av {status.dailyLimit} spørsmål · {status.today.webSearchRequests} nettsøk ({usd(status.today.estimatedUsd)}) · denne måneden {usd(status.month.estimatedUsd)} · {status.model}.
      Anslag fra listepris; fakturaen i Anthropic Console er fasit.
    </p>
  );
}

export function AssistantPage() {
  const batches = useBatches();
  const status = useAssistantStatus();
  const [params, setParams] = useSearchParams();
  const choices = useMemo(() => {
    const all = batches.data ?? [];
    const order = (batch: BatchSummary) => batch.status === "brewing" ? 0 : batch.status === "fermenting" || batch.status === "conditioning" ? 1 : batch.status === "planned" ? 2 : 3;
    return [...all].sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt);
  }, [batches.data]);
  const selectedBatchId = params.get("batch") ?? choices[0]?.id ?? null;

  if (batches.isPending || status.isPending) {
    return <><PageHeader title="Bryggeassistent" /><LoadingState /></>;
  }
  if (batches.error || status.error) {
    return <><PageHeader title="Bryggeassistent" /><ErrorState error={batches.error ?? status.error} onRetry={() => void (batches.refetch(), status.refetch())} /></>;
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Bryggeassistent" subtitle="Spør om et brygg. Samtalen deles med hele bryggeriet." />
      {!status.data.configured && <SetupCard />}
      {choices.length === 0 ? (
        <EmptyState icon="kettle" title="Ingen batcher ennå">Assistenten svarer om et konkret brygg. Opprett en batch først.</EmptyState>
      ) : (
        <>
          <Field label="Brygg">
            {(props) => (
              <Select {...props} value={selectedBatchId ?? ""} onChange={(event) => setParams({ batch: event.target.value }, { replace: true })}>
                {choices.map((batch) => <option key={batch.id} value={batch.id}>#{batch.number} {batch.name}</option>)}
              </Select>
            )}
          </Field>
          {selectedBatchId && <AssistantConversation key={selectedBatchId} batchId={selectedBatchId} configured={status.data.configured} />}
          <UsageLine status={status.data} />
        </>
      )}
    </div>
  );
}

function AssistantConversation({ batchId, configured }: { batchId: string; configured: boolean }) {
  const batch = useBatch(batchId);
  const timeline = useTimeline(batchId, false);
  const toast = useToast();

  async function copyDocument() {
    if (!batch.data || !timeline.data) return;
    try {
      await navigator.clipboard.writeText(buildBrewDocument({ batch: batch.data, timeline: timeline.data, now: Date.now() }));
      toast("Bryggedokumentet er kopiert");
    } catch {
      toast("Kunne ikke kopiere", "error");
    }
  }

  if (batch.isPending || timeline.isPending) return <LoadingState />;
  if (batch.error || timeline.error) return <ErrorState error={batch.error ?? timeline.error} onRetry={() => void (batch.refetch(), timeline.refetch())} />;

  return (
    <section className="space-y-3" aria-label="Samtale">
      <Button size="sm" variant="ghost" icon="clipboard" onClick={() => void copyDocument()} disabled={!batch.data || !timeline.data}>
        Kopier bryggedokument
      </Button>
      <AssistantThread batchId={batchId} batch={batch.data} configured={configured} />
    </section>
  );
}
