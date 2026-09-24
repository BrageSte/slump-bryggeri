# Implementeringsplan v0.2

Oppdatert 2026-09-24. Levende dokument: kryss av oppgaver i samme PR som gjør dem ferdige.

Grunnlag: [implementation-package.md](implementation-package.md) (source of truth),
[architecture.md](architecture.md) (beslutninger), [AGENTS.md](../AGENTS.md) (regler for agenter) og
Brages tilbakemeldinger 2026-09-24 (oppsummert under).

---

## 0. Slik fortsetter du i Claude Code (cloud)

1. Åpne repoet `BrageSte/slump-bryggeri` i Claude Code på web.
2. Oppsettsskript for miljøet: `npm ci`
   (for `npm run dev` i tillegg: `cp .dev.vars.example .dev.vars` og sett `BETTER_AUTH_SECRET` til en tilfeldig verdi).
3. Start en sesjon med for eksempel:
   > Les AGENTS.md og docs/implementation-plan.md. Ta neste åpne oppgave i rekkefølgen under, på en egen
   > branch. Følg akseptansekriteriene, kjør `npm run typecheck` og `npm test`, oppdater docs og kryss av
   > i planen, og lag en PR.
4. **Arbeidsflyt:** én milepæl (eller én oppgave) per branch og PR. CI (`.github/workflows/ci.yml`) må være grønn.
5. **Deploy:** Cloud-sesjoner har ikke tilgang til Cloudflare-kontoen. Deploy skjer fra GitHub Actions
   (`.github/workflows/deploy.yml`) når en PR merges til `main`, **etter at Brage har lagt inn
   `CLOUDFLARE_API_TOKEN`** (oppgave M1.3). Uten token hopper workflowen over deploy.
6. Ting som krever Brage (kontoer, dashbord, kort, filer fra BeerSmith) står under **«Brage må»** i hver oppgave.

---

## 1. Beslutninger fra Brage (2026-09-24)

| # | Tema | Beslutning |
|---|---|---|
| B1 | Drift | Skal være gratis, i hvert fall i starten. Vi blir på Cloudflare (gratisnivået dekker behovet); ingen flytting til Vercel. |
| B2 | Innlogging | Må være gratis og uten eget domene → **Google-innlogging** først. E-postkode beholdes til et domene finnes. |
| B3 | Vannplan | Kommer fra **BeerSmith**-import (stegene ligger der). Egen beregning er kontroll/fallback. |
| B4 | Enheter | Bryggeriet skriver ofte i **gallons**. Må kunne skrive i gal, °F, oz, lb osv. og få liter/°C — og omvendt. |
| B5 | Bryggedag | **Timere og alarmer**, og skjermen skal ikke slukke. |
| B6 | Avslutning | Avslutning av batch med faktiske tall og smaksnotater hører hjemme i **Brygg**-delen. |
| B7 | Graf | Gjæringsgraf — **implementeres**. |
| B8 | Redigering | **Alt skal kunne endres hele veien.** Eksporten skal være penere og ha mer info enn Sunset-PDF-en (den var bare et eksempel). |
| B9 | Vann/pH | Må inn. Ingen utstyr for å måle salter, men **pH-strips**. |

---

## 2. Rekkefølge

| Milepæl | Innhold | Størrelse | Avhenger av | Brage må |
|---|---|---|---|---|
| **M1** | Gratis drift: Google-innlogging, bildelagring, deploy fra GitHub | M | — | Google OAuth-klient, API-token, (evt. kort for R2) |
| **M2** | Enheter (gal/°F/oz …), pH-strips, redigering overalt med historikk | L | — | — |
| **M3** | Timere, alarmer, skjermen på | M | M2 (delvis) | — |
| **M4** | Gjæringsgraf | S–M | — | — |
| **M5** | BeerSmith/BeerXML-import med vannplan og utstyr | L | M2 | BeerSmith-eksporter |
| **M6** | Avslutning av batch, faktiske tall, smaksnotater, kalibreringsobservasjoner | M | M2, M4 | — |
| **M7** | Vann og pH: kildevann, salter, syre, pH-estimat | L | M5 | Kommunens vannanalyse |
| **M8** | Bryggerapport (pen, printbar) og eksport | M | M4, M6, (M7) | — |

M4 er liten og kan tas parallelt med M2/M3.

---

## M1 — Gratis drift

### Bakgrunn: hva koster hva

| Del | Gratis? | Kommentar |
|---|---|---|
| Hosting (Workers) | Ja | 100 000 forespørsler/dag på gratisnivået. |
| Database (D1) | Ja | 5 GB, millioner av lesinger per dag. |
| Adresse | Ja | `slump-bryggeri.brage-steen.workers.dev`. Eget domene er valgfritt (ca. 100–150 kr/år). |
| Innlogging med e-postkode | Nei* | Å sende e-post krever et domene. *Gratis med domene + Cloudflare Email Routing til verifiserte adresser. |
| Innlogging med Google | Ja | Ingen domene eller e-postsending nødvendig. |
| Bilder (R2) | Ja* | 10 GB gratis, men R2 må aktiveres med betalingskort (ingen trekk ved vår bruk). |
| Bilder (KV) | Ja | Uten kort. 1 GB og 1000 skrivinger/dag — nok for noen få bryggere. |

Lovable føles gratis fordi det bruker Supabase, som har innebygd e-post for innlogging — men den er
begrenset til noen få e-poster i timen og ment for testing. Vercel har gratis hosting, men ingen
innebygd innlogging/e-post; vi ville fått samme problem og måttet flytte database og filer.

### M1.1 Google-innlogging (+ valg av innloggingsmetode)

- [ ] `worker/auth/auth.ts`: `socialProviders.google` når `GOOGLE_CLIENT_ID` og `GOOGLE_CLIENT_SECRET` finnes.
      `account.accountLinking = { enabled: true, trustedProviders: ["google"] }` så samme e-post = samme bruker
      uansett metode. Legg secrets inn i `.dev.vars.example` (tomme) og kjør `npm run cf-typegen`.
- [ ] Sett `APP_URL` i `env.production.vars` til `https://slump-bryggeri.brage-steen.workers.dev`
      (OAuth-redirect må være eksakt).
- [ ] Nytt offentlig endepunkt `GET /api/auth/methods` → `{ google: boolean, emailOtp: boolean }`
      (e-postkode er bare tilgjengelig når `canSendEmail()` er sann). Legg det *foran* Better Auth-handleren.
- [ ] `LoginPage`: «Fortsett med Google» (primær når tilgjengelig, `authClient.signIn.social({ provider: "google", callbackURL: "/" })`),
      e-postkode som alternativ når den er tilgjengelig. Tydelig feilmelding hvis ingen metode er satt opp.
- [ ] Invitasjoner fungerer uendret: de matcher på e-post, og Google gir verifisert e-post.
- [ ] Tester: `/api/auth/methods` speiler konfigurasjonen; `POST /api/auth/sign-in/social` gir en Google-URL med riktig
      `redirect_uri` når nøkler er satt, og 4xx når de mangler.
- [ ] Docs: architecture.md (innlogging) og README.

**Brage må:** Google Cloud Console → nytt prosjekt «Slump» → *OAuth consent screen* (External; scopes kun
`openid`, `email`, `profile` — da trengs ingen verifisering) → *Credentials* → *OAuth client ID* (Web).
Autoriserte redirect-URI-er: `https://slump-bryggeri.brage-steen.workers.dev/api/auth/callback/google` og
`http://localhost:5173/api/auth/callback/google`. Deretter:
`npx wrangler secret put GOOGLE_CLIENT_ID --env production` og tilsvarende for `GOOGLE_CLIENT_SECRET`.

**Akseptanse:** Brage og en invitert venn kan logge inn på produksjon med Google og ser samme bryggeri.

### M1.2 Bilder uten R2 (gratis, uten kort)

- [ ] `worker/lib/file-store.ts`: grensesnitt `FileStore { put, get, delete }` med `R2FileStore` og `KvFileStore`.
      Velg R2 hvis `FILES` er bundet, ellers KV (`FILES_KV`), ellers 503 som i dag.
- [ ] KV: nøkkel = samme som R2-nøkkelen; innholdstype og størrelse i metadata. Maks 15 MB (KV tillater 25 MiB).
- [ ] `wrangler.jsonc`: `kv_namespaces` med `FILES_KV` i toppnivå (dev/test) og `env.production`.
- [ ] Tester: opplasting og nedlasting med KV-binding (vitest-miniflare-konfig uten R2); isolasjonstest for vedlegg beholdes.
- [ ] Docs: hvordan bytte til R2 senere (ingen datamigrering nødvendig for nye bilder; gamle kan flyttes med et skript).

**Brage må (eller agent med wrangler-tilgang):** `npx wrangler kv namespace create slump-files` og lime id inn i `wrangler.jsonc`.
Alternativt: aktiver R2 i dashbordet (krever kort) og bruk R2 direkte.

### M1.3 Deploy fra GitHub Actions

- [x] `deploy.yml` kjører ved push til `main` og manuelt, og hopper over med en melding når token mangler.
- [ ] Når token er på plass: verifiser at en merge til `main` kjører tester → migrasjoner → deploy.

**Brage må:** Cloudflare-dashbord → *My Profile → API Tokens → Create Token* → malen «Edit Cloudflare Workers»,
legg til **D1: Edit** (og **Workers KV Storage: Edit** for M1.2). Legg inn som GitHub-secrets i repoet:
`CLOUDFLARE_API_TOKEN` og `CLOUDFLARE_ACCOUNT_ID` (`12e5fd15eb499d3af63d742451c5d185`).

### M1.4 E-postkode senere (valgfritt)

Når/hvis Brage har et domene på Cloudflare: Email Routing + verifiserte mottakeradresser (gratis), eller
Email Sending (Workers Paid). Legg til `send_email`-binding `EMAIL` og sett `EMAIL_FROM`. Koden støtter det allerede.

---

## M2 — Enheter, pH-strips og redigering overalt

### M2.1 Skriv inn i gallons, °F, oz … (B4)

- [ ] `src/domain/model/units.ts`: enhetskatalog per målingstype med konverteringer til/fra kanonisk enhet
      (volum L ↔ US gal; temperatur °C ↔ °F; vekt g/kg ↔ oz/lb; trykk bar ↔ psi; gravitet SG ↔ °P).
      Rene funksjoner i `brewing-calculations`, tester med kjente verdier (20,0 gal = 75,7 L osv.).
- [ ] Migrasjon `0005_measurement_units.sql`: `measurements.entered_value REAL`, `measurements.entered_unit TEXT`.
- [ ] API: `createMeasurementSchema` tar `value` + `unit` i en hvilken som helst støttet enhet for typen.
      **Serveren** konverterer til kanonisk verdi (lagres i `value/unit`) og lagrer det som ble skrevet inn.
      Ukjent enhet → 400.
- [ ] `MeasurementInput`: enhetsvalg ved siden av tallet (f.eks. «L | gal», «°C | °F»), live omregning
      («20,0 gal = 75,7 L»). Sist brukte enhet huskes per type og enhet (lokalt).
- [ ] Bryggeri-innstilling (admin, Mer → Innstillinger): standard visningsenheter for bryggeriet (metrisk / US volum / blandet).
      Loggen viser det som ble skrevet inn, med omregning i parentes: «20,0 gal (75,7 L)».
- [ ] «Omregner» (arket fra bryggedagen og Mer): gal↔L, °F↔°C, oz↔g, lb↔kg, psi↔bar, Brix↔SG (med WCF), °P↔SG.
- [ ] Oppskriftseditor: mengdefelt godtar «2 oz», «10 lb», «5 gal» og konverterer ved lagring (valgfritt i denne runden).
- [ ] Tester: domene (konvertering), integrasjon (gal inn → L lagret, begge returneres), UI-logikk.

**Akseptanse:** På bryggedagen kan man logge «19,0 gal» og se «71,9 L» overalt der tall brukes (mål, graf, rapport).

### M2.2 pH med strips (B9)

- [ ] pH-måling kan registreres som **intervall** («5,8–6,0») med instrument «pH-strips», eller som enkeltverdi (pH-meter).
- [ ] Migrasjon: `measurements.value_min`, `measurements.value_max` (NULL for enkeltverdier). `value` = midtpunkt.
- [ ] Målsammenligning: intervall helt innenfor mål → OK; delvis overlapp → ny status «Usikker» (egen chip, ikke bare farge);
      utenfor → Høy/Lav. Oppdater `deriveBrewDayState` + tester.
- [ ] Input: hurtigvalg for vanlige strip-intervaller (5,0–5,2 … 6,0–6,2) og fritt intervall.

### M2.3 Redigering overalt med historikk (B8)

Beslutning (kan endres): **alle medlemmer** kan redigere loggføringer (små grupper, felles logg), og all
historikk tas vare på. Kommentarer kan bare endres av den som skrev dem.

- [ ] Migrasjon: `brew_event_revisions` (id, event_id, brewery_id, batch_id, before JSON, edited_by, edited_at),
      uforanderlig (trigger blokkerer UPDATE/DELETE).
- [ ] API: `PATCH /breweries/:id/batches/:batchId/events/:eventId` for målinger (verdi/enhet, tidspunkt, merkelapp, variant,
      steg, notat), hendelser (tidspunkt, data, notat), bilder (bildetekst). Skriver revisjon + endring atomisk.
- [ ] API: redigere/slette varianter (splits), redigere batchnavn/bryggedato (API finnes — lag UI).
- [ ] UI: «Rediger» i loggdetalj-arket for alle typer; «redigert»-merke og «Vis historikk» i loggen.
- [ ] Tester: isolasjon (andre bryggerier får 404), revisjon skrives, samtidige endringer (siste vinner, begge i historikken).

### M2.4 Endre planen underveis

Spesifikasjonen krever at batchens snapshot er uforanderlig. Når planen endres under bryggingen (som
«Simcoe økt pga. alder» i Sunset-loggen), lages en ny **planrevisjon** i stedet for å endre snapshotet.

- [ ] Migrasjon: `batch_recipe_revisions` (batch_id, revision, data JSON, change_note, created_by, created_at), uforanderlig.
- [ ] Bryggedagen bruker siste revisjon; originalen vises som «Opprinnelig plan». Rapporten (M8) viser avvik.
- [ ] UI: «Juster plan for denne batchen» (ingredienser, mengder, tider) i batch-menyen.

---

## M3 — Timere, alarmer og skjermen på (B5)

- [ ] **Skjermen på:** Screen Wake Lock (`navigator.wakeLock.request("screen")`) mens en batch i status «brygger nå» er åpen;
      hentes på nytt ved `visibilitychange`. Bryter i batch-headeren («Skjerm på»), standard på. Faller stille tilbake der API-et mangler.
- [ ] **Delte timere:** hendelsestyper `timer_started` `{ label, durationMin, dueAt }` og `timer_cancelled`. Alle i bryggeriet ser
      samme nedtelling (polling finnes). Kort «Timere» på bryggedagen med hurtigvalg (5/10/15/20/30/60 min + egendefinert).
- [ ] **Alarmer i appen:** når en timer går ut, et steg er ferdig eller en planlagt tilsetning forfaller (fra `deriveBrewDayState`):
      lyd (Web Audio, låses opp ved første trykk), vibrasjon der støttet, og et stort alarmbanner med «Kvitter» /
      «Registrer tilsatt». Forvarsel 1 min før tilsetninger. Innstilling for lyd av/på. Kvittering er per enhet.
- [ ] Rene funksjoner for «hva forfaller når» i `src/domain/brew-day/` med tester (inkl. at tilsetninger ikke varsles to ganger).
- [ ] **Senere (M3.5, valgfritt): varsler når appen er lukket.** Web Push (VAPID) + Durable Object-alarm per aktiv timer som sender
      push til alle medlemmer. Tabell for push-abonnement. iOS krever at appen er lagt til på Hjem-skjermen. Durable Objects
      finnes på gratisnivået.

**Akseptanse:** Med telefonen liggende på benken under koken går skjermen ikke i dvale, og det piper ved hver humletilsetning.

---

## M4 — Gjæringsgraf (B7)

- [ ] Ren funksjon `buildFermentationSeries(timeline, recipe, wcf, splitId?)` i `src/domain/brew-day/`: dager siden gjærtilsetning,
      gravitet (SG; Brix korrigert med Terrill mot original-Brix, merket som avledet), temperatur, trykk; målbånd fra
      `fermentationSteps` og FG-mål. Tester med Sunset-fixturen og syntetiske avlesninger.
- [ ] Komponent `FermentationChart` (SVG, uten diagrambibliotek): designtokens, mørkt tema, mobilbredde, trykk på punkt viser verdi,
      variant-filter (Tropical/Pine), «Vis som tabell» for tilgjengelighet.
- [ ] Vises på batchsiden fra status «gjærer», og gjenbrukes i rapporten (M8).

---

## M5 — BeerSmith/BeerXML-import med vannplan og utstyr (B3)

**Brage må:** eksportere 3–5 oppskrifter fra BeerSmith (File → Export → BeerXML), gjerne også utstyrsprofilen og en
`.bsmx`-fil, og legge dem i `tests/fixtures/beersmith/`. Ta skjermbilder av BeerSmiths vann-/mesk-fane for de samme
oppskriftene. Da blir de referansetester (spesifikasjonen §44).

- [ ] Parser `src/domain/import/beerxml.ts` (ren funksjon: XML-tekst → `{ recipes: [{ recipe, equipment?, warnings }] }`).
      Bruk `fast-xml-parser` med `processEntities: false`, og avvis input med `<!DOCTYPE`/`<!ENTITY` (spesifikasjonen §50).
      Parsing skjer i nettleseren; serveren validerer det normaliserte resultatet som i dag.
- [ ] Mapping (BeerXML 1.0 er SI): humlemengde kg→g; farge °L→EBC; HOP USE Boil / Dry Hop / Mash / First Wort / Aroma (→ whirlpool);
      tørrhumle-TIME minutter→dager; YEAST AMOUNT/AMOUNT_IS_WEIGHT; MISC USE; EST_OG/EST_FG/IBU/EST_COLOR/EST_ABV → mål.
      Imperial display-felter ignoreres (SI-feltene er fasit).
- [ ] Utvid oppskriftsmodellen (valgfrie felt, bakoverkompatibelt): `mashSteps[].type`, `infusionAmountL`, `infusionTempC`,
      `mash.grainTempC`, og `waterPlan { source: "beersmith" | "calculated", mashWaterL, spargeWaterL, preBoilVolumeL,
      postBoilVolumeL?, strikeTempC?, spargeTempC? }`. BeerSmiths tall lagres som de er.
- [ ] **Vannplan på bryggedagen:** kort i mesk/skylling med «Innmesking 32,4 L @ 74,6 °C», «Skyllevann …», «Før kok …», og
      volum-mål (sammenlign med loggede volumer). Viser BeerSmith-tallene; vår beregning under «Hvorfor?» og et varsel hvis de avviker mye.
- [ ] **Utstyr fra BeerSmith:** tilby admin å lage ny profilversjon fra `<EQUIPMENT>` (TRUB_CHILLER_LOSS → kettle_loss_l,
      LAUTER_DEADSPACE → mash_dead_space_l, EVAP_RATE %/t × BOIL_SIZE → boil_off_l_per_h, TUN_VOLUME, BATCH_SIZE …), med notat
      «Importert fra BeerSmith». Aldri automatisk.
- [ ] UI: aktiver «PDF / BeerXML / BeerJSON» på importsiden → filvelger → gjennomgangsskjerm (spesifikasjonen §8/§36: struktur,
      ✓/! per seksjon, merknader) → lagre én eller flere oppskrifter. Original-XML lagres i `recipe_sources`.
- [ ] Tester: fixtures (Brages filer + håndlagde: metrisk, flere oppskrifter, manglende verdier, ødelagt XML, DOCTYPE avvist),
      referansetester mot BeerSmith-tall med toleranse.
- [ ] `.bsmx` (BeerSmith sitt eget format) etter at en ekte fil er dokumentert (spesifikasjonen §45).

---

## M6 — Avslutning av batch og smaksnotater (B6)

- [ ] Flyt «Avslutt batch» i Brygg (egen side `/batcher/:id/avslutt`, erstatter dagens bekreftelse):
  1. **Nøkkeltall:** OG (forhåndsutfylt fra siste avlesning etter kok), FG per variant (siste gravitet i gjæring, Brix korrigert),
     volum til gjæring og volum pakket per variant.
  2. **Pakking:** dato, type (fat / flaske / boks), mål-CO₂. Ren funksjon `calculatePrimingSugar(volumeL, targetVolCo2, beerTempC, sugar)` med tester.
  3. **Smaksnotater:** utseende, aroma, smak, munnfølelse, helhet 1–5, «hva endrer vi neste gang».
  4. **Beregnet:** faktisk ABV, tilsynelatende forgjæring, brygghuseffektivitet (`calculateEfficiency`), fordampning, tap mot profil —
     planlagt mot faktisk side om side.
- [ ] Migrasjon: `batch_outcomes` (batch_id, split_id NULL, og, fg, volume_fermenter_l, volume_packaged_l, packaged_at, package_type,
      carbonation_vol, rating, tasting JSON, next_time TEXT, updated_by, updated_at) — redigerbar (B8) med revisjoner som i M2.3.
- [ ] Migrasjon: `calibration_observations` (spesifikasjonen §11/§40): brewery_id, batch_id, parameter_key, value, context JSON, created_at.
      Skrives ved avslutning (effektivitet, fordampning, temperaturfall mesk→kokekar når målt). **Endrer aldri profilen** — forslag er fase 7.
- [ ] Smaksnotater kan også legges til senere (ny loggtype «Smaksnotat», flere over tid: fersk, 4 uker …).
- [ ] Historikk og Hjem viser faktisk ABV og vurdering for ferdige batcher.

---

## M7 — Vann og pH (B9)

Brage har ingen saltmåler, men pH-strips. Kildevannet hentes fra kommunens vannanalyse; salter og syre planlegges;
pH-estimatet sammenlignes med strip-målinger over tid.

- [ ] **Kildevann:** ny gruppe «Vann» i utstyrsprofilen (Ca, Mg, Na, SO₄, Cl, HCO₃/alkalitet i mg/L) — versjoneres og snapshottes
      automatisk med batchen. Hjelpetekst: hvor man finner kommunens vannanalyse. Ikke hardkod verdier.
- [ ] **Oppskrift:** målprofil (valgfri; forhåndsvalg «Balansert», «Humlete», «Maltete», «Bløt/pils» — dokumenter kilde for tallene),
      `waterAdditions: [{ agent: "gypsum" | "cacl2" | "epsom" | "nacl" | "baking_soda" | "lactic_80" | "phosphoric_10", amount, target: "mash" | "sparge" }]`.
      Importeres fra BeerXML `<WATERS>`/MISC der mulig (M5).
- [ ] **Beregninger** (rene funksjoner i `brewing-calculations` + docs/calculations.md med kilder):
  - resulterende ioneprofil og sulfat:klorid-forhold,
  - restalkalitet,
  - estimert mesk-pH (dokumentert modell, merket «estimat»; valider mot BeerSmiths pH-verktøy med Brages oppskrifter),
  - syremengde for mål-pH.
- [ ] **Bryggedag:** salter og syre som planlagte tilsetninger i mesk; mål-pH mot strip-intervall (M2.2); etter noen batcher vises
      avviket mellom estimat og strips (grunnlag for kalibrering, fase 7).
- [ ] Tester med kjente eksempler og BeerSmith-referanser.

---

## M8 — Bryggerapport og eksport (B8)

- [ ] **Rapport** `/batcher/:id/rapport`: pen på skjerm og i A4-utskrift (`@media print`, `@page`). «Last ned PDF» = nettleserens
      utskrift til PDF (gratis, ingen server-PDF). Innhold:
  - hode (bryggeri, øl, batch #, dato, status, varianter),
  - planlagt mot faktisk (OG, FG, ABV, IBU, EBC, volumer, effektivitet),
  - oppskrift slik den ble brygget, med avvik fra planen fremhevet (M2.4),
  - vannplan, mesk og vann/pH (M5/M7),
  - gjæringsgraf (M4), nøkkelhendelser og måletabell,
  - resultater og smaksnotater per variant (M6),
  - bilder, kalibreringsprofil (versjon) og usikkerheter.
- [ ] **Data-eksport** (Mer → Eksport, admin): oppskrift → BeerXML (`toBeerXml`, rundtur-test mot M5-parseren), batch → CSV/JSON av
      loggen, hele bryggeriet → JSON-backup.

---

## Tverrgående krav (hver oppgave)

- Definition of Done (spesifikasjonen §59): UI, mobil, lasting/tom/feil-tilstander, autorisasjon, validering, tester, migrasjon.
- Nye bryggeri-ressurser: isolasjonstest i `tests/integration/authorization.test.ts`.
- Beregninger kun i `src/domain/brewing-calculations/` med kjente input, forventet svar og toleranse.
- Nye migrasjoner er nye filer; `db/schema/database.ts` holdes i sync.
- Oppdater `README.md` (status), `docs/architecture.md` og denne planen i samme PR.

## Utenfor scope nå

Betaling, native apper, Bluetooth/Tilt/iSpindel, full offline-synk, sosiale funksjoner, AI-assistent (fase 6),
inventar (fase 4) — med mindre Brage prioriterer om.
