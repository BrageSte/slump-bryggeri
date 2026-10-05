import { num } from "../format.ts";
import { getProfileParameter, type ProfileParameterKey } from "../model/equipment-profile.ts";
import { ionInfo, ionKeys, type WaterProfile } from "../model/water.ts";

/**
 * The short brief the brewery-level assistant starts every question with: the active equipment profile, the base
 * water and the recipes. Everything else (a recipe's contents, the brewery's history) is fetched with a tool
 * when the question needs it, so the brief stays small and the prompt cache holds.
 */

export interface BreweryBriefInput {
  breweryName: string;
  equipment: {
    name: string;
    version: number;
    values: Record<string, { value: number; source: "manual" | "calibration" | "default" }>;
  } | null;
  baseWater: WaterProfile;
  /** All recipes, newest first. */
  recipes: { name: string; style: string | null }[];
}

/** Profile values worth knowing before designing a recipe, in reading order. */
const shownProfileKeys: ProfileParameterKey[] = [
  "batch_volume_l",
  "brewhouse_efficiency_pct",
  "boil_off_l_per_h",
  "mash_thickness_l_per_kg",
  "mash_tun_volume_l",
  "kettle_volume_l",
  "fermenter_capacity_l",
];

const sourceLabels = { manual: "satt for hånd", calibration: "kalibrert", default: "≈ antatt standard" } as const;
const RECENT_RECIPES = 10;

export function buildBreweryBrief(input: BreweryBriefInput): string {
  const lines: string[] = [`# Bryggeriet: ${input.breweryName}`, ""];

  if (input.equipment) {
    lines.push(`## Utstyrsprofil (versjon ${input.equipment.version}, «${input.equipment.name}»)`);
    for (const key of shownProfileKeys) {
      const parameter = getProfileParameter(key);
      if (!parameter) continue;
      const entry = input.equipment.values[key];
      const value = entry?.value ?? parameter.defaultValue;
      if (value === undefined) continue;
      const source = entry?.source ?? "default";
      lines.push(`- ${parameter.label}: ${num(value, 2)} ${parameter.unit} (${sourceLabels[source]})`);
    }
  } else {
    lines.push("## Utstyrsprofil", "- Ingen aktiv utstyrsprofil. Spør bryggeren om batchstørrelse og effektivitet i stedet for å anta dem.");
  }

  const water = input.baseWater;
  const ions = ionKeys.map((key) => `${ionInfo[key].symbol} ${num(water.ions[key], 1)}`).join(" · ");
  lines.push(
    "",
    "## Basisvann (oppgitt av leverandør, ikke målt av oss)",
    `- ${water.name}: ${ions} mg/L${water.alkalinityMmolL !== undefined ? `; alkalitet ${num(water.alkalinityMmolL, 2)} mmol/L` : ""}. Tas som gitt; trenger ingen egen vannanalyse.`,
  );

  lines.push("", "## Oppskrifter");
  if (input.recipes.length === 0) {
    lines.push("- Ingen oppskrifter ennå.");
  } else {
    const shown = input.recipes.slice(0, RECENT_RECIPES).map((recipe) => (recipe.style ? `${recipe.name} (${recipe.style})` : recipe.name));
    lines.push(`- ${input.recipes.length} oppskrifter. Nyeste: ${shown.join("; ")}.`);
  }
  lines.push("", "Hent oppskrifter med list_recipes og get_recipe, og bryggeriets målte historikk med brewery_history.");
  return lines.join("\n");
}
