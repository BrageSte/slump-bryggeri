import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import {
  BSMX_MAX_BYTES,
  BsmxImportError,
  bsmxSourceData,
  decodeBsmxFile,
  parseBsmx,
  type BsmxRecipeImport,
} from "../../domain/import/bsmx.ts";
import { Button, Card, Icon, InlineError, PageHeader, SectionLabel, useToast } from "../../design-system/index.ts";
import { ApiError } from "../../lib/api.ts";
import { formatNumber } from "../../lib/format.ts";
import { useImportBsmx } from "./api.ts";
import { BsmxEquipmentCard, BsmxImportNotes } from "./BsmxSource.tsx";
import { RecipeIngredients, RecipeMetrics } from "./RecipeView.tsx";

interface PickedFile {
  filename: string;
  text: string;
  /** The file was not UTF-8; the stored copy is converted. */
  converted: boolean;
  recipes: BsmxRecipeImport[];
}

const tooLarge = `Filen er for stor (maks ${BSMX_MAX_BYTES / 1000} kB). Eksporter én oppskrift om gangen fra BeerSmith.`;

async function readBsmxFile(file: File): Promise<PickedFile> {
  if (file.size > BSMX_MAX_BYTES) throw new BsmxImportError(tooLarge);
  const { text, converted } = decodeBsmxFile(new Uint8Array(await file.arrayBuffer()));
  return { filename: file.name, text, converted, recipes: parseBsmx(text) };
}

/**
 * BeerSmith import: pick a .bsmx file, review what becomes the recipe (and what does not), save.
 * The file is parsed here for the review and again on the server, which keeps the file unchanged.
 */
export function BsmxImportPage() {
  const importBsmx = useImportBsmx();
  const navigate = useNavigate();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile | null>(null);
  const [recipeIndex, setRecipeIndex] = useState(0);
  const [readError, setReadError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setReading(true);
    setReadError(null);
    importBsmx.reset();
    try {
      setPicked(await readBsmxFile(file));
      setRecipeIndex(0);
    } catch (error) {
      setPicked(null);
      setReadError(error instanceof BsmxImportError ? error.message : "Kunne ikke lese filen.");
    } finally {
      setReading(false);
    }
  }

  const chosen = picked?.recipes[recipeIndex];

  function save() {
    if (!picked || !chosen) return;
    importBsmx.mutate(
      { filename: picked.filename, text: picked.text, recipeIndex },
      {
        onSuccess: ({ id }) => {
          toast(`«${chosen.recipe.name}» er importert`);
          navigate(`/oppskrifter/${id}`, { replace: true });
        },
      },
    );
  }

  const saveError =
    importBsmx.error instanceof ApiError && importBsmx.error.issues[0] ? importBsmx.error.issues[0].message : importBsmx.error?.message;

  // No `accept` filter: iOS greys out file types it does not know, and .bsmx is one of them.
  const fileButton = (label: string, variant: "primary" | "secondary") => (
    <Button variant={variant} size="lg" block icon="file" loading={reading} onClick={() => fileInput.current?.click()}>
      {label}
    </Button>
  );

  const saveButton = (
    <Button variant="primary" size="lg" block icon="check" loading={importBsmx.isPending} onClick={save}>
      Importer oppskriften
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader back="/oppskrifter/importer" title="BeerSmith-fil" subtitle="Importer en oppskrift fra BeerSmith 2 eller 3 (.bsmx)" />
      <input ref={fileInput} type="file" hidden onChange={(event) => void onFile(event)} />

      {!picked && (
        <Card className="space-y-4">
          <p className="text-small text-muted">
            Oppskriften blir en plan i Slump. Filen tas vare på uendret og kan lastes ned igjen fra oppskriften. Målte verdier
            fra tidligere brygg i BeerSmith tas ikke med.
          </p>
          {fileButton("Velg .bsmx-fil", "primary")}
          {readError && <InlineError>{readError}</InlineError>}
        </Card>
      )}

      {picked && chosen && (
        <>
          <Card className="space-y-3">
            <div className="flex items-start gap-3">
              <Icon name="file" className="mt-0.5 shrink-0 text-primary-strong" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{picked.filename}</p>
                <p className="text-small text-muted">
                  {picked.recipes.length === 1 ? "1 oppskrift" : `${picked.recipes.length} oppskrifter`} ·{" "}
                  {formatNumber(new TextEncoder().encode(picked.text).length / 1000, 0)} kB
                </p>
              </div>
            </div>
            {picked.converted && (
              <p className="flex gap-2 text-small">
                <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-warning" />
                Filen var ikke UTF-8 og er lest som Windows-1252. Kopien som lagres, er omgjort til UTF-8.
              </p>
            )}
            {fileButton("Velg en annen fil", "secondary")}
            {readError && <InlineError>{readError}</InlineError>}
          </Card>

          {picked.recipes.length > 1 && (
            <fieldset className="space-y-2">
              <legend className="mb-2 text-caption font-semibold tracking-[.08em] text-muted uppercase">Velg oppskrift</legend>
              <div className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
                {picked.recipes.map((r, index) => (
                  <label key={index} className="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 hover:bg-surface-2">
                    <input
                      type="radio"
                      name="recipe"
                      className="size-5 accent-primary-strong"
                      checked={index === recipeIndex}
                      onChange={() => {
                        setRecipeIndex(index);
                        importBsmx.reset();
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{r.recipe.name}</span>
                      {r.recipe.style && <span className="block truncate text-small text-muted">{r.recipe.style}</span>}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <section aria-label="Oppskriften" className="space-y-4">
            <div>
              <SectionLabel>Blir oppskriften</SectionLabel>
              <h2 className="mt-1 text-title font-bold tracking-tight">{chosen.recipe.name}</h2>
              {chosen.recipe.style && <p className="text-small text-muted">{chosen.recipe.style}</p>}
            </div>
            <RecipeMetrics recipe={chosen.recipe} />
            <BsmxImportNotes source={chosen} />
            {saveButton}
            {saveError && <InlineError>{saveError}</InlineError>}
          </section>

          <BsmxEquipmentCard source={bsmxSourceData(chosen, recipeIndex, picked.recipes.length)} />
          <RecipeIngredients recipe={chosen.recipe} />
          {saveButton}
        </>
      )}
    </div>
  );
}
