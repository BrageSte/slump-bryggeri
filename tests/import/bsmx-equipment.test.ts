import { describe, expect, it } from "vitest";
import { parseBsmx } from "../../src/domain/import/bsmx.ts";
import { suggestProfileFromBsmx } from "../../src/domain/import/bsmx-equipment.ts";
import { bsmxFixtures } from "../fixtures/beersmith/index.ts";

const load = (...names: string[]) => names.flatMap((name) => parseBsmx(bsmxFixtures[name] ?? ""));

describe("BeerSmith equipment as a calibration suggestion", () => {
  it("maps «1My Equipment - 100l» from Slump's current recipes (reference screenshot values)", () => {
    const suggestion = suggestProfileFromBsmx(load("Love_in_a_canoe.bsmx", "Cascade_Pale_Ale__Kveik.bsmx", "Bitter_90l.bsmx", "Aasen_Klch.bsmx"));
    expect(suggestion?.sourceName).toBe("1My Equipment - 100l");
    expect(suggestion?.values).toMatchObject({
      brewhouse_efficiency_pct: 80,
      // Two of three recipes on this equipment are 90 L; Love in a canoe is scaled to 100 L.
      batch_volume_l: 90,
      mash_tun_volume_l: 75,
      mash_dead_space_l: 3.79,
      kettle_loss_l: 3.79,
      fermentation_loss_l: 5,
      boil_off_l_per_h: 5,
      cooling_shrinkage_pct: 4,
    });
    // BeerSmith's strike water ÷ grain: 37.29/14.3, 44.03/16.88 and 50.48/19.36 ≈ 2.61 L/kg.
    expect(suggestion?.values.mash_thickness_l_per_kg).toBeCloseTo(2.61, 2);
  });

  it("uses the most recent recipe's equipment and ignores other systems for mash thickness", () => {
    const suggestion = suggestProfileFromBsmx(load("IRA.bsmx", "KES_Belgian_Double.bsmx"));
    expect(suggestion?.sourceName).toBe("All Grain - Large 10 Gal/38 l - Cooler");
    expect(suggestion?.values.batch_volume_l).toBe(25);
  });

  it("suggests nothing without equipment", () => {
    expect(suggestProfileFromBsmx([])).toBeNull();
  });
});
