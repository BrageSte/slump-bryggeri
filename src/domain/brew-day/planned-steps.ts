import type { BrewStage } from "../model/brewing.ts";
import type { RecipeDocument } from "../model/recipe.ts";

export type PlannedStepAction = "measure_temperature" | "start_boil" | "add_ingredient" | "follow_fermentation";

export interface PlannedBrewStep {
  id: string;
  stage: BrewStage;
  title: string;
  targetC?: number;
  durationMin?: number;
  durationDays?: number;
  offsetMin?: number;
  fermentationDay?: number;
  amount?: { value: number; unit: string };
  variant?: string;
  action: PlannedStepAction;
}

/** Returns only steps present in the frozen recipe; missing plan data stays empty. */
export function plannedStepsForStage(recipe: RecipeDocument, stage: BrewStage): PlannedBrewStep[] {
  switch (stage) {
    case "mash":
      return recipe.mashSteps.map((step) => ({
        id: `mash:${step.id}`,
        stage,
        title: step.name,
        targetC: step.temperatureC,
        durationMin: step.durationMin,
        action: "measure_temperature",
      }));
    case "lauter": {
      const steps: PlannedBrewStep[] = [];
      if (recipe.spargeTemperatureC !== undefined) {
        steps.push({ id: "sparge-water", stage, title: "Skyllevann", targetC: recipe.spargeTemperatureC, action: "measure_temperature" });
      }
      for (const hop of recipe.hops.filter((item) => item.use === "first_wort")) {
        steps.push({ id: `hop:${hop.id}`, stage, title: hop.name, amount: { value: hop.amountG, unit: "g" }, variant: hop.variant, action: "add_ingredient" });
      }
      return steps;
    }
    case "boil": {
      const steps: PlannedBrewStep[] = recipe.boilTimeMin > 0
        ? [{ id: "boil", stage, title: "Kok", durationMin: recipe.boilTimeMin, action: "start_boil" }]
        : [];
      for (const hop of recipe.hops.filter((item) => item.use === "boil").sort((a, b) => (b.timeMin ?? 0) - (a.timeMin ?? 0))) {
        steps.push({
          id: `hop:${hop.id}`,
          stage,
          title: hop.name,
          amount: { value: hop.amountG, unit: "g" },
          offsetMin: hop.timeMin,
          variant: hop.variant,
          action: "add_ingredient",
        });
      }
      for (const misc of recipe.miscs.filter((item) => item.use === "boil").sort((a, b) => (b.timeMin ?? 0) - (a.timeMin ?? 0))) {
        steps.push({
          id: `misc:${misc.id}`,
          stage,
          title: misc.name,
          amount: { value: misc.amount, unit: misc.unit },
          offsetMin: misc.timeMin,
          action: "add_ingredient",
        });
      }
      return steps;
    }
    case "whirlpool":
      return [
        ...recipe.hops.filter((item) => item.use === "whirlpool").map((hop) => ({
          id: `hop:${hop.id}`,
          stage,
          title: hop.name,
          targetC: hop.temperatureC,
          durationMin: hop.timeMin,
          amount: { value: hop.amountG, unit: "g" },
          variant: hop.variant,
          action: "add_ingredient" as const,
        })),
        ...recipe.miscs.filter((item) => item.use === "whirlpool").map((misc) => ({
          id: `misc:${misc.id}`,
          stage,
          title: misc.name,
          durationMin: misc.timeMin,
          amount: { value: misc.amount, unit: misc.unit },
          action: "add_ingredient" as const,
        })),
      ];
    case "fermentation":
    case "conditioning":
    case "packaging":
      return [
        ...recipe.fermentationSteps.map((step) => ({
          id: `fermentation:${step.id}`,
          stage,
          title: step.name,
          targetC: step.temperatureC,
          durationDays: step.durationDays,
          action: "follow_fermentation" as const,
        })),
        ...recipe.miscs.filter((item) => item.use === "fermentation" || (stage === "packaging" && item.use === "packaging")).map((misc) => ({
          id: `misc:${misc.id}`,
          stage,
          title: misc.name,
          durationDays: misc.timeMin === undefined ? undefined : misc.timeMin / (24 * 60),
          amount: { value: misc.amount, unit: misc.unit },
          action: "add_ingredient" as const,
        })),
        ...recipe.hops
          .filter((item) => item.use === "dry_hop")
          .sort((a, b) => (a.dayOfFermentation ?? 0) - (b.dayOfFermentation ?? 0))
          .map((hop) => ({
            id: `hop:${hop.id}`,
            stage,
            title: hop.name,
            amount: { value: hop.amountG, unit: "g" },
            fermentationDay: hop.dayOfFermentation,
            variant: hop.variant,
            action: "add_ingredient" as const,
          })),
      ];
    case "cooling":
      return [];
  }
}
