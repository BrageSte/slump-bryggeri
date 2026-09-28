import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { BottomSheet, Button, Field, Icon, InlineError, Select, TextInput, useToast } from "../../design-system/index.ts";
import { useEquipmentProfile } from "../equipment/api.ts";
import { todayIso } from "../../lib/format.ts";
import { useRecipes } from "../recipes/api.ts";
import { useCreateBatch } from "./api.ts";

export function NewBatchSheet({ open, onClose, recipeId: presetRecipeId }: { open: boolean; onClose: () => void; recipeId?: string }) {
  const recipes = useRecipes();
  const createBatch = useCreateBatch();
  const profile = useEquipmentProfile();
  // The batch freezes today's profile, so point out what the brew plan will miss before it is locked.
  const missingBoilOff = profile.data !== undefined && profile.data?.values.boil_off_l_per_h === undefined;
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
        {missingBoilOff && (
          <div className="flex gap-2 rounded-md border border-border bg-surface-2/50 p-3 text-small">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0 text-muted" />
            <p>
              Kalibreringen mangler fordampning, så bryggeplanen kan ikke regne ut vannmengder.{" "}
              <Link to="/mer/kalibrering" onClick={onClose} className="font-semibold text-primary-strong underline underline-offset-4">
                Legg den inn først
              </Link>
            </p>
          </div>
        )}
        {createBatch.error && <InlineError>{createBatch.error.message}</InlineError>}
        <Button type="submit" variant="primary" size="lg" block loading={createBatch.isPending} disabled={!selected}>
          Opprett batch
        </Button>
      </form>
    </BottomSheet>
  );
}
