import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { sunsetIpaRecipe } from "../../domain/fixtures/sunset-ipa.ts";
import { parseBsmx } from "../../domain/import/bsmx.ts";
import { Icon, InlineError, PageHeader, useToast } from "../../design-system/index.ts";
import { useCreateRecipe, useImportBsmx, useRecipes } from "./api.ts";
import { loadSlumpBeerSmithFiles } from "./beersmith/slump.ts";

/** Import entry point (wireframe §36). */
export function ImportRecipePage() {
  const create = useCreateRecipe();
  const importBsmx = useImportBsmx();
  const recipes = useRecipes();
  const navigate = useNavigate();
  const toast = useToast();
  const [importingSlump, setImportingSlump] = useState(false);
  const [slumpError, setSlumpError] = useState<string | null>(null);

  // Slump's own BeerSmith recipes, through the same server import as a picked file (original kept).
  async function importSlumpRecipes() {
    setImportingSlump(true);
    setSlumpError(null);
    const existing = new Set((recipes.data ?? []).map((r) => r.name.toLowerCase()));
    let added = 0;
    try {
      for (const file of await loadSlumpBeerSmithFiles()) {
        const name = parseBsmx(file.text)[0]?.recipe.name.toLowerCase();
        if (!name || existing.has(name)) continue;
        await importBsmx.mutateAsync({ filename: file.name, text: file.text, recipeIndex: 0 });
        added += 1;
      }
      toast(added === 0 ? "Oppskriftene finnes allerede" : added === 1 ? "1 oppskrift er lagt inn" : `${added} oppskrifter er lagt inn`);
      navigate("/oppskrifter");
    } catch (error) {
      setSlumpError(error instanceof Error ? error.message : "Kunne ikke importere oppskriftene.");
    } finally {
      setImportingSlump(false);
    }
  }

  const row = "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left";

  return (
    <>
      <PageHeader back="/oppskrifter" title="Importer oppskrift" subtitle="Hvordan vil du legge inn oppskriften?" />
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        <li>
          <Link to="/oppskrifter?vis=bibliotek" className={`${row} hover:bg-surface-2`}>
            <Icon name="book" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">Finn i oppskriftsbiblioteket</span>
              <span className="block text-small text-muted">415 oppskrifter å søke i og kopiere</span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </Link>
        </li>
        <li>
          <button
            type="button"
            className={`${row} hover:bg-surface-2 disabled:opacity-60`}
            disabled={importingSlump || recipes.isPending}
            onClick={() => void importSlumpRecipes()}
          >
            <Icon name="history" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">{importingSlump ? "Legger inn …" : "Slumps BeerSmith-oppskrifter"}</span>
              <span className="block text-small text-muted">
                Love in a canoe, Cascade Pale Ale – Kveik, Bitter 90l og Aasen Kölsch, tunet for 90–100 L-anlegget
              </span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </button>
        </li>
        <li>
          <Link to="/oppskrifter/importer/beersmith" className={`${row} hover:bg-surface-2`}>
            <Icon name="file" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">BeerSmith-fil (.bsmx)</span>
              <span className="block text-small text-muted">Oppskrift fra BeerSmith 2 eller 3, filen tas vare på</span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </Link>
        </li>
        <li>
          <Link to="/oppskrifter/ny" className={`${row} hover:bg-surface-2`}>
            <Icon name="edit" className="text-primary-strong" />
            <span className="flex-1 font-semibold">Opprett manuelt</span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </Link>
        </li>
        <li>
          <button
            type="button"
            className={`${row} hover:bg-surface-2 disabled:opacity-60`}
            disabled={create.isPending}
            onClick={() =>
              create.mutate(
                { recipe: sunsetIpaRecipe, source: { kind: "example" } },
                {
                  onSuccess: ({ id }) => {
                    toast("Sunset IPA er lagt inn");
                    navigate(`/oppskrifter/${id}`);
                  },
                },
              )
            }
          >
            <Icon name="book" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">Eksempel: Sunset IPA</span>
              <span className="block text-small text-muted">Referansebatchen fra 23. september, 60 L split</span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </button>
        </li>
      </ul>
      {slumpError && (
        <div className="mt-3">
          <InlineError>{slumpError}</InlineError>
        </div>
      )}
      {create.error && (
        <div className="mt-3">
          <InlineError>{create.error.message}</InlineError>
        </div>
      )}
    </>
  );
}
