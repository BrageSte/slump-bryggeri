import type { WaterProfile } from "../model/water.ts";

/**
 * Slump Bryggeri's source water: the single canonical copy of the numbers. Everything else (the app
 * page, the brew document, the assistant, docs/water.md) reads from here, and a batch freezes a copy
 * of the profile it was brewed with.
 *
 * To update after the supplier publishes new numbers: append a new profile with a new `id` and the
 * day you read them. Once a batch may have used an entry, never change its published numbers: the entry
 * records what was published when we read it (notes and the confirmation may be corrected).
 *
 * Source: Asker og Bærum Vannverk IKS (ABV), table "Nyttig å vite om vannets innhold (ferdigbehandlet)",
 * column Holsfjorden. ABV states no sample date or period for the table. The entry holds every one of the
 * 31 parameters printed in that column: the nine the app calculates with are typed (`ions`, `alkalinityMmolL`,
 * `hardnessDh`, `ph`), the other 22 are in `otherReported`, each written once.
 */
export const holsfjordenWater20261001: WaterProfile = {
  id: "abv-holsfjorden-2026-10-01",
  name: "Holsfjorden (Asker og Bærum Vannverk)",
  description:
    "Ferdigbehandlet drikkevann fra Holsfjorden. Svært bløtt og mineralfattig, og dermed et nøytralt utgangspunkt for å bygge vannprofiler til ulike øltyper.",
  ions: { ca: 6.6, mg: 0.89, na: 2.7, cl: 2.5, so4: 3.4, hco3: 16.5 },
  alkalinityMmolL: 0.3,
  hardnessDh: 1.1,
  ph: 7.3,
  otherReported: [
    { name: "Farge", value: 13.8, unit: "mg Pt/L", limit: "Akseptabel for abonnenten" },
    { name: "Turbiditet", value: 0.2, unit: "FNU", limit: "Akseptabel for abonnenten" },
    { name: "Jern", value: 0.02, unit: "mg Fe/L", limit: "0,2" },
    { name: "Nitrat", value: 0.39, unit: "mg/L", limit: "50" },
    { name: "Aluminium", value: 0.05, unit: "mg Al/L", limit: "0,2" },
    { name: "Koli.bakt.", value: 0, unit: "ant/100mL", limit: null },
    { name: "E.Coli", value: 0, unit: "ant/100mL", limit: null },
    { name: "Kimtall 22°C", value: 0.7, unit: "ant/mL", limit: "100" },
    { name: "Mangan", value: 0.001, unit: "mg Mn/L", limit: "0,05" },
    { name: "Tot.org.karbon", value: 3.2, unit: "mg/L", limit: "Ingen unormal endring" },
    { name: "Antimon", value: 0.24, unit: "µg/L", limit: "5" },
    { name: "Arsen", value: 0.13, unit: "µg/L", limit: "10" },
    { name: "Bly", value: 0.04, unit: "µg/L", limit: "10" },
    { name: "Cyanid", value: 0.5, unit: "µg/L", limit: "50" },
    { name: "Fluorid", value: 0.07, unit: "mg/l", limit: "1,5" },
    { name: "Kadmium", value: 0.005, unit: "µg/L", limit: "5" },
    { name: "Kobber", value: 0.003, unit: "mg/l", limit: "2" },
    { name: "Krom", value: 0.1, unit: "µg/L", limit: "50" },
    { name: "Kvikksølv", value: 0.0005, unit: "µg/L", limit: "1" },
    { name: "Nikkel", value: 0.6, unit: "µg/L", limit: "20" },
    { name: "Selen", value: 0.03, unit: "µg/L", limit: "10" },
    { name: "Kalium", value: 0.53, unit: "mg/L", limit: null },
  ],
  confirmedUse: {
    confirmedBy: "Brage",
    confirmedAt: "2026-10-01",
    note: "Vannet Slump bruker kommer fra Holsfjorden, og ABVs tabell er kilden for alle verdiene.",
  },
  source: {
    kind: "supplier_report",
    organization: "Asker og Bærum Vannverk IKS (ABV)",
    title: "Vannkvalitet: Nyttig å vite om vannets innhold (ferdigbehandlet), kolonnen Holsfjorden",
    url: "https://www.abvann.no/temasider/vannkvalitet",
    retrievedAt: "2026-10-01",
    publishedAt: null,
    lastModifiedAt: "2026-09-29",
    note: "Siden oppgir ingen prøvedato eller måleperiode. «Sist endret» er sidens HTTP Last-Modified og daterer siden, ikke analysen.",
  },
  caveats: [
    "Tabellen har ingen prøvedato. Vannet er behandlet (alkalisert med CO₂ og hydratkalk, felt med aluminiumsulfat, desinfisert med klor og UV), og dosering følger råvannskvaliteten, så verdiene kan variere noe over tid.",
    "ABV leverer også vann fra Aurevann, som er hardere (2,7 °dH, kalsium 20,3 mg/L). Slump bruker Holsfjorden; bytter bryggestedet vannkilde, må profilen byttes.",
    "Klorid (Cl⁻, 2,5 mg/L) er noe annet enn restklor fra desinfeksjonen. Tabellen oppgir ikke restklor.",
    "ABV bygger nytt vannbehandlingsanlegg for Holsfjorden (abvann.no/nytt-vannbehandlingsanlegg). Når det tas i bruk kan alkalitet og kalsium endre seg; hent verdiene på nytt da.",
  ],
};

/** Every profile Slump has used as base water, oldest first. Append a new entry rather than changing published numbers. */
export const slumpWaterProfiles: readonly WaterProfile[] = [holsfjordenWater20261001];

/** The brewery's default source water: what a new batch freezes and what an older batch is assumed to have used. */
export const slumpBaseWater: WaterProfile = slumpWaterProfiles[slumpWaterProfiles.length - 1]!;

export function slumpWaterProfileById(id: string): WaterProfile | undefined {
  return slumpWaterProfiles.find((profile) => profile.id === id);
}
