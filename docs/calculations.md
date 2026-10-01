# Beregningsmotor

`src/domain/brewing-calculations/` — rene, deterministiske funksjoner uten React, database eller AI
(§43). UI og API kaller disse; ingen språkmodell regner ut brygge-tall.

Alle mengder er metriske: kg, g, L, °C, minutter. Konvertering fra imperial skjer i import-adapterne.

## Funksjoner

| Funksjon | Formel / kilde |
|---|---|
| `platoToSg`, `sgToPlato` | ASBC-tilnærming: SG = 1 + P / (258,6 − 227,1·P/258,2); invers kubisk |
| `brixToSg(brix, wcf)` | P = Brix / WCF, deretter `platoToSg`. WCF er instrumentets korreksjonsfaktor (kalibreringsverdi, standard 1,00) |
| `refractometerFinalGravity` | Sean Terrills kubiske formel (2011), for Brix-avlesning etter at gjæringen har startet |
| `calculateGravityEstimate` | Poeng = Σ(kg · utbytte% · 385,67) · effektivitet / L. Sukrose = 46,214 ppg = 385,67 poeng·L/kg. Sukker/ekstrakt får 100 % |
| `calculateEfficiency` | Invers av over: målt SG og volum → brygghuseffektivitet |
| `calculateAbv` | Standard (OG − FG) · 131,25; alternativ høygravitetsformel tilgjengelig |
| `tinsethUtilization`, `calculateIbu` | Tinseth (1997). Whirlpool: Tinseth for trekketiden × isomeriseringsrate ved temperaturen (Malowicki 2005, normalisert til 1,0 ved 100 °C). Tørrhumle/mesk = 0 IBU |
| `calculateHopAdjustment` | Mengde × oppskriftens AA / faktisk AA |
| `dryHopDose` | g / L |
| `calculateColorEbc` | MCU → SRM (Morey) → EBC |
| `calculateBoilOff` | Før kok − fordampning · tid |
| `forecastBoilEnd` | Prognose for varmt volum og SG ved kokeslutt; gravity points skaleres omvendt med volum |
| `calculateWaterVolumes` | Baklengs fra volum i gjæringskar: tap → krymping ved kjøling → fordampning → absorpsjon/dødvolum |
| `calculateStrikeTemperature` | Palmer (metrisk): Tw = (0,41 / r)(T₂ − T₁) + T₂, pluss bryggeriets kalibrerte systemkorreksjon |
| `calculateTemperatureOffset`, `summarizeCalibrationObservations` | ΔT per observasjon; snitt, standardavvik og forslag (≥ 3 observasjoner). Foreslår bare — admin må godkjenne |
| `calculateRecipeScaling` | Humle/gjær/tilsetninger skaleres med volum; meskede råvarer også med effektivitetsforhold så OG bevares; gjær i hele pakker rundes opp |
| `calculateRecipeMetrics`, `expectedGravities` | Samlet OG/FG/ABV/IBU/farge for en oppskrift |
| `measurementToCanonical`, `measurementFromCanonical` | Målinger normaliseres til °C, L, g, bar, SG og andre lagringsenheter; original enhet beholdes separat |
| `alkalinityMmolFromBicarbonate`, `alkalinityAsCaCO3FromBicarbonate` | Alkalitet fra bikarbonat (gyldig for vann med pH 6–9): mmol/L = HCO₃ / 61,017; som CaCO₃ = mmol/L · 50,043 |
| `hardnessMmol`, `hardnessDegreesDh` | Ca/40,078 + Mg/24,305 (mmol/L); 1 °dH = 10 mg/L CaO = 0,1783 mmol/L |
| `residualAlkalinityAsCaCO3` | Kolbach: alkalitet − Ca/3,5 − Mg/7, med Ca og Mg omregnet til CaCO₃. En indeks, ikke en pH-prediksjon |
| `sulfateToChlorideRatio` | SO₄ / Cl (retningen er viktig; noen kilder snur den). Udefinert uten klorid |
| `saltMassFractions`, `saltIonIncrease`, `addSaltsToWater` | Støkiometri fra formelen med standard atommasser (krystallvann tas med). mg/L = andel · gram · 1000 / liter. Salt-katalogen ligger i `src/domain/model/water.ts` |
| `solveSaltAdditions` | Omvendt saltberegning: gram av oppgitte salter som bringer kildevannet nærmest en målprofil (mg/L). Eksakt minste kvadrater uten negative mengder over alle delmengder av saltene; et salt brukes bare når alle ionene det tilfører (kalsium unntatt) har et mål; gram rundes til 0,1 g og resultatet regnes fra de avrundede mengdene. Returnerer gram, resulterende profil og avvik mot målet |
| `deriveWaterValues` | Alle avledede vannverdier fra en ionprofil |
| `convertUnitValue` | Brew-day-omregner for volum, temperatur, vekt, trykk, SG/°P og Brix/SG med WCF; gjæret Brix krever original Brix |

En måling lagrer både kanonisk verdi/enhet og hva bryggeren skrev. Konvertering er en ren funksjon; API-et
validerer område etter konvertering. Brix etter at gjæringen har startet gir ikke direkte SG. Terrill-estimatet
krever målt Brix før gjæring og WCF fra batchens utstyrsprofil, og vises som estimat med usikkerhet som avhenger
av målerens nøyaktighet og WCF-kalibrering.

## Forenklinger (dokumentert, bevisste)

- Vannkjemi: alle planlagte salter regnes som løst i hele brygge-vannet (mesk + skyll). Syrer regnes ikke med, og mesk-pH
  predikeres ikke: det finnes ingen validert modell for Slump (se [water.md](water.md#7-hva-som-mangler)).
- IBU: isomerisering fra kokehumle etter flameout (under whirlpool/kjøling) regnes ikke med.
- IBU bruker oppskriftens batchvolum og estimert OG som kokegravitet.
- Uten oppgitt utbytte antas 75 %; uten oppgitt forgjæring antas 75 %.
- Kjølekrymping 4 % som standard (samme som BeerSmith).
- Manglende boil-off starter på 5 L/t: et moderat anslag for 60–100 L elektriske eller gassfyrte kokekar,
  omtrent 5–8 % av kjelens volum per time. Reell fordampning varierer med kjele og kokestyrke; mål varmt volum
  før og etter kok. Planen merker derfor tallet «≈ antatt», aldri som kalibrert.

## Tester og toleranser

Hver formel har tester med kjente input, forventet resultat og toleranse (`tests/calculations/`).
Referanser: publiserte tabeller (Tinseth, ASBC Plato), spesifikasjonens eksempler (74,6 °C innmesking,
−2,6 °C kalibreringsforslag, 54,7 g Citra), og **Sunset IPA-loggen**:

| Sjekk | Logg | Toleranse |
|---|---|---|
| 12,1 / 14,0 / 15,0 °Bx → SG | 1.048 / 1.057 / 1.061 | ±0,001 (loggen oppgir «≈») |
| 20,0 / 19,0 / 16,5 US gal | 75,7 / 71,9 / 62,5 L | ±0,05 |
| Maltandeler | 74,7 / 20,2 / 1,9 / 3,3 % | 0,1 |
| Tørrhumledose | 5,8 / 6,7 g/L | 0,05 |
| 75,7 L → 62,5 L på 60 min | ≈ 13,2 L/t fordampning | 0,05 |
| 62,5 L varmt × (1 − 4 %) | 60 L til gjæring | 0,05 |

Merk: loggens Brix → SG stemmer med WCF = 1,00. Refraktometerets reelle WCF bør kalibreres og legges
inn i utstyrsprofilen.

## BeerSmith-referanser (§44)

Ikke laget ennå. Fremgangsmåte:

1. Eksporter utstyrsprofil, meskeprofil og 3–5 oppskrifter med kjente resultater fra BeerSmith.
2. Legg filene i `tests/calculations/beersmith/` sammen med BeerSmith sine beregnede verdier
   (OG, IBU, farge, vannvolumer, innmeskingstemperatur).
3. Skriv tester som kjører samme input gjennom motoren og sammenligner med toleranse.
4. Avvik dokumenteres her — målet er forklarbare forskjeller, ikke å kopiere BeerSmith.
