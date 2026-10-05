import type { AssistantCitation, AssistantReplyAction } from "../../domain/model/api.ts";
import { assistantWebSourceForUrl } from "../../domain/model/assistant-sources.ts";
import { eventTypeLabels, measurementKindSpecs, type BrewStage } from "../../domain/model/brewing.ts";

export function starterQuestions(stage: BrewStage | null): string[] {
  const calibration = "Hva sier dette brygget om kalibreringen vår?";
  if (stage === null || stage === "mash" || stage === "lauter") {
    return ["Hvor mye vann skal jeg varme opp, og til hvilken temperatur?", "Mesken ble for kald. Hva gjør jeg?", calibration];
  }
  if (stage === "boil" || stage === "whirlpool") {
    return ["Hva er neste humletilsetning, og hvor mye?", "Hvordan ligger vi an mot planlagt volum før kok?", calibration];
  }
  return ["Hvordan ligger vi an mot planen?", "Hva bør vi måle i dag?", calibration];
}

/** Starters for the brewery thread: a recipe, a change to one, and what the brewery's own numbers say. */
export function breweryStarterQuestions(): string[] {
  return [
    "Lag en oppskrift på en humlerik IPA rundt 6 %",
    "Hva bør jeg endre i en av oppskriftene våre?",
    "Hva sier historikken om utstyret vårt?",
  ];
}

const number = (value: number, digits = 1, minimumDigits = 0) => value.toLocaleString("nb-NO", { minimumFractionDigits: minimumDigits, maximumFractionDigits: digits });

export function assistantCitationLabel(citation: AssistantCitation): string | null {
  const source = assistantWebSourceForUrl(citation.url);
  if (!source) return null;
  return citation.title ? `${source.organization} – ${citation.title}` : source.organization;
}

export function assistantActionLabel(action: AssistantReplyAction): string {
  if (action.kind === "recipe_draft") return `Utkast: ${action.recipe.name}`;
  if (action.kind === "log_measurement") {
    const label = action.label || measurementKindSpecs[action.measurementKind].label.toLowerCase();
    const decimals = measurementKindSpecs[action.measurementKind].decimals;
    return `Logg ${label} ${number(action.value, decimals, decimals)} ${action.unit}`;
  }
  if (action.kind === "start_timer") return `Start timer ${number(action.durationMin)} min`;
  if (action.type === "water_added") {
    const volume = typeof action.data.volumeL === "number" ? number(action.data.volumeL) : "?";
    const temperature = typeof action.data.temperatureC === "number" ? number(action.data.temperatureC) : "?";
    return `Logg tilsatt ${volume} L vann ${temperature} °C`;
  }
  if (action.type === "ingredient_added" || action.type === "yeast_pitched") {
    const name = typeof action.data.name === "string" ? action.data.name : "tilsetning";
    const amount = typeof action.data.amount === "number" ? number(action.data.amount) : "";
    const unit = typeof action.data.unit === "string" ? action.data.unit : "";
    return `Logg ${name}${amount ? ` ${amount} ${unit}` : ""}`;
  }
  if (action.type === "comment") return "Legg til notat";
  return `Logg ${eventTypeLabels[action.type] ?? action.type}`;
}

export function assistantStageHint(stage: BrewStage | null): string {
  if (stage === "mash" || stage === "lauter") return "Spør om mesking og vannmengder";
  if (stage === "boil" || stage === "whirlpool") return "Spør om neste humletilsetning";
  if (stage === "fermentation" || stage === "conditioning") return "Spør om gjæring og målinger";
  return "Spør om brygget …";
}
