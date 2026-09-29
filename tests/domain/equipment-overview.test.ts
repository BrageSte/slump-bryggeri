import { describe, expect, it } from "vitest";
import { equipmentOverview } from "../../src/domain/brew-day/equipment-overview.ts";
import { defaultProfileValues } from "../../src/domain/model/equipment-profile.ts";

const row = (overview: ReturnType<typeof equipmentOverview>, key: string) => overview.rows.find((r) => r.key === key);

describe("equipment overview", () => {
  it("marks documented defaults as assumed and values without a default as missing", () => {
    const overview = equipmentOverview({ values: {}, recipeBatchSizeL: 60 });
    expect(row(overview, "boil_off_l_per_h")).toMatchObject({ status: "assumed", value: 5, unit: "L/h" });
    expect(row(overview, "brewhouse_efficiency_pct")).toMatchObject({ status: "assumed", value: 72 });
    expect(row(overview, "batch_volume_l")).toMatchObject({ status: "missing", value: null });
  });

  it("treats a stored default as assumed even when the profile carries its value", () => {
    const values = defaultProfileValues();
    const sources = Object.fromEntries(Object.keys(values).map((key) => [key, "default" as const]));
    const overview = equipmentOverview({ values, sources, recipeBatchSizeL: 60 });
    expect(overview.rows.filter((r) => r.status === "assumed").map((r) => r.key)).toEqual([
      "brewhouse_efficiency_pct",
      "boil_off_l_per_h",
      "mash_thickness_l_per_kg",
      "grain_absorption_l_per_kg",
      "strike_temp_offset_c",
    ]);
  });

  it("separates calibrated from typed-in values, and reads older snapshots without sources as typed in", () => {
    const values = { boil_off_l_per_h: 13.2, brewhouse_efficiency_pct: 60, batch_volume_l: 60 };
    const withSources = equipmentOverview({ values, sources: { boil_off_l_per_h: "calibration", brewhouse_efficiency_pct: "manual", batch_volume_l: "manual" }, recipeBatchSizeL: 60 });
    expect(row(withSources, "boil_off_l_per_h")).toMatchObject({ status: "calibrated", value: 13.2 });
    expect(row(withSources, "brewhouse_efficiency_pct")).toMatchObject({ status: "manual", value: 60 });
    const legacy = equipmentOverview({ values, recipeBatchSizeL: 60 });
    expect(row(legacy, "boil_off_l_per_h")).toMatchObject({ status: "manual", value: 13.2 });
  });

  it("warns about assumed values by name, briefly", () => {
    const one = equipmentOverview({ values: { brewhouse_efficiency_pct: 60, mash_thickness_l_per_kg: 3, grain_absorption_l_per_kg: 0.8, strike_temp_offset_c: 1 }, sources: { brewhouse_efficiency_pct: "manual", mash_thickness_l_per_kg: "manual", grain_absorption_l_per_kg: "manual", strike_temp_offset_c: "manual" }, recipeBatchSizeL: 60 });
    expect(one.warnings).toEqual(["Fordampning er en standardverdi, ikke målt. Planen bruker den til du har målt."]);
    const many = equipmentOverview({ values: {}, recipeBatchSizeL: 60 });
    expect(many.warnings[0]).toBe("Brygghuseffektivitet, fordampning og 3 til er standardverdier, ikke målt. Planen bruker dem til du har målt.");
  });

  it("warns when the recipe volume differs from the equipment's batch volume, and only then", () => {
    const equal = equipmentOverview({ values: { batch_volume_l: 60 }, sources: { batch_volume_l: "manual" }, recipeBatchSizeL: 60 });
    expect(equal.warnings.some((w) => w.includes("Oppskriften gjelder"))).toBe(false);
    const differs = equipmentOverview({ values: { batch_volume_l: 45 }, sources: { batch_volume_l: "manual" }, recipeBatchSizeL: 60 });
    expect(differs.warnings).toContain("Oppskriften gjelder 60 L, men utstyret er satt opp for 45 L.");
    const missing = equipmentOverview({ values: {}, recipeBatchSizeL: 60 });
    expect(missing.warnings.some((w) => w.includes("Oppskriften gjelder"))).toBe(false);
  });
});
