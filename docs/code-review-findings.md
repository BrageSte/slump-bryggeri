# Funn fra kodegjennomgang — fase 1

Skannet 2026-09-29 på `claude/code-review-plan` med `npx --yes knip --reporter compact`
fra denne worktree-roten, uten å legge Knip til prosjektets avhengigheter. Kjøring fra
hovedkatalogen tar også med `.claude/worktrees/*` og gir mange falske treff.
Funnene nedenfor er kandidater for små, separate endringer; denne fasen endrer ingen kode.

| Område | Funn | Forslag | Risiko |
|---|---|---|---|
| ✅ Ubrukt UI/API | Knip finner `Skeleton` i `src/design-system/Feedback.tsx`, `useRenameBrewery` i `src/features/breweries/api.ts` og `requireAdmin` i `worker/lib/middleware.ts` uten referanser utenfor definisjonene. | Sjekk at ingen planlagt skjerm eller rute trenger dem; fjern ubrukte eksport/implementasjoner i en liten oppryddings-PR. | Lav for `Skeleton` og hooken; middels for middleware fordi autorisasjonsflyten må gjennomgås før sletting. |
| Ubrukte eksportflater | Knip rapporterer flere eksporterte konstanter og typer, blant annet i `src/domain/model/api.ts`, `src/domain/model/recipe.ts` og `src/domain/brewing-calculations/`. Flere brukes internt i egen fil. | Fjern bare unødvendig `export` etter søk i kode og tester; behold intern verdi der den fortsatt brukes. Ikke lag en ny samlemodul. | Lav til middels; eksportflaten kan være brukt av skript eller eksterne forbrukere som Knip ikke ser. |
| Bryggedag UI | `BatchPage.tsx` er 751 linjer og inneholder sidekomposisjon, aktiv bryggedag, stegkort, neste handling, ferdig visning og meny. `FermentationChart.tsx` er 521 linjer. | Når disse områdene endres, trekk ut selvstendige visningsdeler med tydelige props. Behold tilstand og dataflyt i én eier per side. | Middels; skjermbredde, alarmer og stegstatus må kontrolleres på mobil etter hver UI-endring. |
| Domene og import | `state.ts` (564), `brew-plan.ts` (376), `bsmx.ts` (517) og `api.ts` (624) er store, men har flere beslektede regler eller kontrakter. | Del kun ved en konkret ansvarsgrense: for eksempel stadiumsregler fra tilstand, fasebyggere fra planen eller BeerSmith-konvertering fra parsing. Ikke del etter linjetall alene. | Middels til høy; typene og beregningene deles av UI og Worker og krever eksisterende domenetester. |
| Worker | `worker/services/brew-log.ts` (575) håndterer tidslinje, målinger, korrigering, kommentarer og hendelser. | Vurder å skille lesing fra skriving og deretter korrigering fra ny logging når disse funksjonene berøres. Behold atomiske skriver og bryggeriscoping. | Høy; korrigering, historikk og autorisasjon må fortsatt dekkes av integrasjonstester. |
| Øvrige store filer | `RecipeEditorPage.tsx` (483), `LogSheet.tsx` (457), `BatchReportPage.tsx` (416), `MeasurementInput.tsx` (360), `diy-dog.ts` (346), `BatchResultPage.tsx` (345), `BrewPlanOverview.tsx` (321), `BrewLog.tsx` (321), `worker/assistant/tools.ts` (316) og `worker/services/batches.ts` (312) passerer omtrent 300 linjer. | Ingen egen oppdeling nå. Vurder ansvar og faktisk duplisering når et av områdene endres. | Varierer; oppdeling uten annen gevinst kan gjøre koden vanskeligere å følge. |

**Ubrukt UI/API — gjort:** `useRenameBrewery` og `requireAdmin` var reelt ubrukte utenfor definisjonen og er
fjernet; admin-ruter bruker fortsatt `requireMember("admin")` (se `docs/architecture.md`). `Skeleton` brukes
internt av `LoadingState` i samme fil, så funksjonen er beholdt — kun `export`-nøkkelordet er fjernet siden
ingen andre filer importerte den. Samtidig er det ubrukte `fieldClasses`-videresalget fra
`src/design-system/Form.tsx` fjernet (se punktet under); `inputClasses`-videresalget er beholdt fordi det
brukes av flere sider via `design-system/index.ts`.

## Treff som ikke er dødkode

- `public/sw.js` registreres som URL fra `src/main.tsx`; Knip kan ikke følge den statiske filen.
- `cloudflare:test` er en virtuell modul fra Worker-testmiljøet, ikke en manglende npm-avhengighet.
- `worker/worker-configuration.d.ts`, BeerSmith-filer og fixtures er genererte eller statiske data og
  skal ikke vurderes som store implementasjonsfiler.
- `fieldClasses` brukes direkte fra `src/design-system/field-classes.ts`; Knip pekte bare på et ubrukt
  videresalg fra `src/design-system/Form.tsx`, som nå er fjernet (✅).

De konkrete dupliseringene og UI-overlappene er allerede listet som område 1–10 i
[code-review-plan.md](code-review-plan.md). De hører til egne endringer etter denne skanningen.

- ✅ `AdaptRecipePage` brukte total fermenterbar vekt (inkl. sukker/ekstrakt) til vannvolumer; bruker nå `mashedGrainKg` via `calculateAdaptedWaterVolumes`, som bryggedagsplanen. Antatt/beregnet-merkingen er egen logikk med samme regel som `profileSetting` i `brew-plan.ts` (ikke eksportert) og er bevisst ikke slått sammen.
