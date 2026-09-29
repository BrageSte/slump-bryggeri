# Implementeringsplan v0.5

Oppdatert 2026-09-29 (bryggeplan, bryggeassistent, BeerSmith som grunnlag for kalibrering og
meskehjelp, se B13–B15). Levende dokument: kryss av oppgaver i samme PR som gjør dem ferdige.

Grunnlag: [implementation-package.md](implementation-package.md) (produktprinsipper),
[architecture.md](architecture.md) (implementerte beslutninger), [AGENTS.md](../AGENTS.md) og
Brages avklaringer 2026-09-24. Der eldre spesifikasjon beskriver inventar, AI, innlogging for andre,
flere bryggerier eller vannkjemi, gjelder strykningene i denne planen.

**Produktretning:** en enkel og konsis bryggeapp for Slump Bryggeri, uten hokus pokus. Bygg det som
trengs på bryggedagen, under gjæring og når ølet tappes. Kjernen er fortsatt
**PLAN → FAKTISK → AVVIK → RESULTAT → NESTE BATCH**. Manglende målinger forblir ukjente; de fylles
aldri fra oppskriftsmål eller importerte kalkulatorverdier.

Rekkefølgen følger ølet: Sunset IPA (brygget 23.09) gjærer nå, så gjæring, avslutning og rapport kommer
før neste bryggedag.

---

## 0. Slik fortsetter du i Claude Code (cloud)

1. Åpne repoet `BrageSte/slump-bryggeri` i Claude Code på web. Oppsettsskript: `npm ci`
   (for `npm run dev` i tillegg `cp .dev.vars.example .dev.vars` og en tilfeldig `BETTER_AUTH_SECRET`).
2. Ta neste åpne steg under. Én PR per steg, rett mot `main` — ikke stablede PR-er mot andre brancher.
3. Kjør `npm run typecheck`, `npm test` og `npm run build`, se på endringen i mobilbredde, og kryss av her.
4. Merge til `main` deployer (GitHub Actions: tester → D1-migrasjoner → Cloudflare).

---

## 1. Beslutninger fra Brage (2026-09-24)

| # | Tema | Beslutning |
|---|---|---|
| B1 | Drift | Gratis, på Cloudflare. |
| B2 | Innlogging | Bryggerimodus (felles bryggerikode + «Hvem er du?») er løsningen. Google/e-post-innlogging og flere bryggerier er strøket. |
| B3 | BeerSmith | De sju `.bsmx`-filene (`tests/fixtures/beersmith/`) er importkilde for oppskrifter. |
| B4 | Enheter | Skriv i gal, °F, oz, lb osv.; lagres metrisk. ✅ |
| B5 | Bryggedag | Timere og alarmer; skjermen skal ikke slukke. |
| B6 | Avslutning | Avslutning med faktiske tall og smaksnotater hører hjemme i **Brygg**. |
| B7 | Graf | Gjæringsgraf implementeres. |
| B8 | Redigering | Feilregistreringer kan korrigeres trygt. ✅ Rapporten skal være rikere enn Sunset-PDF-en. |
| B9 | Vann/pH | pH-strips som intervall. ✅ Salter og syre planlegges som vanlige tilsetninger; ingen vannkjemi-kalkulator. |
| B10 | BeerSmith-målinger | `OG_MEASURED`, `FG_MEASURED`, `VOLUME_MEASURED`, `MASH_PH` o.l. er ikke historikk, **selv når `_SET = 1`**. |
| B11 | Utstyr | Versjonerte utstyrsprofiler og uforanderlige batch-snapshots. Import overskriver aldri aktiv profil. |
| B12 | Omfang | Enkel og konsis app: ingen plassholdere, inventar eller automatiske kalibreringsforslag. *AI: se B14.* |
| B13 | Bryggedag (2026-09-28) | Bryggedagen skal ikke være «lukket» og stegvis: alt man lurer på (vann, temperaturer, humle, gjær) skal være synlig hele tiden, og tilsetninger kan registreres når de faktisk skjer. |
| B14 | AI (2026-09-28) | Bryggeassistent med Claude API, betalt per bruk (Sonnet 5 som standard), som svarer om brygget og leser et bryggedokument. Den regner ikke selv og endrer ingenting. Erstatter strykningen av AI i B12. |
| B15 | BeerSmith (2026-09-28) | BeerSmith-oppskriftene er tunet for anlegget og er grunnlaget for oppstart og tuning av kalibreringen. Utstyret kan brukes som *forslag* til ny profilversjon, som en admin ser over og lagrer selv (B11). |

---

## 2. Ferdig

- **Drift og datatrygghet (M1):** bryggerimodus, bildelagring i R2 med KV som fallback, deploy fra
  GitHub Actions, versjonert JSON-backup under Mer → Eksport.
- **Enheter, pH og korrigering (M2):** metrisk lagring med valgfri inntastingsenhet og Omregner,
  pH-strips som intervall med «Usikker»-status, trygg korrigering av loggføringer med historikk.
- **Bryggedag (M3, del):** skjermlås mens et brygg pågår. Listen «Planlagte steg» ble fjernet igjen i
  steg 1, fordi den gjentok Tilsetninger og Neste.
- **BeerSmith (M5, del):** `src/domain/import/bsmx.ts` + trygg XML-leser, testet mot alle sju filene
  ([import-bsmx.md](import-bsmx.md)).
- **Fiks:** tallfeltet i målearket var usynlig for målinger med enhetsvalg (temperatur, volum, SG, trykk, vekt).

---

## 3. Steg (i rekkefølge)

### Steg 1 — Rydd ✅

- [x] Bort: Inventar (bunnmeny, forside, side), Bryggeassistent (Mer, side), «Fase»-radene på Importer
      og tekstkortet «Måleenheter» i Innstillinger. Bunnmeny: Hjem · Brygg · Oppskrifter · Mer.
- [x] Bort: «Planlagte steg» på batchsiden (og `planned-steps.ts`). Stegkortet, Tilsetninger og Neste dekker det.
- [x] Forsiden viser bare målinger fra steget batchen er i, ikke gårsdagens whirlpool-temperatur under gjæring.
- [x] Plan v0.4, README og arkitektur oppdatert.

### Steg 2 — Gjæring ✅

Det Sunset trenger de neste dagene.

- [x] **Gjæringskort per variant** (hele batchen når den ikke er delt): OG (målt SG, ellers fra Brix før
      gjæring, merket «fra Brix»), siste SG og temperatur med tidspunkt, tilsynelatende forgjæring og dag
      siden pitching. SG vurderes ikke som «Høy/Lav» mot FG-målet mens gjæringen pågår.
- [x] **Tidspunkt på alt:** kommentar, tilsetning, hendelse og bilde kan få et annet tidspunkt enn «nå»,
      og «Gå til steg» kan starte et steg tilbake i tid. Da kan en bryggedag føres inn i etterkant.
- [x] **«Tilsatt» med faktisk mengde:** knappen på en planlagt tilsetning åpner et lite ark med planlagt
      mengde forhåndsutfylt; mengden kan endres før lagring (tørrhumle «justeres etter smak»).
- [x] **Gjæringsgraf** (tidl. M7): ren `buildFermentationSeries` fra egne tidsstemplede målinger — SG
      (Brix-avledet er tydelig merket), temperatur og trykk per variant. Manglende målinger er hull, ikke
      interpolerte «faktiske» data. Enkel SVG med tabell under, lesbar i mørkt tema. Testet med Sunset og
      med manglende data.

**Akseptanse:** På dag 3 kan man logge SG for Tropical og Pine hver for seg, se OG → nå → forgjæring per
variant, registrere faktisk tørrhumlemengde og se kurven.

Gjort 2026-09-24. `src/domain/brew-day/fermentation.ts` gir OG, målinger og pitch-tid per variant; kortet og
grafen bruker samme grunnlag. Tidspunkt frem i tid avvises av API-et (5 min slakk). En utført tilsetning viser
faktisk mengde med planen ved siden av.

Gjort 2026-09-28 (påbygning): grafen tegner nå også trykk, FG-mål som stiplet linje og gjæringsplanens
temperaturvindu som et bånd — begge fra `buildFermentationSeries({ ..., recipe })`, ny valgfri
`recipe`-parameter (`buildTemperatureBand` er egen, testet ren funksjon). Tom tilstand er nå `EmptyState`
i stedet for ingenting. `BatchPage.tsx` sender `recipe: batch.recipeSnapshot` til grafen, så FG-målet
og temperaturbåndet vises i appen.

### Steg 3 — Avslutt batch (tidl. M4, forenklet) ✅

- [x] «Avslutt batch» blir et skjema per variant: FG, pakket volum, pakkedato, pakning (boks/fat/flaske),
      CO₂-volumer, smaksnotat, karakter 1–5 og «neste gang». Forhåndsutfyll bare fra egne loggede
      målinger med synlig kilde; «ikke målt» er lov. Oppskriftsmål er aldri faktisk verdi.
- [x] Ny migrasjon for `batch_outcomes` (per batch/variant). Resultatet kan korrigeres senere, og
      JSON-backupen tar det med.
- [x] Rene funksjoner for faktisk ABV og tilsynelatende forgjæring (og effektivitet/fordampning når
      volumer og OG finnes), med kjent input, forventet svar og toleranse. Vis grunnlag og hva som mangler.
- [x] Batchsiden og historikken viser plan mot faktisk.

**Akseptanse:** Sunset Tropical (bokser) og Sunset Pine (fat) kan avsluttes hver for seg med egne tall
og smaksnotater.

Gjort 2026-09-24. `/batcher/:id/resultat` har ett skjema per variant (OG/FG forhåndsutfylt fra loggen med
kilde, «skrevet inn» når det endres), `PUT …/outcomes` med konfliktkontroll, og «Bryggeri-tall»
(fordampning og brygghuseffektivitet fra egne volum-målinger, `src/domain/brew-day/outcome.ts`). Historikken
viser faktisk ABV og karakter. Resultater kan legges inn før batchen avsluttes, f.eks. når Tropical er boksa.

### Steg 4 — Rapport (tidl. M8, forenklet) ✅

- [x] `/batcher/:id/rapport`: pen på skjerm og på A4 (`@media print`, `@page`); «Lagre som PDF» er
      nettleserens utskrift. Innhold: hode, plan mot faktisk (OG, FG, ABV, volumer), malt/humle/gjær
      faktisk brukt, bryggedagsmålinger, varianter, gjæringsgraf, resultater og smaksnotater, notater og
      usikkerheter — «ikke målt» der data mangler.

**Akseptanse:** Rapporten for Sunset IPA kan erstatte den håndlagde bryggeloggen i PDF.

Gjort 2026-09-24. Rapporten lenkes fra batchmenyen («Rapport (PDF)») og fra ferdige batcher. Den er bygget
bare fra loggen, snapshotet og resultatene; «Lagre som PDF» bruker nettleserens utskrift (A4, lys palett,
uten appens menyer). Gjæringsgrafen tegnes i full papirbredde med tabellen åpen.

### Steg 5 — Bryggedag: timer og alarmer (tidl. M3-rest) ✅

- [x] Delte timere som hendelser `timer_started` `{ label, durationMin, dueAt }` og `timer_cancelled`;
      alle i bryggeriet ser samme nedtelling (polling finnes). Hurtigvalg 5/10/15/20/30/60 min + egendefinert.
- [x] Alarmer i appen når en timer går ut, et steg er ferdig eller en planlagt tilsetning forfaller
      (forvarsel 1 min): lyd (Web Audio, låses opp ved første trykk), vibrasjon der det støttes og et stort
      banner med «Kvitter» / «Registrer tilsatt». Kvittering er per enhet; lyd kan slås av.
- [x] Rene funksjoner for «hva forfaller når» i `src/domain/brew-day/` med tester, blant annet at samme
      tilsetning ikke varsles to ganger.

**Akseptanse:** Under kok varsles neste humletilsetning med lyd, og den kan registreres med ett trykk.

Gjort 2026-09-24. `src/domain/brew-day/alarms.ts` (timere fra loggen, forfalte tilsetninger med forvarsel,
steg som er ferdige, timere som har gått ut — hver alarm har en fast nøkkel). Serveren validerer
`timer_started`/`timer_cancelled` og regner ut `dueAt` selv. Banneret ligger nederst over menyen; «Registrer
tilsatt» der logger planlagt mengde med ett trykk, mens «Tilsatt» i listen lar deg endre mengden først.
Alarmer som allerede var forfalt da siden ble åpnet, vises uten lyd.

### Steg 6 — BeerSmith-import (tidl. M5-rest, forenklet) ✅

- [x] Importer → «BeerSmith-fil (.bsmx)»: velg fil → gjennomgang av oppskrift, utstyr, advarsler og
      ignorerte målte felt → lagre som ny oppskrift. Filen lagres uendret i `recipe_sources.original_text`
      med filnavn og kan lastes ned igjen (test byte-lik rundtur for alle sju filene).
- [x] BeerSmith-utstyret lagres som oppskriftens kilde-snapshot og vises på oppskriften, adskilt fra aktiv
      profil. Oppgitte og avledede verdier holdes adskilt ([import-bsmx.md](import-bsmx.md)).
- [x] Hard importregel (B10): ingen batch, målinger, hendelser, resultater eller kalibreringsdata fra
      BeerSmith. Test eksplisitt med `KES_Belgian_Double.bsmx` og `Love_in_a_canoe.bsmx`.
- [x] Tester: alle sju filer, ødelagt/fiendtlig XML, for stor fil, autorisasjon/isolasjon.

**Akseptanse:** De sju gamle oppskriftene kan importeres som planer, med originalfilen tatt vare på og
uten at det oppstår bryggelogg.

Gjort 2026-09-24. Oppskrifter → Importer → «BeerSmith-fil (.bsmx)». Filen leses og vises til gjennomgang
i nettleseren; serveren parser den på nytt (`POST /recipes/import/bsmx`) og lagrer oppskrift, originalfil,
filnavn og kilde-data (utstyr, vannplan, advarsler, ignorerte målte felt) i `recipe_sources`
(migrering `0008`, tabellen er nå uforanderlig). Originalfilen lastes ned byte-lik fra oppskriften
(`GET /recipes/:id/source/file`). Maks filstørrelse er 250 kB (én oppskrift er 20–30 kB), så parsingen
holder seg godt innenfor CPU-grensen på gratisplanen.

---

### Steg 7 — Bryggeplan (B13) ✅

Gjort 2026-09-28. Samlet **Bryggeplan** på bryggedagen (`src/domain/brew-day/brew-plan.ts`, `BrewPlanOverview.tsx`):
nøkkeltall (innmesking, mesk, skyllevann, kok, malt, humle, gjærtilsetting, OG → FG) og alle faser samtidig,
med gjeldende fase uthevet og ferdige faser sammenfoldet. Den erstatter tilsetningskortet (ikke Neste), så ingenting
vises dobbelt. «Tilsett» åpner det forhåndsutfylte tilsetningsarket; gjær registreres direkte. Vannmengder og
innmeskingstemperatur tas fra oppskriften når kilden oppgir dem, ellers beregnet fra utstyrssnapshot og merket «≈».
Mangler fordampning, sier planen det, og «Ny batch» varsler før profilen låses.

Samtidig: «Start gjæring» når all gjær er registrert, «Mål SG» (ikke «Sjekk gravity»), slettet batch navigerer
videre, forsiden sier hva siste måling er, og en kallers bredde erstatter feltenes standardbredde (`fieldClasses`).

### Steg 8 — Bryggedokument og bryggeassistent (B14) ✅

Gjort 2026-09-28. Oppsett og kostnad: [assistant.md](assistant.md).

- **Bryggedokument** (`src/domain/brew-document/`): plan per fase, utstyrssnapshot, status nå, resultater og hele
  loggen som tekst. «Kopier bryggedokument» på assistentsiden.
- **Hva brygget sier om kalibreringen** (`tuning.ts`): fordampning og brygghuseffektivitet fra `brewhouseNumbers`,
  og systemkorreksjon innmesking fra første mesketemperatur (`suggestStrikeOffsetFromMash`). Bare tekst med
  grunnlag; ingenting lagres automatisk.
- **Assistent** (`worker/services/assistant.ts`, `worker/assistant/`): Claude med bryggedokumentet som cachet
  kontekst og åtte lesende beregningsverktøy (innmesking, vannmengder, mesketemperatur-justering, Brix → SG,
  ABV, effektivitet, fordampning, enhetsomregning). Dagsgrense (`ASSISTANT_DAILY_LIMIT`, 40), 10 per minutt,
  atomisk dagsreservasjon i `assistant_daily_requests` (migrering `0010`), tokenbruk i `assistant_usage`
  (migrering `0009`) og anslag i appen. Assistent i bunnmenyen og i batchmenyen.
- `calculateMashTemperatureAdjustment` (BeerSmith Mash Adjust: 1,417 L mot 1,41 L) brukes som verktøy for
  assistenten. Et eget kort for mesketemperatur-korrigering på bryggedagen er fortsatt strøket.

### Steg 9 — BeerSmith som startpunkt for kalibrering (B15) ✅

Gjort 2026-09-28. Oppskriftssiden for en BeerSmith-oppskrift har «Bruk som startpunkt i kalibreringen»:
`suggestProfileFromBsmx` fyller inn effektivitet, batchvolum, meskekar, dødvolum, trubtap, gjæringstap,
fordampning, krymping og mesketykkelse (BeerSmiths innmeskingsvann ÷ korn). Kalibreringssiden viser
gammel → ny, og en admin lagrer ny versjon. «Slumps BeerSmith-oppskrifter» under Importer legger inn Love in a
canoe, Cascade Pale Ale – Kveik, Bitter 90l og Aasen Kölsch (dagens 90–100 L-anlegg) gjennom samme import.
BSMX-filene ligger nå i `src/features/recipes/beersmith/`.

**Brage må:** i produksjon, importer «Slumps BeerSmith-oppskrifter», åpne Love in a canoe → «Bruk som startpunkt i
kalibreringen», sjekk verdiene mot anlegget i dag og lagre. Production-secret `ANTHROPIC_API_KEY` er satt;
sett et månedlig forbrukstak i Anthropic Console ([assistant.md](assistant.md)).

### Steg 10 — Bryggedokument på batchsiden (B14) ✅

- [x] Vis det samme deterministiske bryggedokumentet som assistenten leser direkte på batchsiden. Status nå og
      kalibreringsgrunnlaget er åpne; plan, utstyr, resultater og full logg kan åpnes ved behov.
- [x] Bruk batchens eksisterende, medlemsbeskyttede detalj- og loggspørringer. Dokumentet følger nye målinger og
      hendelser uten ekstra API-kall, AI-kall, dataskriving eller migrasjon.
- [x] Mobil og mørk modus, 44 px trykkflater, tydelig tom tilstand og sidens laste-/feiltilstander; tester for
      dokumentseksjoner, manglende verdier og loggtekst.

**Akseptanse:** Når en måling logges under et brygg, viser dokumentet den sammen med plan og manglende data.
Brukeren kan lese kalibreringsgrunnlaget uten å spørre assistenten eller endre profilen.

### Oppdatering 2026-09-29 — Mesketemperatur og BeerSmith-utstyr ✅

- [x] Meskekortet foreslår en beregnet vannjustering når siste temperaturmåling er utenfor måltoleransen.
      Vannmengden kommer fra oppskriften eller bryggeplanen; vannet kan loggføres som `water_added`.
- [x] BeerSmith-startpunktet varsler om store avvik fra aktivt anlegg og oppskriftsdato eldre enn fem år.
      Advarselen blokkerer ikke lagring.
- [x] Rene tester for BeerSmiths temperaturjustering og utstyrssammenligning.

### Steg 11 — Veileder: delt tråd og loggforslag ✅

- [x] Lagre spørsmål og svar i `assistant_messages` per batch. Alle medlemmer ser samme tråd, med forfatternavn;
      API-et returnerer de 100 nyeste meldingene eldste først og bruker de siste omtrent 12 som modellhistorikk.
- [x] Vis Veileder på batchsiden: mobilknapp over bunnmenyen som åpner samtalen, og sidepanel på desktop.
      `/assistent` bruker den valgte batchens samme lagrede tråd. Behold «Kopier bryggedokument».
- [x] Legg til `propose_actions` for validerte målinger, hendelser og timere. Forslag utføres ikke av AI;
      bryggeren logger via eksisterende endepunkt og bekrefter deretter med ett trykk, eller avviser.
- [x] Poll tråden mens den vises, vis hvem som spurte og hvem som logget/avviste et forslag, og behold lagret
      spørsmål når Anthropic-kallet feiler.
- [x] Isolasjon, historikk, handlingstilstand, validering og promptregel testes med fake Anthropic-klient.

**Akseptanse:** Alle på bryggeriet kan følge samtalen på samme batch. Et foreslått loggelement endrer ingenting før
en brygger bekrefter det; etterpå ser alle hvem som utførte handlingen og når.

Gjort 2026-09-29. Delt tråd i `assistant_messages` og bryggeriscopede endepunkter. Veileder vises på batchsiden og
den gamle assistentsiden bruker nå samme tråd. Claude foreslår skjema-validerte loggoppføringer; logging skjer via
de eksisterende måle-, hendelses- og kommentarendepunktene før statusen registreres på forslaget. Utvidet
bryggeri-eksport og oppdatert [assistant.md](assistant.md).

---

## 4. Strøket (bygg ikke uten ny beslutning)

- **Innlogging for andre** (tidl. M9): Google/e-post, kobling av personer til kontoer, flere bryggerier.
  E-post-OTP-koden ligger igjen, men brukes ikke i bryggerimodus.
- **Vannkjemi** (tidl. M6): versjonert kildevannsprofil, salt-/syrekalkulator og pH-modell.
- **Kalibreringsobservasjoner og automatiske forslag.** Kalibrering endres for hånd som ny profilversjon.
- Eget, selvstendig kort for mesketemperatur-korrigering er fortsatt strøket. Et kontekstuelt hint på
  det aktive meskesteget ble lagt til 2026-09-29. BeerXML-import/-eksport og CSV-eksport er også strøket.
- Inventar, smart import (bilde/nettadresse/tekst), push-varsler, full generisk
  revisjonshistorikk og avanserte planrevisjoner.

## Tverrgående krav (hver oppgave)

- Definition of Done (spesifikasjonen §59): UI, mobil, lasting/tom/feil-tilstander, autorisasjon, validering, tester, migrasjon.
- Nye bryggeri-ressurser: isolasjonstest i `tests/integration/authorization.test.ts`.
- Beregninger kun i `src/domain/brewing-calculations/` med kjente input, forventet svar og toleranse.
- Nye migrasjoner er nye filer; `db/schema/database.ts` holdes i sync.
- Oppdater `README.md` og `docs/architecture.md` når implementeringen faktisk endrer status eller beslutninger.
