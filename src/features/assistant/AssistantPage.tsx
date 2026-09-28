import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { buildBrewDocument } from "../../domain/brew-document/brew-document.ts";
import type { AssistantStatus, BatchSummary } from "../../domain/model/api.ts";
import type { BrewStage } from "../../domain/model/brewing.ts";
import {
  Button,
  Card,
  cx,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  InlineError,
  LoadingState,
  PageHeader,
  Select,
  TextArea,
  useToast,
} from "../../design-system/index.ts";
import { ApiError } from "../../lib/api.ts";
import { useBatch, useBatches, useTimeline } from "../batches/api.ts";
import { useAskAssistant, useAssistantStatus, type ChatMessage } from "./api.ts";
import { appendQuestion, prepareHistoryForRequest, retryHistory } from "./conversation.ts";

/** Errors that retrying cannot fix; they need an admin or a new day. */
const SETUP_ERRORS = new Set(["assistant_not_configured", "assistant_daily_limit", "assistant_key_rejected", "assistant_no_credit", "assistant_model_unavailable"]);

function starters(stage: BrewStage | null): string[] {
  const common = "Hva sier dette brygget om kalibreringen vår?";
  if (stage === null || stage === "mash" || stage === "lauter") {
    return ["Hvor mye vann skal jeg varme opp, og til hvilken temperatur?", "Mesken ble for kald. Hva gjør jeg?", common];
  }
  if (stage === "boil" || stage === "whirlpool") {
    return ["Hva er neste humletilsetning, og hvor mye?", "Hvordan ligger vi an mot planlagt volum før kok?", common];
  }
  return ["Hvordan ligger vi an mot planen?", "Hva bør vi måle i dag?", common];
}

function loadHistory(batchId: string): ChatMessage[] {
  try {
    const raw = window.sessionStorage.getItem(`assistant:${batchId}`);
    return raw ? (JSON.parse(raw) as ChatMessage[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(batchId: string, messages: ChatMessage[]): void {
  try {
    window.sessionStorage.setItem(`assistant:${batchId}`, JSON.stringify(messages));
  } catch {
    // Per-tab convenience only.
  }
}

/** Renders the small Markdown subset the assistant uses (paragraphs, lists, bold, headings) without HTML. */
function Answer({ text }: { text: string }) {
  const inline = (line: string): ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") && part.endsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : part));
  const listItem = /^\s*([-*•]|\d+\.)\s+/;

  // Group consecutive lines into paragraphs and lists; a blank line ends either.
  const groups: { list: boolean; ordered: boolean; lines: string[] }[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      groups.push({ list: false, ordered: false, lines: [] });
      continue;
    }
    const isItem = listItem.test(line);
    const last = groups.at(-1);
    if (last && last.lines.length > 0 && last.list === isItem) last.lines.push(line);
    else groups.push({ list: isItem, ordered: isItem && /^\s*\d+\./.test(line), lines: [line] });
  }

  return (
    <div className="space-y-2">
      {groups
        .filter((group) => group.lines.length > 0)
        .map((group, i) => {
          if (group.list) {
            const items = group.lines.map((line, j) => <li key={j}>{inline(line.replace(listItem, ""))}</li>);
            return group.ordered ? (
              <ol key={i} className="list-decimal space-y-1 pl-5">{items}</ol>
            ) : (
              <ul key={i} className="list-disc space-y-1 pl-5">{items}</ul>
            );
          }
          return (
            <p key={i}>
              {group.lines.map((line, j) => (
                <span key={j} className={cx(/^#+\s/.test(line) && "font-semibold")}>
                  {j > 0 && <br />}
                  {inline(line.replace(/^#+\s/, ""))}
                </span>
              ))}
            </p>
          );
        })}
    </div>
  );
}

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
        <li>
          Lag en konto på <strong>console.anthropic.com</strong>, kjøp litt kreditt under Billing og sett et månedlig forbrukstak.
        </li>
        <li>Lag en nøkkel under API keys.</li>
        <li>
          Legg den inn i produksjon fra prosjektmappa:
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
      I dag {status.today.requests} av {status.dailyLimit} spørsmål ({usd(status.today.estimatedUsd)}) · denne måneden {usd(status.month.estimatedUsd)} ·{" "}
      {status.model}. Anslag fra listepris; fakturaen i Anthropic Console er fasit.
    </p>
  );
}

export function AssistantPage() {
  const batches = useBatches();
  const status = useAssistantStatus();
  const [params, setParams] = useSearchParams();

  const choices = useMemo(() => {
    const all = batches.data ?? [];
    const order = (b: BatchSummary) => (b.status === "brewing" ? 0 : b.status === "fermenting" || b.status === "conditioning" ? 1 : b.status === "planned" ? 2 : 3);
    return [...all].sort((a, b) => order(a) - order(b) || b.createdAt - a.createdAt);
  }, [batches.data]);
  const batchId = params.get("batch") ?? choices[0]?.id ?? null;

  if (batches.isPending || status.isPending) {
    return (
      <>
        <PageHeader title="Bryggeassistent" />
        <LoadingState />
      </>
    );
  }
  if (batches.error || status.error) {
    return (
      <>
        <PageHeader title="Bryggeassistent" />
        <ErrorState error={batches.error ?? status.error} onRetry={() => void (batches.refetch(), status.refetch())} />
      </>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader title="Bryggeassistent" subtitle="Spør om et brygg. Tallene regnes ut med bryggeriets egne beregninger." />
      {!status.data.configured && <SetupCard />}
      {choices.length === 0 ? (
        <EmptyState icon="kettle" title="Ingen batcher ennå">
          Assistenten svarer om et konkret brygg. Opprett en batch først.
        </EmptyState>
      ) : (
        <>
          <Field label="Brygg">
            {(p) => (
              <Select {...p} value={batchId ?? ""} onChange={(e) => setParams({ batch: e.target.value }, { replace: true })}>
                {choices.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.number} {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {batchId && <Conversation key={batchId} batchId={batchId} configured={status.data.configured} />}
          <UsageLine status={status.data} />
        </>
      )}
    </div>
  );
}

function Conversation({ batchId, configured }: { batchId: string; configured: boolean }) {
  const batch = useBatch(batchId);
  const timeline = useTimeline(batchId, false);
  const ask = useAskAssistant(batchId);
  const toast = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadHistory(batchId));
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveHistory(batchId, messages);
  }, [batchId, messages]);
  useEffect(() => {
    // Braces matter: newer browsers return a promise from scrollIntoView, which React would treat as cleanup.
    void endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, ask.isPending]);

  function submit(history: ChatMessage[]) {
    ask.mutate(prepareHistoryForRequest(history), { onSuccess: (reply) => setMessages((current) => [...current, { role: "assistant", content: reply.reply }]) });
  }

  function send(question: string) {
    if (ask.isPending) return;
    const next = appendQuestion(messages, question);
    if (!next) return;
    setMessages(next);
    setDraft("");
    submit(next);
  }

  function retry() {
    if (ask.isPending) return;
    const history = retryHistory(messages);
    if (history) submit(history);
  }

  async function copyDocument() {
    if (!batch.data || !timeline.data) return;
    try {
      await navigator.clipboard.writeText(buildBrewDocument({ batch: batch.data, timeline: timeline.data, now: Date.now() }));
      toast("Bryggedokumentet er kopiert");
    } catch {
      toast("Kunne ikke kopiere", "error");
    }
  }

  const error = ask.error instanceof ApiError ? ask.error : null;
  const awaitingAnswer = messages.at(-1)?.role === "user";

  return (
    <section className="space-y-3" aria-label="Samtale">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" icon="clipboard" onClick={() => void copyDocument()} disabled={!batch.data || !timeline.data}>
          Kopier bryggedokument
        </Button>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" icon="trash" onClick={() => (setMessages([]), ask.reset())} disabled={ask.isPending}>
            Ny samtale
          </Button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {starters(batch.data?.currentStage ?? null).map((question) => (
            <button
              key={question}
              type="button"
              disabled={!configured}
              onClick={() => send(question)}
              className="min-h-11 rounded-full border border-border bg-surface px-4 text-left text-small font-semibold hover:bg-surface-2 disabled:opacity-50"
            >
              {question}
            </button>
          ))}
        </div>
      )}

      <ol className="space-y-3">
        {messages.map((message, i) => (
          <li key={i} className={cx("flex", message.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cx(
                "max-w-[85%] rounded-card px-4 py-3",
                message.role === "user" ? "bg-primary text-on-primary" : "border border-border bg-surface",
              )}
            >
              {message.role === "user" ? <p className="whitespace-pre-wrap">{message.content}</p> : <Answer text={message.content} />}
            </div>
          </li>
        ))}
        {ask.isPending && (
          <li className="flex justify-start" aria-live="polite">
            <div className="flex items-center gap-2 rounded-card border border-border bg-surface px-4 py-3 text-muted">
              <Icon name="sparkles" size={18} className="animate-pulse" />
              Tenker og regner …
            </div>
          </li>
        )}
      </ol>
      <div ref={endRef} />

      {error && awaitingAnswer && !ask.isPending && (
        <div className="space-y-2">
          <InlineError>{error.message}</InlineError>
          {!SETUP_ERRORS.has(error.code) && (
            <Button size="sm" onClick={retry}>
              Prøv igjen
            </Button>
          )}
        </div>
      )}

      <form
        className="space-y-2"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <Field label="Spørsmål">
          {(p) => (
            <TextArea
              {...p}
              value={draft}
              maxLength={4000}
              disabled={!configured}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              placeholder={configured ? "F.eks. «OG ble 1.055, hva betyr det for effektiviteten?»" : "Sett opp assistenten først"}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={ask.isPending} disabled={!configured || !draft.trim()}>
          Spør
        </Button>
      </form>
    </section>
  );
}
