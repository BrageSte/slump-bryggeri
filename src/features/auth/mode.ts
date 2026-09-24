import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModeResponse } from "../../domain/model/api.ts";
import { api } from "../../lib/api.ts";

export const modeQueryKey = ["mode"] as const;

/** Whether the app runs in brewery mode (no accounts) and this device's state in it. */
export function useMode() {
  return useQuery({ queryKey: modeQueryKey, queryFn: () => api.get<ModeResponse>("/mode"), staleTime: 60_000 });
}

/** "Bytt person": forget who this device is (keeps the brewery code). */
export function useLeavePerson() {
  const queryClient = useQueryClient();
  return async () => {
    await api.post("/brewery-mode/leave");
    queryClient.clear();
    window.location.assign("/inngang");
  };
}
