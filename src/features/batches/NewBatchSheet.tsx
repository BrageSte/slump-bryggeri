import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { BottomSheet, Button, Field, InlineError, Select, TextInput, useToast } from "../../design-system/index.ts";
import { todayIso } from "../../lib/format.ts";
import { useRecipes } from "../recipes/api.ts";
import { useCreateBatch } from "./api.ts";

export function NewBatchSheet({ open, onClose, recipeId: presetRecipeId }: { open: boolean; onClose: () => void; recipeId?: string }) {
  const recipes = useRecipes();
  const createBatch = useCreateBatch();
  const navigate = useNavigate();
  const toast = useToast();
  const [recipeId, setRecipeId] = useState(presetRecipeId ?? "");
  const [brewDate, setBrewDate] = useState(todayIso());
  const selected = presetRecipeId ?? (recipeId || recipes.data?.[0]?.id || "");

  function submit(event: FormEvent) {
    event.preventDefault();
    createBatch.mutate(
      { recipeId: selected, brewDate: brewDate || undefined },
      {
        onSuccess: ({ id }) => {
          toast("Batch opprettet");
          onClose();
          navigate(`/batcher/${id}`);
        },
      },
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Ny batch">
      <form onSubmit={submit} className="space-y-4">
        {!presetRecipeId && (
          <Field label="Oppskrift">
            {(p) => (
              <Select {...p} required value={selected} onChange={(e) => setRecipeId(e.target.value)}>
                {recipes.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} (v{r.version}, {r.batchSizeL} L)
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Bryggedato">{(p) => <TextInput {...p} type="date" value={brewDate} onChange={(e) => setBrewDate(e.target.value)} />}</Field>
        <p className="text-small text-muted">
          Oppskriften og bryggeriets kalibrering låses i batchen. Senere endringer påvirker ikke dette brygget.
        </p>
        {createBatch.error && <InlineError>{createBatch.error.message}</InlineError>}
        <Button type="submit" variant="primary" size="lg" block loading={createBatch.isPending} disabled={!selected}>
          Opprett batch
        </Button>
      </form>
    </BottomSheet>
  );
}
