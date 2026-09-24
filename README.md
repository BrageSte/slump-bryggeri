# Slump Bryggeri

Mobil-først PWA for brygging: oppskrifter, bryggerikalibrering, felles bryggelogg og (senere)
inventar og en bryggeassistent. Cloudflare Workers + D1 + R2, React + Vite + TypeScript.

**Source of truth:** [docs/implementation-package.md](docs/implementation-package.md)

## Kom i gang

```bash
npm install
cp .dev.vars.example .dev.vars   # sett BETTER_AUTH_SECRET (openssl rand -base64 32)
npm run db:migrate:local
npm run db:seed:library:local    # oppskriftsbiblioteket (415 oppskrifter)
npm run dev                      # http://localhost:5173
```

Logg inn med en hvilken som helst e-post. Lokalt sendes ingen e-post — innloggingskoden skrives i
terminalen der `npm run dev` kjører. Under «Importer oppskrift» ligger Sunset IPA som eksempel.

| Kommando | |
|---|---|
| `npm test` | Enhetstester (beregninger, bryggedag) + integrasjonstester i workerd med D1/R2 |
| `npm run typecheck` | TypeScript for app, worker, tester og config |
| `npm run build` | Produksjonsbygg |
| `npm run deploy` | Bygg og deploy til Cloudflare (se [docs/architecture.md](docs/architecture.md#deploy-cloudflare)) |
| `npm run icons` | Generer PWA-ikoner på nytt |

## Status

| Fase | Innhold | Status |
|---|---|---|
| 0 Foundation | Repo, CI, D1-migrasjoner, auth (e-post-OTP), PWA, designtokens, komponenter | ✅ (deploy krever Cloudflare-ressurser) |
| 1 Brewery | Bryggerier, medlemmer, invitasjoner, roller, utstyr, versjonert kalibreringsprofil | ✅ |
| 2 Recipes | Normalisert oppskriftsmodell, manuell editor, versjoner, skalering, tilpasning til bryggeriet, oppskriftsbibliotek (415 DIY Dog-oppskrifter) | ✅ — BeerXML/BeerJSON-import gjenstår |
| 3 Brew Day | Batcher med snapshots, stadier, mål vs. målt, tilsetninger, felles logg, kommentarer, bilder (R2), split-gjæring | ✅ |
| 4 Inventory | Lots, alfasyre, transaksjoner | ⏳ |
| 5 Smart Import | Bilde/PDF/tekst/URL + AI-tolkning med gjennomgang | ⏳ |
| 6 Assistant | Kontekstbevisst assistent med beregningsmotoren som verktøy | ⏳ (ligger under Mer til den er bygget) |
| 7 Calibration intelligence | Observasjoner → forslag → admin godkjenner | ⏳ (beregningen `summarizeCalibrationObservations` finnes) |

## Dokumentasjon

- [Arkitektur og beslutninger](docs/architecture.md)
- [Designsystem](docs/design-system.md)
- [Beregningsmotor](docs/calculations.md)
