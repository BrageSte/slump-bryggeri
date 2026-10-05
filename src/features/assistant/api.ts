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

/** A batch's own thread, or (batchId null) the brewery's thread about recipes and equipment. */
const threadKey = (breweryId: string, batchId: string | null) =>
  batchId === null ? ([...breweryKey(breweryId), "assistant-thread"] as const) : ([...breweryKey(breweryId), "batches", batchId, "assistant-thread"] as const);
const threadPath = (breweryId: string, batchId: string | null) =>
  batchId === null ? `/breweries/${breweryId}/assistant/messages` : `/breweries/${breweryId}/batches/${batchId}/assistant/messages`;

export function useAssistantStatus() {
  const { breweryId } = useBrewery();
  return useQuery({ queryKey: statusKey(breweryId), queryFn: () => api.get<AssistantStatus>(`/breweries/${breweryId}/assistant`) });
}

export function useAssistantThread(batchId: string | null, enabled = true) {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: threadKey(breweryId, batchId),
    queryFn: () => api.get<AssistantThreadResponse>(threadPath(breweryId, batchId)),
    enabled,
    refetchInterval: enabled ? 10_000 : false,
  });
}

export function usePostAssistantMessage(batchId: string | null) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.post<AssistantPostResponse>(threadPath(breweryId, batchId), { content }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: threadKey(breweryId, batchId) });
      void queryClient.invalidateQueries({ queryKey: statusKey(breweryId) });
    },
  });
}

export function useResolveAssistantAction(batchId: string | null) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageId: string; index: number; status: "done" | "dismissed"; logEntryId?: string }) =>
      api.patch(`${threadPath(breweryId, batchId)}/${input.messageId}/actions/${input.index}`, { status: input.status, logEntryId: input.logEntryId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadKey(breweryId, batchId) }),
  });
}
