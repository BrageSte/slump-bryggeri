# BeerSmith-import (BSMX)

Adapter: [`src/domain/import/bsmx.ts`](../src/domain/import/bsmx.ts) (ren funksjon, ingen DB).
XML leses av [`src/domain/import/xml.ts`](../src/domain/import/xml.ts), som avviser `DOCTYPE`/entiteter
og har grenser for dybde (32) og antall elementer (50 000). BSMX-filer kan være maks 250 kB
(`BSMX_MAX_BYTES`; én oppskrift er 20–30 kB).

BeerSmith er en **importkilde for planer**. Målte verdier i filen blir aldri observasjoner i Slump
(se «Hard importregel» nederst).

## Filformat

BSMX er XML uten XML-deklarasjon og uten attributter. Tekst er ASCII med numeriske entiteter
(`K&#246;lsch`). Strukturen i alle sju eksempelfilene:

```
Recipes                      mappe (Name, Type 7372, Size = antall oppskrifter)
└─ Data
   └─ Recipe
      ├─ F_R_*               oppskriftsfelt (navn, brygger, dato, notater, målte verdier …)
      ├─ F_R_EQUIPMENT       F_E_* utstyrsprofil slik den var i oppskriften
      ├─ F_R_STYLE           F_S_* BJCP-stil
      ├─ F_R_MASH            F_MH_* meskeprofil
      │  └─ steps/Data/MashStep   F_MS_* meskesteg
      ├─ F_R_BASE_GRAIN      malmal for skalering, ikke en ingrediens (ignoreres)
      ├─ F_R_CARB            F_C_* karboneringsprofil
      ├─ F_R_AGE             F_A_* gjærings-/modningsprofil
      ├─ Ingredients/Data    Grain, Hops, Yeast, Misc (og Water når det er brukt)
      └─ AgeData             tom i alle filene
```

En fil kan inneholde flere `Recipe` (mappeeksport). `parseBsmx` returnerer én import per oppskrift.

## Enheter

BeerSmith lagrer alltid i sine interne US-enheter, uansett hva brukeren viste:

| Størrelse | BSMX-enhet | Slump |
|---|---|---|
| Volum (`*_VOL`, `*_LOSS`, `F_MS_INFUSION`, `F_E_BOIL_OFF`) | US fl oz | L (÷ 33,814) |
| Vekt (`F_G_AMOUNT`, `F_H_AMOUNT`, `F_E_TUN_MASS`) | oz | kg / g |
| Temperatur | °F | °C, én desimal |
| Malt-farge `F_G_COLOR` | SRM (°L) | EBC (× 1,97) |
| Tid | min (kok/mesk), dager (gjæring) | samme |
| Misc `F_M_AMOUNT` | enheten i `F_M_UNITS` | samme enhet |

Kontroll mot «1My Equipment - 100l» (skjermbildet): `F_E_BATCH_VOL` 3043,26 fl oz = 90,00 L,
`F_E_MASH_VOL` 2536,05 = 75,00 L, `F_E_TUN_MASS` 352,74 oz = 10,00 kg, `F_E_BOIL_OFF` 169,07 = 5,00 L/t,
`F_E_TRUB_LOSS` 128 = 3,79 L, `F_E_BOIL_VOL` 3467,18 = 102,54 L.

## Kodetabeller

| Felt | Koder |
|---|---|
| `F_G_TYPE` | 0 korn, 1 ekstrakt, 2 sukker, 3 adjunkt, 4 tørrekstrakt |
| `F_H_USE` | 0 kok, 1 tørrhumling, 2 mesk, 3 first wort, 4 aroma/whirlpool |
| `F_H_FORM` | 0 pellet, 1 plugg, 2 blad (1 og 2 → «whole») |
| `F_Y_FORM` | 0 flytende, 1 tørr, 2 slant, 3 kultur |
| `F_M_USE` | 0 kok, 1 mesk, 2 primær, 3 sekundær, 4 tapping |
| `F_M_UNITS` | 0 mg, 1 g, 2 oz, 3 lb, 4 kg, 5 ml, 6 ts, 7 ss, 8 kopp, 9 pt, 10 qt, 11 l, 12 gal, 13 stk |
| `F_M_TIME_UNITS` | 0 min, 1 timer, 2 dager, 3 uker |
| `F_MS_TYPE` | 0 infusjon, 1 temperatur, 2 dekoksjon |
| `F_A_TYPE` | antall gjæringstrinn − 1 |
| `*_IN_RECIPE` | 0 = ligger i mappen, men er ikke med i oppskriften (hoppes over) |

Bare misc-enhetene 6 og 13 finnes i eksempelfilene. Andre enhetskoder gir et review-varsel.

## Hva som importeres

| Slump | BSMX |
|---|---|
| navn, stil, brygger, notater | `F_R_NAME`, `F_S_NAME`, `F_R_BREWER`, `F_R_NOTES`/`F_R_DESCRIPTION` |
| batchstørrelse, koketid, effektivitet | `F_E_BATCH_VOL`, `F_E_BOIL_TIME`, `F_E_EFFICIENCY` |
| fermenterbare | `Grain`: mengde, type, farge, `F_G_YIELD`, leverandør/opprinnelse |
| humle | `Hops`: mengde, alfa, bruk, tid, form, whirlpool-temperatur |
| gjær | `Yeast`: navn + produkt-ID, lab, form, pakker, snitt av min/maks forgjæring |
| tilsetninger | `Misc`: mengde, enhet, bruk, tid (utenfor kok som notat) |
| meskesteg | `MashStep`: temperatur, tid, infusjonsvolum og -temperatur |
| vannplan (`waterPlan`) | sum av infusjoner, strike-temperatur, korntemperatur, skylletemperatur |
| gjæringsplan | `F_R_AGE`: 1–3 trinn etter `F_A_TYPE` med start/slutt-temperatur, pluss modning `F_A_AGE` |
| karbonering | `F_R_CARB_VOLS` |
| planlagt IBU | sum av `F_H_IBU_CONTRIB` (BeerSmiths beregning) |
| utstyrs-snapshot (`equipment`) | `F_R_EQUIPMENT`, delt i `stated` (brukerens tall) og `derived` (før-kok- og tappevolum) |

**Finnes ikke i filen:** OG, FG, farge og ABV beregnes ikke av BeerSmith i filen og settes derfor
ikke som mål. Slumps beregningsmotor regner dem ut fra ingrediensene. Skyllevolum er heller ikke lagret.
`F_R_DESIRED_OG`/`_IBU`/`_COLOR` er skaleringsmål, ikke planverdier, og ignoreres.

**Varsler i stedet for gjetting:** tørrhumling (BeerSmith oppgir kontakttid, ikke dag), ukjente koder,
dekoksjon, manglende utstyr/mesk (standardverdier 20 L / 60 min / 72 %), vannprofiler (M6) og
avkortet tekst.

## Hard importregel

Disse feltene beskriver et tidligere brygg og importeres **aldri**, heller ikke når `<felt>_SET` er 1:
`F_R_OG_MEASURED`, `F_R_FG_MEASURED`, `F_R_VOLUME_MEASURED`, `F_R_FINAL_VOL_MEASURED`,
`F_R_BOIL_VOL_MEASURED`, `F_R_OG_BOIL_MEASURED`, `F_R_OG_MASH_MEASURED`, `F_R_OG_PRIMARY`,
`F_R_OG_SECONDARY`, `F_R_MASH_PH`, `F_R_RUNOFF_PH`, `F_R_RUNNING_GRAVITY`. Tidtakere
(`F_R_MASH_TIMER` …) og priser/inventar ignoreres også. Felt med `_SET = 1` listes i
`ignoredMeasuredFields` for review-visningen.

## I appen

Oppskrifter → Importer → «BeerSmith-fil (.bsmx)». Nettleseren leser filen (`decodeBsmxFile`: UTF-8 med
byte-order-mark bevart, ellers Windows-1252 med varsel) og viser oppskrift, varsler, ignorerte målte felt,
utstyr og vannplan. Ved lagring parser serveren filen på nytt og lagrer bare oppskriften og kilden:
originalfilen uendret, filnavn og `BsmxSourceData`. Oppskriften viser «Fra BeerSmith» med utstyret og
«Last ned fil». Testene (`tests/integration/recipe-import.test.ts`) importerer alle sju filene og sjekker
byte-lik nedlasting, hard importregel, fiendtlig/ødelagt XML, for store filer og isolasjon.

## Testfiler

`src/features/recipes/beersmith/` (byte-like kopier fra `oppskrifter.zip`, uten `__MACOSX`; appen bruker
fire av dem til «Slumps BeerSmith-oppskrifter»), lastet i testene via `tests/fixtures/beersmith/index.ts` og testet i
`tests/import/bsmx.test.ts`:

| Fil | Dekker |
|---|---|
| `Aasen_Klch.bsmx` | entiteter (`K&#246;lch`), SRM→EBC, ett gjæringstrinn + modning, strike-vann |
| `Aasen_Klch_60l.bsmx` | samme oppskrift skalert, eldre utstyrsnavn |
| `Bitter_90l.bsmx` | utstyret fra skjermbildet (90 L), tre gjæringstrinn med temperaturrampe, misc |
| `Cascade_Pale_Ale__Kveik.bsmx` | tørr kveik, flere humlesorter |
| `IRA.bsmx` | eldste fil (2012), 30+20 gal-utstyr, flytende gjær med starter |
| `KES_Belgian_Double.bsmx` | sukker (candi), `F_R_OG_MEASURED_SET = 1` (ignoreres) |
| `Love_in_a_canoe.bsmx` | flaked corn, humle ved 0 min, tørr lagergjær, `F_R_VOLUME_MEASURED_SET = 1` (ignoreres) |
