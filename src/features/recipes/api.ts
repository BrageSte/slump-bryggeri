import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreatedResponse,
  LibraryRecipeDetail,
  LibrarySearchResponse,
  RecipeDetail,
  RecipeSummary,
} from "../../domain/model/api.ts";
import type { LibraryCategory } from "../../domain/model/library.ts";
import type { RecipeDocument } from "../../domain/model/recipe.ts";
import { api } from "../../lib/api.ts";
import { saveFile } from "../../lib/save-file.ts";
import { breweryKey } from "../breweries/api.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";

const recipesKey = (breweryId: string) => [...breweryKey(breweryId), "recipes"] as const;

export function useRecipes() {
  const { breweryId } = useBrewery();
  return useQuery({ queryKey: recipesKey(breweryId), queryFn: () => api.get<RecipeSummary[]>(`/breweries/${breweryId}/recipes`) });
}

export function useRecipe(recipeId: string | undefined) {
  const { breweryId } = useBrewery();
  return useQuery({
    queryKey: [...recipesKey(breweryId), recipeId],
    queryFn: () => api.get<RecipeDetail>(`/breweries/${breweryId}/recipes/${recipeId}`),
    enabled: Boolean(recipeId),
  });
}

export function useCreateRecipe() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { recipe: RecipeDocument; source?: { kind: string } }) =>
      api.post<CreatedResponse>(`/breweries/${breweryId}/recipes`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipesKey(breweryId) }),
  });
}

/** Imports one recipe from a BeerSmith file; the server parses and keeps the file (docs/import-bsmx.md). */
export function useImportBsmx() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { filename: string; text: string; recipeIndex: number }) =>
      api.post<CreatedResponse>(`/breweries/${breweryId}/recipes/import/bsmx`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipesKey(breweryId) }),
  });
}

/** Saves the file a recipe was imported from, exactly as it was picked. */
export async function downloadRecipeSourceFile(breweryId: string, recipeId: string, filename: string): Promise<void> {
  const { blob } = await api.download(`/breweries/${breweryId}/recipes/${recipeId}/source/file`);
  saveFile(blob, filename);
}

export function useSaveRecipeVersion(recipeId: string) {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { recipe: RecipeDocument; baseVersionId: string; changeNote?: string; kind?: "normalized" | "adaptation" }) =>
      api.post<CreatedResponse>(`/breweries/${breweryId}/recipes/${recipeId}/versions`, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipesKey(breweryId) }),
  });
}

export function useDeleteRecipe() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (recipeId: string) => api.delete(`/breweries/${breweryId}/recipes/${recipeId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipesKey(breweryId) }),
  });
}

// --- Recipe library (public reference recipes, not brewery-scoped) -----------------------

export function useLibrarySearch(q: string, category: LibraryCategory | null) {
  return useInfiniteQuery({
    queryKey: ["library", "search", q, category],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "20", offset: String(pageParam) });
      if (q) params.set("q", q);
      if (category) params.set("category", category);
      return api.get<LibrarySearchResponse>(`/library/recipes?${params}`);
    },
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    staleTime: 10 * 60_000,
  });
}

export function useLibraryRecipe(libraryId: string | undefined) {
  return useQuery({
    queryKey: ["library", "recipe", libraryId],
    queryFn: () => api.get<LibraryRecipeDetail>(`/library/recipes/${libraryId}`),
    enabled: Boolean(libraryId),
    staleTime: 10 * 60_000,
  });
}

export function useCopyFromLibrary() {
  const { breweryId } = useBrewery();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (libraryId: string) => api.post<CreatedResponse>(`/breweries/${breweryId}/recipes/from-library`, { libraryId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: recipesKey(breweryId) }),
  });
}
