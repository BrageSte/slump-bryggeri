import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BatchDetail, BatchSummary, CreatedResponse, TimelineItem } from "../../domain/model/api.ts";
import type { BatchStatus, BrewStage, MeasurementKind } from "../../domain/model/brewing.ts";
import { api } from "../../lib/api.ts";
import { breweryKey } from "../breweries/api.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";

/** While a batch is active the log refreshes this often so everyone sees the same brew. */
export const LIVE_REFRESH_MS = 5000;

const batchesKey = (breweryId: string) => [...breweryKey(breweryId), "batches"] as const;
const batchKey = (breweryId: string, batchId: string) => [...batchesKey(breweryId), "detail", batchId] as const;
const timelineKey = (breweryId: string, batchId: string) => [...batchesKey(breweryId), "timeline", batchId] as const;

export const ACTIVE_STATUSES: BatchStatus[] = ["brewing", "fermenting", "conditioning"];

export function useBatches(statuses?: BatchStatus[]) {
  const { breweryId } = useBrewery();
  const query = statuses ? `?status=${statuses.join(",")}` : "";
  return useQuery({
    queryKey: [...batchesKey(breweryId), "list", statuses?.join(",") ?? "all"],
    queryFn: () => api.get<BatchSummary[]>(`/breweries/${breweryId}/batches${query}`),
  });
}

export function useBatch(batchId: string | undefined) {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: batchKey(breweryId, batchId ?? ""),
    queryFn: () => api.get<BatchDetail>(`/breweries/${breweryId}/batches/${batchId}`),
    enabled: Boolean(batchId),
    refetchInterval: (query) => (query.state.data?.status === "completed" ? false : LIVE_REFRESH_MS),
  });
}

export function useTimeline(batchId: string | undefined, live = true) {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: timelineKey(breweryId, batchId ?? ""),
    queryFn: () => api.get<TimelineItem[]>(`/breweries/${breweryId}/batches/${batchId}/timeline`),
    enabled: Boolean(batchId),
    refetchInterval: live ? LIVE_REFRESH_MS : false,
  });
}

/** Mutations on one batch: refresh the batch, its log and batch lists afterwards. */
function useBatchMutation<TInput, TResult = unknown>(
  batchId: string,
  request: (base: string, input: TInput) => Promise<TResult>,
  options: { optimistic?: (input: TInput) => TimelineItem | null } = {},
) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  const base = `/breweries/${breweryId}/batches/${batchId}`;
  return useMutation({
    mutationFn: (input: TInput) => request(base, input),
    onMutate: async (input) => {
      const item = options.optimistic?.(input);
      if (!item) return;
      await queryClient.cancelQueries({ queryKey: timelineKey(breweryId, batchId) });
      queryClient.setQueryData<TimelineItem[]>(timelineKey(breweryId, batchId), (current) =>
        [...(current ?? []), item].sort((a, b) => a.occurredAt - b.occurredAt),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: timelineKey(breweryId, batchId) });
      void queryClient.invalidateQueries({ queryKey: batchKey(breweryId, batchId) });
      void queryClient.invalidateQueries({ queryKey: [...batchesKey(breweryId), "list"] });
    },
  });
}

export interface MeasurementInput {
  kind: MeasurementKind;
  value: number;
  unit?: string;
  label?: string;
  stage?: BrewStage | null;
  splitId?: string | null;
  measuredAt?: number;
  comment?: string | null;
}

export function useLogMeasurement(batchId: string, currentUser: { id: string; name: string }) {
  return useBatchMutation(batchId, (base, input: MeasurementInput) => api.post<CreatedResponse>(`${base}/measurements`, input), {
    optimistic: (input) => ({
      id: `optimistic-${Date.now()}`,
      type: "measurement",
      stage: input.stage ?? null,
      splitId: input.splitId ?? null,
      occurredAt: input.measuredAt ?? Date.now(),
      createdAt: Date.now(),
      createdBy: currentUser,
      data: null,
      measurement: {
        id: "optimistic",
        kind: input.kind,
        label: input.label ?? null,
        value: input.value,
        unit: input.unit ?? "",
        sampleTempC: null,
        instrument: null,
        comment: input.comment ?? null,
      },
      comment: null,
      attachment: null,
    }),
  });
}

export const useAddComment = (batchId: string) =>
  useBatchMutation(batchId, (base, input: { body: string; stage?: BrewStage | null; splitId?: string | null }) =>
    api.post<CreatedResponse>(`${base}/comments`, input),
  );

export const useEditComment = (batchId: string) =>
  useBatchMutation(batchId, (base, input: { commentId: string; body: string }) =>
    api.patch(`${base}/comments/${input.commentId}`, { body: input.body }),
  );

export const useLogEvent = (batchId: string) =>
  useBatchMutation(
    batchId,
    (base, input: { type: string; stage?: BrewStage | null; splitId?: string | null; occurredAt?: number; data?: Record<string, unknown> }) =>
      api.post<CreatedResponse>(`${base}/events`, input),
  );

export const useDeleteEvent = (batchId: string) =>
  useBatchMutation(batchId, (base, eventId: string) => api.delete(`${base}/events/${eventId}`));

export const useStartStage = (batchId: string) =>
  useBatchMutation(batchId, (base, stage: BrewStage) => api.post<CreatedResponse>(`${base}/stage`, { stage }));

export const useUpdateBatch = (batchId: string) =>
  useBatchMutation(batchId, (base, input: { name?: string; status?: BatchStatus; brewDate?: string | null }) => api.patch(base, input));

export const useCreateSplit = (batchId: string) =>
  useBatchMutation(batchId, (base, input: { name: string; vessel?: string | null; volumeL?: number | null }) =>
    api.post<CreatedResponse>(`${base}/splits`, input),
  );

export const useUploadPhoto = (batchId: string) =>
  useBatchMutation(batchId, (base, form: FormData) => api.upload<CreatedResponse>(`${base}/attachments`, form));

export function useCreateBatch() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { recipeId: string; name?: string; brewDate?: string }) =>
      api.post<CreatedResponse>(`/breweries/${breweryId}/batches`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: batchesKey(breweryId) }),
  });
}

export function useDeleteBatch() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => api.delete(`/breweries/${breweryId}/batches/${batchId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: batchesKey(breweryId) }),
  });
}
