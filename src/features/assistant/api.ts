import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AssistantPostResponse,
  AssistantStatus,
  AssistantThreadResponse,
} from "../../domain/model/api.ts";
import { api } from "../../lib/api.ts";
import { breweryKey } from "../breweries/api.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";

const statusKey = (breweryId: string) => [...breweryKey(breweryId), "assistant"] as const;
const threadKey = (breweryId: string, batchId: string) => [...breweryKey(breweryId), "batches", batchId, "assistant-thread"] as const;

export function useAssistantStatus() {
  const { breweryId } = useBrewery();
  return useQuery({ queryKey: statusKey(breweryId), queryFn: () => api.get<AssistantStatus>(`/breweries/${breweryId}/assistant`) });
}

export function useAssistantThread(batchId: string, enabled = true) {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: threadKey(breweryId, batchId),
    queryFn: () => api.get<AssistantThreadResponse>(`/breweries/${breweryId}/batches/${batchId}/assistant/messages`),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}

export function usePostAssistantMessage(batchId: string) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.post<AssistantPostResponse>(`/breweries/${breweryId}/batches/${batchId}/assistant/messages`, { content }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey(breweryId, batchId) });
      void queryClient.invalidateQueries({ queryKey: statusKey(breweryId) });
    },
  });
}

export function useResolveAssistantAction(batchId: string) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; index: number; status: "done" | "dismissed"; logEntryId?: string }) =>
      api.patch(
        `/breweries/${breweryId}/batches/${batchId}/assistant/messages/${input.messageId}/actions/${input.index}`,
        { status: input.status, logEntryId: input.logEntryId },
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadKey(breweryId, batchId) }),
  });
}
