import { calculateAbv } from "../brewing-calculations/abv.ts";
import { calculateEfficiency } from "../brewing-calculations/gravity.ts";
import { inferLibraryCategory, libraryCategoryLabels, type LibraryCategory } from "../model/library.ts";
import {
  RECIPE_SCHEMA_VERSION,
  type Culture,
  type Fermentable,
  type FermentableType,
  type HopAddition,
  type MashStep,
  type Misc,
  type RecipeDocument,
} from "../model/recipe.ts";

/**
 * Import adapter: BrewDog "DIY Dog" recipes in Punk API JSON (github.com/alxiw/punkapi, MIT)
 * → normalized RecipeDocument.
 *
 * The source data was transcribed by hand from the DIY Dog PDF and is inconsistent
 * (hop timing as "start"/"Middle"/"Dry Hop, at Day 6"/"WHP", fruit and oak listed as hops,
 * missing mash times). Every guess made here is reported in `warnings` so the UI can show it,
 * and the original JSON is kept alongside the normalized recipe (spec §9).
 */

interface Amount {
  value: number;
  unit: string;
}

export interface DiyDogBeer {
  id: number;
  name: string;
  tagline?: string | null;
  first_brewed?: string | null;
  description?: string | null;
  abv?: number | null;
  ibu?: number | null;
  target_fg?: number | null;
  target_og?: number | null;
  ebc?: number | null;
  attenuation_level?: number | null;
  volume: Amount;
  method: {
    mash_temp?: { temp: Amount; duration: number | null }[] | null;
    fermentation?: { temp?: Amount | null } | null;
    twist?: string | null;
  };
  ingredients: {
    malt: { name: string; amount: Amount }[];
    hops: { name: string; amount: Amount; add: string; attribute: string | null }[];
    yeast: string | null;
  };
  brewers_tips?: string | null;
}

export interface ConvertedLibraryRecipe {
  recipe: RecipeDocument;
  category: LibraryCategory;
  warnings: string[];
}

const DEFAULT_BOIL_MIN = 60;
const DEFAULT_EFFICIENCY = 75;

const SUGAR = /sugar|dextrose|glucose|honey|syrup|candi|maple|molass|muscovado|muscavado/i;
// Fruit, spices, sugars, wood … listed among the hops in the source. (Hop extracts stay hops;
// "Mandarina Bavaria" is a hop, hence mandarin(?!a).)
const NOT_A_HOP = new RegExp(
  [
    "juice", "concentrate", "puree", "mango", "chil+i", "habanero", "habenero", "coffee", "cascara", "sugar",
    "muscovado", "muscavado", "honey", "syrup", "lactose", "marshmallow", "oak", "segment", "mandarin(?!a)",
    "tangerine", "peel", "zest", "berr", "currant", "cherr", "plum", "coconut", "vanilla", "cacao", "cacoa",
    "cocoa", "nibs", "ginger", "lemongrass", "lime", "lemon", "orange", "grapefruit", "apricot", "peach",
    "passion", "pepper", "spruce", "heather", "juniper", "elderflower", "jasmine", "rosemary", "bay lea",
    "cardamo", "cinnamon", "coriander", "nutmeg", "anis", "poppy", "guarana", "kola", "powder", "salt",
    "sodium", "chloride", "seaweed", "husk", "caramalt",
  ].join("|"),
  "i",
);

function toKg(amount: Amount): number | null {
  if (amount.unit === "kilograms" || amount.unit === "kilogram") return amount.value;
  if (amount.unit === "grams") return amount.value / 1000;
  return null;
}

function toGrams(amount: Amount): number | null {
  if (amount.unit === "grams") return amount.value;
  if (amount.unit === "kilograms" || amount.unit === "kilogram") return amount.value * 1000;
  return null;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** 1056 → 1.056. The dataset stores gravities as integers. */
function gravity(value: number | null | undefined): number | undefined {
  if (typeof value !== "number" || value < 990 || value > 1200) return undefined;
  return value / 1000;
}

type Timing =
  | { use: "boil"; timeMin: number }
  | { use: "first_wort" | "mash" | "whirlpool" }
  | { use: "dry_hop"; day?: number; note?: string }
  | { use: "aging" }
  | { use: "unknown" };

function parseTiming(add: string, boilTimeMin: number): Timing {
  const a = add.trim().toLowerCase();
  if (a === "start" || a === "kettle" || a === "additions") return { use: "boil", timeMin: boilTimeMin };
  if (a === "middle") return { use: "boil", timeMin: Math.round(boilTimeMin / 2) };
  if (a === "end" || a === "flame out" || a === "flameout") return { use: "boil", timeMin: 0 };
  if (/^\d+$/.test(a)) return { use: "boil", timeMin: Math.min(Number(a), boilTimeMin) };
  if (a === "whirlpool" || a === "whp") return { use: "whirlpool" };
  if (a === "first wort hops" || a === "fwh") return { use: "first_wort" };
  if (a === "mash") return { use: "mash" };
  if (a === "wood ageing" || a === "wood aging") return { use: "aging" };
  const day = /day\s*(\d+)/.exec(a);
  if (day) return { use: "dry_hop", day: Number(day[1]) };
  if (a === "hd1" || a === "hd2") return { use: "dry_hop", note: a === "hd1" ? "Tørrhumling 1" : "Tørrhumling 2" };
  if (/dry hop|^fv|secondary|maturation/.test(a)) return { use: "dry_hop" };
  return { use: "unknown" };
}

function cultureForm(name: string): Culture["form"] {
  if (/wyeast|wlp|white labs|imperial/i.test(name)) return "liquid";
  if (/safale|saflager|safbrew|fermentis|lallemand|nottingham|danstar|us-?05|s-?04|w-?34|\bdry\b|mangrove|m\d\d\b/i.test(name)) return "dry";
  return "other";
}

export function boilTimeFor(beer: DiyDogBeer): number {
  const numeric = beer.ingredients.hops.map((h) => h.add.trim()).filter((a) => /^\d+$/.test(a)).map(Number);
  return Math.max(DEFAULT_BOIL_MIN, ...numeric);
}

export function convertDiyDogBeer(beer: DiyDogBeer): ConvertedLibraryRecipe {
  const warnings: string[] = [];
  const boilTimeMin = boilTimeFor(beer);

  // Fermentables (a few "malts" are sugars, or peel/spices given in grams)
  const fermentables: Fermentable[] = [];
  const miscs: Misc[] = [];
  beer.ingredients.malt.forEach((malt, i) => {
    const kg = toKg(malt.amount);
    if (kg === null || kg <= 0) {
      warnings.push(`Hoppet over «${malt.name}»: ukjent mengde (${malt.amount.value} ${malt.amount.unit}).`);
      return;
    }
    if (malt.amount.unit === "grams" && !SUGAR.test(malt.name)) {
      miscs.push({ id: `m${i + 1}`, name: malt.name, amount: malt.amount.value, unit: "g", use: "boil", timeMin: 10 });
      warnings.push(`«${malt.name}» sto under malt; lagt inn som tilsetning i kok (10 min) — tidspunkt er antatt.`);
      return;
    }
    const type: FermentableType = /lactose/i.test(malt.name) ? "other" : SUGAR.test(malt.name) ? "sugar" : "grain";
    fermentables.push({ id: `f${i + 1}`, name: malt.name, type, amountKg: round(kg, 3) });
  });

  // Hops (and the non-hop additions listed among them)
  const hops: HopAddition[] = [];
  beer.ingredients.hops.forEach((hop, i) => {
    const timing = parseTiming(hop.add, boilTimeMin);
    const grams = toGrams(hop.amount);
    const alpha = /([\d.]+)\s*%\s*alpha/i.exec(hop.attribute ?? "");
    const isHop = !NOT_A_HOP.test(hop.name) && timing.use !== "aging" && grams !== null;

    if (!isHop) {
      const use: Misc["use"] =
        timing.use === "boil" ? "boil" : timing.use === "mash" ? "mash" : timing.use === "whirlpool" ? "whirlpool" : "fermentation";
      const unit = grams !== null ? "g" : hop.amount.unit === "ml" ? "ml" : "stk";
      const amount = grams ?? hop.amount.value;
      if (amount <= 0) return;
      miscs.push({
        id: `x${i + 1}`,
        name: hop.name,
        amount: round(amount, 1),
        unit,
        use,
        timeMin: timing.use === "boil" ? timing.timeMin : undefined,
        notes: timing.use === "aging" ? "Fatlagring / treflis" : undefined,
      });
      return;
    }
    if (!grams || grams <= 0) return;

    let addition: HopAddition;
    switch (timing.use) {
      case "boil":
        addition = { id: `h${i + 1}`, name: hop.name, amountG: round(grams, 1), use: "boil", timeMin: timing.timeMin };
        break;
      case "dry_hop":
        addition = {
          id: `h${i + 1}`,
          name: hop.name,
          amountG: round(grams, 1),
          use: "dry_hop",
          dayOfFermentation: timing.day,
          notes: timing.note,
        };
        break;
      case "whirlpool":
        addition = { id: `h${i + 1}`, name: hop.name, amountG: round(grams, 1), use: "whirlpool" };
        break;
      case "first_wort":
        addition = { id: `h${i + 1}`, name: hop.name, amountG: round(grams, 1), use: "first_wort", timeMin: boilTimeMin };
        break;
      case "mash":
        addition = { id: `h${i + 1}`, name: hop.name, amountG: round(grams, 1), use: "mash" };
        break;
      default:
        addition = { id: `h${i + 1}`, name: hop.name, amountG: round(grams, 1), use: "boil", timeMin: 0 };
        warnings.push(`Ukjent tidspunkt «${hop.add}» for ${hop.name}; lagt inn ved slutten av kok.`);
    }
    if (alpha) addition.alphaPct = Number(alpha[1]);
    hops.push(addition);
  });
  if (hops.length > 0 && hops.every((h) => h.alphaPct === undefined)) {
    warnings.push("Kilden oppgir ikke alfasyre. IBU vises fra oppskriftens mål; legg inn alfasyre for egne beregninger.");
  }

  // Yeast
  const cultures: Culture[] = [];
  if (beer.ingredients.yeast) {
    const attenuation = beer.attenuation_level;
    cultures.push({
      id: "y1",
      name: beer.ingredients.yeast.trim(),
      form: cultureForm(beer.ingredients.yeast),
      amount: 1,
      unit: "pkg",
      attenuationPct: typeof attenuation === "number" && attenuation > 0 && attenuation <= 100 ? round(attenuation, 1) : undefined,
    });
  } else {
    warnings.push("Kilden oppgir ikke gjær.");
  }

  // Mash
  const mashSource = beer.method.mash_temp ?? [];
  const mashSteps: MashStep[] = [];
  mashSource.forEach((step, i) => {
    const temp = step.temp?.value;
    if (typeof temp !== "number" || temp < 30 || temp > 80) {
      warnings.push(`Meskesteg ${i + 1} har ingen gyldig temperatur i kilden; utelatt.`);
      return;
    }
    if (step.duration == null) warnings.push(`Meskesteg ${i + 1} mangler varighet; satt til 60 min.`);
    mashSteps.push({
      id: `ms${i + 1}`,
      name: mashSource.length === 1 ? "Mesk" : `Steg ${i + 1}`,
      temperatureC: temp,
      durationMin: step.duration ?? 60,
    });
  });

  // Transcription errors exist (e.g. 99 °C); only keep plausible fermentation temperatures.
  let fermentationTemp = beer.method.fermentation?.temp?.value;
  if (typeof fermentationTemp === "number" && (fermentationTemp < 0 || fermentationTemp > 40)) {
    warnings.push(`Gjæringstemperaturen ${fermentationTemp} °C i kilden er åpenbart feil; utelatt.`);
    fermentationTemp = undefined;
  }
  const og = gravity(beer.target_og);
  const fgRaw = gravity(beer.target_fg);
  const fg = og !== undefined && fgRaw !== undefined && fgRaw < og ? fgRaw : undefined;

  // Efficiency: back-calculated from the recipe's own OG with typical malt yields, so that scaling
  // to our brewhouse keeps the intended gravity. Falls back to 75 % when the result is implausible.
  let efficiencyPct = DEFAULT_EFFICIENCY;
  if (og !== undefined && fermentables.some((f) => f.type === "grain")) {
    const efficiency = calculateEfficiency({ fermentables, sg: og, volumeL: beer.volume.value });
    if (efficiency >= 45 && efficiency <= 95) efficiencyPct = Math.round(efficiency);
    else {
      warnings.push(
        `Malt og OG i kilden gir ${Math.round(efficiency)} % effektivitet, som ikke er realistisk — trolig en feil i kilden. Bruker ${DEFAULT_EFFICIENCY} %.`,
      );
    }
  }

  // Plausibility checks: flag, never silently "fix", obvious transcription errors in the source.
  if (og !== undefined && fg !== undefined && typeof beer.abv === "number" && beer.abv < 20) {
    const implied = calculateAbv(og, fg);
    if (Math.abs(implied - beer.abv) > 1.5) {
      warnings.push(`OG/FG i kilden gir ${implied.toFixed(1)} % ABV, men oppgitt ABV er ${beer.abv} % — sjekk tallene.`);
    }
  }
  const kgPerLitre = fermentables.reduce((sum, f) => sum + f.amountKg, 0) / beer.volume.value;
  if (kgPerLitre > 0.6) {
    warnings.push(`${fermentables.reduce((sum, f) => sum + f.amountKg, 0).toFixed(1)} kg malt til ${beer.volume.value} L er urealistisk — trolig en feil i kilden.`);
  }

  const notes = [
    beer.brewers_tips ? `Bryggetips: ${beer.brewers_tips.trim()}` : null,
    beer.method.twist ? `Twist: ${beer.method.twist.trim()}` : null,
    beer.first_brewed ? `Først brygget: ${beer.first_brewed}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const category = inferLibraryCategory(beer.name, beer.tagline ?? "", beer.description ?? "");

  const recipe: RecipeDocument = {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    name: beer.name.trim().slice(0, 120),
    style: category === "other" ? undefined : libraryCategoryLabels[category],
    description: [beer.tagline, beer.description].filter(Boolean).join("\n\n").slice(0, 4000) || undefined,
    author: "BrewDog (DIY Dog)",
    batchSizeL: beer.volume.value,
    boilTimeMin,
    efficiencyPct,
    fermentables,
    hops,
    cultures,
    miscs,
    mashSteps,
    fermentationSteps:
      typeof fermentationTemp === "number"
        ? [{ id: "fs1", name: "Primærgjæring", temperatureC: fermentationTemp }]
        : [],
    targets: {
      og,
      fg,
      ibu: typeof beer.ibu === "number" ? beer.ibu : undefined,
      abvPct: typeof beer.abv === "number" ? beer.abv : undefined,
      colorEbc: typeof beer.ebc === "number" ? beer.ebc : undefined,
    },
    notes: notes ? notes.slice(0, 10_000) : undefined,
  };

  return { recipe, category, warnings };
}

/** Lower-cased text the library search matches against: name, tagline and every ingredient. */
export function diyDogSearchText(beer: DiyDogBeer, categoryLabel: string): string {
  return [
    beer.name,
    beer.tagline,
    categoryLabel,
    ...beer.ingredients.malt.map((m) => m.name),
    ...beer.ingredients.hops.map((h) => h.name),
    beer.ingredients.yeast,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
