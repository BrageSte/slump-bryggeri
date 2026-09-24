import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeResponse } from "../../domain/model/api.ts";
import { ApiError, api } from "../../lib/api.ts";
import { authClient } from "../../lib/auth-client.ts";

export const meQueryKey = ["me"] as const;

/** The signed-in user with memberships; `null` when signed out. */
export function useMe() {
  return useQuery({
    queryKey: meQueryKey,
    queryFn: async () => {
      try {
        return await api.get<MeResponse>("/me");
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return async () => {
    await authClient.signOut();
    queryClient.clear();
    window.location.assign("/logg-inn");
  };
}
