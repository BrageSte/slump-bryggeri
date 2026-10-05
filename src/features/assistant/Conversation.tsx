import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { AssistantThreadMessage } from "../../domain/model/api.ts";
import { Button, cx, Field, Icon, InlineError, LoadingState, markdownInline, MarkdownList, TextArea } from "../../design-system/index.ts";
import { useMe } from "../auth/session.ts";
import { assistantCitationLabel } from "./conversation.ts";

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

export function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("nb-NO", { hour: "2-digit", minute: "2-digit" });
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

/**
 * The shared conversation: the stored messages, a starter list while it is empty, and the composer. What the assistant
 * proposes (log entries in a batch thread, recipe drafts in the brewery thread) is drawn by `renderActions`.
 */
export function Conversation({
  thread,
  post,
  configured,
  intro,
  starters,
  label,
  placeholder,
  actionError,
  renderActions,
}: {
  thread: { isPending: boolean; error: Error | null; messages: AssistantThreadMessage[]; refetch: () => void };
  post: { isPending: boolean; error: Error | null; send: (content: string) => Promise<unknown> };
  configured: boolean;
  /** Shown above the starter questions while the thread is empty. */
  intro: string;
  starters: string[];
  /** Label of the question field. */
  label: string;
  placeholder: string;
  actionError?: string | null;
  renderActions?: (message: AssistantThreadMessage) => ReactNode;
}) {
  const me = useMe();
  const user = me.data?.user ?? { id: "", name: "" };
  const [draft, setDraft] = useState("");
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const messages = thread.messages;

  useEffect(() => {
    void endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages.length, post.isPending]);

  async function send(content: string) {
    const clean = content.trim();
    if (!clean || post.isPending) return;
    setPendingQuestion(clean);
    setDraft("");
    try {
      await post.send(clean);
    } catch {
      // The mutation error is shown below; the user message remains saved in the shared thread.
    } finally {
      setPendingQuestion(null);
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
          <Button size="sm" onClick={thread.refetch}>Prøv igjen</Button>
        </div>
      ) : null}

      {!thread.isPending && messages.length === 0 && !pendingQuestion && (
        <div className="space-y-2">
          <p className="text-small text-muted">{intro}</p>
          <div className="flex flex-wrap gap-2">
            {starters.map((question) => (
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
                {message.role === "assistant" && message.actions && message.actions.length > 0 && renderActions?.(message)}
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
        <Field label={label}>
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
              placeholder={configured ? placeholder : "Sett opp assistenten først"}
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
