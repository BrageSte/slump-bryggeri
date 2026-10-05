import { useState } from "react";
import type { AssistantMessageAction, AssistantProposedAction, AssistantThreadMessage, BatchDetail } from "../../domain/model/api.ts";
import { eventTypeLabels } from "../../domain/model/brewing.ts";
import { Button, useToast } from "../../design-system/index.ts";
import { useMe } from "../auth/session.ts";
import { useAddComment, useLogEvent, useLogMeasurement } from "../batches/api.ts";
import { useAssistantThread, usePostAssistantMessage, useResolveAssistantAction } from "./api.ts";
import { Conversation, clockTime } from "./Conversation.tsx";
import { assistantActionLabel, starterQuestions } from "./conversation.ts";

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

/** A batch's shared conversation. What the assistant proposes are log entries the brewer confirms with one tap. */
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
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function performLog(action: AssistantProposedAction): Promise<string> {
    if (!batch) throw new Error("Batchen ble ikke funnet.");
    if (action.kind === "log_measurement") {
      const result = await logMeasurement.mutateAsync({
        kind: action.measurementKind,
        value: action.value,
        unit: action.unit,
        label: action.label,
        splitId: action.splitId,
        sampleTempC: action.sampleTempC,
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

  async function confirm(message: AssistantThreadMessage, action: AssistantProposedAction, index: number) {
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

  return (
    <Conversation
      thread={{ isPending: thread.isPending, error: thread.error, messages: thread.data?.messages ?? [], refetch: () => void thread.refetch() }}
      post={{ isPending: post.isPending, error: post.error, send: (content) => post.mutateAsync(content) }}
      configured={configured}
      intro="Start samtalen med et spørsmål om brygget."
      starters={starterQuestions(batch?.currentStage ?? null)}
      label="Spør Veileder"
      placeholder="Spør om denne batchen …"
      actionError={actionError}
      renderActions={(message) => (
        <div className="space-y-2 pt-1 text-left">
          {(message.actions ?? []).map((action, index) => {
            // Recipe drafts belong to the brewery thread; a batch thread only proposes log entries.
            if (action.kind === "recipe_draft") return null;
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
    />
  );
}
