# Plan for kodegjennomgang

Opprettet 2026-09-29. Appen er bygd raskt av flere økter og agenter parallelt (Claude, Codex, Sonnet). Målet med
gjennomgangen er at koden skal være **enkel å forstå, uten dupliseringer og uten mer kompleksitet enn behovet
krever** — før vi bygger mer. Gjennomgangen endrer ikke oppførsel; hver rettelse har grønne tester før og etter.

## Regler

- Én PR per område, liten nok til å leses på en kveld. Ingen ny funksjonalitet i samme PR.
- Oppførselen er uendret: `npm run typecheck`, `npm test` og `npm run build` er grønne før og etter, og
  bryggedagen sjekkes i nettleseren (mobil) når UI er berørt.
- Sletting foretrekkes framfor abstraksjon. En hjelpefunksjon innføres først når minst tre steder trenger den.
- AGENTS.md gjelder fortsatt: beregninger bare i `brewing-calculations`, domenekode uten React/DB/Worker,
  autorisasjon og isolasjonstester uendret.

## Fase 1 — Automatisk skanning (kort)

- Ubrukt kode og eksport: kjør `npx knip` (ingen ny avhengighet i repoet) og gå gjennom resultatet for hånd.
- Store filer og funksjoner: alt over ~300 linjer vurderes for oppdeling (i dag `BatchPage.tsx` 751,
  `state.ts` 564, `brew-plan.ts` 376).
- Resultat: en liste i `docs/code-review-findings.md` (område, funn, forslag, risiko).

## Fase 2 — Kjente funn (bekreftet 2026-09-29)

| # | Område | Funn | Forslag | Status |
|---|---|---|---|---|
| 1 | Domene | Tidslinje → `BrewDayLogEntry` mappes likt fire steder: `features/batches/helpers.ts`, `brew-document.ts`, `tuning.ts` og integrasjonstester | Én funksjon i `src/domain/brew-day/` som alle bruker | ✅ `toBrewDayLog` flyttet til `src/domain/brew-day/timeline.ts`; `helpers.ts` re-eksporterer den, `brew-document.ts` og `tuning.ts` bruker den direkte |
| 2 | Domene | «Mesket korn» (`grain` + `adjunct`) summeres på egen hånd i `brew-plan.ts`, `mash-adjustment.ts`, `bsmx-equipment.ts` og `worker/assistant/tools.ts`, selv om `isMashed` finnes i `gravity.ts` | Én `mashedGrainKg(recipe)` i `brewing-calculations` | ✅ `mashedGrainKg(recipe)` lagt til i `brewing-calculations/gravity.ts` (med test) og brukt i alle fire steder; `brew-plan.ts` sitt planlistefilter bruker nå også `isMashed` |
| 3 | Domene | Lokale `num()`/`round()` i `brew-document.ts`, `tuning.ts`, `brewery-history.ts`, `bsmx-equipment.ts` og `tools.ts` | Del én formatering/avrunding (domenet kan ikke bruke `src/lib/format.ts`) | ✅ delt `num`/`round` i `src/domain/format.ts`, brukt av alle fem filene. `diy-dog.ts` og `units.ts` sin `round` er urørt (annen avrundingsregel for negative tall) |
| 4 | Tester | `BatchDetail`-fixturer bygges for hånd i minst fire testfiler | Én testhjelper `makeBatch()` / `sunsetTimeline()` i `tests/` | ✅ `tests/helpers/batch.ts` brukt i alle fire filer |
| 5 | UI | Bryggedagen viser overlappende innhold: stegkort, bryggeplan, bryggedokument-panel, resultatsammendrag og gjæringskort | Avklar hva hver del har ansvar for; kutt dobbeltvisning (se fase 3) | |
| 6 | UI | Assistentsiden (`/assistent`) og Veileder-panelet dekker nå det samme | Behold én: assistentsiden kan bli en liste over batcher som åpner veilederen | ✅ `/assistent` er nå en batchliste (aktive først) som åpner `AssistantThread` per batch; Veileder-panelet uendret. |
| 7 | UI | Tre måter å gjøre Markdown om til visning: `AssistantThread`, `brew-document-view.ts`, `BatchReportPage` | Én liten renderer for det begrensede formatet vi selv lager | ✅ Delt `markdownInline`/`MarkdownList` i `design-system/Markdown.tsx`, brukt av `AssistantThread` og `BrewDocumentPanel`; seksjonsparseren i `brew-document-view.ts` uendret. `BatchReportPage` gjør ikke Markdown-parsing (bare formaterte tabellceller/fritekst) og er derfor ikke endret. |
| 8 | UI | To flytende elementer nederst på mobil (Logg-knapp og Veileder-felt) | Vurder én samlet handlingslinje | |
| 9 | Docs | `implementation-plan.md` og `architecture.md` er skrevet av mange økter; overlappende og utdaterte avsnitt | Stram inn: én kilde per beslutning, fjern historikk som ligger i git | |
| 10 | Worker | Assistent-API: gammel og ny vei (`assistant.ts` + `assistant-thread.ts`), prompt og verktøy i flere filer | Sjekk at det bare finnes én vei inn, og at hver fil har ett ansvar | |

## Fase 3 — Bryggedagen (etter første ekte bryggedag)

Bryggedagsiden ryddes **etter** at appen er brukt på en ekte bryggedag, med notater om hva som ble brukt,
savnet og aldri sett på. Da vet vi hva som kan foldes bort eller fjernes, i stedet for å gjette. B12 («enkel og
konsis») er målestokken.

## Fase 4 — Tester for flatene

Logikken er godt dekket, men brukerflatene har ingen automatiske tester (feilen med det 0 px brede tallfeltet
kom derfor i produksjon). Legg til noen få ende-til-ende-tester av bryggedagsflyten på mobilbredde: start mesk,
logg temperatur, se mesketips, registrer tilsetning, start timer. Vurder avhengigheten (Playwright) før innføring.

## Arbeidsflyt

1. Fase 1 og hvert område i fase 2 kan tas av Codex (Luna) som egne, små jobber i hver sin worktree.
2. Claude går gjennom, kjører alle tester (inkludert integrasjon, som ikke kjører i Codex-sandkassen),
   committer og lager PR.
3. Etter merge krysses området av her.

- [x] Fase 1: skanning og `code-review-findings.md`
- [ ] Fase 2: områdene 1–10
- [ ] Fase 3: bryggedagen etter ekte bruk
- [ ] Fase 4: ende-til-ende-tester
