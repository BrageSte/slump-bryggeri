import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AssistantMessageAction, AssistantProposedAction, AssistantThreadMessage, BatchDetail } from "../../domain/model/api.ts";
import { eventTypeLabels } from "../../domain/model/brewing.ts";
import { Button, cx, Field, Icon, InlineError, LoadingState, markdownInline, MarkdownList, TextArea, useToast } from "../../design-system/index.ts";
import { useMe } from "../auth/session.ts";
import { useAddComment, useLogEvent, useLogMeasurement } from "../batches/api.ts";
import { useAssistantThread, usePostAssistantMessage, useResolveAssistantAction } from "./api.ts";
import { assistantActionLabel, assistantCitationLabel, starterQuestions } from "./conversation.ts";

function Answer({ text }: { text: string }) {
  const listItem = /^\s*([-*•]|\d+\.)\s+/;
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
      {groups.filter((group) => group.lines.length > 0).map((group, index) => {
        if (group.list) {
          const items = group.lines.map((line) => ({ text: line.replace(listItem, "") }));
          return <MarkdownList key={index} items={items} ordered={group.ordered} />;
        }
        return <p key={index}>{group.lines.map((line, lineIndex) => <span key={lineIndex} className={cx(/^#+\s/.test(line) && "font-semibold")}>{lineIndex > 0 && <br />}{markdownInline(line.replace(/^#+\s/, ""))}</span>)}</p>;
      })}
    </div>
  );
}

function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
}

function completionText(action: AssistantMessageAction): string | null {
  if (action.status === "pending") return null;
  const name = action.resolvedBy?.name ?? "en brygger";
  const time = action.resolvedAt === null ? "" : ` kl. ${clockTime(action.resolvedAt)}`;
  return action.status === "done" ? `✓ Logget av ${name}${time}` : `Avvist av ${name}${time}`;
}

function eventSummary(action: AssistantProposedAction): string {
  if (action.kind !== "log_event") return assistantActionLabel(action);
  if (action.type === "comment") return String(action.data.body ?? "");
  return eventTypeLabels[action.type] ?? action.type;
}

function Sources({ citations }: { citations: AssistantThreadMessage["citations"] }) {
  const sources = citations.flatMap((citation) => {
    const label = assistantCitationLabel(citation);
    return label ? [{ ...citation, label }] : [];
  });
  if (sources.length === 0) return null;

  return (
    <ul className="space-y-0.5 px-1 text-caption text-muted" aria-label="Kilder">
      {sources.map((source) => (
        <li key={source.url}>
          <a className="inline-flex min-h-11 items-center underline decoration-border underline-offset-2 hover:text-primary-strong" href={source.url} target="_blank" rel="noopener noreferrer">
            Kilde: {source.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export function AssistantThread({
  batchId,
  batch,
  configured,
  enabled = true,
}: {
  batchId: string;
  batch: BatchDetail | null;
  configured: boolean;
  enabled?: boolean;
}) {
  const thread = useAssistantThread(batchId, enabled);
  const post = usePostAssistantMessage(batchId);
  const resolveAction = useResolveAssistantAction(batchId);
  const me = useMe();
  const user = me.data?.user ?? { id: "", name: "" };
  const logMeasurement = useLogMeasurement(batchId, user);
  const logEvent = useLogEvent(batchId);
  const addComment = useAddComment(batchId);
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = thread.data?.messages ?? [];

  useEffect(() => {
    void endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, post.isPending]);

  async function send(content: string) {
    const clean = content.trim();
    if (!clean || post.isPending) return;
    setPendingQuestion(clean);
    setDraft("");
    try {
      await post.mutateAsync(clean);
    } catch {
      // The mutation error is shown below; the user message remains saved in the shared thread.
    } finally {
      setPendingQuestion(null);
    }
  }

  async function performLog(action: AssistantProposedAction): Promise<string> {
    if (!batch) throw new Error("Batchen ble ikke funnet.");
    if (action.kind === "log_measurement") {
      const result = await logMeasurement.mutateAsync({
        kind: action.measurementKind,
        value: action.value,
        unit: action.unit,
        label: action.label,
        splitId: action.splitId,
        stage: batch.currentStage,
      });
      return result.id;
    }
    if (action.kind === "start_timer") {
      const result = await logEvent.mutateAsync({
        type: "timer_started",
        stage: batch.currentStage,
        data: { label: action.label, durationMin: action.durationMin },
      });
      return result.id;
    }
    if (action.type === "comment") {
      const body = action.data.body;
      if (typeof body !== "string") throw new Error("Notatet mangler tekst.");
      const result = await addComment.mutateAsync({ body, stage: batch.currentStage });
      return result.id;
    }
    const result = await logEvent.mutateAsync({ type: action.type, stage: batch.currentStage, data: action.data });
    return result.id;
  }

  async function confirm(message: AssistantThreadMessage, action: AssistantMessageAction, index: number) {
    const key = `${message.id}:${index}`;
    setBusyAction(key);
    setActionError(null);
    try {
      const logEntryId = await performLog(action);
      await resolveAction.mutateAsync({ messageId: message.id, index, status: "done", logEntryId });
      toast("Loggført i bryggeloggen");
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Kunne ikke logge forslaget.");
    } finally {
      setBusyAction(null);
    }
  }

  async function dismiss(message: AssistantThreadMessage, index: number) {
    setBusyAction(`${message.id}:${index}`);
    setActionError(null);
    try {
      await resolveAction.mutateAsync({ messageId: message.id, index, status: "dismissed" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Kunne ikke avvise forslaget.");
    } finally {
      setBusyAction(null);
    }
  }

  const visibleMessages = pendingQuestion
    ? [...messages, { id: "pending", role: "user" as const, content: pendingQuestion, actions: null, citations: [], author: { id: user.id, name: user.name }, createdAt: Date.now() }]
    : messages;

  return (
    <div className="space-y-3">
      {thread.isPending ? <LoadingState /> : thread.error ? (
        <div className="space-y-2">
          <InlineError>{thread.error.message}</InlineError>
          <Button size="sm" onClick={() => void thread.refetch()}>Prøv igjen</Button>
        </div>
      ) : null}

      {!thread.isPending && messages.length === 0 && !pendingQuestion && (
        <div className="space-y-2">
          <p className="text-small text-muted">Start samtalen med et spørsmål om brygget.</p>
          <div className="flex flex-wrap gap-2">
            {starterQuestions(batch?.currentStage ?? null).map((question) => (
              <button
                key={question}
                type="button"
                disabled={!configured || post.isPending}
                onClick={() => void send(question)}
                className="min-h-11 rounded-full border border-border bg-surface px-3 py-2 text-left text-small font-semibold hover:bg-surface-2 disabled:opacity-50"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="max-h-[48dvh] space-y-3 overflow-y-auto overscroll-contain pr-1 md:max-h-[54dvh]">
        {visibleMessages.map((message) => {
          const mine = message.role === "user" && message.author?.id === user.id;
          return (
            <li key={message.id} className={cx("flex", mine ? "justify-end" : "justify-start")}>
              <div className={cx("max-w-[94%] space-y-1", message.role === "user" ? "text-right" : "text-left")}>
                <p className="tabular px-1 text-caption text-muted">
                  {message.role === "assistant" ? "Veileder" : message.author?.name ?? "Brygger"}
                  {message.id !== "pending" && ` · ${clockTime(message.createdAt)}`}
                </p>
                <div className={cx("rounded-card px-3 py-2.5 text-small", message.role === "user" ? "bg-primary text-on-primary" : "border border-border bg-surface")}>
                  {message.role === "user" ? <p className="whitespace-pre-wrap text-left">{message.content}</p> : <Answer text={message.content} />}
                </div>
                {message.role === "assistant" && <Sources citations={message.citations} />}
                {message.role === "assistant" && message.actions && message.actions.length > 0 && (
                  <div className="space-y-2 pt-1 text-left">
                    {message.actions.map((action, index) => {
                      const key = `${message.id}:${index}`;
                      const completed = completionText(action);
                      return (
                        <div key={index} className="rounded-md border border-border bg-surface-2/60 p-2">
                          {completed ? (
                            <p className="tabular min-h-11 content-center px-2 text-small font-semibold text-muted">{completed}</p>
                          ) : (
                            <div className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_auto]">
                              <Button size="md" variant="primary" block className="min-h-11 justify-start text-left tabular" loading={busyAction === key} disabled={busyAction !== null} onClick={() => void confirm(message, action, index)}>
                                <span className="truncate">{assistantActionLabel(action)}</span>
                              </Button>
                              <Button size="md" variant="ghost" disabled={busyAction !== null} onClick={() => void dismiss(message, index)}>
                                Avvis
                              </Button>
                            </div>
                          )}
                          {action.kind === "log_event" && action.type === "comment" && <p className="px-2 pb-1 text-small text-muted">{eventSummary(action)}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {post.isPending && (
          <li className="flex justify-start" aria-live="polite">
            <div className="flex items-center gap-2 rounded-card border border-border bg-surface px-3 py-2.5 text-small text-muted">
              <Icon name="sparkles" size={18} className="animate-pulse" />
              Tenker og regner …
            </div>
          </li>
        )}
      </ol>
      <div ref={endRef} />

      {actionError && <InlineError>{actionError}</InlineError>}
      {post.error && <InlineError>{post.error.message}</InlineError>}
      {!configured && <p className="text-small text-muted">Assistenten er ikke satt opp ennå.</p>}

      <form className="space-y-2 border-t border-border pt-3" onSubmit={(event: FormEvent) => { event.preventDefault(); void send(draft); }}>
        <Field label="Spør Veileder">
          {(props) => (
            <TextArea
              {...props}
              value={draft}
              maxLength={4000}
              disabled={!configured || post.isPending}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
              placeholder={configured ? "Spør om denne batchen …" : "Sett opp assistenten først"}
              className="min-h-20"
            />
          )}
        </Field>
        <Button type="submit" variant="primary" size="md" block loading={post.isPending} disabled={!configured || !draft.trim()}>
          Spør
        </Button>
      </form>
    </div>
  );
}
