// Real BeerSmith exports from Slump (docs/import-bsmx.md). Kept byte for byte; macOS
// `__MACOSX` resource files from the original archive are left out.
import aasenKolsch from "./Aasen_Klch.bsmx?raw";
import aasenKolsch60l from "./Aasen_Klch_60l.bsmx?raw";
import bitter90l from "./Bitter_90l.bsmx?raw";
import cascadePaleAleKveik from "./Cascade_Pale_Ale__Kveik.bsmx?raw";
import ira from "./IRA.bsmx?raw";
import kesBelgianDouble from "./KES_Belgian_Double.bsmx?raw";
import loveInACanoe from "./Love_in_a_canoe.bsmx?raw";

export const bsmxFixtures: Record<string, string> = {
  "Aasen_Klch.bsmx": aasenKolsch,
  "Aasen_Klch_60l.bsmx": aasenKolsch60l,
  "Bitter_90l.bsmx": bitter90l,
  "Cascade_Pale_Ale__Kveik.bsmx": cascadePaleAleKveik,
  "IRA.bsmx": ira,
  "KES_Belgian_Double.bsmx": kesBelgianDouble,
  "Love_in_a_canoe.bsmx": loveInACanoe,
};
