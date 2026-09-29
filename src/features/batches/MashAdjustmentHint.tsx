import { useState } from "react";
import type { BrewDayLogEntry } from "../../domain/brew-day/state.ts";
import { suggestMashTemperatureAdjustment } from "../../domain/brew-day/mash-adjustment.ts";
import type { ProfileValueSources, ProfileValues } from "../../domain/model/equipment-profile.ts";
import type { RecipeDocument } from "../../domain/model/recipe.ts";
import type { BrewStage } from "../../domain/model/brewing.ts";
import { Button } from "../../design-system/index.ts";
import { formatNumber, formatTime } from "../../lib/format.ts";

export function MashAdjustmentHint({
  recipe,
  equipment,
  equipmentSources,
  log,
  stage,
  stageStartedAt,
  now,
  onAddWater,
  busy,
}: {
  recipe: RecipeDocument;
  equipment: ProfileValues;
  equipmentSources?: ProfileValueSources;
  log: readonly BrewDayLogEntry[];
  stage: BrewStage | null;
  stageStartedAt: number | null;
  now: number;
  onAddWater: (volumeL: number, temperatureC: number) => void;
  busy: boolean;
}) {
  const [chosenTemperatureC, setChosenTemperatureC] = useState<number | null>(null);
  const input = { recipe, equipment, equipmentSources, log, stage, stageStartedAt, now };
  const baseline = suggestMashTemperatureAdjustment(input);
  if ("waterAddedAt" in baseline) {
    return (
      <p className="rounded-md bg-surface-2 p-3 text-small">
        <span className="tabular">{formatNumber(baseline.waterAddedL, 1)} L</span> vann tilsatt kl. {formatTime(baseline.waterAddedAt)}. Rør om og
        logg mesketemperaturen på nytt før du tilsetter mer.
      </p>
    );
  }
  if (!("direction" in baseline)) return null;

  const temperatures = baseline.direction === "raise" ? [90, 95, 100] : [5, 10, 15];
  const additionTempC = chosenTemperatureC !== null && temperatures.includes(chosenTemperatureC)
    ? chosenTemperatureC
    : baseline.additionTempC;
  const suggestion = additionTempC === baseline.additionTempC
    ? baseline
    : suggestMashTemperatureAdjustment({ ...input, additionTempC });
  if (!("direction" in suggestion)) return null;

  const volume = formatNumber(suggestion.additionL, 1);
  const temperature = formatNumber(suggestion.additionTempC, 0);
  const target = formatNumber(suggestion.targetC, 1);
  const mashWater = formatNumber(suggestion.mashWaterL, 1);
  const grain = formatNumber(suggestion.grainKg, 2);
  const waterDescription = suggestion.direction === "raise" ? "vann" : "kaldt vann";
  const action = suggestion.direction === "raise" ? "for å nå" : "for å senke mesken til";

  return (
    <div className="space-y-3 rounded-md bg-surface-2 p-3">
      <p className="font-semibold">
        Tilsett ca. <span className="tabular">{volume} L</span> {waterDescription} på{" "}
        <span className="tabular">{temperature} °C</span> {action} <span className="tabular">{target} °C</span>
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Temperatur på vannet">
        {temperatures.map((value) => (
          <Button
            key={value}
            size="md"
            variant={suggestion.additionTempC === value ? "secondary" : "ghost"}
            aria-pressed={suggestion.additionTempC === value}
            aria-label={`Velg vann på ${value} °C`}
            onClick={() => setChosenTemperatureC(value)}
          >
            {value} °C
          </Button>
        ))}
      </div>
      <p className="text-small text-muted">
        {suggestion.mashWaterSource === "measured" ? "Bruker loggført" : suggestion.mashWaterSource === "recipe" ? "Bruker oppskriftens" : suggestion.mashWaterSource === "assumed" ? `Bruker antatt${suggestion.mashWaterAssumptions?.length ? ` (${suggestion.mashWaterAssumptions.join(", ")})` : ""}` : "Bruker beregnet"} {mashWater} L meskevann og {grain} kg korn.
        Varmetap i meskekaret er ikke medregnet.
      </p>
      <Button variant="primary" onClick={() => onAddWater(suggestion.additionL, suggestion.additionTempC)} loading={busy}>
        Logg tilsatt vann
      </Button>
    </div>
  );
}
