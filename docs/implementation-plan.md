# Implementeringsplan v0.3

Oppdatert 2026-09-24. Levende dokument: kryss av oppgaver i samme PR som gjør dem ferdige.

Grunnlag: [implementation-package.md](implementation-package.md) (produktprinsipper),
[architecture.md](architecture.md) (implementerte beslutninger), [AGENTS.md](../AGENTS.md) og
Brages avklaringer 2026-09-24. Der eldre spesifikasjon omtaler BSMX som «senere» eller BeerSmith-felt
som mulig historikk, gjelder avklaringene i denne planen.

**Produktretning:** gjør appen nyttig på neste bryggedag og samle Slumps egne faktiske data fra nå av.
Kjernen er **PLAN → ACTUAL → DEVIATION → OUTCOME → LEARNING → NEXT BATCH**. Manglende målinger skal
forbli ukjente, ikke fylles fra oppskriftsmål eller importerte kalkulatorverdier.

---

## 0. Slik fortsetter du i Claude Code (cloud)

1. Åpne repoet `BrageSte/slump-bryggeri` i Claude Code på web.
2. Oppsettsskript for miljøet: `npm ci`
   (for `npm run dev` i tillegg: `cp .dev.vars.example .dev.vars` og sett `BETTER_AUTH_SECRET` til en tilfeldig verdi).
3. Start en sesjon med for eksempel:
   > Les AGENTS.md og docs/implementation-plan.md. Ta neste åpne oppgave i rekkefølgen under, på en egen
   > branch. Følg akseptansekriteriene, kjør `npm run typecheck`, `npm test` og `npm run build`, oppdater docs og kryss av
   > i planen, og lag en PR.
4. **Arbeidsflyt:** én milepæl (eller én oppgave) per branch og PR. CI (`.github/workflows/ci.yml`) må være grønn.
5. **Deploy:** Cloud-sesjoner har ikke tilgang til Cloudflare-kontoen. Deploy skjer fra GitHub Actions
   (`.github/workflows/deploy.yml`) når en PR merges til `main`, **etter at Brage har lagt inn
   `CLOUDFLARE_API_TOKEN`** (oppgave M1.3). Uten token hopper workflowen over deploy.
6. Ting som krever Brage står under **«Brage må»**. Arbeid videre med uavhengige oppgaver mens de venter.

---

## 1. Beslutninger fra Brage (2026-09-24)

| # | Tema | Beslutning |
|---|---|---|
| B1 | Drift | Skal være gratis, i hvert fall i starten. Vi blir på Cloudflare (gratisnivået dekker behovet); ingen flytting til Vercel. |
| B2 | Innlogging | **Ingen innlogging i starten** (2026-09-24, oppdatert): appen er Slump Bryggeris egen. «Bryggerimodus» med felles bryggerikode og «Hvem er du?». Ekte innlogging (Google/e-post) kommer når appen skal brukes av andre (M9). |
| B3 | BeerSmith | De sju `.bsmx`-filene i `/Users/brage/Downloads/oppskrifter.zip` er importkilde for oppskrifter, planer og utstyrssnapshots. BeerXML beholdes som utvekslingsformat. Egen beregning av vannplan er kontroll/fallback. |
| B4 | Enheter | Bryggeriet skriver ofte i **gallons**. Må kunne skrive i gal, °F, oz, lb osv. og få liter/°C — og omvendt. |
| B5 | Bryggedag | **Timere og alarmer**, og skjermen skal ikke slukke. |
| B6 | Avslutning | Avslutning av batch med faktiske tall og smaksnotater hører hjemme i **Brygg**-delen. |
| B7 | Graf | Gjæringsgraf — **implementeres**. |
| B8 | Redigering | Feilregistreringer skal kunne korrigeres trygt. Full generisk revisjonshistorikk og avanserte planrevisjoner skal ikke blokkere bryggedag eller batchresultater. Rapporten skal være rikere enn Sunset-PDF-en. |
| B9 | Vann/pH | Må inn. Ingen utstyr for å måle salter, men **pH-strips**. |
| B10 | BeerSmith-målinger | Brage bekrefter at **ingen faktiske historiske bryggemålinger** ble ført i BeerSmith. `OG_MEASURED`, `FG_MEASURED`, `VOLUME_MEASURED`, `MASH_PH` og tilsvarende felt er ikke historikk, **selv når `_SET = 1`**. |
| B11 | Utstyr | Behold versjonerte equipment-profiler og uforanderlige batch-snapshots. Importert utstyr overskriver aldri aktiv profil automatisk. |

De to BeerSmith-kalkulatorbildene (Mash pH og Mash Adjust) er **referanse-/akseptansescenarier**, ikke
historiske målinger. «Measured Mash pH 5.80» i bildet er et eksempelinput, ikke en Slump-loggføring.

---

## 2. Rekkefølge

| Milepæl | Innhold | Størrelse | Avhenger av | Brage må |
|---|---|---|---|---|
| **M1** | Stabil drift, bildelagring og JSON-backup av hele bryggeriet | S–M | — | API-token for produksjonsdeploy |
| **M2** | Enheter, pH-strips og trygg korrigering av feilregistreringer | M | — | — |
| **M3** | Bryggedagsmodus: steg, Wake Lock, timere, alarmer og raske handlinger | M | M2.1 for enhetsvisning; ellers uavhengig | — |
| **M4** | Avslutt batch og samle faktiske resultater | M | M2.1 for enhetsvisning; ellers uavhengig | — |
| **M5** | Førsteklasses BSMX-import og BeerXML-import med kilde og utstyrssnapshot | L | — | Tilgang til de sju BSMX-filene i utviklingsmiljø/CI |
| **M6** | Praktisk vann- og pH-støtte under brygging | M | M2.2; bruker M5-data når de finnes | Vannanalyse for eksakte kildevannverdier |
| **M7** | Gjæringsgraf fra egne målinger | S–M | M2.1 | — |
| **M8** | Rik bryggerapport og deling/eksport av oppskrift og batch | M | M4; inkluderer M5–M7-data når de finnes | — |
| **M9** | Innlogging for andre bryggerier (Google/e-post), knytte personer til kontoer | M | — | Google OAuth-klient / domene |

M3, M4 og M5 trenger ikke vente på gjæringsgraf, avansert vannmodell eller full generisk historikk.

---

## M1 — Stabil drift og datatrygghet

### M1.1 Bryggerimodus — ingen innlogging i starten ✅

Gjort 2026-09-24. Appen er Slump Bryggeris egen: ingen kontoer, ingen e-post.

- Felles **bryggerikode** (secret `BREWERY_ACCESS_CODE`) skrives inn én gang per enhet → signert cookie.
  Uten satt kode er appen åpen (brukes lokalt). Ny kode = alle enheter må skrive inn koden på nytt.
- **«Hvem er du?»**: velg deg selv fra listen eller «Legg meg til». Første person oppretter bryggeriet og blir administrator.
  «Bytt person» under Mer.
- Personer er vanlige rader i `users` (plassholder-e-post `…@personer.slump.invalid`), så M9 kan koble dem til ekte
  kontoer uten datamigrering. Navnet i loggen er en merkelapp, ikke bevis — alle med koden kan velge hvem som helst.
- Kode: `worker/auth/brewery-mode.ts`, `worker/routes/brewery-mode.ts`, `src/features/breweries/BreweryModePage.tsx`.
  Tester: `tests/integration/brewery-mode.test.ts`.
- Slås av med `BREWERY_MODE` ≠ `"on"` (da gjelder vanlig innlogging).

### M1.2 Bildelagring

- [x] `worker/lib/file-store.ts`: grensesnitt `FileStore { put, get, delete }` med `R2FileStore` og `KvFileStore`.
      Velg R2 hvis `FILES` er bundet, ellers KV (`FILES_KV`), ellers 503 som i dag.
- [x] KV: nøkkel = samme som R2-nøkkelen; innholdstype og størrelse i metadata. Behold dagens filgrense på 15 MB.
- [x] `wrangler.jsonc`: `kv_namespaces` med `FILES_KV` i toppnivå (dev/test) og `env.production`.
- [x] Tester: opplasting og nedlasting med KV-binding (vitest-miniflare-konfig uten R2); isolasjonstest for vedlegg beholdes.
- [x] Docs: hvordan bytte til R2 senere (ingen datamigrering nødvendig for nye bilder; gamle kan flyttes med et skript).

Gjort 2026-09-24. Opprettet R2-bøtta `slump-bryggeri-files` og KV-namespace `slump-files`.
Produksjon bruker R2; KV er fallback når R2-bindingen mangler.

Bindingene og KV-id-en er lagt inn i `wrangler.jsonc` for lokal konfigurasjon og produksjon.

### M1.3 Deploy fra GitHub Actions

- [x] `deploy.yml` kjører ved push til `main` og manuelt, og hopper over med en melding når token mangler.
- [ ] Når token er på plass: verifiser at en merge til `main` kjører tester → migrasjoner → deploy.

**Brage må:** Cloudflare-dashbord → *My Profile → API Tokens → Create Token* → malen «Edit Cloudflare Workers»,
legg til **D1: Edit** (og **Workers KV Storage: Edit** for M1.2). Legg inn som GitHub-secrets i repoet:
`CLOUDFLARE_API_TOKEN` og `CLOUDFLARE_ACCOUNT_ID` (`12e5fd15eb499d3af63d742451c5d185`).

### M1.4 JSON-backup av hele bryggeriet

- [x] Admin-eksport under Mer → Eksport: versjonert JSON med bryggeri/personer, utstyr og profilversjoner,
      oppskrifter/versjoner/kilder, batcher/snapshots/splits, logg/målinger, resultater og relasjoner/
      tidsstempler. Filvedlegg listes med metadata og kan lastes ned separat; merk tydelig at JSON
      alene ikke inneholder bildebytes. Gjenoppretting er en senere oppgave.
- [x] API-et bruker `c.var.membership.breweryId`, krever admin og avviser andre bryggerier med 404.
      Test at relevante tabeller/referanser er med og at andre bryggeriers data ikke lekker.

Gjort 2026-09-24. Eksportformat `slump-brewery-backup` v1 har en tom `batch_outcomes`-liste fram til M4
oppretter resultattabellen. Auth-sesjoner og credentials eksporteres ikke.

**Akseptanse:** bryggeriet kan tidlig ta ut en kontrollerbar kopi av egne strukturerte data.

---

## M2 — Enheter, pH-strips og nødvendige rettelser

### M2.1 Metrisk standard med valgfrie inntastingsenheter (B4)

- [x] Enhetskatalog per målingstype og rene konverteringer i `brewing-calculations`: L ↔ US gal,
      °C ↔ °F, g/kg ↔ oz/lb, bar ↔ psi, SG ↔ °Plato og Brix ↔ SG. For Brix etter gjærstart
      kreves original-Brix og WCF; merk avledet SG med metode og usikkerhet. Test kjente tall/rundtur.
- [x] Migrasjon `0005_measurement_units.sql`: `measurements.entered_value REAL`, `measurements.entered_unit TEXT`.
- [x] API: `createMeasurementSchema` tar `value` + `unit` i en hvilken som helst støttet enhet for typen.
      **Serveren** konverterer til kanonisk verdi (lagres i `value/unit`) og lagrer det som ble skrevet inn.
      Ukjent enhet → 400.
- [x] `MeasurementInput`: enhetsvalg ved siden av tallet starter alltid metrisk (f.eks. «L | US gal», «°C | °F»), norsk desimalkomma,
      live omregning («21 US gal = 79,5 L»). Valgt enhet gjelder bare gjeldende inntasting og lagres ikke.
- [x] Ingen bryggeri-preferanse for enheter; standarden er metrisk. Loggen viser det som ble skrevet inn,
      med omregning i parentes: «21,0 US gal (79,5 L)».
- [x] «Omregner» (arket fra bryggedagen og Mer): gal↔L, °F↔°C, oz↔g, lb↔kg, psi↔bar, Brix↔SG (med WCF), °P↔SG.
- [x] Tester: domene (konvertering), integrasjon (gal inn → L lagret, begge returneres), UI-logikk.

Gjort 2026-09-24. Målinger lagres metrisk, mens brukeren kan velge en inntastingsenhet for ett enkelt
innslag. Det valget lagres ikke. Etter gjæringsstart vises Brix-avledet SG bare når en Brix-måling før
gjæring finnes; resultatet merkes som estimat med Terrill-metode, WCF og en forklaring av usikkerheten.

**Akseptanse:** På bryggedagen kan man logge «19,0 US gal», se kanoniske liter og fortsatt finne
originaltallet. Avledet SG fra gjæret Brix fremstår ikke som direkte målt SG.

### M2.2 pH med strips (B9)

- [x] pH-strips er standardregistrering som intervall («5,8–6,0») med instrument «pH-strips»; enkeltverdi
      kan brukes ved behov og lagres uten instrument hvis det ikke er oppgitt. «pH-meter» settes ikke automatisk.
- [x] Migrasjon: `measurements.value_min`, `measurements.value_max` (NULL for enkeltverdier). `value` = midtpunkt.
- [x] Målsammenligning: intervall helt innenfor mål → OK; delvis overlapp → ny status «Usikker» (egen chip, ikke bare farge);
      utenfor → Høy/Lav. Oppdater `deriveBrewDayState` + tester.
- [x] Input: hurtigvalg for vanlige strip-intervaller (5,0–5,2 … 6,0–6,2) og fritt intervall.

Gjort 2026-09-24. Stripintervall er standard i pH-inputen. API-et lagrer `value` som midtpunkt og
beholder intervallet og instrumentet i tidslinjen; enkeltverdier får ikke et oppdiktet instrument.

### M2.3 Trygg korrigering av feilregistreringer (B8)

Alle medlemmer kan korrigere loggføringer i den lille fellesloggen; kommentarer kan bare endres av
forfatteren. Behold hvem/når og forrige verdi. Dette er den minste sikre løsningen for feil på bryggedagen.

- [x] «Korriger» for målinger og hendelser: verdi/enhet, tidspunkt, steg/variant og notat. Behold
      originalen via enkel append-only korreksjonspost eller erstatningshendelse; vis «korrigert».
- [x] Kommentarer kan redigeres av forfatteren; vis at de er redigert.
- [x] Skriv endring/spor atomisk med `requireMember`, batch-/bryggeri-scope og konfliktkontroll. Erstatningen
      beholder opprinnelig `created_by`; `corrections` angir hvem som korrigerte. Startede steg kan ikke
      korrigeres fordi batchens `stage_started_at` ellers blir feil. Valider ingrediensdata med samme schema
      som ved ny logging. Test 404 for andre bryggerier og at korrigert tall brukes i mål-mot-faktisk-visning.
- [x] Lag UI for eksisterende API for batchnavn/bryggedato; rettelser av splits kan tas når de trengs.

Gjort 2026-09-24. Korrigering lager en ny logghendelse med forrige verdi, tidspunkt og forfatter i
`data.corrections`, og skjuler originalhendelsen fra den aktive loggen. Gamle rader bevares i databasen.
Erstatningen beholder opprinnelig `created_by`; korrigerende medlem står i `data.corrections`. Startede steg
avvises. `ingredient_added` og `yeast_pitched` valideres med `ingredientAddedDataSchema`. Korrigering krever
`baseUpdatedAt`; samtidige eller utdaterte endringer avvises.

### Senere: full revisjon og avanserte planendringer

Spesifikasjonen krever at batchens snapshot er uforanderlig. Når planen endres under bryggingen (som
«Simcoe økt pga. alder» i Sunset-loggen), lages en ny **planrevisjon** i stedet for å endre snapshotet.

Generisk `brew_event_revisions`, «Vis historikk» for alle felttyper og `batch_recipe_revisions` kan
bygges etter M4. Originalt batch-snapshot endres aldri. Inntil da logges mindre planavvik som faktisk
tilsetning og notat.

---

## M3 — Bryggedagsmodus (B5)

- [x] **Planlagte steg:** vis neste meske-, skylle-, koke-, humle- og gjæringssteg fra batchens
      oppskriftssnapshot; vis mål, tid og neste handling. Funger med manuelle oppskrifter og bruker
      importerte planer etter M5. Manglende plan gir tom tilstand, ikke oppdiktede steg.
- [x] **Skjermen på:** Screen Wake Lock (`navigator.wakeLock.request("screen")`) mens en batch i status «brygger nå» er åpen;
      hentes på nytt ved `visibilitychange`. Bryter i batch-headeren («Skjerm på»), standard på. Faller stille tilbake der API-et mangler.
- [ ] **Delte timere:** hendelsestyper `timer_started` `{ label, durationMin, dueAt }` og `timer_cancelled`. Alle i bryggeriet ser
      samme nedtelling (polling finnes). Kort «Timere» på bryggedagen med hurtigvalg (5/10/15/20/30/60 min + egendefinert).
- [ ] **Alarmer i appen:** når en timer går ut, et steg er ferdig eller en planlagt tilsetning forfaller (fra `deriveBrewDayState`):
      lyd (Web Audio, låses opp ved første trykk), vibrasjon der støttet, og et stort alarmbanner med «Kvitter» /
      «Registrer tilsatt». Forvarsel 1 min før tilsetninger. Innstilling for lyd av/på. Kvittering er per enhet.
- [ ] Rene funksjoner for «hva forfaller når» i `src/domain/brew-day/` med tester (inkl. at tilsetninger ikke varsles to ganger).
- [ ] **Raske handlinger:** «Registrer tilsatt» oppretter `ingredient_added` koblet til planlagt ID
      når mulig. Målings- og hendelseslogging fra aktivt steg med klokkeslett/variant forhåndsutfylt.
- [ ] **Mesktemperatur-korrigering:** ren, testet kalkulator for vann å tilsette med vannvolum,
      kornvekt, nå-/måltemperatur, tilsetningsvannets temperatur og eventuelt meskekarets masse/
      varmekapasitet. Resultat er forslag; logg først ved brukertrykk. BeerSmith Mash Adjust-bildet
      (67,8 °C mål, 65,6 °C nå, 18,93 L, 4,54 kg, 100 °C tilsetningsvann → 1,41 L) er
      referansescenario med dokumentert toleranse/modellavvik, ikke en historisk bryggmåling.

Gjort 2026-09-24. Batchens aktive steg viser bare planlagte punkter fra det uforanderlige
oppskriftssnapshotet, med en kort foreslått handling og en tom tilstand uten plan. Skjermlås er på som
standard mens et brygg pågår, kan slås av i batch-headeren og gjenopptas når fanen blir synlig igjen.

Varsler når appen er lukket (Web Push) er en senere utvidelse, ikke en blokkering for bryggedagsmodus.

**Akseptanse:** Under kok holder skjermen seg våken når støttet, neste humletilsetning varsles,
brukeren kan registrere den og logge en måling raskt.

---

## M4 — Avslutt batch og bygg Slumps egen historikk (B6)

- [ ] Bytt dagens enkle ferdigbekreftelse med «Avslutt batch» i Brygg. Forhåndsutfyll **bare** fra
      egne loggede målinger med synlig kilde; be om faktisk OG, FG per variant, volum til gjæring,
      pakket volum, dato, pakningstype og karboneringsplan. Tillat «ikke målt». Oppskriftsmål er aldri
      faktisk verdi. Resultatet kan korrigeres senere med sporbar endring.
- [ ] Ny migrasjon for `batch_outcomes` med tall per batch/variant, pakkeinformasjon, smaksnotater,
      vurdering og «hva gjør vi annerledes neste gang?». Flere smaksnotater over tid kan legges som
      logghendelser. Vis faktisk mot plan på batchsiden og i historikken, før rapporten finnes.
- [ ] Beregn faktisk ABV, tilsynelatende forgjæring, brygghuseffektivitet, boil-off og volumtap
      **bare når nødvendige målinger finnes**. Forklar grunnlag og manglende input. Rene funksjoner
      med kjent input, forventet resultat og toleranse.
- [ ] Skriv `calibration_observations` fra tilstrekkelig dokumenterte egne målinger og batchens
      utstyrssnapshot. Endre aldri aktiv profil automatisk. Test isolasjon, split-volumer, manglende
      målinger og korrigert resultat.

**Akseptanse:** En ny Slump-batch kan avsluttes med egne tall og læring uten import, graf eller
avansert pH-beregning.

---

## M5 — BSMX først, BeerXML for utveksling (B3, B10, B11)

De sju filene i `/Users/brage/Downloads/oppskrifter.zip` er reelle BSMX-eksempler. Repoet har ennå
bare `src/domain/import/diy-dog.ts`; `recipe_sources` lagrer kildeproveniens, og
`recipe_versions.data` er et versjonert oppskriftsdokument. Bruk disse modellene videre. Kopier et
begrenset, godkjent fixture-utvalg til `tests/fixtures/beersmith/`; utelat macOS `__MACOSX`-filer.
Dokumenter hvilke faktiske filer/varianter testene dekker. BeerSmith er **importkilde**, ikke Slumps
historiske bryggelogg.

- [ ] Dokumenter BSMX-strukturen fra alle sju filer og lag `src/domain/import/bsmx.ts` som ren,
      defensiv adapter. Utvid `recipeDocumentSchema` bakoverkompatibelt for navn/metadata,
      fermentables, hops, yeast, misc, planlagt OG/FG/IBU/farge/ABV, mash steps, meske-/skyllevann,
      infusjonsmengder, strike-temperatur, koketid, gjæringsplan og karbonering/pakking der data
      faktisk finnes. Manglende eller tvetydige felt gir review-varsel.
- [ ] Lag `src/domain/import/beerxml.ts` for fremtidige importer fra BeerSmith, Brewfather og
      Brewer's Friend; bruk samme normaliserte modell og review-flyt. BeerJSON kan vente. Avvis
      `DOCTYPE`/entities, ugyldig XML og urimelige størrelser før parsing.
- [ ] Importvisning: velg `.bsmx`/`.xml`, gjennomgå oppskrift, planer, utstyr og advarsler **før**
      lagring. Behold rå XML uendret i `recipe_sources.original_text`, med filnavn og format, slik
      at originalfilen kan lastes ned igjen. Test byte-lik rundtur for UTF-8-filene i arkivet;
      avvis filer over grensen eller bruk vedlegg for større kilder. Senere endringer lager ny
      immutable oppskriftsversjon; originalen beholdes.
- [ ] Behold BeerSmith-utstyr som **oppskriftens kilde-snapshot**, separat fra aktiv profil. Utvid
      modell/lagring for oppgitte verdier: effektivitet, batch-/fermenter-/flaskevolum,
      meskekarkapasitet/-masse/-varmekapasitet, deadspace/mesketap, koketid/-volum/-fordampning,
      kjølekrymping, trubtap og humleutnyttelse. Skill oppgitte fra avledede tall. Admin kan
      eksplisitt opprette en **ny** profilversjon etter review; aldri overskriv aktiv profil eller
      historiske batch-snapshots.
- [ ] Vis importert vann-/meskeplan på bryggedagen som kildens plan. Egen beregning er merket
      kontroll/fallback; store avvik gir review-varsel.
- [ ] **Hard importregel:** Ignorer `OG_MEASURED`, `FG_MEASURED`, `VOLUME_MEASURED`, `MASH_PH` og
      tilsvarende measured-/kalkulatorfelt som historiske observasjoner, **også ved `_SET = 1`**.
      Opprett ingen batch, `measurements`, `brew_events`, `batch_outcomes` eller
      `calibration_observations` fra BeerSmith. Test eksplisitt med `KES_Belgian_Double.bsmx`
      og `Love_in_a_canoe.bsmx`, der slike flagg forekommer.
- [ ] Test alle sju BSMX-filene, metrisk/imperial mapping, manglende felt, ødelagt/fiendtlig XML,
      review, kildefilbevaring, equipment-snapshot og autorisasjon/isolasjon.

**Utstyrsreferanse:** Bildet «1My Equipment - 100l» viser 80 % effektivitet, 90 L til gjæring,
5 L gjæringstap, 85 L flaskevolum, 75 L meskekar, 10 kg og 0,15 cal/g-°C, 3,79 L mesketap,
102,54 L beregnet før-kok-volum, 60 min kok, 5 L/time fordampning, 4 % krymping, 97,54 L
etter kok, 3,79 L trubtap og 100 % humleutnyttelse. Bruk dette som mapping-/review-referanse,
ikke hardkodet produksjonsprofil. Filene har også ulike utstyrsnavn; bevar forskjellene.

**Akseptanse:** De sju gamle oppskriftene kan importeres som planer med originalfil og riktig
utstyrskontekst, uten at historisk bryggelogg oppstår som bivirkning.

---

## M6 — Praktisk vann og pH (B9)

- [ ] Versjonert kildevannsprofil med Ca, Mg, Na, SO₄, Cl og HCO₃/alkalitet, inkludert kilde/dato;
      snapshot ved batchstart. Ukjente verdier forblir ukjente. Støtt planlagte salt-/syretilsetninger,
      vannmengder og mål-pH; importer planverdier fra M5 når de finnes.
- [ ] Vis vann- og syreplan som bryggedagshandlinger med «Registrer tilsatt». Vis mål-pH mot faktisk
      strip-intervall fra M2.2; kalkulatorinput er ikke logget pH.
- [ ] Vis kilde, mål og faktisk strip-intervall sammen med planlagte tilsetninger. En enkel
      korrigering kan registreres som tiltak med faktisk mengde og årsak, uten beregnet syreforslag.
- [ ] Integrasjonstest for at
      planverdier aldri blir faktiske målinger ved import eller kalkulatorbruk.

BeerSmith Mash pH-bildet er referansescenario for en **senere** syrekalkulator: 18,93 L meskevann,
4,54 kg korn, HCO₃ 122 ppm, 7,57 L skyllevann ved pH 7,20, eksempelinput 5,80, mål 5,30,
MPH 3 og 88 % melkesyre → 8,4 ml mesk + 1,2 ml skyllevann. Det er ikke et historisk datapunkt,
og et eget estimat må dokumentere modell og toleranse før det vises som forslag. Kommunal
vannanalyse er nyttig input, men blokkerer ikke logging eller planlagte tilsetninger.

---

## M7 — Gjæringsgraf (B7)

- [ ] Ren `buildFermentationSeries` fra Slumps egne tidsstemplede målinger: SG eller tydelig
      avledet verdi fra Brix, temperatur og trykk per variant, med mål fra batch-snapshot.
      Manglende målinger er hull, ikke interpolerte «faktiske» data.
- [ ] Mobilvennlig graf med mørkt tema, tilgjengelig tabell, punktdetaljer og variantfilter.
      Test Sunset-fixturen og manglende data. Grafen kan senere gjenbrukes i M8.

---

## M8 — Bryggerapport og eksport (B8)

- [ ] **Rapport** `/batcher/:id/rapport`: pen på skjerm og i A4-utskrift (`@media print`, `@page`). «Last ned PDF» = nettleserens
      utskrift til PDF (gratis, ingen server-PDF). Innhold:
  - hode (bryggeri, øl, batch #, dato, status, varianter),
  - planlagt mot faktisk (OG, FG, ABV, IBU, EBC, volumer, effektivitet), med «ikke målt» der data mangler,
  - oppskriftssnapshot, faktiske tilsetninger og avvik; avanserte planrevisjoner legges til hvis bygget,
  - vannplan, mesk og vann/pH når M5/M6-data finnes,
  - gjæringsgraf fra M7, nøkkelhendelser og måletabell,
  - resultater og smaksnotater per variant fra M4,
  - bilder, kalibreringsprofil (versjon) og usikkerheter.
- [ ] **Data-eksport:** oppskrift → BeerXML (`toBeerXml`, rundtur-test mot M5-parseren), batch → CSV/JSON
      av logg og resultat. **Hele bryggeriets JSON-backup ligger i M1.4**, ikke her.

---

## M9 — Innlogging for andre (senere)

Når appen skal brukes av andre enn Slump Bryggeri:

- [ ] **Google-innlogging** (gratis, uten domene): `socialProviders.google` i `worker/auth/auth.ts` når
      `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` finnes; `account.accountLinking = { enabled: true, trustedProviders: ["google"] }`;
      `APP_URL` satt i `env.production.vars`; «Fortsett med Google» på innloggingssiden; offentlig `GET /api/auth/methods`.
      **Brage må:** OAuth-klient i Google Cloud Console (scopes `openid`, `email`, `profile`; redirect-URI-er
      `https://slump-bryggeri.brage-steen.workers.dev/api/auth/callback/google` og `http://localhost:5173/api/auth/callback/google`),
      og `npx wrangler secret put GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET --env production`.
- [ ] **Koble personer til kontoer:** hver person i bryggerimodus legger inn sin e-post (Mer → Innstillinger); da kobler
      Better Auth kontoen til samme bruker ved første innlogging. Deretter kan bryggerimodus slås av.
- [ ] **E-postkode** (valgfritt): domene + Cloudflare Email Routing til verifiserte adresser (gratis) eller Email Sending /
      Resend; `send_email`-binding `EMAIL` + `EMAIL_FROM`. Koden støtter det allerede.
- [ ] Flere bryggerier per installasjon (bryggerimodus antar ett).

## Senere, når egne batchdata finnes

- Avansert pH-/vannkjemimodell og syrekalkulator med dokumentert metode, test mot BeerSmith-
  referansescenariet i M6 og kalibrering mot faktiske Slump-målinger. Resultatet er et forslag;
  brukeren godkjenner enhver loggføring.
- Full generisk revisjonshistorikk og avanserte batch-planrevisjoner, uten mutasjon av opprinnelige snapshots.
- Kalibreringsforslag fra gjentatte observasjoner: systematisk boil-off, effektivitet, volumtap,
  temperaturkorrigeringer og effekten av oppskriftsendringer. Vis antall batcher, spredning og
  usikkerhet. Admin godkjenner eventuell **ny profilversjon**; appen endrer aldri profilen selv.
- Varsler når appen er lukket, inventar, AI-assistent og sosiale funksjoner bare ved ny prioritering.

## Tverrgående krav (hver oppgave)

- Definition of Done (spesifikasjonen §59): UI, mobil, lasting/tom/feil-tilstander, autorisasjon, validering, tester, migrasjon.
- Nye bryggeri-ressurser: isolasjonstest i `tests/integration/authorization.test.ts`.
- Beregninger kun i `src/domain/brewing-calculations/` med kjente input, forventet svar og toleranse.
- Nye migrasjoner er nye filer; `db/schema/database.ts` holdes i sync.
- Oppdater `README.md` og `docs/architecture.md` når implementeringen faktisk endrer status eller beslutninger.

## Utenfor scope nå

Betaling, native apper, Bluetooth/Tilt/iSpindel, full offline-synk, sosiale funksjoner, AI-assistent,
inventar og multi-brewery auth — med mindre Brage prioriterer om.
