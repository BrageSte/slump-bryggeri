import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Button,
  buttonClasses,
  Card,
  ConfirmDialog,
  ErrorState,
  Icon,
  InlineError,
  LoadingState,
  PageHeader,
  Section,
  StatusChip,
  useToast,
} from "../../design-system/index.ts";
import { formatDate } from "../../lib/format.ts";
import { useMe } from "../auth/session.ts";
import { NewBatchSheet } from "../batches/NewBatchSheet.tsx";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { downloadRecipeSourceFile, useDeleteRecipe, useRecipe } from "./api.ts";
import { compareBsmxEquipmentWithProfile, suggestProfileFromBsmx } from "../../domain/import/bsmx-equipment.ts";
import type { ProfileValues } from "../../domain/model/equipment-profile.ts";
import { BsmxEquipmentCard, BsmxImportNotes } from "./BsmxSource.tsx";
import { RecipeIngredients, RecipeMetrics } from "./RecipeView.tsx";
import { useEquipmentProfile } from "../equipment/api.ts";

const sourceLabels: Record<string, string> = {
  manual: "Lagt inn manuelt",
  example: "Eksempeloppskrift",
  library: "Oppskriftsbiblioteket (BrewDog DIY Dog)",
  beerxml: "BeerXML",
  beerjson: "BeerJSON",
  text: "Innlimt tekst",
  url: "Nettside",
  image: "Bilde",
  pdf: "PDF",
  bsmx: "BeerSmith-fil",
};

export function RecipeDetailPage() {
  const { recipeId } = useParams();
  const recipe = useRecipe(recipeId);
  const me = useMe();
  const { breweryId, isAdmin } = useBrewery();
  const deleteRecipe = useDeleteRecipe();
  const navigate = useNavigate();
  const toast = useToast();
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  if (recipe.isPending) return <LoadingState />;
  if (recipe.error) {
    return (
      <>
        <PageHeader back="/oppskrifter" title="Oppskrift" />
        <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />
      </>
    );
  }

  const { current, source } = recipe.data;
  const doc = current.data;

  async function downloadFile(filename: string) {
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadRecipeSourceFile(breweryId, recipe.data!.id, filename);
    } catch (cause) {
      setDownloadError(cause instanceof Error ? cause.message : "Kunne ikke laste ned filen.");
    } finally {
      setDownloading(false);
    }
  }
  const canDelete = isAdmin || recipe.data.versions.at(-1)?.createdBy.id === me.data?.user.id;

  return (
    <div className="space-y-6">
      <PageHeader
        back="/oppskrifter"
        eyebrow={
          <StatusChip tone={current.kind === "adaptation" ? "primary" : "neutral"}>
            v{current.version}
            {current.kind === "adaptation" ? " · tilpasset bryggeriet" : ""}
          </StatusChip>
        }
        title={doc.name}
        subtitle={doc.style}
      />

      {doc.description && <p className="text-muted">{doc.description}</p>}
      <RecipeMetrics recipe={doc} />

      <div className="grid gap-2 sm:grid-cols-3">
        <Button variant="primary" size="lg" icon="kettle" onClick={() => setCreatingBatch(true)}>
          Opprett batch
        </Button>
        <Link to={`/oppskrifter/${recipe.data.id}/tilpass`} className={buttonClasses("secondary", "lg")}>
          <Icon name="sliders" size={22} />
          Tilpass
        </Link>
        <Link to={`/oppskrifter/${recipe.data.id}/rediger`} className={buttonClasses("secondary", "lg")}>
          <Icon name="edit" size={22} />
          Rediger
        </Link>
      </div>

      <RecipeIngredients recipe={doc} />

      {source?.bsmx && (
        <Section
          title="Fra BeerSmith"
          action={
            source.filename ? (
              <Button size="sm" variant="ghost" icon="file" loading={downloading} onClick={() => void downloadFile(source.filename!)}>
                Last ned fil
              </Button>
            ) : undefined
          }
        >
          {downloadError && <InlineError>{downloadError}</InlineError>}
          <BsmxEquipmentCard source={source.bsmx} />
          {isAdmin && source.bsmx.equipment && (
            <CalibrationFromBeerSmith suggestion={suggestProfileFromBsmx([{ recipe: doc, ...source.bsmx }])} />
          )}
          {(source.bsmx.warnings.length > 0 || source.bsmx.ignoredMeasuredFields.length > 0) && (
            <details className="group">
              <summary className="flex min-h-11 cursor-pointer items-center gap-1 text-small font-semibold">
                <Icon name="chevronRight" size={18} className="transition group-open:rotate-90" />
                Merknader fra importen
              </summary>
              <div className="mt-2">
                <BsmxImportNotes source={source.bsmx} />
              </div>
            </details>
          )}
        </Section>
      )}

      <Section title="Versjoner">
        <ol className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
          {recipe.data.versions.map((v) => (
            <li key={v.id} className="flex items-baseline gap-3 px-4 py-3">
              <span className="tabular font-semibold">v{v.version}</span>
              <span className="min-w-0 flex-1 text-small">
                {v.changeNote ?? (v.version === 1 ? "Opprettet" : "Endret")}
                {v.kind === "adaptation" && " · tilpasset"}
                <span className="block text-muted">
                  {v.createdBy.name} · {formatDate(v.createdAt)}
                </span>
              </span>
              {v.id === current.id && <StatusChip tone="primary">Gjeldende</StatusChip>}
            </li>
          ))}
        </ol>
        {source && (
          <p className="text-small text-muted">
            Kilde: {sourceLabels[source.kind] ?? source.kind}
            {source.filename && ` · ${source.filename}`}
            {source.url && (
              <>
                {" · "}
                <a href={source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  original
                </a>
              </>
            )}
          </p>
        )}
      </Section>

      {canDelete && (
        <Button variant="ghost" icon="trash" className="text-danger" onClick={() => setConfirmDelete(true)}>
          Slett oppskrift
        </Button>
      )}

      <NewBatchSheet open={creatingBatch} onClose={() => setCreatingBatch(false)} recipeId={recipe.data.id} />
      <ConfirmDialog
        open={confirmDelete}
        title="Slette oppskriften?"
        confirmLabel="Slett"
        danger
        loading={deleteRecipe.isPending}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() =>
          deleteRecipe.mutate(recipe.data.id, {
            onSuccess: () => {
              toast("Oppskriften er slettet");
              navigate("/oppskrifter", { replace: true });
            },
          })
        }
      >
        Batcher som allerede er brygget beholder sin kopi av oppskriften.
      </ConfirmDialog>
    </div>
  );
}

/** Offers the BeerSmith equipment as the starting point for a new calibration version (never applied by itself). */
function CalibrationFromBeerSmith({ suggestion }: { suggestion: ReturnType<typeof suggestProfileFromBsmx> }) {
  const profile = useEquipmentProfile();
  if (!suggestion) return null;
  const activeValues = profile.data
    ? Object.fromEntries(Object.entries(profile.data.values).map(([key, entry]) => [key, entry.value])) as ProfileValues
    : {};
  const warning = compareBsmxEquipmentWithProfile(suggestion, activeValues, Date.now());
  return (
    <Card className="space-y-2">
      {warning && (
        <div role="status" className="rounded-md border border-warning bg-warning-soft p-3 text-small">
          <p className="font-semibold text-warning">Sjekk utstyret</p>
          <p className="mt-1">{warning}</p>
        </div>
      )}
      <p className="text-small text-muted">
        Oppskriftene fra BeerSmith er tunet for anlegget. Fordampning, tap, meskekar og mesketykkelse herfra kan bli
        startpunktet for kalibreringen. Du ser hver verdi før noe lagres.
      </p>
      <Link to="/mer/kalibrering" state={{ profileSuggestion: suggestion }} className={buttonClasses("secondary", "md", true)}>
        <Icon name="sliders" size={20} />
        Bruk som startpunkt i kalibreringen
      </Link>
    </Card>
  );
}
