# Slump Bryggeri

Mobil-først PWA for brygging: oppskrifter, bryggerikalibrering, felles bryggelogg og (senere)
inventar og en bryggeassistent. Cloudflare Workers + D1 + R2 (KV fallback), React + Vite + TypeScript.

**Source of truth:** [docs/implementation-package.md](docs/implementation-package.md) · **Neste steg:** [docs/implementation-plan.md](docs/implementation-plan.md)

**Produksjon:** https://slump-bryggeri.brage-steen.workers.dev

## Kom i gang

```bash
npm install
cp .dev.vars.example .dev.vars   # sett BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run db:migrate:local
npm run db:seed:library:local    # oppskriftsbiblioteket (415 oppskrifter)
npm run dev                      # http://localhost:5173
```

Appen kjører i **bryggerimodus**: ingen innlogging, bare «Hvem er du?». Lokalt kreves ingen bryggerikode
(sett `BREWERY_ACCESS_CODE` i `.dev.vars` for å teste den). I produksjon deles koden i bryggeriet.
Under «Importer oppskrift» ligger Sunset IPA som eksempel, og under Oppskrifter → Bibliotek 415 oppskrifter.

| Kommando | |
|---|---|
| `npm test` | Enhetstester + workerd-integrasjonstester med D1/R2 og en separat kjøring uten R2 for KV-fallback |
| `npm run typecheck` | TypeScript for app, worker, tester og config |
| `npm run build` | Produksjonsbygg |
| `npm run deploy` | Bygg og deploy til Cloudflare (se [docs/architecture.md](docs/architecture.md#deploy-cloudflare)) |
| `npm run icons` | Generer PWA-ikoner på nytt |

Administratorer kan laste ned en versjonert JSON-sikkerhetskopi under **Mer → Eksport**. Vedleggsmetadata og
nedlastingslenker følger med; bilde- og PDF-bytes gjør det ikke, og gjenoppretting støttes ikke ennå.

Målinger lagres metrisk. Måleinput starter alltid med metriske enheter, men lar deg velge en annen enhet for
den aktuelle inntastingen og viser omregningen med én gang. Valget huskes ikke. pH-strips logges som intervall;
delvis overlapp med målet vises som **Usikker**. Omregneren er tilgjengelig fra **Mer** og målearket på
bryggedagen.

## Status

| Fase | Innhold | Status |
|---|---|---|
| 0 Foundation | Repo, CI, D1-migrasjoner, bryggerimodus (+ e-post-OTP klar for senere), PWA, designtokens, komponenter | ✅ |
| 1 Brewery | Bryggerier, medlemmer, invitasjoner, roller, utstyr, versjonert kalibreringsprofil | ✅ |
| 2 Recipes | Normalisert oppskriftsmodell, manuell editor, versjoner, skalering, tilpasning til bryggeriet, oppskriftsbibliotek (415 DIY Dog-oppskrifter) | ✅ — BeerXML/BeerJSON-import gjenstår |
| 3 Brew Day | Batcher med snapshots, stadier, mål vs. målt, tilsetninger, felles logg, kommentarer, bilder (R2), split-gjæring | ✅ |
| 4 Inventory | Lots, alfasyre, transaksjoner | ⏳ |
| 5 Smart Import | Bilde/PDF/tekst/URL + AI-tolkning med gjennomgang | ⏳ |
| 6 Assistant | Kontekstbevisst assistent med beregningsmotoren som verktøy | ⏳ (ligger under Mer til den er bygget) |
| 7 Calibration intelligence | Observasjoner → forslag → admin godkjenner | ⏳ (beregningen `summarizeCalibrationObservations` finnes) |

## Dokumentasjon

- **[Implementeringsplan v0.3](docs/implementation-plan.md)** — neste milepæler (M1–M9)
- [Arkitektur og beslutninger](docs/architecture.md)
- [Designsystem](docs/design-system.md)
- [Beregningsmotor](docs/calculations.md)
