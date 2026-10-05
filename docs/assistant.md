# Bryggeassistenten

Assistenten har to delte samtaler: én per batch, som svarer på spørsmål om det brygget, og én for hele bryggeriet om
oppskrifter, utstyr og historikk ([Bryggeritråden](#bryggeritråden-oppskrifter)). Den bruker Claude fra Anthropic, og dere
betaler bare for spørsmålene som faktisk stilles.

## Slik virker den

1. Appen lager **bryggedokumentet** for batchen (`src/domain/brew-document/brew-document.ts`): plan, utstyrssnapshot,
   status nå og hele loggen. Det vises på batchsiden og er det samme dokumentet som «Kopier bryggedokument» gir deg.
   Assistenten bruker separate Markdown-seksjoner fra samme datagrunnlag.
2. Workeren sender et **kort brief** og spørsmålet til Claude (`worker/services/assistant.ts`). Briefet inneholder
   batchhodet, status og neste handling, én linje med planens nøkkeltall, de siste åtte logglinjene og totalt antall
   loggoppføringer. Briefet mellomlagres (prompt caching).
3. Hvis briefet ikke er nok, henter Claude bare én relevant seksjon om gangen med `get_batch_section`: plan, vann,
   utstyr, status, resultater, kalibrering eller logg. Hele loggen hentes bare for spørsmål om historikk eller tidslinje.
   `brewery_history` er forbeholdt kalibrering, spørsmål om hva som er normalt for bryggeriet og hvordan tidligere batchers
   vann, salter, syre og pH ser ut.
4. Claude gjør **aldri aritmetikk selv**, heller ikke summer eller differanser. Den kaller appens egne beregninger som verktøy (`worker/assistant/tools.ts`):
   innmeskingstemperatur, vannmengder, mesketemperatur-justering, Brix → SG, ABV/forgjæring, brygghuseffektivitet,
   observert fordampning og enhetsomregning. Standardverdiene kommer fra batchens utstyrssnapshot.
   `water_chemistry` gir batchens vannkjemi i fire adskilte deler (oppgitt kildevann, beregnet, plan, målt) og kan regne «hva om»
   med salter; veiledningsvinduer følger med merket som veiledning. Den predikerer ikke mesk-pH og doserer ikke syre, og
   assistenten er bedt om å si det i stedet for å anslå ([water.md](water.md)).
5. Planlagte verdier, beregnede verdier merket «≈» og målte verdier holdes atskilt. Manglende målinger omtales som
   «ikke målt»; assistenten gjetter ikke.
6. Assistenten leser **hele spørsmålet først**, henter relevant plan ved behov og svarer på alle delspørsmål med råd og
   neste praktiske steg. Bare en tydelig ny faktisk måling eller hendelse i denne batchen blir et valgfritt loggforslag med
   `propose_actions`. Plan, mål, hypotese, sitat, allerede logget verdi eller «ikke logg» gir ingen handling. Et usikkert kar
   eller tidspunkt skal avklares; det gjettes ikke. Assistenten spør ikke «skal jeg logge?» når kortet allerede gir valget. Forslag valideres mot loggskjemaene, men
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

## Bryggeritråden (oppskrifter)

Under **Assistent → Oppskrifter og bryggeriet** er det én delt samtale for hele bryggeriet, uten batch. Den lagres i
`assistant_messages` med `batch_id` NULL (migrasjon `0013`), deler dagskvoten og kostnadsvisningen med batchtrådene, og er
bare synlig for medlemmer av bryggeriet. Spørsmål lagres før Anthropic-kallet, som i batchtråden.

1. **Kort brief** (`src/domain/brew-document/brewery-brief.ts`): bryggeriets navn, aktiv utstyrsprofil med de verdiene som
   trengs for å lage en oppskrift (batchvolum, effektivitet, fordampning, mesketykkelse og kar) og hvor hver kommer fra
   («satt for hånd», «kalibrert» eller «≈ antatt standard»), Slumps basisvann (Holsfjorden, oppgitt av leverandør) og
   oppskriftslisten. Finnes ingen profil, sier briefen at assistenten skal spørre i stedet for å anta.
2. **Verktøy** (`worker/assistant/recipe-tools.ts`), i tillegg til `brewery_history`, `abv_and_attenuation` og
   `convert_units`: `list_recipes` (id, navn, stil, versjon og appens estimerte OG, FG, ABV, IBU og farge), `get_recipe`
   (én oppskrift med ingredienser, steg, vannplan og beregnede tall) og `design_recipe`. Batchverktøyene finnes ikke her, og
   `design_recipe` finnes ikke i batchtråden.
3. **`design_recipe`: modellen gir struktur, appen regner mengdene.** Modellen sender malt som andel av totalmassen, humle med
   bruk, tid, alfasyre og andel av IBU (eller g/L for tørrhumle), gjær, mesk- og gjæringssteg, mål (OG og IBU tilpasses, farge,
   FG og ABV sammenlignes) og eventuelt ønsket vannprofil. Appen regner kg malt, gram humle og gram salt
   (`designRecipe` og `applyWaterPlan`, se [calculations.md](calculations.md)), bygger oppskriften, kontrollerer den mot
   oppskriftsskjemaet og gir modellen oppskrift, beregnet OG/FG/ABV/IBU/farge ved siden av målene, vannet og, ved
   `basedOnRecipeId`, hva som er endret fra den gamle. Et felt for mengder finnes ikke i verktøyet: sender modellen
   `amountKg` eller `amountG`, avvises kallet. Inkonsistente innspill (andeler som ikke blir 100 %, bitrende humle uten
   alfasyre) gir en feilmelding modellen kan rette på.
4. **Utkast, ikke lagring.** Resultatet av `design_recipe` følger svaret som et *utkast* (`recipe_draft` i `actions`), vist
   som et kort med navn, stil og appens egne tall, og hele oppskriften på forespørsel. Bare `design_recipe` kan lage et utkast,
   så innholdet er alltid regnet av appen, og høyst tre utkast per svar. Assistenten lagrer aldri en oppskrift. «Åpne utkast»
   åpner redigereren med beregnede mengder; brukerens «Lagre» er eneste skriving. Forespørselen bevares som kilde, og en
   endring får ny oppskriftsversjon og egen kilde uten å endre den opprinnelige. «Brygg denne» går gjennom samme gjennomgang
   og lagring, deretter batchveiviseren med oppskriften valgt. Utkast til en eksisterende oppskrift beholder grunnversjonens id
   og kan ikke lagres over en nyere versjon. Gamle utkast uten versjonsgrunnlag må lages på nytt.
5. **Standardverdier.** Batchstørrelse, effektivitet og kokotid kommer fra brukeren, ellers fra grunnoppskriften (ved ny versjon),
   ellers fra utstyrsprofilen. Mangler de, spør assistenten. Assistenten skal si hvilke den brukte, særlig når effektiviteten er den
   ukalibrerte standardantakelsen.
6. **Ingen inventar.** Bryggeren kan si hva hen har hjemme i fritekst, og assistenten bygger rundt det og sier hva som bør kjøpes.
7. **Vann.** Basisvannet tas som gitt (ingen egen analyse kreves). Gir modellen et vannmål, regner appen saltene fra Holsfjorden og
   mesk- og skyllevannet i bryggeplanen. Ingen syredosering og ingen mesk-pH-modell; å måle mesk-pH er valgfritt og foreslås bare
   når det betyr noe.
8. **Grenser.** Inntil 8 beregningsrunder per spørsmål (6 i batchtråden), siden en oppskrift kan trenge oppslag, historikk og et
   nytt forsøk. Nettsøk og kilder fungerer som i batchtråden.

## Bryggeriets egne tall

Verktøyet `brewery_history` oppsummerer bryggeriets 10 nyeste andre batcher med målte tall for fordampning,
brygghuseffektivitet, innmeskingsavvik og forgjæring per gjær, med antall, snitt og spredning. Per batch følger også
vann og pH med: kildevannet som ble brukt, mesk-pH-målet, pH-målinger med prøvepunkt, temperatur og instrument, og
tilsatte salter og syre med mengde og styrke. Ingenting av det er predikert. Verdiene i hver
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
6. Åpne **Veileder** på en batch eller **Assistent** i bunnmenyen og velg en batch eller «Oppskrifter og bryggeriet». Står det
   «ikke satt opp» mangler nøkkelen; ellers er det klart. Samtalen følger batchen (eller bryggeriet) og deles med hele bryggeriet.

Testene setter alltid en tom nøkkel og kaller aldri det ekte API-et.

## Innstillinger (`wrangler.jsonc` → `vars`)

| Variabel | Standard | Betydning |
|---|---|---|
| `ASSISTANT_MODEL` | `claude-sonnet-5-5` | Modellen. Slump bruker bare Sonnet etter Brages valg 2026-10-05; ingen automatisk Haiku-ruting. |
| `ASSISTANT_DAILY_LIMIT` | `40` | Maks spørsmål per bryggeri per døgn (UTC). |
| `ASSISTANT_WEB_SEARCH` | `on` | `off` deaktiverer nettsøket. |

I tillegg er det en grense på 10 spørsmål per minutt (`ASSISTANT_RATE_LIMITER`), inntil 6 beregningsrunder per
spørsmål (8 i bryggeritråden) og maks 8000 ut-tokens per API-runde, inkludert thinking. Sonnet/Opus 5, Sonnet 4.6 og
Opus 4.6–4.8 bruker adaptive thinking med medium effort. Eldre modeller og Haiku bruker API-standard uten de innstillingene,
og grunnversjonen av direkte nettsøk. Standardmodellen er fortsatt Sonnet 5.5.

## Kvalitet og videre plan

[Gjennomgang 2026-10-05](assistant-review.md) dekker API-tilgang, modellvalg, Jev og skills.
`npm run eval:assistant` viser 21 syntetiske norske situasjoner uten å lese API-nøkkelen eller gjøre API-kall.
`npm run eval:assistant -- --compare --repeats 2` viser oppsettet for en gjentatt sammenligning av Sonnet medium/high.
Legg til `--live` for betalte kall; eksempel:

```bash
npm run eval:assistant -- --live --compare --repeats 2 --concurrency 2 --budget-usd 1.35
```

Haiku er tatt ut av evalverktøyet etter Brages valg. Produksjonsmodellen og dens medium-innstilling endres ikke av en prøve.
Testene leser aldri produksjonsdata og skriver aldri en bryggelogg. Nøkkel tas fra miljøet eller `.dev.vars`, aldri fra
kommandolinjen. Stoppbudsjettet deles mellom alle profiler og repetisjoner og sjekkes før nye kall. Allerede sendte kall kan
føre anslaget over grensen. Prisene er estimater; Anthropic-fakturaen er fasit.

Resultater og delresultater lagres atomisk i `eval-results/`, som ikke tømmes av Playwright.
`--resume <rapport>` kan fullføre bare budsjett-hoppede oppgaver; forbruket fra forrige del bæres videre.
Kontekst, prompt, verktøy, profiler og repetisjoner må være identiske. Feilede API-kall krever en separat prøve. `--output` kan velge en annen fil,
og `--case` en situasjon. Rapporten lagrer fast fixturedato, hash av kontekst/prompt/verktøy, tidligere samtaleturene,
modellinnstilling, ordantall, svartid, cache-/tokenbruk og teksten fra hver API-runde, i tillegg til svaret appen viser.
De automatiske sjekkene gjelder handlinger, datagrunnlag og manglende svar. Hele svarteksten må vurderes separat mot
kriteriene i rapporten. Enhets-/integrasjonstestene med fake-klient tester kodekontraktene og beviser ikke modellens forståelse.

## Kostnad

Listepris per million tokens (september 2026): Haiku 4.5 $1 inn / $5 ut, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20.
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
