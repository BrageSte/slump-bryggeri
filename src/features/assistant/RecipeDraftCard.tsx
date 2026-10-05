import { Link } from "react-router";
import { buttonClasses } from "../../design-system/index.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { calculateRecipeMetrics } from "../../domain/brewing-calculations/index.ts";
import type { AssistantRecipeDraft } from "../../domain/model/api.ts";
import { formatNumber, formatSg } from "../../lib/format.ts";
import { RecipeIngredients } from "../recipes/RecipeView.tsx";

/**
 * A recipe the assistant designed. The numbers are the app's own calculation from the ingredients (the same
 * `calculateRecipeMetrics` as the recipe page), never the model's; the recipe's own targets are not shown in their place.
 * Short first: name and key numbers, and the whole recipe on request.
 */
export function RecipeDraftCard({ draft, request }: { draft: AssistantRecipeDraft; request: string }) {
  const { breweryId } = useBrewery();
  const editorPath = draft.baseRecipeId ? `/oppskrifter/${draft.baseRecipeId}/rediger` : "/oppskrifter/ny";
  const state = (brewAfterSave: boolean) => ({ assistantDraft: { breweryId, recipe: draft.recipe, baseRecipeId: draft.baseRecipeId, baseVersionId: draft.baseVersionId, request, brewAfterSave } });
  const { recipe } = draft;
  const metrics = calculateRecipeMetrics(recipe);
  const figures = [
    `OG ${formatSg(metrics.og)}`,
    `FG ${formatSg(metrics.fg)}`,
    `${formatNumber(metrics.abvPct, 1)} % ABV`,
    `${formatNumber(metrics.ibu, 0)} IBU`,
    `${formatNumber(metrics.colorEbc, 0)} EBC`,
    `${formatNumber(recipe.batchSizeL, 0)} L`,
  ];
  return (
    <div className="space-y-1 rounded-md border border-border bg-surface-2/60 p-3 text-left" data-testid="recipe-draft">
      <p className="text-caption text-muted">{draft.baseRecipeId ? "Utkast til ny versjon av en oppskrift" : "Utkast til ny oppskrift"}</p>
      <p className="font-semibold">
        {recipe.name}
        {recipe.style && <span className="font-normal text-muted"> · {recipe.style}</span>}
      </p>
      <p className="tabular text-small">{figures.join(" · ")}</p>
      <p className="text-caption text-muted">Beregnet av appen fra ingrediensene. Utkastet er ikke lagret.</p>
      <div className="flex flex-wrap gap-2 pt-2">
        <Link to={editorPath} state={state(false)} className={buttonClasses("primary")}>Åpne utkast</Link>
        <Link to={editorPath} state={state(true)} className={buttonClasses("secondary")}>Brygg denne</Link>
      </div>
      <p className="text-caption text-muted">Se over og lagre oppskriften før du oppretter en batch.</p>
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-small font-semibold text-primary-strong">Vis hele utkastet</summary>
        <div className="pt-2">
          <RecipeIngredients recipe={recipe} />
        </div>
      </details>
    </div>
  );
}
