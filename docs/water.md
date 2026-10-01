# Vann og pH

Brygge-vann er en del av Slumps kunnskaps- og datamodell, ikke et eget regneark ved siden av. Dette dokumentet forklarer
hva som er lagret hvor, hva vannet til Slump betyr for brygging, og hvordan vi måler, slik at bryggehistorikken etter
hvert kan svare på hvilket vann og hvor mye salt og syre en oppskrift trenger. Beslutningen (B17) og statusen står i
[implementation-plan.md](implementation-plan.md); koden er beskrevet i [architecture.md](architecture.md#vannkunnskap).

Alt som står her om **hva som er bra for øl** er generell veiledning fra bryggelitteratur, ikke regler og ikke noe som er
bevist for Slumps anlegg. Der kildene er uenige, sier vi det.

## 1. Fire slags verdier

Vannkjemi blander lett tall som har helt ulik tyngde. Appen holder dem derfor alltid fra hverandre, med de samme fire
merkelappene i appen, i bryggedokumentet, i assistenten og i denne teksten:

| Slag | Betyr | Hvor det bor | Eksempel |
|---|---|---|---|
| **Oppgitt (kilde)** | Tall vannverket eller et laboratorium har publisert | `src/domain/water/slump-water.ts`. Fryses i hver batch (`batch_equipment_snapshots.data.water`) | Kalsium 6,6 mg/L |
| **Beregnet** | Vår egen utregning fra oppgitte tall | `src/domain/brewing-calculations/water-chemistry.ts`. Lagres aldri | Restalkalitet ≈ 8,3 mg/L |
| **Mål / anbefaling** | Det en oppskrift sikter mot, eller generell veiledning | Oppskriftens `water` og `targets.mashPhMin/Max`. Veiledning i `src/domain/water/guidance.ts` | Mesk-pH 5,2–5,4 |
| **Målt i brygget** | Det som faktisk ble målt eller tilsatt under et brygg | Bryggeloggen: pH som måling, salter og syre som tilsetning med `waterAgent` | pH 5,34 på en prøve på 22 °C |

Reglene: en beregning gis aldri ut som oppgitt eller målt. Et mål er aldri en måling. Generelle vinduer overstyrer aldri
en oppskrifts eget mål eller en måling. Manglende målinger står som «ikke målt», og appen gjetter ikke mesk-pH.

## 2. Slumps basisvann

Slump bruker hovedsakelig drikkevann fra Holsfjorden, levert av Asker og Bærum Vannverk IKS (ABV). Dette er bryggeriets
basisvann: det nye batcher fryser, og det eldre batcher antas å ha brukt (merket som antatt).

**Den ene kanoniske kopien** er `holsfjordenWater20261001` i [slump-water.ts](../src/domain/water/slump-water.ts).
Tabellen under er generert fra den (`npm run docs:water`), og en test feiler hvis den ikke stemmer, så tallene finnes
ikke i to håndskrevne utgaver.

<!-- water-profile:start -->
Profil-id: `abv-holsfjorden-2026-10-01`

| Verdi | Tall | Enhet | Slag |
|---|---:|---|---|
| Kalsium (Ca) | 6,6 | mg/L | Oppgitt (kilde) |
| Magnesium (Mg) | 0,89 | mg/L | Oppgitt (kilde) |
| Natrium (Na) | 2,7 | mg/L | Oppgitt (kilde) |
| Klorid (Cl) | 2,5 | mg/L | Oppgitt (kilde) |
| Sulfat (SO₄) | 3,4 | mg/L | Oppgitt (kilde) |
| Bikarbonat (HCO₃) | 16,5 | mg/L | Oppgitt (kilde) |
| Alkalitet | 0,3 | mmol/L | Oppgitt (kilde) |
| Hardhet | 1,1 | °dH | Oppgitt (kilde) |
| pH i vannet | 7,3 | – | Oppgitt (kilde) |
| Alkalitet som CaCO₃ | 13,5 | mg/L | Beregnet |
| Hardhet | 1,13 | °dH | Beregnet |
| Restalkalitet (RA) som CaCO₃ | 8,3 | mg/L | Beregnet |
| Sulfat:klorid | 1,36 | – | Beregnet |

Øvrige oppgitte verdier (22), slik kilden skriver dem. Kolonnen «Grenseverdi» er kildens egen grense for drikkevann, ikke et bryggemål:

| Parameter | Tall | Enhet | Grenseverdi |
|---|---:|---|---|
| Farge | 13,8 | mg Pt/L | Akseptabel for abonnenten |
| Turbiditet | 0,2 | FNU | Akseptabel for abonnenten |
| Jern | 0,02 | mg Fe/L | 0,2 |
| Nitrat | 0,39 | mg/L | 50 |
| Aluminium | 0,05 | mg Al/L | 0,2 |
| Koli.bakt. | 0 | ant/100mL | – |
| E.Coli | 0 | ant/100mL | – |
| Kimtall 22°C | 0,7 | ant/mL | 100 |
| Mangan | 0,001 | mg Mn/L | 0,05 |
| Tot.org.karbon | 3,2 | mg/L | Ingen unormal endring |
| Antimon | 0,24 | µg/L | 5 |
| Arsen | 0,13 | µg/L | 10 |
| Bly | 0,04 | µg/L | 10 |
| Cyanid | 0,5 | µg/L | 50 |
| Fluorid | 0,07 | mg/l | 1,5 |
| Kadmium | 0,005 | µg/L | 5 |
| Kobber | 0,003 | mg/l | 2 |
| Krom | 0,1 | µg/L | 50 |
| Kvikksølv | 0,0005 | µg/L | 1 |
| Nikkel | 0,6 | µg/L | 20 |
| Selen | 0,03 | µg/L | 10 |
| Kalium | 0,53 | mg/L | – |

Alle 16 verdier med tallfestet grenseverdi ligger under den.

- **Bekreftet i bruk:** Brage, 2026-10-01. Vannet Slump bruker kommer fra Holsfjorden, og ABVs tabell er kilden for alle verdiene.
- **Kilde:** Vannverkets oppgitte verdier, Asker og Bærum Vannverk IKS (ABV). Vannkvalitet: Nyttig å vite om vannets innhold (ferdigbehandlet), kolonnen Holsfjorden. <https://www.abvann.no/temasider/vannkvalitet>
- **Hentet:** 2026-10-01
- **Prøve- eller publiseringsdato:** ikke oppgitt av kilden
- **Siden sist endret (HTTP Last-Modified):** 2026-09-29. Dette daterer siden, ikke analysen.

Forbehold:

- Tabellen har ingen prøvedato. Vannet er behandlet (alkalisert med CO₂ og hydratkalk, felt med aluminiumsulfat, desinfisert med klor og UV), og dosering følger råvannskvaliteten, så verdiene kan variere noe over tid.
- ABV leverer også vann fra Aurevann, som er hardere (2,7 °dH, kalsium 20,3 mg/L). Slump bruker Holsfjorden; bytter bryggestedet vannkilde, må profilen byttes.
- Klorid (Cl⁻, 2,5 mg/L) er noe annet enn restklor fra desinfeksjonen. Tabellen oppgir ikke restklor.
- ABV bygger nytt vannbehandlingsanlegg for Holsfjorden (abvann.no/nytt-vannbehandlingsanlegg). Når det tas i bruk kan alkalitet og kalsium endre seg; hent verdiene på nytt da.
<!-- water-profile:end -->

Hele kolonnen Holsfjorden ble lest fra ABVs side 2026-10-01: alle 31 parametere ABV skriver, ikke bare ionene. De ni appen
regner med er egne felt, de 22 andre står i `otherReported`, og hver verdi er skrevet én gang. Brage har bekreftet at dette er
vannet Slump bruker og at ABVs tabell er kilden for alle verdiene. De ni første stemte med referanseverdiene prosjektet
startet med, og beregnet alkalitet og hardhet stemmer med ABVs egne avrundede tall (en test sjekker det).

### Slik oppdaterer du profilen

1. Åpne kilden (lenken over) og les hele kolonnen Holsfjorden i «Nyttig å vite om vannets innhold (ferdigbehandlet)», ikke
   bare ionene.
2. Legg til en **ny** profil i `slumpWaterProfiles` med ny `id`, dagens dato som `retrievedAt`, og `publishedAt` bare
   hvis siden oppgir en dato. Parametere appen regner med skrives i de typede feltene, alle andre i `otherReported`.
   Endre aldri publiserte tall i en oppføring en batch kan ha brukt: den er en journal over hva som ble publisert da
   (en test låser den første).
3. Kjør `npm run docs:water`, `npm test` og `npm run typecheck`.
4. Nye batcher fryser den nye profilen. Gamle batcher beholder sin egen kopi. Batcher fra før vannkjemi ble registrert
   har ingen kopi og antas å ha brukt basisvannet.

Hent verdiene på nytt når ABV tar i bruk det nye vannbehandlingsanlegget, og hvis smak eller målt pH begynner å avvike
uten annen forklaring.

## 3. Hva basisvannet betyr for brygging

- **Svært bløtt og mineralfattig.** Hardhet 1,1 °dH er i det klassiske «svært bløtt»-båndet (0–4 °dH). Kalsium,
  magnesium, klorid og sulfat ligger alle under det laveste vinduet kildene bruker for smak eller pH-effekt (avsnitt 4).
  Vannet er derfor et nøytralt utgangspunkt der du bygger profilen selv, og egner seg som utgangspunkt for å bygge
  profiler til ulike øltyper. Lyse øl i bløtvanns-tradisjoner kan brygges nesten som det er.
- **Kalsium må nesten alltid tilsettes.** 6,6 mg/L er langt under det vanlige vinduet på 50–150 mg/L. Kalsium senker
  mesk-pH og støtter enzymer, klaring og gjær. Gips (gir kalsium og sulfat) og kalsiumklorid (gir kalsium og klorid)
  er de naturlige kildene, og valget mellom dem former smaken (se klorid/sulfat under).
- **Lite alkalitet.** Alkaliteten er ≈ 13,5 mg/L som CaCO₃ (restalkalitet ≈ 8,3). Vannet skyver altså mesk-pH lite opp.
  Hvor mye syre, om noe, som trengs, avgjøres av kornblandingen og tilsatt kalsium, ikke av vannet alene.
- **Klorid og sulfat er under smaksnivå.** Forholdet sulfat:klorid (1,36) sier derfor ingenting; ingen av ionene har
  smak. Balansen bestemmer du helt selv.
- **Vannets egen pH (7,3) sier nesten ingenting om mesk-pH.** Se avsnittet om hvorfor.
- **Behandlet vann.** ABV alkaliserer med CO₂ og hydratkalk, feller humus med aluminiumsulfat, og desinfiserer med klor
  og UV. Dosering følger råvannskvaliteten, så tallene kan variere. **Klorid er ikke restklor:** tabellen oppgir ikke
  restklor. Klor og kloramin kan gi klorfenoler (medisinsmak) i øl; aktivt kull eller sulfitt (kaliummetabisulfitt,
  «Campden») fjerner det (generell bryggepraksis, se for eksempel Brew Your Own,
  [Water Treatments](https://byo.com/articles/water-treatments/)). Spør ABV eller mål, i stedet for å anta.
- **Kilden er bekreftet.** Brage har bekreftet (2026-10-01) at vannet Slump bruker kommer fra Holsfjorden. ABV leverer også
  fra Aurevann, som er hardere (2,7 °dH, kalsium 20,3 mg/L); bytter bryggestedet vannkilde, må profilen byttes.

## 4. Veiledning (mål / anbefaling, ikke regler)

Strukturert i `src/domain/water/guidance.ts`, og vist under Mer → Vann. Kildene er American Homebrewers Association
([Understanding Water for Homebrewing](https://homebrewersassociation.org/how-to-brew/understanding-water-for-homebrewing/))
og Brewfather ([Water Chemistry & Adjustments](https://docs.brewfather.app/brewing-knowledge/water-chemistry)). For
dypere lesing: Palmer og Kaminski, *Water: A Comprehensive Guide for Brewers* (Brewers Publications, 2013), som vi ikke har
sitert tall fra direkte.

| Ion | Vanlig vindu (mg/L) | Hva det gjør | Merknad, og der kildene er uenige |
|---|---|---|---|
| Kalsium | 50–150 | Senker mesk-pH, støtter enzymer, klaring og gjær | AHA sier 50–200 |
| Magnesium | 10–30 | Gjærnæring i små mengder. Mye gir sur, bitter, metallisk smak | AHA: problem over ca. 50. Brewfather: over 30 |
| Natrium | 0–150 | Rundhet sammen med klorid. Mye gir salt, hardt preg | Brewfather 0–100 (opp til 150 for maltbetonte). AHA 70–150 ideelt, harskt over 200 |
| Klorid | 50–200 | Fylde, rundhet, maltsødme | Lyse, tørre øl brygges ofte under 50 |
| Sulfat | 50–350 | Fremhever humlebitterhet, gir tørrhet | Høyt sulfat med mye humle kan bli hardt |
| Bikarbonat | ingen fast vindu | Alkalitet: løfter mesk-pH | Avhenger av kornblandingen |

Ingen stilspesifikke mål er kodet inn, med vilje. En oppskrift kan oppgi sin egen målprofil (under «Vann»), og den
gjelder foran dette.

### Mesk-pH

- **Vindu:** 5,2–5,6 målt ved ca. 20 °C er det mest siterte (Brewfather). AHA sier 5,1–5,8 med 5,2–5,5 som optimalt. Slump
  bruker 5,2–5,4 som standardmål når en oppskrift ikke har et eget, og det kan justeres per oppskrift.
- **Mål en avkjølt prøve** (ca. 20–25 °C). En varm prøve leser omtrent 0,2–0,35 pH lavere (Brewfather). Appen dømmer derfor
  ikke en prøve over 35 °C mot målet: den vises som «Usikker».
- **Strips gir et intervall, ikke et punkt.** De lagres som intervall og vises som «Usikker» når intervallet bare delvis
  overlapper målet. En pH-meter gir et punkt, men må kalibreres mot bufferløsninger og brukes på avkjølt prøve.
- Konsentrerte syrer er etsende: bruk hansker og vernebriller, og tilsett syre i vann, ikke omvendt.

### Hvordan kornblandingen påvirker mesk-pH

Mesk-pH er et samspill mellom malten, vannets alkalitet, kalsium og magnesium, og tilsatt syre. Lyse basismalter gir
høyest mesk-pH i rent vann. Crystal og ristet malt, og syrnet malt, senker den, i stigende grad etter farge og andel.
Mørk malt trenger derfor ofte mer alkalitet for å treffe vinduet, mens en lys kornblanding i svært bløtt vann gjerne
ligger høyt og kan trenge kalsium eller litt syre. Hvor mye som faktisk trengs for Slumps kornblandinger er det vi vil
lære av egne målinger.

### Hvorfor råvannets pH ikke er nok

pH forteller bare hvor sur vannet er akkurat nå, ikke hvor mye syre det tåler. Det som flytter mesk-pH er alkaliteten
(buffer), kalsium og magnesium som reagerer med fosfater i malten, og malten selv med sin egen syre og buffer. To vann
med samme pH 7,3 kan gi helt ulik mesk-pH. Derfor registrerer vi mesk-pH som en måling i hvert brygg, og regner ikke ut en
verdi fra vannets pH.

### Kalsium, magnesium og natrium

Kalsium reagerer med malt-fosfater og frigjør syre, slik at mesk-pH synker. Det er den viktigste av de tre for pH.
Magnesium virker svakere på pH og er gjærnæring i små mengder. Natrium påvirker ikke pH, men gir rundhet og, med klorid, en
saltsmak hvis det blir mye. Natron (natriumbikarbonat) tilfører alkalitet og løfter derfor pH.

### Klorid, sulfat og balansen mellom dem

Klorid fremhever fylde og maltsødme; sulfat fremhever humlebitterhet og tørrhet. Brewfather bruker forholdet
**sulfat:klorid** (merk retningen; noen kilder snur det): under 0,5 svært malt/rundt, 0,5–1 maltbetont, 1–2
balansert, 2–4 humlebetont og tørt, over 4 svært humlebetont. Forholdet sier bare noe når minst ett av ionene er over
ca. 50 mg/L; ved Slumps lave basisvann er det meningsløst før du har tilsatt noe. Totalmengden teller også: mye av begge
gir et hardt, mineralsk preg.

### Bikarbonat, alkalitet og restalkalitet

Alkalitet er vannets evne til å motstå surgjøring. Med bikarbonat som eneste alkalitet (vann med pH 6–9) er
1 mmol/L alkalitet = 61 mg/L bikarbonat = 50 mg/L som CaCO₃. **Restalkalitet (RA, Kolbach)** trekker fra den delen
kalsium og magnesium tar ut: alkalitet − Ca/3,5 − Mg/7, i CaCO₃-enheter. Positiv RA løfter mesk-pH og passer mørk malt;
negativ senker den og passer lys malt. RA er en grov indeks, ikke en pH-prediksjon.

### Gips (CaSO₄) og kalsiumklorid (CaCl₂)

Begge tilfører kalsium, men gir ulik smak: gips gir sulfat (tørt, humlebetont), kalsiumklorid gir klorid (fyldig, rundt).
Vær nøye med hvilket kalsiumklorid du har: **dihydrat** (CaCl₂·2H₂O) og **vannfri** (CaCl₂) gir ulik mengde kalsium per
gram. Appen lagrer derfor hvilket middel du tilsatte (`waterAgent`), ikke bare navnet. Gips løses langsomt og best i
varmt vann eller mesk; kalsiumklorid løses lett og trekker fuktighet, så veg det raskt.

<!-- water-agents:start -->
| Middel | Id | Ca | Mg | Na | Cl | SO₄ | HCO₃ |
|---|---|---:|---:|---:|---:|---:|---:|
| Gips (kalsiumsulfat, CaSO₄·2H₂O) | `gypsum` | 23,3 | – | – | – | 55,8 | – |
| Kalsiumklorid, dihydrat (CaCl₂·2H₂O) | `calcium_chloride_dihydrate` | 27,3 | – | – | 48,2 | – | – |
| Kalsiumklorid, vannfri (CaCl₂) | `calcium_chloride_anhydrous` | 36,1 | – | – | 63,9 | – | – |
| Epsomsalt (magnesiumsulfat, MgSO₄·7H₂O) | `epsom_salt` | – | 9,9 | – | – | 39,0 | – |
| Bordsalt (natriumklorid, NaCl) | `table_salt` | – | – | 39,3 | 60,7 | – | – |
| Natron (natriumbikarbonat, NaHCO₃) | `baking_soda` | – | – | 27,4 | – | – | 72,6 |

Salter: mg/L ion som 1 g gir når det løses i 10 L vann. Syrer: melkesyre (`lactic_acid`, vanlige styrker 80, 88, 90 %); fosforsyre (`phosphoric_acid`, vanlige styrker 10, 75, 85 %).
<!-- water-agents:end -->

### Syretilsetninger

Syre nøytraliserer bikarbonat og senker mesk-pH. Melkesyre (80–90 %) kan gi en mild melkesyresmak i svært høye doser
(Brewfather nevner over 0,5 mL/L); fosforsyre (75–85 %) er smaksnøytral. Hvor mye som trengs avhenger av kornblandingen,
ikke bare av vannet, så **appen foreslår ingen syremengde ennå**. Tilsett lite av gangen, la det virke, og mål på en
avkjølt prøve. Loggfør hver tilsetning med middel, mengde og styrke, slik at vi kan lære av den.

## 5. Målestrategi: pH som standard i bryggeflyten

Dette er det systemet kan registrere, og hvor det havner. Ingenting krever en databasemigrering: det bygger på
eksisterende felt, så historikken er urørt.

| Hva | Hvor | Felt |
|---|---|---|
| Kildevann brukt | Frosset i batchen ved opprettelse | `equipmentSnapshot.water` (hele profilen med kilde og dato) |
| Planlagt vannprofil | Oppskriften | `recipe.water.target` (mg/L), `profileName`, `notes` |
| Planlagte salter og syre | Oppskriften, som vanlige tilsetninger | `recipe.miscs[].waterAgent`, `acidStrengthPct`, mengde og enhet |
| Salter og syre faktisk tilsatt | Loggen | `ingredient_added` med `waterAgent`, `acidStrengthPct`, mengde, enhet |
| Mesk-pH, mål | Oppskriften | `recipe.targets.mashPhMin/Max` (ellers 5,2–5,4 som antatt) |
| Mesk-pH, faktisk | Loggen | måling `ph`, steg `mash` |
| Prøvetemperatur | Loggen | `measurements.sample_temp_c` (`sampleTempC`) |
| Tid og steg | Loggen | `occurred_at` og `stage` |
| pH før kok / etter kok | Loggen | steg + merkelapp «pH før kok» / «pH etter kok» |
| pH under gjæring / ferdig øl, også surøl | Loggen | steg `fermentation`, eller merkelapp «Slutt-pH» |
| Instrument | Loggen | `instrument` («pH-meter», eller intervall fra «pH-strips») |

**Prøvepunktet** (`mash`, `pre_boil`, `post_boil`, `fermentation`, `final`) lagres ikke i et eget felt: det leses ut av
steg og merkelapp (`classifyPhSamplePoint`). En måling fra før denne funksjonen fantes, for eksempel Sunset IPA sin pH 5,9
«Før kok» i skyllesteget, eller en sur vørter på pH ca. 3,8 før kok, leses på samme måte og **skrives aldri om**. Under pH-målingen
velger brygger prøvepunkt, prøvetemperatur og instrument; velger man et punkt steget allerede sier, trengs ingen merkelapp.

Anbefalt rutine (generell praksis, justeres etter hvert):

1. Mesk-pH: prøve ca. 10–20 minutter inn i mesken, avkjølt til ca. 20–25 °C. Logg temperatur og instrument.
2. Før kok og etter kok når det er relevant (alltid for surøl). Fall i pH under koking er normalt.
3. Ferdig øl, og under gjæring for surøl.
4. Logg hver salt- og syretilsetning med middel, mengde og styrke.

## 6. Fra bryggehistorikk til svar

Bryggeassistenten har verktøyet `water_chemistry` (én batch: kilde, beregnet, plan, målt, med what-if for salter) og
`brewery_history` (per batch: kildevann, mesk-pH-mål, pH-målinger med punkt og temperatur, tilsatte salter og syre). Modellen
regner ikke selv; den leser tall fra de testede funksjonene. Status for spørsmålene vi vil kunne svare på:

| Spørsmål | Status |
|---|---|
| Hvilken vannprofil bør denne oppskriften bruke? | Registrering ✓ (målprofil i oppskriften). Anbefaling ✗: ingen logikk som foreslår en profil fra kornblanding og stil |
| Hvor mye CaCl₂ / CaSO₄ / syre til vårt kildevann? | Fremover-regning ✓ (gitt gram: hva blir profilen). Omvendt (gitt målprofil: hvor mange gram) ✗. Syredosering ✗ |
| Hva var predikert mot målt mesk-pH? | Målt ✓. Predikert ✗: ingen validert modell, så appen gjetter ikke. Når en modell finnes, må predikert verdi lagres per batch |
| Trengte tidligere batcher med lignende kornblanding mer eller mindre syre? | ◐ Syre og pH per batch er med i historikken. Mangler: kornblandingens egenskaper (andel crystal, ristet, farge) i oppsummeringen |
| Hvordan hang vannkjemi sammen med effektivitet, gjæring og smak? | ◐ Kildevann, resultater og smaksnotater finnes per batch. Selve sammenhengsanalysen ✗, og det trengs mange flere batcher |
| Kan anbefalingene bli bedre med mer Slump-data? | ✗ Krever at predikert og målt sammenlignes over tid; se neste steg |

## 7. Hva som mangler

- **Prøvedato for ABVs tabell.** ABVs tabell er kilden (Brages beslutning 2026-10-01), men den oppgir ingen prøvedato, så
  årstidsvariasjon er ukjent. En egen analyse trengs ikke for å bruke profilen; jevnlige pH- og alkalitetsmålinger i brygg
  vil vise om vannet avviker.
- **Restklor og kloramin** er ikke oppgitt av kilden.
- **Modell for mesk-pH** og **syredosering**: krever malts farge og buffer (eller målt destillert-vann-pH) og validering mot
  egne målinger.
- **Omvendt saltberegning** (målprofil til gram).
- **Kornblandingens egenskaper** i historikken, så «lignende kornblanding» kan defineres.
- **Valg av vannkilde per batch** (for eksempel fortynnet med omvendt osmose): i dag fryser alle batcher basisvannet.
- **Logg over pH-meterets kalibrering.**
- **Stilmaler** for vannprofiler, med vilje ikke laget uten egne resultater.
- Ingen automatisk sjekk mot ABVs side; oppdatering gjøres for hånd (se over).

**Mest verdifulle neste steg mot automatiske vannjusteringer:** en ren, testet *omvendt mineralberegning* i
`brewing-calculations`: gitt kildevannet, ønsket Ca/Cl/SO₄ (og eventuelt Mg/Na) og vannmengde, finn gram av kalsiumklorid,
gips, epsomsalt og salt som kommer nærmest. Den er ren støkiometri, trenger ingen pH-modell, bruker data vi allerede har
(frosset kildevann, oppskriftens målprofil, middelkatalogen), og svarer direkte på «hvor mye CaCl₂/CaSO₄». Parallelt:
mål mesk-pH på avkjølt prøve og logg salter og syre i 10–15 brygg, og lagre en enkel publisert modells predikerte
mesk-pH per batch, så feilen mot det målte samles opp før noen modell får styre syredosering.
