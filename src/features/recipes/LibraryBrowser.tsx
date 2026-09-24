import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import type { LibraryRecipeSummary } from "../../domain/model/api.ts";
import { libraryCategoryKeys, libraryCategoryLabels, type LibraryCategory } from "../../domain/model/library.ts";
import { Button, cx, EmptyState, ErrorState, Icon, inputClasses, LoadingState, StatusChip } from "../../design-system/index.ts";
import { formatNumber, formatSg } from "../../lib/format.ts";
import { useDebouncedValue } from "../../lib/use-debounced.ts";
import { useLibrarySearch } from "./api.ts";

function isCategory(value: string | null): value is LibraryCategory {
  return value !== null && (libraryCategoryKeys as readonly string[]).includes(value);
}

export function recipeStats(r: Pick<LibraryRecipeSummary, "abvPct" | "ibu" | "og" | "colorEbc">): string {
  return [
    r.abvPct !== null ? `${formatNumber(r.abvPct, 1)} %` : null,
    r.ibu !== null ? `${formatNumber(r.ibu, 0)} IBU` : null,
    r.og !== null ? `OG ${formatSg(r.og)}` : null,
    r.colorEbc !== null ? `${formatNumber(r.colorEbc, 0)} EBC` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Search in the recipe library. The search text and category live in the URL so that
 * going back from a recipe returns to the same results.
 */
export function LibraryBrowser() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [text, setText] = useState(params.get("q") ?? "");
  const categoryParam = params.get("kategori");
  const category = isCategory(categoryParam) ? categoryParam : null;
  const q = useDebouncedValue(text.trim());
  const search = useLibrarySearch(q, category);

  function update(next: { q?: string; kategori?: LibraryCategory | null }) {
    const merged = new URLSearchParams(params);
    if (next.q !== undefined) {
      if (next.q) merged.set("q", next.q);
      else merged.delete("q");
    }
    if (next.kategori !== undefined) {
      if (next.kategori) merged.set("kategori", next.kategori);
      else merged.delete("kategori");
    }
    setParams(merged, { replace: true });
  }

  const items = search.data?.pages.flatMap((page) => page.items) ?? [];
  const total = search.data?.pages[0]?.total ?? 0;
  const from = `${location.pathname}${location.search}`;

  return (
    <div className="space-y-4">
      <label className="relative block">
        <span className="sr-only">Søk i oppskriftsbiblioteket</span>
        <Icon name="search" size={20} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <input
          type="search"
          value={text}
          enterKeyHint="search"
          onChange={(e) => {
            setText(e.target.value);
            update({ q: e.target.value.trim() });
          }}
          placeholder="Navn, humle, malt eller gjær …"
          className={cx(inputClasses, "min-h-12 pl-10")}
        />
      </label>

      <div role="group" aria-label="Kategori" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden">
        {([null, ...libraryCategoryKeys] as (LibraryCategory | null)[]).map((key) => (
          <button
            key={key ?? "all"}
            type="button"
            aria-pressed={category === key}
            onClick={() => update({ kategori: key })}
            className={cx(
              "min-h-10 shrink-0 rounded-full border px-4 text-small font-semibold whitespace-nowrap",
              category === key ? "border-primary bg-primary text-on-primary" : "border-border bg-surface text-text",
            )}
          >
            {key === null ? "Alle" : libraryCategoryLabels[key]}
          </button>
        ))}
      </div>

      {search.isPending ? (
        <LoadingState rows={4} />
      ) : search.error ? (
        <ErrorState error={search.error} onRetry={() => void search.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="book" title="Ingen treff">
          Prøv et annet ord, for eksempel en humlesort («citra») eller en stil («stout»).
        </EmptyState>
      ) : (
        <>
          <p className="text-small text-muted" aria-live="polite">
            {total} {total === 1 ? "oppskrift" : "oppskrifter"}
          </p>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface">
            {items.map((r) => (
              <li key={r.id}>
                <Link to={`/oppskrifter/bibliotek/${r.id}`} state={{ from }} className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold">{r.name}</span>
                      <StatusChip>{libraryCategoryLabels[r.category]}</StatusChip>
                    </span>
                    {r.tagline && <span className="block truncate text-small text-muted">{r.tagline}</span>}
                    <span className="tabular block text-small">{recipeStats(r)}</span>
                  </span>
                  <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
          {search.hasNextPage && (
            <Button block variant="ghost" loading={search.isFetchingNextPage} onClick={() => void search.fetchNextPage()}>
              Vis flere
            </Button>
          )}
        </>
      )}

      <p className="text-caption text-muted">
        Biblioteket inneholder 415 oppskrifter fra BrewDog DIY Dog (datasett fra{" "}
        <a href="https://github.com/alxiw/punkapi" target="_blank" rel="noreferrer" className="underline">
          punkapi
        </a>
        , MIT). Alle er 20 L og kan tilpasses bryggeriet etter at de er lagt til.
      </p>
    </div>
  );
}
