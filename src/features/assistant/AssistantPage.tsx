import { useSearchParams } from "react-router";
import { buildBrewDocument } from "../../domain/brew-document/brew-document.ts";
import type { AssistantStatus, BatchSummary } from "../../domain/model/api.ts";
import { brewStageLabels } from "../../domain/model/brewing.ts";
import { Button, Card, EmptyState, ErrorState, Icon, ListCard, ListLink, LoadingState, PageHeader, Section, StatusChip, useToast } from "../../design-system/index.ts";
import { useBatch, useBatches, useTimeline } from "../batches/api.ts";
import { statusLabel, statusTones } from "../batches/helpers.ts";
import { AssistantThread } from "./AssistantThread.tsx";
import { BreweryThread } from "./BreweryThread.tsx";
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

/** Brewing first, then fermenting/conditioning, then planned, then completed history last. */
function activeFirst(batches: BatchSummary[]): BatchSummary[] {
  const order = (batch: BatchSummary) => (batch.status === "brewing" ? 0 : batch.status === "fermenting" || batch.status === "conditioning" ? 1 : batch.status === "planned" ? 2 : 3);
  return [...batches].sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt);
}

export function AssistantPage() {
  const batches = useBatches();
  const status = useAssistantStatus();
  const [params] = useSearchParams();

  if (batches.isPending || status.isPending) {
    return <><PageHeader title="Bryggeassistent" /><LoadingState /></>;
  }
  if (batches.error || status.error) {
    return <><PageHeader title="Bryggeassistent" /><ErrorState error={batches.error ?? status.error} onRetry={() => void (batches.refetch(), status.refetch())} /></>;
  }

  if (params.get("tema") === "bryggeri") return <BreweryConversation configured={status.data.configured} />;

  const choices = activeFirst(batches.data);
  const batchId = params.get("batch");
  const selected = batchId ? choices.find((batch) => batch.id === batchId) ?? null : null;

  if (selected) return <AssistantConversation batch={selected} configured={status.data.configured} />;

  return (
    <div className="space-y-4">
      <PageHeader title="Bryggeassistent" subtitle="Velg en samtale. Samtalene deles med hele bryggeriet." />
      {!status.data.configured && <SetupCard />}
      <ListCard>
        <ListLink
          to="/assistent?tema=bryggeri"
          icon={<Icon name="book" className="shrink-0 text-primary-strong" />}
          title="Oppskrifter og bryggeriet"
          subtitle="Lag eller endre en oppskrift, spør om utstyr og historikk"
        />
      </ListCard>
      <Section title="Et brygg">
        {choices.length === 0 ? (
          <EmptyState icon="kettle" title="Ingen batcher ennå">Spørsmål om et konkret brygg krever en batch. Opprett en først.</EmptyState>
        ) : (
          <ListCard>
            {choices.map((batch) => (
              <ListLink
                key={batch.id}
                to={`/assistent?batch=${batch.id}`}
                title={<><span className="text-muted tabular">#{batch.number}</span> {batch.name}</>}
                subtitle={batch.currentStage && batch.status !== "completed" ? brewStageLabels[batch.currentStage] : batch.recipe.name}
                trailing={<StatusChip tone={statusTones[batch.status]}>{statusLabel(batch.status)}</StatusChip>}
              />
            ))}
          </ListCard>
        )}
      </Section>
      <UsageLine status={status.data} />
    </div>
  );
}

function BreweryConversation({ configured }: { configured: boolean }) {
  return (
    <div className="space-y-3">
      <PageHeader back="/assistent" title="Oppskrifter og bryggeriet" subtitle="Delt samtale for hele bryggeriet" />
      <BreweryThread configured={configured} />
    </div>
  );
}

function AssistantConversation({ batch: summary, configured }: { batch: BatchSummary; configured: boolean }) {
  const batch = useBatch(summary.id);
  const timeline = useTimeline(summary.id, false);
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

  return (
    <div className="space-y-3">
      <PageHeader back="/assistent" title={`#${summary.number} ${summary.name}`} subtitle="Delt samtale for hele bryggeriet" />
      {batch.isPending || timeline.isPending ? (
        <LoadingState />
      ) : batch.error || timeline.error ? (
        <ErrorState error={batch.error ?? timeline.error} onRetry={() => void (batch.refetch(), timeline.refetch())} />
      ) : (
        <>
          <Button size="sm" variant="ghost" icon="clipboard" onClick={() => void copyDocument()}>
            Kopier bryggedokument
          </Button>
          <AssistantThread batchId={summary.id} batch={batch.data} configured={configured} />
        </>
      )}
    </div>
  );
}
