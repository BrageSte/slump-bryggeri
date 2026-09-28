# Bryggeassistenten

Assistenten svarer på spørsmål om én batch. Den bruker Claude fra Anthropic, og dere betaler bare for
spørsmålene som faktisk stilles.

## Slik virker den

1. Appen lager **bryggedokumentet** for batchen (`src/domain/brew-document/brew-document.ts`): plan, utstyrssnapshot,
   status nå og hele loggen. Det er det samme dokumentet som «Kopier bryggedokument» gir deg.
2. Workeren sender dokumentet og spørsmålet til Claude (`worker/services/assistant.ts`). Dokumentet mellomlagres
   (prompt caching), så gjentatte beregninger i samme spørsmål blir billige.
3. Claude regner **aldri ut bryggetall selv**. Den kaller appens egne beregninger som verktøy (`worker/assistant/tools.ts`):
   innmeskingstemperatur, vannmengder, mesketemperatur-justering, Brix → SG, ABV/forgjæring, brygghuseffektivitet,
   observert fordampning og enhetsomregning. Standardverdiene kommer fra batchens utstyrssnapshot.
4. Assistenten kan **ikke endre noe** i appen. Den sier hva som bør logges eller justeres i kalibreringen;
   en person gjør det.
5. Spørsmål og svar lagres ikke på serveren (bare i fanen). Serveren reserverer antall spørsmål atomisk per dag
   (`assistant_daily_requests`) og lagrer tokenbruk per dag (`assistant_usage`) for kostnadsvisningen.

## Oppsett (én gang)

1. Lag en konto på [console.anthropic.com](https://console.anthropic.com).
2. **Billing:** kjøp kreditt (forhåndsbetalt) og sett et **månedlig forbrukstak** (Settings → Limits). Da kan regningen
   aldri bli større enn taket.
3. **API keys:** lag en nøkkel, for eksempel «slump-bryggeri». Den vises bare én gang.
4. Produksjon, fra prosjektmappa:

   ```bash
   npx wrangler secret put ANTHROPIC_API_KEY --env production
   ```

   Lim inn nøkkelen når du blir spurt. Gjør dette etter at koden er deployet (merge til `main`); hemmeligheten
   gjelder med én gang, uten ny deploy.
5. Lokalt: sett `ANTHROPIC_API_KEY=` i `.dev.vars` og start `npm run dev` på nytt.
6. Åpne **Assistent** i bunnmenyen. Står det «ikke satt opp» mangler nøkkelen; ellers er det klart.

Testene setter alltid en tom nøkkel og kaller aldri det ekte API-et.

## Innstillinger (`wrangler.jsonc` → `vars`)

| Variabel | Standard | Betydning |
|---|---|---|
| `ASSISTANT_MODEL` | `claude-sonnet-5` | Modellen. `claude-haiku-4-5` er billigst, `claude-opus-5` er sterkest og dyrest. |
| `ASSISTANT_DAILY_LIMIT` | `40` | Maks spørsmål per bryggeri per døgn (UTC). |

I tillegg er det en grense på 10 spørsmål per minutt (`ASSISTANT_RATE_LIMITER`), inntil 6 beregningsrunder per
spørsmål og maks 8000 tokens i svaret.

## Kostnad

Listepris per million tokens (september 2026): Haiku 4.5 $1 inn / $5 ut, Sonnet 5 $2 / $10, Opus 5 $5 / $25.
Et vanlig spørsmål med bryggedokumentet er grovt 30–40 000 tokens inn og 1–2 000 ut, altså rundt 1 kr med
Sonnet 5. Appen viser et anslag for dagen og måneden under chatten; fakturaen i Anthropic Console er fasit.

## Feilmeldinger

| Melding i appen | Årsak | Gjør |
|---|---|---|
| Assistenten er ikke satt opp | `ANTHROPIC_API_KEY` mangler | Oppsett punkt 4–5 |
| Anthropic avviste API-nøkkelen | Feil eller slettet nøkkel | Lag ny nøkkel og legg den inn på nytt |
| Anthropic-kontoen er tom for kreditt | Kreditten er brukt opp | Fyll på under Billing |
| Modellen er ikke tilgjengelig | `ASSISTANT_MODEL` finnes ikke for nøkkelen | Bruk en modell fra tabellen over |
| Dagens grense er nådd | `ASSISTANT_DAILY_LIMIT` | Vent til midnatt (UTC) eller øk grensen |
| Fikk ikke kontakt med Anthropic | Nett eller Anthropic nede | Prøv igjen |
