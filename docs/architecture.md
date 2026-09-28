# Arkitektur

Levende dokument: beslutninger som faktisk er tatt i koden. Produktkravene står i
[implementation-package.md](implementation-package.md), som er source of truth.

## Oversikt

```
Telefon / desktop (PWA, React SPA)
        │  fetch /api/*  (cookie-sesjon, same-origin)
        ▼
Cloudflare Worker (Hono)  ──  Better Auth (e-post-OTP)
        │                      │
        ├── D1 (SQLite)  ◄─────┘  strukturerte data
        ├── R2                     bilder / PDF (primærlager)
        └── KV                     fallback når R2-bindingen mangler
```

Én Worker serverer både SPA-en (static assets, SPA-fallback) og API-et. `run_worker_first: ["/api/*"]`
sender bare API-kall til Worker-koden; alt annet er statiske filer.

| Lag | Valg | Hvorfor |
|---|---|---|
| Frontend | React 19, Vite 8, TypeScript, React Router 8, TanStack Query, React Hook Form, Zod, Tailwind 4 | Spesifisert (§21–22). Serverdata ligger i TanStack Query, ingen global state. |
| Backend | Cloudflare Worker + Hono | Liten router med middleware-kjede for `user → membership → permission`. |
| Database | D1 via Kysely (`kysely-d1`) | Typede spørringer uten ORM-magi. Tabelltyper i `db/schema/database.ts`. |
| Filer | R2, med KV-fallback | Nøkkel `breweries/{breweryId}/batches/{batchId}/{attachmentId}` i begge lagre. |
| Auth | Better Auth 1.7 + email OTP, D1 direkte | Better Auth støtter D1-bindingen nativt; ingen egen dialekt nødvendig. |
| E-post | Cloudflare Email Service (`send_email`) eller Resend | Uten leverandør logges koder til dev-loggen — **kun på localhost**. |
| Tester | Vitest 4, `@cloudflare/vitest-pool-workers` | Integrasjonstester kjører i workerd med D1/R2; en separat konfigurasjon tester KV uten R2. |

## Mappestruktur

Følger §46. `src/domain/` er delt mellom frontend og Worker og har ingen avhengigheter til React,
database eller AI.

```
src/domain/brewing-calculations/  rene beregningsfunksjoner (docs/calculations.md)
src/domain/brew-day/state.ts       utleder «hva skjer nå / mål / målt / neste» fra snapshot + logg
src/domain/brew-day/brew-plan.ts   samlet bryggeplan for alle faser (vann, mesk, kok, humle, gjær, gjæring)
src/domain/brew-document/          bryggedokumentet og hva brygget sier om kalibreringen
src/domain/model/                  oppskriftsdokument (Zod), stadier, målingstyper, API-kontrakter
src/domain/fixtures/sunset-ipa.ts  første referansebatch (§62)
worker/                            Hono-app, auth, middleware, services (én fil per domene)
worker/assistant/                  bryggeassistenten: verktøy-løkke mot Claude, beregningsverktøy, priser
db/migrations/                     D1-migrasjoner (wrangler d1 migrations)
tests/                             calculations, domain, integration
```

## Bryggerimodus (ingen innlogging i starten)

Produksjon kjører i **bryggerimodus** (`BREWERY_MODE=on`): appen tjener ett bryggeri, uten kontoer.
En felles bryggerikode (`BREWERY_ACCESS_CODE`, secret) skrives inn én gang per enhet, og enheten velger
«Hvem er du?» blant bryggeriets personer. Personer er vanlige `users`-rader med plassholder-e-post, og
`requireUser` godtar enten en Better Auth-sesjon eller personen valgt på enheten (signerte cookies,
HMAC med `BETTER_AUTH_SECRET`). All autorisasjon videre (medlemskap, roller, isolasjon) er uendret.
Avvik fra §20 etter ønske fra Brage. Innlogging for andre (Google/e-post) er strøket fra planen;
e-post-OTP-koden ligger igjen, men brukes ikke i bryggerimodus.

## Autorisasjon (§50)

Alle ruter under `/api/breweries/:breweryId/*` går gjennom `requireMember()`:

1. `requireUser` henter sesjonen fra Better Auth (signert cookie).
2. `requireMember` slår opp medlemskap for *denne* brukeren i *dette* bryggeriet.
   Ikke-medlemmer får **404**, ikke 403, så andre bryggeriers eksistens ikke lekker.
3. Admin-handlinger krever `requireMember("admin")`.
4. Alle spørringer under et bryggeri filtrerer på `brewery_id` fra det verifiserte medlemskapet —
   aldri på en id fra request body. Ressurser slås opp med `id = ? AND brewery_id = ?`.

`tests/integration/authorization.test.ts` dekker Alice/Bob-scenariet fra §52, inkludert forsøk på å
nå Brewery A sine ressurser via Bob sin egen brewery-id.

Øvrig:
- CSRF: skrivende forespørsler med `Origin` fra et annet nettsted eller `Sec-Fetch-Site: cross-site`
  avvises. Sesjonscookien er `SameSite=Lax`.
- Rate limiting: Cloudflare Rate Limiting-bindinger for innlogging (per IP) og opplasting (per bruker).
  Innloggingskoder har maks 5 forsøk og lagres hashet.
- Vedlegg: kun JPEG/PNG/WebP/HEIC/PDF (ikke SVG/HTML), maks 15 MB, serveres med `sandbox`-CSP.
- Sikkerhetsheadere for statiske filer i `public/_headers`.

## Datamodell

Se `db/migrations/`. Viktige regler (§51), håndhevet i databasen med triggere:

| Uforanderlig | Hvordan |
|---|---|
| `recipe_versions` | Trigger blokkerer UPDATE. Hver lagring = ny versjon. |
| `batch_recipe_snapshots`, `batch_equipment_snapshots` | Trigger blokkerer UPDATE. Tas atomisk når batchen opprettes. |
| `equipment_profile_values` | Trigger blokkerer UPDATE. Endring = ny profilversjon (kun én aktiv). |

Sletting er soft delete (`deleted_at`) der historikk ellers påvirkes.

### Avvik fra tabellisten i §40 (bevisst)

- **Ingredienser og steg ligger i oppskriftsdokumentet**, ikke i egne `recipe_ingredients`/`recipe_steps`-tabeller.
  Oppskriften er et versjonert JSON-dokument (`recipe_versions.data`) validert av
  `recipeDocumentSchema`. Skalering, tilpasning og batch-snapshot blir da rene funksjoner på ett
  dokument, og versjoner kan ikke komme ut av sync med radtabeller. Trenger vi spørringer som
  «hvilke oppskrifter bruker Citra», legges en avledet indekstabell til.
- **`brewery_invites`** er lagt til (MVP krever invitasjoner).
- **`batch_splits`** er lagt til for delt gjæring (Sunset Tropical / Sunset Pine). Målinger og hendelser
  kan knyttes til en split.
- `users/sessions/accounts/verifications` er Better Auth sine tabeller, med flertallsnavn og snake_case.
  Mappingen står i `worker/auth/auth.ts` og må holdes i sync med `0001_auth.sql`.

### Bryggeloggen (§41)

`brew_events` er tidslinjen med åpen `type`-vokabular (`mash_started`, `ingredient_added`,
`cold_crash_started`, `custom` …). Typede detaljer ligger i egne tabeller med `event_id`:
`measurements`, `comments`, `attachments`. Nye bryggesteg krever ingen skjemaendring.

Tidslinjen sorteres på `occurred_at` (når det skjedde), så etterregistrerte målinger havner riktig.
Alle loggskjemaer og «Gå til steg» kan settes tilbake i tid; `timestampSchema` avviser tidspunkt mer enn
fem minutter frem i tid (klokker som går litt fort er greit).

Under gjæring og modning oppsummeres loggen per variant (`batch_splits`) av
`src/domain/brew-day/fermentation.ts`: OG fra siste SG/Brix etter kok, målinger i gjæringskaret (Brix
korrigeres for alkohol bare når en Brix-måling fra før gjæringen finnes), temperatur og trykk. SG vurderes
ikke mot FG-målet mens gjæringen pågår. Det samme grunnlaget tegner gjæringsgrafen; manglende målinger
interpoleres aldri.

Loggkorrigering bruker en ny `brew_events`-rad med `data.corrections` som revisjonsspor. Originalhendelsen
og eventuell målerad markeres slettet, men beholdes i databasen. `baseUpdatedAt` gir konfliktkontroll; batch
og bryggeri filtreres fra verifisert medlemskap. Erstatningen beholder opprinnelig `created_by`, mens
`data.corrections` angir hvem som korrigerte. Hendelser med type `*_started` avvises så
`batches.stage_started_at` forblir konsistent. `ingredient_added` og `yeast_pitched` valideres med
`ingredientAddedDataSchema`. Kommentarer beholder egen forfatterstyrt redigering.

Målinger lagrer både kanonisk `value/unit` og `entered_value/entered_unit`, slik at API-et kan regne med
liter/°C/g/bar/SG samtidig som loggen viser det bryggeren skrev. Måleinput starter alltid metrisk; en annen
valgt enhet gjelder bare for den aktuelle inntastingen og lagres ikke som en preferanse. Brix fra gjæring får bare
et avledet FG når batchloggen inneholder en Brix-måling før gjæring; resultatet merkes som estimat.
Stripmålinger kan lagre `value_min/value_max`; `value` er midtpunktet. Bryggedagens målstatus sammenligner
hele intervallet og viser «Usikker» når det bare overlapper målet delvis. pH-input starter med stripintervall;
enkeltverdier får bare et instrument hvis det er uttrykkelig oppgitt.

### Timere og alarmer

Timere er vanlige logghendelser: `timer_started` `{ label, durationMin, dueAt }` (serveren regner ut
`dueAt` fra tidspunktet) og `timer_cancelled` `{ timerId }` (må peke på en timer i samme batch). Alle ser
samme nedtelling via pollingen. `dueAlarms` gir forfalte timere, ferdige meske-/koke-/whirlpoolsteg og
tilsetninger (forvarsel 1 min) med faste nøkler; hvilke som er kvittert lagres per enhet i localStorage.
Lyd (Web Audio) låses opp ved første trykk; vibrasjon der nettleseren støtter det. Varsler når appen er
lukket (Web Push) er ikke bygget.

### Resultater

`batch_outcomes` har ett resultat per variant (`split_id`, NULL = hele batchen; unik indeks på
`(batch_id, IFNULL(split_id, ''))`). OG/FG lagres med kilde (`sg`, `brix`, `manual`), og NULL betyr
«ikke målt». Resultater kan endres: `PUT /batches/:id/outcomes` krever `baseUpdatedAt` fra skjemaet og gir
409 ved samtidige endringer; `updated_by/updated_at` viser hvem som endret sist. ABV, forgjæring, fordampning
og brygghuseffektivitet regnes ut ved visning (`src/domain/brew-day/outcome.ts`), aldri lagret.

### Bryggerapport

`/batcher/:id/rapport` (`BatchReportPage`) setter sammen oppskriftssnapshot, logg og resultater til ett
dokument: plan mot faktisk, malt, humle (plan mot registrert), gjær og fordeling, bryggedagsmålinger,
gjæringsgraf med tabell, resultater, kommentarer og usikkerheter. Ingen server-PDF: `@page`/`@media print` i
`tokens.css` gir A4 i lys palett, og appens navigasjon har `print:hidden`.

## Bryggeri-eksport

Administratorer kan laste ned `GET /api/breweries/:breweryId/export` fra **Mer → Eksport**. API-et bruker
`c.var.membership.breweryId` etter `requireMember("admin")` og returnerer formatet
`slump-brewery-backup`, versjon 1. `tables` beholder relasjonene, rå JSON-dokumentene og tidsstemplene for
bryggeriet, personer/medlemskap, invitasjoner, utstyr/profilverdier, oppskrifter/kilder/versjoner,
batcher/snapshots/splits/resultater og logghendelser/målinger/kommentarer/vedlegg. Auth-sesjoner og
credentials er ikke med. `files` lister vedleggsmetadata og relative nedlastingslenker; filbytes ligger
fortsatt i objektlageret. Gjenoppretting støttes ikke ennå.

## Oppskriftsbibliotek

Fanen **Oppskrifter** har to visninger: bryggeriets egne oppskrifter og et søkbart bibliotek.

- Kilde: BrewDog *DIY Dog* — 415 oppskrifter, datasett fra [alxiw/punkapi](https://github.com/alxiw/punkapi)
  (MIT). Den offisielle Punk API-en ble lagt ned i 2023, og det finnes ikke noe åpent, stabilt
  oppskrifts-API på nett (Brewer's Friend sitt API gir bare tilgang til egne oppskrifter). Derfor
  ligger datasettet i vår egen D1-tabell `recipe_library`: raskt søk, virker selv om kilden forsvinner.
- `src/domain/import/diy-dog.ts` konverterer til vår oppskriftsmodell. Kildedataene er håndtranskribert
  og rotete; alt adapteren må gjette eller utelate lagres som *merknader* og vises før man kopierer.
  Effektivitet regnes baklengs fra oppskriftens egen OG slik at tilpasning til bryggeriet bevarer
  gravitasjonen.
- Tabellen er global referansedata: lesbar for alle innloggede, aldri skrivbar via API-et.
  «Legg til i bryggeriet» (`POST /breweries/:id/recipes/from-library`) lager en vanlig oppskrift, og
  originalen lagres i `recipe_sources` (§9).
- Oppdatering: `npm run library:build -- <sti til punkapi-klon>` → `db/seeds/recipe-library.sql`
  (validerer alle oppskrifter), deretter `npm run db:seed:library:local|remote`.
- BeerSmith-filer (`.bsmx`): `POST /breweries/:id/recipes/import/bsmx` tar filnavn og tekst, parser på
  serveren med samme rene adapter som gjennomgangsskjermen (`src/domain/import/bsmx.ts`) og lager bare
  oppskrift + kilde + versjon 1. Kilden (`recipe_sources`) har originalfilen uendret i `original_text`,
  `filename` og `data` (BeerSmith-utstyr adskilt i oppgitt/avledet, vannplan, advarsler, ignorerte målte
  felt). Bryggeriets utstyrsprofil endres aldri. `GET …/recipes/:id/source/file` gir filen tilbake
  byte-lik. Kilder er uforanderlige (trigger). Maks 250 kB per fil. Se [import-bsmx.md](import-bsmx.md).
- BeerXML og AI-tolkning er strøket inntil videre.

## Navigasjon (avvik fra §5)

Etter ønske fra Brage har **Oppskrifter** fått egen fane: Hjem · Brygg · Oppskrifter · Assistent · Mer.
Brygg viser bare batcher. Inventar er strøket, så det har ingen plassholder. Assistent kom tilbake 2026-09-28 (B14).

## Sanntid

Bryggeloggen oppdateres med polling (5 s) mens en batch er aktiv, og nye målinger vises optimistisk
for den som logger. Dette er enkelt og robust på mobilnett. Durable Objects/WebSocket kan erstatte
pollingen senere uten å endre API-et.

## Offline / PWA (§54)

- `public/sw.js`: nettverk først for sider (fallback til cachet app-shell), cache først for hash-assets.
  API-svar caches aldri. Cachenavnet inneholder build-id, så hver deploy starter rent.
- Siste kjente sesjon ligger i TanStack Query-cachen, så et kort nettutfall gir ikke blank skjerm.
- Full offline-skriving er ikke v1.

## Kjøre lokalt

```bash
npm install
cp .dev.vars.example .dev.vars   # sett BETTER_AUTH_SECRET
npm run db:migrate:local
npm run dev                      # http://localhost:5173 — innloggingskoder skrives i terminalen
```

## Deploy (Cloudflare)

Produksjon: **https://slump-bryggeri.brage-steen.workers.dev** (konto brage.steen@gmail.com, D1 `slump-bryggeri` i EEUR).

`npm run deploy` bygger med `CLOUDFLARE_ENV=production` og bruker `env.production` i `wrangler.jsonc`.
Cloudflare Worker-environments arver ikke bindings, derfor er både `FILES` (R2) og `FILES_KV` oppført
både på toppnivå og under produksjon. R2-bøtta `slump-bryggeri-files` er primærlageret; KV-namespace
`slump-files` brukes bare når Worker-en mangler R2-bindingen. Begge bruker samme objektstier som
vedleggstabellen, så backendbytte krever ingen DB-migrasjon. Før KV-objekter flyttes til R2, må bytes
kopieres med samme nøkkel og `contentType` fra KV-metadata; ellers peker eksisterende loggposter
fortsatt på objekter som ikke finnes i R2. Nye opplastinger i produksjon går direkte til R2.

Bindings og namespace-id-er står i `wrangler.jsonc`. Lokal dev og Vitest bruker lokale bindings;
`vitest.kv.config.ts` peker på `wrangler.kv-test.jsonc`, som bevisst ikke har R2-bindingen.

```bash
npm run db:migrate:remote        # nye migrasjoner
npm run db:seed:library:remote   # etter at oppskriftsbiblioteket er bygget på nytt
npm run deploy
npx wrangler secret put BETTER_AUTH_SECRET --env production   # kun første gang (er satt)
```

### E-post for innloggingskoder

Innlogging krever en e-postleverandør. Koden velger i denne rekkefølgen (`worker/auth/email.ts`):

1. **Cloudflare Email Service** (anbefalt): krever et domene i Cloudflare-kontoen med Email Sending
   aktivert (`wrangler email sending enable <domene>`; Email Sending krever Workers Paid).
   Legg til `"send_email": [{ "name": "EMAIL" }]` i `wrangler.jsonc` og sett `EMAIL_FROM` til en adresse
   på domenet. Gratis alternativ for en liten gruppe: Email Routing på domenet og verifiserte
   mottakeradresser (hver brygger bekrefter adressen sin én gang).
2. **Resend**: `wrangler secret put RESEND_API_KEY` og `EMAIL_FROM` på et domene verifisert i Resend.

Uten leverandør feiler innlogging utenfor localhost — med vilje, så koder aldri havner i logger.

## Kjente begrensninger / neste steg

- Hovedbundelen er ~176 kB gzip. Zod ligger i den fordi domenemodellen eksporterer schemas; å skille
  typer/etiketter fra schemas vil spare ~40–50 kB.
- `compatibility_date` er satt til 2026-08-15 fordi test-poolens workerd ikke støtter nyere datoer ennå.
- Inventar, smart import og automatiske kalibreringsforslag er strøket fra planen (2026-09-24).

## Bryggeassistent (B14)

Claude via Anthropic-SDK-en i Workeren (`worker/services/assistant.ts`). Konteksten er bryggedokumentet
(`src/domain/brew-document/`), sendt som cachet systemblokk. Alle tall kommer fra verktøy som kaller
`src/domain/brewing-calculations/` (`worker/assistant/tools.ts`); modellen regner ikke selv og kan ikke skrive
til databasen. Batchen hentes scoped til `c.var.membership.breweryId` før noe annet, så andre bryggerier får 404.
Nøkkelen er hemmeligheten `ANTHROPIC_API_KEY`; uten den svarer API-et 503 `assistant_not_configured`.
Forbruk per bryggeri og døgn ligger i `assistant_usage` (bare tall, ikke samtaler). Testene setter alltid en
tom nøkkel. Oppsett og kostnad: [assistant.md](assistant.md).
