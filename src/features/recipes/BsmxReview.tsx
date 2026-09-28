import { useMemo, useState } from "react";
import { Link } from "react-router";
import { parseBsmx, BsmxImportError, type BsmxRecipeImport } from "../../domain/import/bsmx.ts";
import { suggestProfileFromBsmx } from "../../domain/import/bsmx-equipment.ts";
import { Button, Card, cx, Icon, InlineError, Section, StatusChip, buttonClasses } from "../../design-system/index.ts";
import { formatNumber } from "../../lib/format.ts";
import { useBrewery } from "../breweries/BreweryContext.tsx";
import { useCreateRecipe, useRecipes } from "./api.ts";

export interface BsmxFile {
  name: string;
  text: string;
}

interface Candidate {
  key: string;
  fileName: string;
  text: string;
  item: BsmxRecipeImport;
}

type Parsed = { candidates: Candidate[]; errors: string[] };

function parseFiles(files: BsmxFile[]): Parsed {
  const candidates: Candidate[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      parseBsmx(file.text).forEach((item, index) => candidates.push({ key: `${file.name}#${index}`, fileName: file.name, text: file.text, item }));
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof BsmxImportError ? error.message : "kunne ikke leses"}`);
    }
  }
  return { candidates, errors };
}

/**
 * Review step for BeerSmith files (M5): see what each recipe contains, including the equipment it
 * was designed for, before anything is saved. Measured brew-sheet values are never imported.
 */
export function BsmxReview({ files, onCancel }: { files: BsmxFile[]; onCancel: () => void }) {
  const { isAdmin } = useBrewery();
  const recipes = useRecipes();
  const create = useCreateRecipe();
  const parsed = useMemo(() => parseFiles(files), [files]);
  const existingNames = useMemo(() => new Set((recipes.data ?? []).map((r) => r.name.toLowerCase())), [recipes.data]);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; name: string }[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Default: everything that is not already in the brewery.
  const chosen = selected ?? new Set(parsed.candidates.filter((c) => !existingNames.has(c.item.recipe.name.toLowerCase())).map((c) => c.key));
  const suggestion = suggestProfileFromBsmx(parsed.candidates.map((c) => c.item));

  async function save() {
    setSaving(true);
    setSaveError(null);
    const done: { id: string; name: string }[] = [];
    for (const candidate of parsed.candidates.filter((c) => chosen.has(c.key))) {
      try {
        const { id } = await create.mutateAsync({ recipe: candidate.item.recipe, source: { kind: "bsmx", originalText: candidate.text } });
        done.push({ id, name: candidate.item.recipe.name });
      } catch (error) {
        setSaveError(`${candidate.item.recipe.name}: ${error instanceof Error ? error.message : "kunne ikke lagres"}`);
        break;
      }
    }
    setSaved(done);
    setSaving(false);
  }

  if (saved) {
    return (
      <div className="space-y-4">
        <Card className="space-y-3">
          <p className="font-semibold">
            {saved.length === 1 ? "1 oppskrift er lagt inn" : `${saved.length} oppskrifter er lagt inn`}
          </p>
          <ul className="space-y-1">
            {saved.map((recipe) => (
              <li key={recipe.id}>
                <Link to={`/oppskrifter/${recipe.id}`} className="text-primary-strong underline underline-offset-4">
                  {recipe.name}
                </Link>
              </li>
            ))}
          </ul>
          {saveError && <InlineError>{saveError}</InlineError>}
        </Card>
        {suggestion && <EquipmentSuggestionCard suggestion={suggestion} isAdmin={isAdmin} />}
        <Link to="/oppskrifter" className={buttonClasses("secondary", "lg", true)}>
          Til oppskriftene
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {parsed.errors.map((error) => (
        <InlineError key={error}>{error}</InlineError>
      ))}
      {parsed.candidates.length === 0 ? (
        <p className="text-muted">Fant ingen oppskrifter i filen.</p>
      ) : (
        <Section title="Oppskrifter">
          <ul className="space-y-2">
            {parsed.candidates.map((candidate) => {
              const { recipe, equipment, waterPlan, warnings, sourceDate } = candidate.item;
              const exists = existingNames.has(recipe.name.toLowerCase());
              const checked = chosen.has(candidate.key);
              return (
                <li key={candidate.key}>
                  <label
                    className={cx(
                      "flex cursor-pointer gap-3 rounded-card border p-4",
                      checked ? "border-primary bg-primary-soft" : "border-border bg-surface",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 size-5 shrink-0 accent-primary"
                      checked={checked}
                      onChange={() => {
                        const next = new Set(chosen);
                        if (checked) next.delete(candidate.key);
                        else next.add(candidate.key);
                        setSelected(next);
                      }}
                    />
                    <span className="min-w-0 flex-1 space-y-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{recipe.name}</span>
                        {exists && <StatusChip tone="warning">Finnes allerede</StatusChip>}
                      </span>
                      <span className="tabular block text-small text-muted">
                        {[recipe.style, `${formatNumber(recipe.batchSizeL, 0)} L`, `kok ${formatNumber(recipe.boilTimeMin, 0)} min`, sourceDate?.slice(0, 4)]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {waterPlan.mashWaterL !== undefined && (
                        <span className="tabular block text-small">
                          Innmesking {formatNumber(waterPlan.mashWaterL, 1)} L
                          {waterPlan.strikeTemperatureC !== undefined && ` ved ${formatNumber(waterPlan.strikeTemperatureC, 1)} °C`}
                        </span>
                      )}
                      {equipment && <span className="block text-small text-muted">Utstyr i BeerSmith: {equipment.name}</span>}
                      {warnings.map((warning) => (
                        <span key={warning} className="flex gap-1.5 text-small text-muted">
                          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
                          {warning}
                        </span>
                      ))}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      <p className="text-small text-muted">
        Målinger fra gamle brygg i BeerSmith importeres ikke. Originalfilen lagres sammen med oppskriften.
      </p>
      {saveError && <InlineError>{saveError}</InlineError>}
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" onClick={onCancel} disabled={saving}>
          Avbryt
        </Button>
        <Button variant="primary" size="lg" loading={saving} disabled={chosen.size === 0} onClick={() => void save()}>
          Legg inn {chosen.size > 0 ? chosen.size : ""}
        </Button>
      </div>
    </div>
  );
}

function EquipmentSuggestionCard({ suggestion, isAdmin }: { suggestion: NonNullable<ReturnType<typeof suggestProfileFromBsmx>>; isAdmin: boolean }) {
  return (
    <Card highlight className="space-y-3">
      <div>
        <p className="font-semibold">Utstyret fra BeerSmith: {suggestion.sourceName}</p>
        <p className="text-small text-muted">
          Fordampning, tap, meskekar og mesketykkelse fra oppskriftene kan bli startpunktet for kalibreringen. Du ser hver verdi
          før noe lagres, og eksisterende batcher påvirkes ikke.
        </p>
      </div>
      {isAdmin ? (
        <Link to="/mer/kalibrering" state={{ profileSuggestion: suggestion }} className={buttonClasses("primary", "md", true)}>
          Se forslag til kalibrering
        </Link>
      ) : (
        <p className="text-small text-muted">Be en administrator åpne importen for å bruke utstyret i kalibreringen.</p>
      )}
    </Card>
  );
}
