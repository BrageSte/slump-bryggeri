import { Link, useSearchParams } from "react-router";
import { buttonClasses, EmptyState, ErrorState, Icon, ListCard, ListLink, LoadingState, PageHeader, SegmentedControl } from "../../design-system/index.ts";
import { formatNumber } from "../../lib/format.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useRecipes } from "./api.ts";
import { LibraryBrowser } from "./LibraryBrowser.tsx";

/** Oppskrifter: the brewery's own recipes, and the library to look up new ones in. */
export function RecipesPage() {
  const [params, setParams] = useSearchParams();
  const { breweryName } = useBrewery();
  const tab = params.get("vis") === "bibliotek" ? "library" : "ours";
  return (
    <>
      <PageHeader title="Oppskrifter" />
      <div className="mb-5">
        <SegmentedControl
          label="Vis"
          value={tab}
          onChange={(value) => setParams(value === "library" ? { vis: "bibliotek" } : {}, { replace: true })}
          options={[
            { value: "ours", label: breweryName.length > 16 ? "Våre" : breweryName },
            { value: "library", label: "Bibliotek" },
          ]}
        />
      </div>
      {tab === "library" ? <LibraryBrowser /> : <OurRecipes />}
    </>
  );
}

function OurRecipes() {
  const recipes = useRecipes();
  if (recipes.isPending) return <LoadingState />;
  if (recipes.error) return <ErrorState error={recipes.error} onRetry={() => void recipes.refetch()} />;

  const importButton = (
    <Link to="/oppskrifter/importer" className={buttonClasses("primary")}>
      <Icon name="plus" size={20} />
      Ny oppskrift
    </Link>
  );

  if (recipes.data.length === 0) {
    return (
      <EmptyState
        icon="book"
        title="Ingen oppskrifter ennå"
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {importButton}
            <Link to="/oppskrifter?vis=bibliotek" className={buttonClasses("secondary")}>
              Finn i biblioteket
            </Link>
          </div>
        }
      >
        Legg inn en egen oppskrift, eller finn en i biblioteket med 415 oppskrifter.
      </EmptyState>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex justify-end">{importButton}</div>
      <ListCard>
        {recipes.data.map((recipe) => (
          <ListLink
            key={recipe.id}
            to={`/oppskrifter/${recipe.id}`}
            title={recipe.name}
            subtitle={[recipe.style, `${formatNumber(recipe.batchSizeL, 0)} L`, `v${recipe.version}`].filter(Boolean).join(" · ")}
          />
        ))}
      </ListCard>
    </div>
  );
}
