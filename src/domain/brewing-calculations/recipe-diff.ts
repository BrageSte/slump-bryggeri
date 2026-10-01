import type { RecipeDocument } from "../model/recipe.ts";
import { ionKeys, type IonKey } from "../model/water.ts";
import { calculateRecipeMetrics } from "./recipe-metrics.ts";

export interface Change<T> {
  before: T;
  after: T;
}

export interface RecipeMetricsDiff {
  og: Change<number | null>;
  fg: Change<number | null>;
  abvPct: Change<number | null>;
  ibu: Change<number | null>;
  colorEbc: Change<number | null>;
}

export const basicFields = ["name", "style", "batchSizeL", "efficiencyPct", "boilTimeMin"] as const;
export type BasicField = (typeof basicFields)[number];

export interface BasicChange {
  field: BasicField;
  before: string | number | undefined;
  after: string | number | undefined;
}

export interface FermentableState {
  amountKg: number;
}
export interface HopState {
  amountG: number;
  use: string;
  timeMin?: number;
  dayOfFermentation?: number;
}
export interface AmountState {
  amount: number;
  unit: string;
}

export interface ItemChange<T> {
  kind: "added" | "removed" | "changed";
  /** Name in the "after" recipe, or in "before" for removed items. */
  name: string;
  /** Set when a matched item was renamed. */
  previousName?: string;
  before?: T;
  after?: T;
}

export interface WaterTargetChange {
  ion: IonKey;
  before: number | undefined;
  after: number | undefined;
}

export interface RecipeDiff {
  metrics: RecipeMetricsDiff;
  basics: BasicChange[];
  fermentables: ItemChange<FermentableState>[];
  hops: ItemChange<HopState>[];
  cultures: ItemChange<AmountState>[];
  miscs: ItemChange<AmountState>[];
  water: WaterTargetChange[];
  isEmpty: boolean;
}

const normalizeName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Pairs items by id first, then by `key` (normalized name plus whatever else identifies the item). */
function diffItems<I extends { id: string; name: string }, S>(
  before: I[],
  after: I[],
  key: (item: I) => string,
  state: (item: I) => S,
): ItemChange<S>[] {
  const pairs = new Map<I, I>();
  const taken = new Set<I>();
  const pair = (matches: (a: I, b: I) => boolean) => {
    for (const b of before) {
      if (pairs.has(b)) continue;
      const a = after.find((candidate) => !taken.has(candidate) && matches(candidate, b));
      if (a) {
        pairs.set(b, a);
        taken.add(a);
      }
    }
  };
  pair((a, b) => a.id === b.id);
  pair((a, b) => key(a) === key(b));

  const changes: ItemChange<S>[] = [];
  for (const b of before) {
    const a = pairs.get(b);
    if (!a) {
      changes.push({ kind: "removed", name: b.name, before: state(b) });
      continue;
    }
    const renamed = normalizeName(a.name) !== normalizeName(b.name);
    if (renamed || JSON.stringify(state(a)) !== JSON.stringify(state(b))) {
      changes.push({ kind: "changed", name: a.name, ...(renamed ? { previousName: b.name } : {}), before: state(b), after: state(a) });
    }
  }
  for (const a of after) if (!taken.has(a)) changes.push({ kind: "added", name: a.name, after: state(a) });
  return changes;
}

const hopState = (h: RecipeDocument["hops"][number]): HopState => ({
  amountG: h.amountG,
  use: h.use,
  ...(h.timeMin === undefined ? {} : { timeMin: h.timeMin }),
  ...(h.dayOfFermentation === undefined ? {} : { dayOfFermentation: h.dayOfFermentation }),
});

/**
 * What changed between two versions of a recipe: calculated metrics, basics, ingredient lists and
 * planned water. Pure data — the caller formats it (UI text, assistant summary).
 * Items match by id, then by normalized name (plus `use` and `variant` for hops, `variant` for cultures).
 */
export function diffRecipes(before: RecipeDocument, after: RecipeDocument): RecipeDiff {
  const mb = calculateRecipeMetrics(before);
  const ma = calculateRecipeMetrics(after);
  const metric = (k: keyof RecipeMetricsDiff): Change<number | null> => ({ before: mb[k], after: ma[k] });

  const basics = basicFields.flatMap((field) => (before[field] === after[field] ? [] : [{ field, before: before[field], after: after[field] }]));
  const water = ionKeys.flatMap((ion) => {
    const [b, a] = [before.water?.target?.[ion], after.water?.target?.[ion]];
    return b === a ? [] : [{ ion, before: b, after: a }];
  });

  const fermentables = diffItems(before.fermentables, after.fermentables, (f) => normalizeName(f.name), (f) => ({ amountKg: f.amountKg }));
  const hops = diffItems(before.hops, after.hops, (h) => `${normalizeName(h.name)}|${h.use}|${h.variant ?? ""}`, hopState);
  const amountState = (i: { amount: number; unit: string }): AmountState => ({ amount: i.amount, unit: i.unit });
  const cultures = diffItems(before.cultures, after.cultures, (c) => `${normalizeName(c.name)}|${c.variant ?? ""}`, amountState);
  const miscs = diffItems(before.miscs, after.miscs, (m) => normalizeName(m.name), amountState);

  return {
    metrics: { og: metric("og"), fg: metric("fg"), abvPct: metric("abvPct"), ibu: metric("ibu"), colorEbc: metric("colorEbc") },
    basics,
    fermentables,
    hops,
    cultures,
    miscs,
    water,
    isEmpty: [basics, fermentables, hops, cultures, miscs, water].every((list) => list.length === 0),
  };
}
