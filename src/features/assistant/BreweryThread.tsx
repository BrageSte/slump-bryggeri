import { useAssistantThread, usePostAssistantMessage } from "./api.ts";
import { Conversation } from "./Conversation.tsx";
import { breweryStarterQuestions } from "./conversation.ts";
import { RecipeDraftCard } from "./RecipeDraftCard.tsx";

/**
 * The brewery's shared conversation about recipes, equipment and brewing in general (no batch). The assistant answers
 * with short proposals and recipe drafts whose amounts the app has calculated; nothing is saved by the conversation.
 */
export function BreweryThread({ configured }: { configured: boolean }) {
  const thread = useAssistantThread(null);
  const post = usePostAssistantMessage(null);

  return (
    <Conversation
      thread={{ isPending: thread.isPending, error: thread.error, messages: thread.data?.messages ?? [], refetch: () => void thread.refetch() }}
      post={{ isPending: post.isPending, error: post.error, send: (content) => post.mutateAsync(content) }}
      configured={configured}
      intro="Spør om en ny oppskrift, en endring i en av dere har, eller hva bryggeriets egne tall sier."
      starters={breweryStarterQuestions()}
      label="Spør Veileder"
      placeholder="Be om en oppskrift, eller fortell hva du har hjemme …"
      renderActions={(message) => (
        <div className="space-y-2 pt-1">
          {(message.actions ?? []).map((action, index) => (action.kind === "recipe_draft" ? <RecipeDraftCard key={index} draft={action} request={(thread.data?.messages ?? []).slice(0, (thread.data?.messages ?? []).findIndex((entry) => entry.id === message.id)).findLast((entry) => entry.role === "user")?.content ?? "Oppskriftsutkast fra assistenten"} /> : null))}
        </div>
      )}
    />
  );
}
