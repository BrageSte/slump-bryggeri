import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BreweryDetail, CreatedResponse, Role } from "../../domain/model/api.ts";
import { api } from "../../lib/api.ts";
import { meQueryKey } from "../auth/session.ts";
import { useBrewery } from "./BreweryContext.tsx";

export const breweryKey = (breweryId: string) => ["brewery", breweryId] as const;

export function useBreweryDetail() {
  const { breweryId } = useBrewery();
  return useQuery({ queryKey: [...breweryKey(breweryId), "detail"], queryFn: () => api.get<BreweryDetail>(`/breweries/${breweryId}`) });
}

export function useCreateBrewery() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<CreatedResponse>("/breweries", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}

export function useUpdateMyName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.patch("/me", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}

export function useRespondToInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ inviteId, accept }: { inviteId: string; accept: boolean }) =>
      api.post<{ breweryId?: string }>(`/invites/${inviteId}/${accept ? "accept" : "decline"}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meQueryKey }),
  });
}

function useBreweryMutation<TInput>(request: (breweryId: string, input: TInput) => Promise<unknown>) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => request(breweryId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: breweryKey(breweryId) });
      void queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
  });
}

export const useInvite = () =>
  useBreweryMutation((id, input: { email: string; role: Role }) => api.post<CreatedResponse>(`/breweries/${id}/invites`, input));
export const useRevokeInvite = () => useBreweryMutation((id, inviteId: string) => api.delete(`/breweries/${id}/invites/${inviteId}`));
export const useUpdateMemberRole = () =>
  useBreweryMutation((id, input: { userId: string; role: Role }) => api.patch(`/breweries/${id}/members/${input.userId}`, { role: input.role }));
export const useRemoveMember = () => useBreweryMutation((id, userId: string) => api.delete(`/breweries/${id}/members/${userId}`));
