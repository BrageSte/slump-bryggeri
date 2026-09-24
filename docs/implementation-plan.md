# Implementeringsplan v0.4

Oppdatert 2026-09-24. Levende dokument: kryss av oppgaver i samme PR som gjør dem ferdige.

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
| B12 | Omfang | Enkel og konsis app: ingen plassholdere, AI, inventar eller automatiske kalibreringsforslag. |

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

### Steg 5 — Bryggedag: timer og alarmer (tidl. M3-rest)

- [ ] Delte timere som hendelser `timer_started` `{ label, durationMin, dueAt }` og `timer_cancelled`;
      alle i bryggeriet ser samme nedtelling (polling finnes). Hurtigvalg 5/10/15/20/30/60 min + egendefinert.
- [ ] Alarmer i appen når en timer går ut, et steg er ferdig eller en planlagt tilsetning forfaller
      (forvarsel 1 min): lyd (Web Audio, låses opp ved første trykk), vibrasjon der det støttes og et stort
      banner med «Kvitter» / «Registrer tilsatt». Kvittering er per enhet; lyd kan slås av.
- [ ] Rene funksjoner for «hva forfaller når» i `src/domain/brew-day/` med tester, blant annet at samme
      tilsetning ikke varsles to ganger.

**Akseptanse:** Under kok varsles neste humletilsetning med lyd, og den kan registreres med ett trykk.

### Steg 6 — BeerSmith-import (tidl. M5-rest, forenklet)

- [ ] Importer → «BeerSmith-fil (.bsmx)»: velg fil → gjennomgang av oppskrift, utstyr, advarsler og
      ignorerte målte felt → lagre som ny oppskrift. Filen lagres uendret i `recipe_sources.original_text`
      med filnavn og kan lastes ned igjen (test byte-lik rundtur for alle sju filene).
- [ ] BeerSmith-utstyret lagres som oppskriftens kilde-snapshot og vises på oppskriften, adskilt fra aktiv
      profil. Oppgitte og avledede verdier holdes adskilt ([import-bsmx.md](import-bsmx.md)).
- [ ] Hard importregel (B10): ingen batch, målinger, hendelser, resultater eller kalibreringsdata fra
      BeerSmith. Test eksplisitt med `KES_Belgian_Double.bsmx` og `Love_in_a_canoe.bsmx`.
- [ ] Tester: alle sju filer, ødelagt/fiendtlig XML, for stor fil, autorisasjon/isolasjon.

**Akseptanse:** De sju gamle oppskriftene kan importeres som planer, med originalfilen tatt vare på og
uten at det oppstår bryggelogg.

Steg 5 og 6 kan byttes om neste brygg er en av BeerSmith-oppskriftene.

---

## 4. Strøket (bygg ikke uten ny beslutning)

- **Innlogging for andre** (tidl. M9): Google/e-post, kobling av personer til kontoer, flere bryggerier.
  E-post-OTP-koden ligger igjen, men brukes ikke i bryggerimodus.
- **Vannkjemi** (tidl. M6): versjonert kildevannsprofil, salt-/syrekalkulator og pH-modell.
- **Kalibreringsobservasjoner og automatiske forslag.** Kalibrering endres for hånd som ny profilversjon.
- Mesketemperatur-korrigering, BeerXML-import/-eksport og CSV-eksport.
- Inventar, AI-assistent, smart import (bilde/nettadresse/tekst), push-varsler, full generisk
  revisjonshistorikk og avanserte planrevisjoner.

## Tverrgående krav (hver oppgave)

- Definition of Done (spesifikasjonen §59): UI, mobil, lasting/tom/feil-tilstander, autorisasjon, validering, tester, migrasjon.
- Nye bryggeri-ressurser: isolasjonstest i `tests/integration/authorization.test.ts`.
- Beregninger kun i `src/domain/brewing-calculations/` med kjente input, forventet svar og toleranse.
- Nye migrasjoner er nye filer; `db/schema/database.ts` holdes i sync.
- Oppdater `README.md` og `docs/architecture.md` når implementeringen faktisk endrer status eller beslutninger.
