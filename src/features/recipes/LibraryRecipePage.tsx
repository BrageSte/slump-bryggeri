import { useLocation, useNavigate, useParams } from "react-router";
import { libraryCategoryLabels } from "../../domain/model/library.ts";
import { Button, Card, ErrorState, Icon, InlineError, LoadingState, PageHeader, StatusChip, useToast } from "../../design-system/index.ts";
import { formatNumber } from "../../lib/format.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useCopyFromLibrary, useLibraryRecipe } from "./api.ts";
import { RecipeIngredients, RecipeMetrics } from "./RecipeView.tsx";

/** Read-only view of a library recipe, with "add to our brewery". */
export function LibraryRecipePage() {
  const { libraryId } = useParams();
  const location = useLocation();
  const back = (location.state as { from?: string } | null)?.from ?? "/oppskrifter?vis=bibliotek";
  const recipe = useLibraryRecipe(libraryId);
  const copy = useCopyFromLibrary();
  const { breweryName } = useBrewery();
  const navigate = useNavigate();
  const toast = useToast();

  if (recipe.isPending) {
    return (
      <>
        <PageHeader back={back} title="Laster oppskrift …" />
        <LoadingState />
      </>
    );
  }
  if (recipe.error) {
    return (
      <>
        <PageHeader back={back} title="Oppskriftsbibliotek" />
        <ErrorState error={recipe.error} onRetry={() => void recipe.refetch()} />
      </>
    );
  }

  const r = recipe.data;
  // The description starts with the tagline, which is already the subtitle.
  const description = r.tagline && r.recipe.description?.startsWith(r.tagline)
    ? r.recipe.description.slice(r.tagline.length).trim()
    : r.recipe.description;
  return (
    <div className="space-y-6">
      <PageHeader back={back} eyebrow={<StatusChip>{libraryCategoryLabels[r.category]}</StatusChip>} title={r.name} subtitle={r.tagline} />

      <Card className="space-y-3">
        <p className="text-small text-muted">
          Fra <strong className="text-text">{r.source.name}</strong> · {formatNumber(r.batchSizeL, 0)} L
          {r.source.url && (
            <>
              {" · "}
              <a href={r.source.url} target="_blank" rel="noreferrer" className="font-semibold text-primary-strong underline underline-offset-4">
                Se kilden
              </a>
            </>
          )}
        </p>
        {copy.error && <InlineError>{copy.error.message}</InlineError>}
        <Button
          variant="primary"
          size="lg"
          block
          icon="plus"
          loading={copy.isPending}
          onClick={() =>
            copy.mutate(r.id, {
              onSuccess: ({ id }) => {
                toast(`${r.name} er lagt til`);
                navigate(`/oppskrifter/${id}`);
              },
            })
          }
        >
          Legg til i {breweryName}
        </Button>
        <p className="text-small text-muted">Oppskriften kopieres. Etterpå kan du tilpasse den til volumet og utstyret deres.</p>
      </Card>

      {r.warnings.length > 0 && (
        <details className="rounded-card border border-warning/40 bg-warning-soft p-4">
          <summary className="flex min-h-11 cursor-pointer items-center gap-2 font-semibold text-warning">
            <Icon name="alert" size={20} />
            Tolkning av kilden ({r.warnings.length} {r.warnings.length === 1 ? "merknad" : "merknader"})
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-small">
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}

      {description && <p className="whitespace-pre-line text-muted">{description}</p>}
      <RecipeMetrics recipe={r.recipe} />
      <RecipeIngredients recipe={r.recipe} />
    </div>
  );
}
