import { useWatch, type Control, type UseFieldArrayReturn, type UseFormGetValues, type UseFormSetValue } from "react-hook-form";
import { buildBrewPlan } from "../../domain/brew-day/brew-plan.ts";
import { solveSaltAdditions, type SaltOption } from "../../domain/brewing-calculations/index.ts";
import { emptyRecipe, type RecipeDocument } from "../../domain/model/recipe.ts";
import { getWaterAgent, ionInfo, ionKeys, isSaltAgent, type PartialIonConcentrations, type WaterAgentId } from "../../domain/model/water.ts";
import { isTotalBrewingWaterAssumed, totalBrewingWaterL } from "../../domain/water/batch-water.ts";
import { slumpBaseWater } from "../../domain/water/slump-water.ts";
import type { ProfileValueSources, ProfileValues } from "../../domain/model/equipment-profile.ts";
import { Button, useToast } from "../../design-system/index.ts";
import { formatAmount, formatNumber } from "../../lib/format.ts";
import { useEquipmentProfile } from "../equipment/api.ts";

/** Names used inside the one-line suggestion. */
const saltNames: Record<string, string> = {
  gypsum: "gips",
  calcium_chloride_dihydrate: "kalsiumklorid",
  calcium_chloride_anhydrous: "kalsiumklorid",
  epsom_salt: "epsomsalt",
  table_salt: "bordsalt",
};

/** Deviations smaller than this (mg/L) are rounding, not worth a note. */
const DEVIATION_NOTE_MG_PER_L = 1;

const positive = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;

type Plan = {
  target: PartialIonConcentrations;
  waterL: number | null;
  assumed: boolean;
};

/** Targets and water volume from whatever parts of the form are already valid. */
function readForm(values: Partial<RecipeDocument>, equipment: ProfileValues, sources: ProfileValueSources): Plan {
  const target: PartialIonConcentrations = {};
  for (const ion of ionKeys) {
    const value = values.water?.target?.[ion];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) target[ion] = value;
  }
  let waterL: number | null = null;
  let assumed = false;
  if (positive(values.batchSizeL) && positive(values.efficiencyPct)) {
    try {
      const plan = buildBrewPlan({
        recipe: {
          ...emptyRecipe(),
          ...values,
          targets: {},
          fermentables: (values.fermentables ?? []).filter((f) => f && positive(f.amountKg)),
          hops: (values.hops ?? []).filter((h) => h && positive(h.amountG)),
          cultures: (values.cultures ?? []).filter((c) => c && positive(c.amount)),
          miscs: [],
          mashSteps: (values.mashSteps ?? []).filter((s) => s && typeof s.temperatureC === "number" && Number.isFinite(s.temperatureC)),
        } as RecipeDocument,
        equipment,
        equipmentSources: sources,
      });
      waterL = totalBrewingWaterL(plan.summary);
      assumed = isTotalBrewingWaterAssumed(plan.summary);
    } catch {
      waterL = null;
    }
  }
  return { target, waterL: waterL !== null && waterL > 0 ? waterL : null, assumed };
}

/**
 * «Foreslå salter»: the grams of gypsum, calcium chloride, Epsom salt and table salt that bring Slump's base water
 * to the ion targets above, short first and the working on demand. Applying it writes ordinary «Andre tilsetninger» rows.
 */
export function SaltSuggestion({
  control,
  getValues,
  setValue,
  miscs,
}: {
  control: Control<RecipeDocument>;
  getValues: UseFormGetValues<RecipeDocument>;
  setValue: UseFormSetValue<RecipeDocument>;
  miscs: UseFieldArrayReturn<RecipeDocument, "miscs">;
}) {
  const toast = useToast();
  const profile = useEquipmentProfile();
  const values = useWatch({ control }) as Partial<RecipeDocument>;
  if (profile.isPending || profile.error) return null;

  const equipment = Object.fromEntries(Object.entries(profile.data?.values ?? {}).map(([k, v]) => [k, v.value])) as ProfileValues;
  const sources = Object.fromEntries(Object.entries(profile.data?.values ?? {}).map(([k, v]) => [k, v.source])) as ProfileValueSources;
  const { target, waterL, assumed } = readForm(values, equipment, sources);

  if (Object.keys(target).length === 0) {
    return <p className="text-small text-muted">Fyll inn mål for kalsium, klorid og/eller sulfat, så regner appen ut saltene.</p>;
  }
  if (waterL === null) {
    return <p className="text-small text-muted">Vannmengden er ukjent til batchvolum og malt er fylt inn, så saltene kan ikke regnes ut ennå.</p>;
  }

  const hasAnhydrous = (values.miscs ?? []).some((misc) => misc?.waterAgent === "calcium_chloride_anhydrous");
  const offered: WaterAgentId[] = ["gypsum", hasAnhydrous ? "calcium_chloride_anhydrous" : "calcium_chloride_dihydrate", "epsom_salt", "table_salt"];
  const options = offered.flatMap((id): SaltOption[] => {
    const agent = getWaterAgent(id);
    return isSaltAgent(agent) ? [{ id, composition: agent.composition }] : [];
  });
  const solution = solveSaltAdditions({ source: slumpBaseWater.ions, target, waterVolumeL: waterL, salts: options });
  const needed = solution.salts.filter((salt) => salt.grams > 0);
  const targetIons = ionKeys.filter((ion) => target[ion] !== undefined);
  const tooHigh = targetIons.filter((ion) => (solution.deviation[ion] ?? 0) > DEVIATION_NOTE_MG_PER_L);
  const tooLow = targetIons.filter((ion) => (solution.deviation[ion] ?? 0) < -DEVIATION_NOTE_MG_PER_L);
  const symbols = (ions: readonly (typeof ionKeys)[number][]) => ions.map((ion) => ionInfo[ion].symbol).join(", ");

  function apply() {
    const rows = getValues("miscs") ?? [];
    for (const salt of solution.salts) {
      const index = rows.findIndex((row) => row.waterAgent === salt.id);
      if (salt.grams <= 0) continue;
      if (index >= 0) {
        setValue(`miscs.${index}.amount`, salt.grams, { shouldDirty: true });
        setValue(`miscs.${index}.unit`, "g", { shouldDirty: true });
      } else {
        const agent = getWaterAgent(salt.id);
        miscs.append({ id: crypto.randomUUID(), name: agent?.shortLabel ?? salt.id, amount: salt.grams, unit: "g", use: "mash", waterAgent: salt.id as WaterAgentId });
      }
    }
    // Offered salts that are no longer needed leave the recipe; highest index first so the others keep their place.
    const unneeded = solution.salts.filter((salt) => salt.grams <= 0).map((salt) => salt.id);
    const stale = rows.flatMap((row, i) => (row.waterAgent && unneeded.includes(row.waterAgent) ? [i] : [])).sort((a, b) => b - a);
    for (const index of stale) miscs.remove(index);
    toast("Saltene er lagt inn under «Andre tilsetninger»");
  }

  return (
    <div className="space-y-1 rounded-md bg-surface-2/40 p-3">
      {needed.length === 0 ? (
        <p className="text-small">Ingen salter trengs, eller kan hjelpe, for disse målene.</p>
      ) : (
        <>
          <p className="tabular text-small">
            <span className="font-semibold">Forslag for ≈ {formatNumber(waterL, 0)} L vann (mesk + skyll):</span>{" "}
            {needed.map((salt) => `${formatAmount(salt.grams, "g")} ${saltNames[salt.id] ?? salt.id}`).join(" · ")}
          </p>
          <Button variant="secondary" icon="plus" onClick={apply}>
            Legg inn som tilsetninger
          </Button>
        </>
      )}
      <details>
        <summary className="min-h-11 cursor-pointer py-2 text-small font-semibold text-primary-strong">Hva det gir</summary>
        <dl className="tabular grid grid-cols-[1fr_auto] gap-y-1 text-small">
          {targetIons.map((ion) => (
            <div key={ion} className="contents">
              <dt className="text-muted">{ionInfo[ion].name} ({ionInfo[ion].symbol})</dt>
              <dd>
                {formatNumber(target[ion], 0)} → {formatNumber(solution.result[ion], 0)} mg/L
              </dd>
            </div>
          ))}
        </dl>
        <ul className="mt-2 space-y-1 text-small text-muted">
          <li>Regnet fra {slumpBaseWater.name}. Syre er ikke regnet med.</li>
          {assumed && <li>Vannmengden bygger på antatte verdier; vei saltene etter faktisk vannmengde.</li>}
          {tooHigh.length > 0 && <li>Salter kan bare legge til, ikke fjerne: {symbols(tooHigh)} i kildevannet er allerede over målet.</li>}
          {tooLow.length > 0 && <li>Målet for {symbols(tooLow)} nås ikke med disse saltene sammen med de andre målene.</li>}
        </ul>
      </details>
    </div>
  );
}
