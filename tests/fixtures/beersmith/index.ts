// Real BeerSmith exports from Slump (docs/import-bsmx.md), shipped with the app in
// src/features/recipes/beersmith/. Kept byte for byte; macOS
// `__MACOSX` resource files from the original archive are left out.
import aasenKolsch from "../../../src/features/recipes/beersmith/Aasen_Klch.bsmx?raw";
import aasenKolsch60l from "../../../src/features/recipes/beersmith/Aasen_Klch_60l.bsmx?raw";
import bitter90l from "../../../src/features/recipes/beersmith/Bitter_90l.bsmx?raw";
import cascadePaleAleKveik from "../../../src/features/recipes/beersmith/Cascade_Pale_Ale__Kveik.bsmx?raw";
import ira from "../../../src/features/recipes/beersmith/IRA.bsmx?raw";
import kesBelgianDouble from "../../../src/features/recipes/beersmith/KES_Belgian_Double.bsmx?raw";
import loveInACanoe from "../../../src/features/recipes/beersmith/Love_in_a_canoe.bsmx?raw";

export const bsmxFixtures: Record<string, string> = {
  "Aasen_Klch.bsmx": aasenKolsch,
  "Aasen_Klch_60l.bsmx": aasenKolsch60l,
  "Bitter_90l.bsmx": bitter90l,
  "Cascade_Pale_Ale__Kveik.bsmx": cascadePaleAleKveik,
  "IRA.bsmx": ira,
  "KES_Belgian_Double.bsmx": kesBelgianDouble,
  "Love_in_a_canoe.bsmx": loveInACanoe,
};
