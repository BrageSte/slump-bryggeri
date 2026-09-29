# Bryggeassistenten

Assistenten svarer på spørsmål om én batch. Den bruker Claude fra Anthropic, og dere betaler bare for
spørsmålene som faktisk stilles.

## Slik virker den

1. Appen lager **bryggedokumentet** for batchen (`src/domain/brew-document/brew-document.ts`): plan, utstyrssnapshot,
   status nå og hele loggen. Det vises på batchsiden og er det samme dokumentet som «Kopier bryggedokument» gir deg.
   Assistenten bruker separate Markdown-seksjoner fra samme datagrunnlag.
2. Workeren sender et **kort brief** og spørsmålet til Claude (`worker/services/assistant.ts`). Briefet inneholder
   batchhodet, status og neste handling, én linje med planens nøkkeltall, de siste åtte logglinjene og totalt antall
   loggoppføringer. Briefet mellomlagres (prompt caching).
3. Hvis briefet ikke er nok, henter Claude bare én relevant seksjon om gangen med `get_batch_section`: plan, utstyr,
   status, resultater, kalibrering eller logg. Hele loggen hentes bare for spørsmål om historikk eller tidslinje.
   `brewery_history` er forbeholdt kalibrering og spørsmål om hva som er normalt for bryggeriet.
4. Claude gjør **aldri aritmetikk selv**, heller ikke summer eller differanser. Den kaller appens egne beregninger som verktøy (`worker/assistant/tools.ts`):
   innmeskingstemperatur, vannmengder, mesketemperatur-justering, Brix → SG, ABV/forgjæring, brygghuseffektivitet,
   observert fordampning og enhetsomregning. Standardverdiene kommer fra batchens utstyrssnapshot.
5. Planlagte verdier, beregnede verdier merket «≈» og målte verdier holdes atskilt. Manglende målinger omtales som
   «ikke målt»; assistenten gjetter ikke.
6. Når bryggeren forteller om en måling eller noe som har skjedd, foreslår assistenten en loggføring med
   `propose_actions` i stedet for å be bryggeren logge det manuelt. Forslag valideres mot loggskjemaene, men
   assistenten utfører aldri en skriving. Bryggeren trykker «Logg» eller «Avvis» for hvert forslag.
7. Spørsmål og svar **lagres per batch** i `assistant_messages` og er synlige for alle i bryggeriet. D1 beholder
   hele tråden; API-et viser de 100 nyeste meldingene, eldste først, mens modellen får de siste omtrent 12 som
   samtalehistorikk.
   Forslagene lagres sammen med assistentsvaret. Når en brygger logger eller avviser et forslag, lagres hvem som
   gjorde det og tidspunktet, slik at alle ser utfallet.
8. Serveren reserverer antall spørsmål atomisk per dag (`assistant_daily_requests`) og lagrer tokenbruk per dag
   (`assistant_usage`) for kostnadsvisningen. Antall nettsøk inngår også i kostnadsanslaget. Spørsmål lagres før
   Anthropic-kallet, så de står igjen i tråden også når assistenten returnerer en feil.

## Når søker assistenten på nett?

Assistenten søker bare når svaret avhenger av konkrete eksterne fakta som ikke finnes i batchkonteksten eller
beregningsverktøyene: humlens alfasyre eller olje, gjærens temperatur- eller utgjæringsområde, maltfarge eller
ekstrakt, stilretningslinjer — eller når bryggeren ber uttrykkelig om en kilde. Den søker aldri etter data for
denne batchen, bryggeriets historikk eller noe et beregningsverktøy kan svare på. Den bør bruke ett avgrenset søk.
Finner den ingen pålitelig kilde, skal den si det i stedet for å gjette. Bryggepraksis som er godt etablert kan
besvares uten søk, men merkes som generell veiledning, ikke som et faktum om denne batchen.

Nettsøket er begrenset til disse kildene:

- Humle: Yakima Chief (`yakimachief.com`), BarthHaas (`barthhaas.com`), Hopsteiner (`hopsteiner.com`).
- Gjær: Fermentis (`fermentis.com`), Lallemand (`lallemandbrewing.com`), White Labs (`whitelabs.com`),
  Wyeast (`wyeastlab.com`), Omega Yeast (`omegayeast.com`).
- Malt: Weyermann (`weyermann.de`), BESTMALZ (`bestmalz.de`), Castle Malting (`castlemalting.com`).
- Stil og prosess: BJCP (`bjcp.org`), Brewers Association (`brewersassociation.org`).

Svar som bruker nettdata skal navngi organisasjonen og lenke til kilden. Kildelenkene vises også under svaret.
Humledata varierer mellom avlingsår og lot; assistenten skal si fra om dette. Serververktøyet er begrenset til
maksimalt to nettsøk per spørsmål, også når Claude fortsetter en pauset samtale. Nettsøk koster $10 per 1 000 søk
(1 cent per søk), i tillegg til tokenprisene. Dagsgrensen på spørsmål endres ikke.

## Bryggeriets egne tall

Verktøyet `brewery_history` oppsummerer bryggeriets 10 nyeste andre batcher med målte tall for fordampning,
brygghuseffektivitet, innmeskingsavvik og forgjæring per gjær, med antall, snitt og spredning. Verdiene i hver
batchs utstyrssnapshot vises ved siden av, så «profil mot målt» synes. Det leser bare batcher, logg og resultater
i eget bryggeri og skriver aldri til dem. Assistenten henter det bare ved spørsmål om kalibrering eller hva som er
normalt for bryggeriet.

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
6. Åpne **Veileder** på en batch eller **Assistent** i bunnmenyen og velg batch. Står det «ikke satt opp» mangler
   nøkkelen; ellers er det klart. Samtalen følger batchen og deles med hele bryggeriet.

Testene setter alltid en tom nøkkel og kaller aldri det ekte API-et.

## Innstillinger (`wrangler.jsonc` → `vars`)

| Variabel | Standard | Betydning |
|---|---|---|
| `ASSISTANT_MODEL` | `claude-sonnet-5` | Modellen. `claude-haiku-4-5` er billigst, `claude-opus-5` er sterkest og dyrest. |
| `ASSISTANT_DAILY_LIMIT` | `40` | Maks spørsmål per bryggeri per døgn (UTC). |
| `ASSISTANT_WEB_SEARCH` | `on` | `off` deaktiverer nettsøket. |

I tillegg er det en grense på 10 spørsmål per minutt (`ASSISTANT_RATE_LIMITER`), inntil 6 beregningsrunder per
spørsmål og maks 8000 tokens i svaret.

## Kostnad

Listepris per million tokens (september 2026): Haiku 4.5 $1 inn / $5 ut, Sonnet 5 $2 / $10, Opus 5 $5 / $25.
Inn-tokenbruken varierer med briefet, hvilke seksjoner eller beregninger spørsmålet trenger, og antall runder. Et
vanlig spørsmål sender derfor ikke hele den voksende loggen hver gang. Appen viser et anslag for dagen og måneden
basert på tokenbruk og nettsøk fra API-et; fakturaen i Anthropic Console er fasit.

## Feilmeldinger

| Melding i appen | Årsak | Gjør |
|---|---|---|
| Assistenten er ikke satt opp | `ANTHROPIC_API_KEY` mangler | Oppsett punkt 4–5 |
| Anthropic avviste API-nøkkelen | Feil eller slettet nøkkel | Lag ny nøkkel og legg den inn på nytt |
| Anthropic-kontoen er tom for kreditt | Kreditten er brukt opp | Fyll på under Billing |
| Modellen er ikke tilgjengelig | `ASSISTANT_MODEL` finnes ikke for nøkkelen | Bruk en modell fra tabellen over |
| Dagens grense er nådd | `ASSISTANT_DAILY_LIMIT` | Vent til midnatt (UTC) eller øk grensen |
| Fikk ikke kontakt med Anthropic | Nett eller Anthropic nede | Prøv igjen |
