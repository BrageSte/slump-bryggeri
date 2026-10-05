import { describe, expect, it } from "vitest";
import { emptyRecipe } from "../../src/domain/model/recipe.ts";
import { assistantActionLabel, assistantCitationLabel, assistantStageHint, breweryStarterQuestions, starterQuestions } from "../../src/features/assistant/conversation.ts";

describe("assistant thread helpers", () => {
  it("offers starter questions for the current brew stage", () => {
    expect(starterQuestions("mash")[0]).toContain("vann");
    expect(starterQuestions("boil")[0]).toContain("humletilsetning");
    expect(starterQuestions("fermentation")[0]).toContain("planen");
    expect(assistantStageHint("fermentation")).toContain("Spør om gjæring");
  });

  it("offers starters for the brewery thread that ask for a recipe, a change and the brewery's own numbers", () => {
    const starters = breweryStarterQuestions();
    expect(starters).toHaveLength(3);
    expect(starters[0]).toContain("oppskrift");
    expect(starters.join(" ")).toContain("historikken");
  });

  it("names a recipe draft by its recipe", () => {
    expect(assistantActionLabel({ kind: "recipe_draft", recipe: emptyRecipe({ name: "Hazy IPA" }), baseRecipeId: null })).toBe("Utkast: Hazy IPA");
  });

  it("formats confirmation labels with Norwegian decimals", () => {
    expect(assistantActionLabel({ kind: "log_measurement", measurementKind: "temperature", value: 64, unit: "°C", label: "mesketemperatur" })).toBe("Logg mesketemperatur 64,0 °C");
    expect(assistantActionLabel({ kind: "log_event", type: "water_added", data: { volumeL: 3.5, temperatureC: 95 } })).toBe("Logg tilsatt 3,5 L vann 95 °C");
    expect(assistantActionLabel({ kind: "start_timer", label: "Humle", durationMin: 10 })).toBe("Start timer 10 min");
  });

  it("labels citations with their brewing source and rejects links outside the allowlist", () => {
    expect(assistantCitationLabel({ url: "https://www.fermentis.com/en/product/safale-us-05/", title: "SafAle US-05" })).toBe("Fermentis – SafAle US-05");
    expect(assistantCitationLabel({ url: "javascript:alert(1)", title: "Unsafe" })).toBeNull();
  });
});
