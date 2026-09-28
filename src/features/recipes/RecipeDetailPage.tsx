import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, buttonClasses, ConfirmDialog, ErrorState, Icon, LoadingState, PageHeader, Section, StatusChip, useToast } from "../../design-system/index.ts";
import { formatDate } from "../../lib/format.ts";
import { useMe } from "../auth/session.ts";
import { NewBatchSheet } from "../batches/NewBatchSheet.tsx";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useDeleteRecipe, useRecipe } from "./api.ts";
import { RecipeIngredients, RecipeMetrics } from "./RecipeView.tsx";

const sourceLabels: Record<string, string> = {
  manual: "Lagt inn manuelt",
  example: "Eksempeloppskrift",
  library: "Oppskriftsbiblioteket (BrewDog DIY Dog)",
  bsmx: "BeerSmith (.bsmx)",
  beerxml: "BeerXML",
  beerjson: "BeerJSON",
  text: "Innlimt tekst",
  url: "Nettside",
  image: "Bilde",
  pdf: "PDF",
};

export function RecipeDetailPage() {
  const { recipeId } = useParams();
  const recipe = useRecipe(recipeId);
  const me = useMe();
  const { isAdmin } = useBrewery();
  const deleteRecipe = useDeleteRecipe();
  const navigate = useNavigate();
  const toast = useToast();
  const [creatingBatch, setCreatingBatch] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (recipe.isPending) return <LoadingState />;
  if (recipe.error) {
    return (
      <>
        <PageHeader back="/oppskrifter" title="Oppskrift" />
        <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />
      </>
    );
  }

  const { current } = recipe.data;
  const doc = current.data;
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
        {recipe.data.source && (
          <p className="text-small text-muted">
            Kilde: {sourceLabels[recipe.data.source.kind] ?? recipe.data.source.kind}
            {recipe.data.source.url && (
              <>
                {" · "}
                <a href={recipe.data.source.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
                  original
                </a>
              </>
            )}
            {recipe.data.source.kind === "bsmx" && recipe.data.source.originalText && (
              <>
                {" · "}
                <a
                  href={`data:application/xml;charset=utf-8,${encodeURIComponent(recipe.data.source.originalText)}`}
                  download={`${recipe.data.name}.bsmx`}
                  className="underline underline-offset-4"
                >
                  last ned originalfilen
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
