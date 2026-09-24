import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreatedResponse, EquipmentItem, EquipmentProfile, EquipmentProfileVersionSummary } from "../../domain/model/api.ts";
import { api } from "../../lib/api.ts";
import { breweryKey } from "../breweries/api.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";

export function useEquipmentProfile() {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: [...breweryKey(breweryId), "equipment-profile"],
    queryFn: () => api.get<EquipmentProfile | null>(`/breweries/${breweryId}/equipment-profile`),
  });
}

export function useProfileVersions() {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: [...breweryKey(breweryId), "equipment-profile", "versions"],
    queryFn: () => api.get<EquipmentProfileVersionSummary[]>(`/breweries/${breweryId}/equipment-profile/versions`),
  });
}

export function useSaveProfileVersion() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { values: Record<string, number | null>; changeNote?: string }) =>
      api.post<CreatedResponse>(`/breweries/${breweryId}/equipment-profile/versions`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...breweryKey(breweryId), "equipment-profile"] }),
  });
}

export function useEquipment() {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: [...breweryKey(breweryId), "equipment"],
    queryFn: () => api.get<EquipmentItem[]>(`/breweries/${breweryId}/equipment`),
  });
}

export function useSaveEquipment() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: Omit<EquipmentItem, "id"> & { id?: string }) =>
      id ? api.put(`/breweries/${breweryId}/equipment/${id}`, input) : api.post(`/breweries/${breweryId}/equipment`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...breweryKey(breweryId), "equipment"] }),
  });
}

export function useDeleteEquipment() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/breweries/${breweryId}/equipment/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...breweryKey(breweryId), "equipment"] }),
  });
}
