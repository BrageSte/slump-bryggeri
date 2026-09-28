import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AssistantReply, AssistantStatus } from "../../domain/model/api.ts";
import { api } from "../../lib/api.ts";
import { breweryKey } from "../breweries/api.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";

const statusKey = (breweryId: string) => [...breweryKey(breweryId), "assistant"] as const;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function useAssistantStatus() {
  const { breweryId } = useBrewery();
  return useQuery({ queryKey: statusKey(breweryId), queryFn: () => api.get<AssistantStatus>(`/breweries/${breweryId}/assistant`) });
}

export function useAskAssistant(batchId: string) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messages: ChatMessage[]) => api.post<AssistantReply>(`/breweries/${breweryId}/batches/${batchId}/assistant`, { messages }),
    // Usage changes with every answer (and with failures that still used tokens).
    onSettled: () => queryClient.invalidateQueries({ queryKey: statusKey(breweryId) }),
  });
}
