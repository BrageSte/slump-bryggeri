import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { BSMX_MAX_CHARS } from "../../domain/import/bsmx.ts";
import { sunsetIpaRecipe } from "../../domain/fixtures/sunset-ipa.ts";
import { Icon, InlineError, PageHeader, useToast } from "../../design-system/index.ts";
import { useCreateRecipe } from "./api.ts";
import { BsmxReview, type BsmxFile } from "./BsmxReview.tsx";
import { loadSlumpBeerSmithFiles } from "./beersmith/slump.ts";

/** Import entry point (wireframe §36). */
export function ImportRecipePage() {
  const create = useCreateRecipe();
  const navigate = useNavigate();
  const toast = useToast();
  const [review, setReview] = useState<BsmxFile[] | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [loadingSlump, setLoadingSlump] = useState(false);

  const row = "flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left";

  async function readFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setFileError(null);
    const files: BsmxFile[] = [];
    for (const file of Array.from(list)) {
      if (file.size > BSMX_MAX_CHARS) return setFileError(`${file.name} er for stor.`);
      files.push({ name: file.name, text: await file.text() });
    }
    setReview(files);
  }

  if (review) {
    return (
      <>
        <PageHeader back="/oppskrifter" title="Importer fra BeerSmith" subtitle="Velg hva som skal inn i Slump" />
        <BsmxReview files={review} onCancel={() => setReview(null)} />
      </>
    );
  }

  return (
    <>
      <PageHeader back="/oppskrifter" title="Importer oppskrift" subtitle="Hvordan vil du legge inn oppskriften?" />
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
        <li>
          <button
            type="button"
            className={`${row} hover:bg-surface-2 disabled:opacity-60`}
            disabled={loadingSlump}
            onClick={() => {
              setLoadingSlump(true);
              void loadSlumpBeerSmithFiles()
                .then(setReview)
                .finally(() => setLoadingSlump(false));
            }}
          >
            <Icon name="history" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">Slumps BeerSmith-oppskrifter</span>
              <span className="block text-small text-muted">Fire oppskrifter tunet for 90–100 L-anlegget, med utstyret de ble laget for</span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
          </button>
        </li>
        <li>
          <label className={`${row} cursor-pointer hover:bg-surface-2`}>
            <Icon name="file" className="text-primary-strong" />
            <span className="flex-1">
              <span className="block font-semibold">BeerSmith-fil (.bsmx)</span>
              <span className="block text-small text-muted">Én eller flere filer eksportert fra BeerSmith</span>
            </span>
            <Icon name="chevronRight" size={20} className="text-muted" />
            <input
              type="file"
              accept=".bsmx,application/xml,text/xml"
              multiple
              className="sr-only"
              onChange={(event) => void readFiles(event.target.files)}
            />
          </label>
        </li>
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
      <p className="mt-3 text-small text-muted">Import fra bilde, PDF, BeerXML, nettadresse og innlimt tekst kommer senere.</p>
      {fileError && (
        <div className="mt-3">
          <InlineError>{fileError}</InlineError>
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
