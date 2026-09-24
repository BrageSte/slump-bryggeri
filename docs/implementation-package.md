# Slump Bryggeri
## Implementation Package v0.1

**Produkt:** mobil-first PWA for brygging, oppskrifter, inventar, bryggelogg, bryggerikalibrering og AI-assistanse  
**Primærplattform:** Cloudflare  
**Status:** pre-implementation specification  
**Arbeidsprinsipp:** enkelt under brygging, avansert når man trenger det

> Dette dokumentet er prosjektets source of truth. Beslutninger tatt under implementering står i
> [architecture.md](architecture.md), [design-system.md](design-system.md) og [calculations.md](calculations.md).

---

# 1. Produktvisjon

Slump Bryggeri skal være en digital bryggeassistent som samler det man normalt har spredt mellom BeerSmith/Brewfather, notater, regneark, bilder og ChatGPT.

Appen skal hjelpe brukeren med å:

- lagre og forstå hvordan akkurat bryggeriet fungerer
- importere oppskrifter fra mange ulike kilder
- tilpasse en oppskrift til det aktuelle bryggeriet
- planlegge og gjennomføre en bryggedag
- registrere faktiske målinger og hendelser
- holde oversikt over ingredienser og utstyr
- dokumentere hvert brygg med bilder og kommentarer
- bruke en AI-assistent som kjenner bryggeriet, oppskriften, lageret og det aktuelle brygget
- forbedre bryggeriets kalibrering basert på erfaringer fra faktiske brygg

Produktet skal **ikke føles som et administrasjonssystem**.

På bryggedagen skal man i hovedsak se:

> Hva skjer nå?  
> Hva er målet?  
> Hva målte vi?  
> Hva er neste steg?

Avanserte innstillinger, kalibrering og tekniske detaljer ligger ett nivå dypere.

---

# 2. Kjerneprinsipp

## «Simple surface, deep underneath»

En ny bruker skal kunne importere en oppskrift og brygge uten å forstå datamodellen.

En erfaren bruker/admin skal samtidig kunne kontrollere:

- brygghuseffektivitet
- volumtap
- dead space
- fordampning
- temperaturtap
- varmeoverføring
- meskeparametere
- pumpe-/overføringssteg
- utbytte
- forventet OG/FG
- pH-mål
- individuelle utstyrskomponenter

Disse to brukerbehovene må ikke blandes i samme grensesnitt.

---

# 3. Produktets hovedobjekter

Systemet bygges rundt seks hovedobjekter:

### Brewery
Et felles bryggeri/workspace med medlemmer, utstyr, lager og kalibrering.

### Recipe
Den generelle oppskriften.

Oppskriften skal kunne eksistere uavhengig av et bestemt bryggeri.

### Brewery Recipe
Oppskriften etter at den er tilpasset et bestemt bryggeri.

Eksempel:

> Original: 20 L oppskrift fra bok  
> → skalert og tilpasset  
> → Slump Bryggeri: 72 L, korrigerte temperaturer, vannvolumer og humlemengder.

### Batch
En konkret gjennomføring av en oppskrift.

Batchen tar et **snapshot** av:

- oppskrift
- utstyrsprofil
- kalibrering
- ingrediensdata

senere endringer i bryggeriet skal derfor aldri endre historikken til gamle brygg.

### Brew Log
Den kronologiske historikken til batchen:

- hendelser
- målinger
- ingredienstilsetninger
- kommentarer
- bilder
- endringer
- AI-notater

### Inventory
Ingredienser og relevante beholdninger.

---

# 4. Eksempel fra faktisk brygging

Det eksisterende rednings-sour-brygget viser godt hva datamodellen må håndtere.

Brygget har blant annet volum, OG, pH, gjær, temperatur og målprofil.

Bryggeloggen inneholder videre Brix/pH-målinger, humletilsetninger, Protafloc, gjærnæring og gjærstart.

Senere prosess inneholder gjæringstemperatur, trykk, cold crash, karbonering og sekundær gjæring på frukt.

Dette betyr at loggsystemet ikke bør hardkodes rundt bare «temperatur og SG». Det trenger generiske hendelser og målinger.

---

# 5. Informasjonsarkitektur

Mobilappen får fem permanente hovedområder.

## 1. Hjem
Brygg akkurat nå.

Viser:

- aktiv batch
- neste handling
- viktige målinger
- kommende oppgaver
- lageradvarsler
- nylige brygg

## 2. Brygg
To undernivåer:

**Oppskrifter**
- importer
- opprett
- rediger
- kopier
- tilpass til bryggeri

**Batcher**
- planlagt
- brygger nå
- gjærer
- modner
- ferdig

## 3. Inventar
- malt
- humle
- gjær
- tilsetninger
- annet

## 4. Assistent
Global AI-assistent.

Assistenten får automatisk kontekst av hvor brukeren befinner seg.

## 5. Mer
- utstyr
- bryggerikalibrering
- medlemmer
- administrasjon
- eksport
- innstillinger

---

# 6. Primær brukerflyt

Det viktigste produktflowet er:

**Finn oppskrift**
→ **Importer**
→ **Kontroller AI-tolkning**
→ **Velg bryggeri**
→ **Tilpass**
→ **Kontroller ingredienser**
→ **Opprett batch**
→ **Brygg**
→ **Logg målinger**
→ **Gjæring**
→ **Smaksnotater**
→ **Avslutt batch**
→ **Oppdater kalibreringsforslag**

Alt annet er sekundært.

---

# 7. Recipe Import

Dette blir en av produktets viktigste funksjoner.

## Importkilder

Én knapp:

**Importer oppskrift**

Deretter:

### Fil
- BeerXML
- BeerJSON
- BeerSmith-data
- PDF
- bilde

### Digitalt
- nettadresse
- lim inn tekst

### Analogt
- ta bilde av oppskrift i bok
- ta bilde av magasin/oppskriftsark

### Manuelt
- tom oppskrift

BeerJSON er en god referanse for den normaliserte modellen fordi standarden allerede beskriver blant annet oppskrifter, utstyr, humle, fermenterbare ingredienser, kulturer, mash, fermentation, packaging og vannprofiler.

---

# 8. Hvordan AI-import skal fungere

AI skal **ikke direkte opprette en ferdig godkjent oppskrift**.

Pipeline:

**SOURCE**
→ OCR/teksttolking
→ AI extraction
→ normalized recipe draft
→ validering
→ bruker-review
→ lagring

Eksempel:

> «2 oz Citra @ 10 min»

tolkes til:

- ingredient: Citra
- type: hop
- quantity: 56.7 g
- timing: boil
- duration: 10 min

UI viser deretter:

**AI tolket dette som:**

Citra  
56,7 g  
Kok – 10 min

[Godkjenn]

Originalteksten beholdes slik at feil enkelt kan oppdages.

---

# 9. Original versus tilpasset oppskrift

Dette er en viktig arkitekturregel.

Systemet må alltid kunne skille mellom:

### Source Recipe
Det som sto i boka/nettsiden/BeerXML.

### Normalized Recipe
Standardisert intern representasjon.

### Brewery Adaptation
Beregnet versjon for Slump Bryggeri.

### Batch Snapshot
Det vi faktisk bestemte oss for å brygge.

Originaldata skal aldri automatisk overskrives.

---

# 10. Bryggerikalibrering

Bryggeriet får én aktiv **Equipment Profile Version**.

Eksempel:

**Slump Brewery Profile v7**

Inneholder blant annet:

### Kapasitet
- mash tun volume
- kettle volume
- fermenter capacity

### Volumtap
- mash dead space
- pump/pipe loss
- transfer loss
- kettle loss
- chiller loss
- fermentation loss

### Kok
- boil-off L/h eller %
- minimum boil volume

### Effektivitet
- mash efficiency
- brewhouse efficiency

### Temperatur
Temperaturtap modelleres eksplisitt.

Eksempel:

Mash tun  
→ pump  
→ pipe  
→ kettle

Observed:

72,0 °C  
→  
69,4 °C

ΔT = -2,6 °C

Vi bør lagre både:

**manual calibration**
og
**observations**

Ikke la én dårlig måling automatisk endre profilen.

---

# 11. Calibration Engine

Systemet registrerer observasjoner over tid.

Eksempel:

| Batch | Fra | Til | Volum | ΔT |
|---|---:|---:|---:|---:|
| #021 | 72,0 | 69,4 | 64 L | -2,6 |
| #022 | 71,5 | 69,1 | 61 L | -2,4 |
| #023 | 72,0 | 69,3 | 66 L | -2,7 |

Appen kan vise:

> Observed mean: -2.57 °C  
> Current calibration: -3.0 °C  
> Suggested: -2.6 °C

Admin må trykke:

**Apply calibration**

AI skal aldri gjøre dette automatisk.

---

# 12. Målinger

Measurements er egne dataobjekter.

Typiske typer:

- temperature
- pH
- SG
- Brix
- pressure
- volume
- flow
- weight
- gravity
- dissolved oxygen senere
- custom

Measurement lagrer:

- verdi
- enhet
- tidspunkt
- batch
- brew stage
- bruker
- kommentar
- eventuelt instrument
- prøvetemperatur hvis relevant

---

# 13. Inventar

Inventaret skal være nyttig, ikke et ERP-system.

## Malt

- navn
- produsent
- type
- mengde
- enhet
- lot/batch valgfritt

## Humle

Humle bør lagres per pakke/lot fordi alfasyre varierer.

Eksempel:

**Citra**
2025 crop  
AA: 12,8 %  
250 g  
Åpnet

Dette gjør assistenten mye smartere.

Oppskriften kan for eksempel bruke:

> Citra 50 g @ 14 % AA

lageret har:

> Citra @ 12,8 %

beregningsmotoren kan beregne forskjellen.

AI forklarer resultatet.

---

# 14. Ingredient Knowledge

Inventar og kunnskapsbase er to forskjellige ting.

### Inventory
Hva vi faktisk har.

### Ingredient Library
Hva ingrediensen er.

Eksempel Citra:

- origin
- aroma descriptors
- typical alpha acid range
- common usage
- substitution candidates
- notes

Assistenten kan da svare på:

> Hva skjer hvis vi bytter Mosaic med Citra?

men samtidig se:

> Du har faktisk 370 g Citra 12,8 % AA på lager.

Det er denne kombinasjonen som gjør AI-delen interessant.

---

# 15. AI-arkitektur

AI er et lag **oppå systemet**, ikke selve systemet.

Det skal være tre ansvar:

### 1. Interpret
Forstå naturlig språk, bilder og oppskrifter.

### 2. Explain
Forklare beregninger og bryggevalg.

### 3. Assist
Foreslå handlinger.

Det skal ikke være AI sitt ansvar å beregne deterministiske bryggeverdier.

---

# 16. Deterministic engine

Eksempel:

Brukeren:

> Oppskriften bruker 50 g Citra på 14 %, men vår er 12,8 %. Hva gjør vi?

AI:

→ identifiserer problem  
→ kaller calculator  
→ calculator returnerer resultat  
→ AI forklarer

Dette er langt mer robust enn å la språkmodellen regne selv.

Samme prinsipp brukes for:

- scaling
- gravity
- ABV
- strike water
- mash temperatures
- IBU
- water volumes
- efficiency
- boil-off
- temperature offsets

---

# 17. AI-context

Assistenten skal få kontekst dynamisk.

På Recipe-siden:

- oppskrift
- bryggeri
- lager

På Batch-siden:

- batch recipe snapshot
- brew log
- aktuelle målinger
- equipment snapshot
- inventory

På Inventory-siden:

- inventory
- ingredient library

På Calibration-siden:

- equipment profile
- relevante observasjoner

Ikke dump hele databasen inn i hver prompt.

---

# 18. AI write-policy

AI har i utgangspunktet read-only tilgang.

Den kan foreslå:

> Registrer pH 5,34 ved mash 20 min?

Bruker må velge:

**Logg måling**

Først da skrives data.

Samme regel gjelder:

- kalibrering
- lagerendringer
- oppskriftsendringer
- batch-status

---

# 19. Roller

Hold det enkelt.

## Member
Kan:

- opprette oppskrift
- opprette batch
- logge brygg
- kommentere
- laste opp bilder
- bruke AI
- se inventar

## Admin

Alt over +

- utstyr
- kalibrering
- medlemmer
- ingredient library overrides
- systeminnstillinger

Vi trenger ikke mer rollelogikk i v1.

---

# 20. Innlogging

Målet:

> skriv e-post → motta kode → logg inn.

Ingen passord.

Better Auth har støtte for email OTP, og D1 kan brukes gjennom en Kysely-kompatibel Cloudflare D1-dialekt.

Forslag:

**Better Auth**
+
**email OTP**
+
transaksjonell e-postleverandør

Bruker kan:

- opprette eget bryggeri
- bli invitert til eksisterende bryggeri

---

# 21. Teknisk arkitektur

## Frontend

React  
Vite  
TypeScript

Cloudflare har en offisiell React + Vite-stack hvor React-SPA og Worker-API kan ligge i samme applikasjon.

## Backend

Cloudflare Worker.

API:

`/api/*`

## Database

Cloudflare D1.

## Filer

Cloudflare R2.

Brukes til:

- brew photos
- recipe images
- PDFs
- import source files

## Authentication

Better Auth + email OTP.

## AI

OpenAI API kun fra backend.

API-nøkkel skal aldri eksponeres i frontend.

## PWA

Installable web app.

V1:

- app manifest
- installable
- cached application shell
- grunnleggende caching

Full konfliktfri offline-redigering er **ikke v1**.

---

# 22. Frontend dependencies

Hold dependency count lav.

Anbefalt:

- React
- React Router
- TanStack Query
- React Hook Form
- Zod
- Tailwind eller tilsvarende utility CSS

Unngå:

- Redux
- tung global state
- flere UI-frameworks samtidig

Serverdata skal i størst mulig grad være serverdata, ikke global frontend-state.

---

# 23. Design philosophy

## Brew Day First

Designet må fungere:

- på telefon
- stående
- med én hånd
- med våte/skitne hender
- i dårlig lys
- mens noe koker

Dette betyr:

### Store targets
Minimum ca. 44 px interaktive områder.

### Viktige tall er store
67,2 °C skal være mye viktigere enn teksten «Temperature measurement».

### Neste handling er tydelig
Ikke presenter ti like viktige ting samtidig.

### Avanserte innstillinger skjules
Admin/configuration bruker progressive disclosure.

---

# 24. Design system

## Brand personality

Slump skal føles:

- praktisk
- teknisk
- litt håndverksmessig
- rolig
- kompetent
- ikke corporate SaaS
- ikke «craft beer hipster»

---

# 25. Color tokens

### Base

`--color-bg: #F4F1E8`

Varm lys bakgrunn.

`--color-surface: #FFFEFA`

Kort/modaler.

`--color-text: #18231F`

Primær tekst.

`--color-text-muted: #68736D`

Sekundær tekst.

### Brand

`--color-primary: #294A3D`

Mørk bryggerigrønn.

`--color-primary-soft: #DDE8E0`

### Accent

`--color-accent: #C68B42`

Malt/kobber.

### Semantic

`--color-success: #3F7653`

`--color-warning: #B6782E`

`--color-danger: #A84E42`

`--color-info: #426C83`

Ikke bruk farger alene til å kommunisere state.

---

# 26. Dark mode

Brygging skjer ofte i mørkere lokaler.

Dark mode bør derfor være del av designet tidlig.

Bakgrunn:

`#121916`

Surface:

`#1A2420`

Text:

`#EDF2EE`

Brand accent og statusfarger justeres for kontrast.

---

# 27. Typography

Hold det enkelt.

Primær:

**Inter / system sans-serif**

Ingen behov for en egen display-font i applikasjonen.

Measurement UI bruker:

`font-variant-numeric: tabular-nums`

Eksempel:

67,2 °C  
1.061  
5,34 pH

skal ikke hoppe visuelt når tall endrer seg.

---

# 28. Type scale

Display measurement  
**40 / 44**

Page title  
**28 / 34**

Section title  
**20 / 26**

Body  
**16 / 24**

Small  
**14 / 20**

Caption  
**12 / 16**

Under 16 px bør sjelden brukes på interaktiv informasjon.

---

# 29. Spacing

4 px grid.

Tokens:

4  
8  
12  
16  
24  
32  
48  
64

Standard card padding:

16 px mobile  
20–24 px desktop

---

# 30. Shape

Small radius  
8 px

Default  
12 px

Card  
16 px

Pills/status  
999 px

Bruk lite skygger.

Hierarki skapes hovedsakelig med:

- spacing
- border
- background
- typography

---

# 31. Core components

Designsystemet skal minimum ha:

### Navigation
- MobileBottomNav
- DesktopSidebar
- PageHeader

### Data
- MetricCard
- Measurement
- MeasurementInput
- StatusChip
- TargetVsActual

### Brewing
- BrewStep
- BrewTimeline
- BrewAction
- IngredientAddition
- Timer
- BatchStatus

### Recipe
- IngredientRow
- MashStep
- FermentationStep
- RecipeMetric
- ScaleComparison

### Inventory
- InventoryRow
- LotBadge
- QuantityEditor
- LowStockBadge

### Content
- Card
- Section
- EmptyState
- Attachment
- Comment

### Interaction
- Button
- IconButton
- BottomSheet
- Modal
- ConfirmAction
- Toast

### AI
- AssistantButton
- AssistantDrawer
- SuggestedAction
- SourceContext

---

# 32. Button hierarchy

**Primary**

Neste steg / Logg / Godkjenn.

**Secondary**

Rediger / Åpne / Se detaljer.

**Ghost**

Sekundære navigasjonshandlinger.

**Danger**

Slett / forkast.

Kun én primær handling per område når mulig.

---

# 33. Measurement input

Dette er en kritisk komponent.

Eksempel:

**pH**

[ 5.34 ]

Mål: 5.2–5.4

[Logg]

Ved numeriske målinger:

- åpne numeric keyboard
- unit vises eksplisitt
- tidligere verdi tilgjengelig
- klokkeslett foreslås automatisk

---

# 34. Mobile Wireframe — Home

```text
┌────────────────────────────┐
│ SLUMP                   ☰  │
│ God bryggedag              │
├────────────────────────────┤
│ AKTIVT BRYGG               │
│                            │
│ Rednings-sour              │
│ Gjæring • dag 3            │
│                            │
│ 33.0°C    0.8 bar          │
│                            │
│ Neste:                     │
│ Sjekk gravity              │
│                            │
│ [ Åpne brygget ]           │
├────────────────────────────┤
│ Oppskrifter   Inventar     │
│ Utstyr        Historikk    │
├────────────────────────────┤
│ ○ Hjem ○ Brygg + ○ AI ○ Mer│
└────────────────────────────┘
```

---

# 35. Mobile Wireframe — Brew Day

```text
┌────────────────────────────┐
│ ← West Coast IPA       ••• │
│ BRYGGER NÅ                 │
├────────────────────────────┤
│ MASH                       │
│                            │
│ Mål         Målt           │
│ 67.0°C      66.8°C ✓       │
│                            │
│ pH target   pH             │
│ 5.2–5.4     5.34 ✓         │
├────────────────────────────┤
│ NESTE                      │
│                            │
│ Mash rest                  │
│ 32 min igjen               │
│                            │
│ [ Start overføring ]       │
├────────────────────────────┤
│ LOGG                       │
│ 10:44 pH 5.34              │
│ 10:32 Mash 66.8°C          │
│ 10:21 Mash started         │
│                            │
│ + Logg noe                 │
├────────────────────────────┤
│ [ Spør bryggeassistent ]   │
└────────────────────────────┘
```

Dette er appens viktigste skjerm.

---

# 36. Mobile Wireframe — Recipe import

```text
┌────────────────────────────┐
│ ← Importer oppskrift       │
├────────────────────────────┤
│ Hvordan vil du importere?  │
│                            │
│ 📷 Ta bilde                │
│ 🖼 Last opp bilde          │
│ 📄 PDF / BeerXML           │
│ 🔗 Nettadresse             │
│ 📋 Lim inn tekst           │
│ ✎  Opprett manuelt         │
└────────────────────────────┘
```

Etter analyse:

```text
┌────────────────────────────┐
│ Vi fant denne oppskriften  │
├────────────────────────────┤
│ Sierra-style Pale Ale      │
│ 20 L                       │
│                            │
│ Malt                 ✓     │
│ 4.5 kg Pale malt           │
│ 0.3 kg Crystal             │
│                            │
│ Humle                !     │
│ Cascade 30 g @ 60m         │
│ Cascade 25 g @ 10m         │
│                            │
│ ⚠ Alfasyre mangler         │
│                            │
│ [ Gjennomgå ]              │
│ [ Lagre oppskrift ]        │
└────────────────────────────┘
```

---

# 37. Mobile Wireframe — Brewery adaptation

```text
┌────────────────────────────┐
│ Tilpass til Slump          │
├────────────────────────────┤
│ Original     Slump         │
│ 20 L          72 L         │
│                            │
│ OG            1.056        │
│ ABV           5.6 %        │
│ IBU           42           │
├────────────────────────────┤
│ Strike temp                 │
│ 72.0°C  →     74.6°C       │
│              ↑             │
│              korrigert for │
│              systemtap     │
├────────────────────────────┤
│ Malt                       │
│ 4.5 kg → 16.4 kg           │
│                            │
│ [ Se beregninger ]         │
│                            │
│ [ Opprett batch ]          │
└────────────────────────────┘
```

---

# 38. Mobile Wireframe — Inventory

```text
┌────────────────────────────┐
│ Inventar              +    │
├────────────────────────────┤
│ Søk...                     │
│ [Malt] [Humle] [Gjær]      │
├────────────────────────────┤
│ CITRA                      │
│ 12.8 % AA                  │
│ 370 g                      │
│ ● Åpnet                    │
├────────────────────────────┤
│ CASCADE                    │
│ 6.1 % AA                   │
│ 82 g                       │
│ ⚠ Lav beholdning           │
└────────────────────────────┘
```

---

# 39. Admin Wireframe — Calibration

```text
┌────────────────────────────┐
│ Brewery calibration        │
├────────────────────────────┤
│ Transfer                   │
│ Mash → Kettle              │
│                            │
│ Current offset             │
│ -3.0°C                     │
│                            │
│ Observed                   │
│ -2.6°C                     │
│ -2.4°C                     │
│ -2.7°C                     │
│                            │
│ Suggested                  │
│ -2.6°C                     │
│                            │
│ [ Apply suggestion ]       │
├────────────────────────────┤
│ Boil off                   │
│ 8.4 L/h                    │
├────────────────────────────┤
│ Brewhouse efficiency       │
│ 74 %                       │
└────────────────────────────┘
```

---

# 40. Database model

Minimumstabeller:

### users
Auth identity.

### breweries
Workspace.

### brewery_members
user ↔ brewery + role.

### equipment
Fysiske komponenter.

### equipment_profiles
Versjonerte komplette bryggeri-profiler.

### equipment_profile_values
Kalibreringsparametere.

### recipes
Master recipe metadata.

### recipe_versions
Immutable recipe version.

### recipe_sources
Original kilde.

### recipe_ingredients
Normalized ingredient list.

### recipe_steps
Mash/boil/fermentation/etc.

### batches
Concrete brew.

### batch_recipe_snapshot
Recipe frozen at brew start.

### batch_equipment_snapshot
Equipment/calibration frozen at brew start.

### brew_events
Timeline.

### measurements
Numeric observations.

### comments
Discussion.

### attachments
R2 references.

### inventory_items
Ingredient type.

### inventory_lots
Actual purchased lot/package.

### inventory_transactions
In/out/adjustment.

### calibration_observations
Observed system behavior.

### ingredient_library
Ingredient knowledge.

### ai_threads
Conversation metadata.

### ai_messages
Optional persistent AI conversation.

---

# 41. Brew event model

Event må være generisk.

Eksempler:

`mash_started`

`measurement`

`ingredient_added`

`transfer_started`

`transfer_completed`

`boil_started`

`cooling_started`

`yeast_pitched`

`pressure_changed`

`cold_crash_started`

`packaged`

`comment`

`custom`

Dermed trenger vi ikke endre databaseschema hver gang noen finner på et nytt bryggesteg.

---

# 42. Inventory transactions

Ikke bare oppdater:

`Citra = 220 g`

Registrer:

`-150 g`
`reason = batch #032`

Dette gir historikk.

Transaksjonstyper:

- purchase
- consume
- adjustment
- discard
- transfer

---

# 43. Beregningsmotor

Lag egen modul:

`/domain/brewing-calculations`

Den skal være:

- uten React
- uten database
- uten AI
- pure functions
- fullstendig testbar

Eksempel:

`calculateAbv()`

`calculateHopAdjustment()`

`calculateRecipeScaling()`

`calculateBoilOff()`

`calculateStrikeTemperature()`

`calculateVolumeTransfer()`

`calculateTemperatureOffset()`

`calculateGravityEstimate()`

`calculateIbu()`

Dette gjør det enkelt å teste resultatene mot BeerSmith.

---

# 44. BeerSmith migration

BeerSmith er referansesystemet under oppstarten.

Før vi implementerer avanserte beregninger bør det eksporteres:

- dagens utstyrsprofil
- mash profile
- representative recipes
- oppskrifter med kjente resultater
- eventuelle gamle målinger

Målet er ikke å kopiere BeerSmith.

Målet er å lage testfixtures:

> For denne oppskriften + denne utstyrsprofilen forventer BeerSmith X.

Vår motor kan deretter sammenlignes.

---

# 45. BSMX

Ikke gjør BSMX-parser kritisk for MVP.

Først:

1. Skaff én faktisk eksportfil.
2. Dokumenter strukturen.
3. Lag parser basert på reelle data.
4. Opprett automatiske importtester.

BeerXML/BeerJSON kan støttes først.

---

# 46. Project structure

```text
/
├── docs/
│   ├── product-brief.md
│   ├── design-system.md
│   ├── architecture.md
│   ├── calculations.md
│   └── import-spec.md
│
├── src/
│   ├── app/
│   ├── components/
│   ├── features/
│   │   ├── auth/
│   │   ├── breweries/
│   │   ├── recipes/
│   │   ├── batches/
│   │   ├── inventory/
│   │   ├── equipment/
│   │   ├── calibration/
│   │   └── assistant/
│   │
│   ├── design-system/
│   ├── domain/
│   │   └── brewing-calculations/
│   └── lib/
│
├── worker/
│   ├── index.ts
│   ├── routes/
│   ├── auth/
│   ├── ai/
│   └── services/
│
├── db/
│   ├── migrations/
│   ├── schema/
│   └── seeds/
│
├── tests/
│   ├── calculations/
│   ├── import/
│   └── integration/
│
└── public/
    └── manifest/
```

---

# 47. MVP definition

MVP er ferdig når følgende scenario fungerer:

### Brage
logger inn med e-post.

### Oppretter
Slump Bryggeri.

### Inviterer
to andre brukere.

### Registrerer
utstyret.

### Importerer
en eksisterende oppskrift.

### Systemet
tilpasser oppskriften til bryggeriet.

### Oppretter
en batch.

### Tre personer
kan bruke samme live bryggelogg.

### De kan
registrere temperatur, pH, SG/Brix, kommentarer og bilder.

### Batchen
kan avsluttes og ligger i historikken.

Det er MVP.

---

# 48. Faseplan

## Phase 0 — Foundation

- repo
- CI
- Cloudflare deployment
- D1 migrations
- auth
- PWA
- design tokens
- component foundation

---

## Phase 1 — Brewery

- brewery/workspaces
- members
- roles
- equipment
- equipment profile
- basic calibration

---

## Phase 2 — Recipes

- normalized recipe model
- manual editor
- BeerXML
- BeerJSON
- recipe scaling
- brewery adaptation

---

## Phase 3 — Brew Day

- batches
- timeline
- measurements
- steps
- comments
- R2 photos
- status flow

Dette bør bli første virkelig brukbare versjon.

---

## Phase 4 — Inventory

- ingredient library
- lots
- alpha acid
- quantities
- inventory transactions
- batch consumption

---

## Phase 5 — Smart Import

- images
- PDF
- pasted text
- URLs
- AI extraction
- review UI

---

## Phase 6 — Assistant

- batch-aware assistant
- brewery-aware assistant
- calculators as tools
- inventory context
- suggested log entries

---

## Phase 7 — Calibration intelligence

- observation aggregation
- suggestions
- comparison between predicted/actual
- admin approval workflow

---

# 49. Explicit non-goals for initial build

Ikke bygg nå:

- betaling
- abonnement
- kommersiell SaaS-admin
- native iOS/Android
- avansert sensorintegrasjon
- Bluetooth
- Tilt/iSpindel
- automatisk pumpekontroll
- full offline sync
- sosial feed
- offentlig recipe marketplace
- avansert AI-agent som kan endre data fritt

Disse kan komme senere.

---

# 50. Security requirements

Alle API-endepunkter må verifisere:

`user`
→ `brewery membership`
→ `permission`

Aldri stol på `breweryId` fra frontend alene.

R2-objekter må knyttes til brewery/batch.

OpenAI credentials kun backend.

AI-verktøy må bruke samme authorization-lag som resten av API-et.

Rate limit:

- login
- AI
- uploads

Valider alle imports.

Ingen XML parser skal tillate eksterne entities.

---

# 51. Data integrity rules

Immutable:

- historical recipe snapshots
- historical equipment snapshots
- inventory transactions

Editable:

- recipe draft
- current equipment profile
- current inventory quantity through transaction
- comments

Deletion bør som hovedregel være soft-delete når historikken ellers påvirkes.

---

# 52. Testing

## Calculation tests

Hver formel får:

- known inputs
- expected result
- tolerance

Der BeerSmith-data finnes:

**BeerSmith reference test**

---

## Import tests

Fixtures:

- BeerXML
- BeerJSON
- BSMX senere
- metric
- imperial
- missing values
- malformed file

---

## Authorization

Test:

Alice – Brewery A  
Bob – Brewery B

Bob skal aldri kunne hente data fra Brewery A ved å manipulere API-id.

---

## Brew log

Test:

- chronological order
- concurrent users
- attachments
- measurement units
- edited comments

---

# 53. UX acceptance criteria

En bruker skal kunne logge en temperatur fra åpnet batch på maksimalt noen få trykk.

En bruker skal ikke måtte gå inn i admininnstillinger under en vanlig bryggedag.

En bruker skal alltid kunne se:

- nåværende steg
- mål
- faktisk måling
- neste handling

En importert AI-tolket oppskrift skal aldri lagres som godkjent uten at brukeren får se det strukturerte resultatet.

En avansert bruker skal kunne se hvordan beregninger er kommet frem.

---

# 54. PWA acceptance criteria

Appen:

- kan installeres på iOS/Android/desktop
- åpner standalone
- har korrekt icon/manifest
- husker brukerens siste relevante bryggeri
- laster app shell raskt
- håndterer midlertidig nettutfall uten blank skjerm

Full skrive-synk offline er ikke krav i første versjon.

---

# 55. Design rule: Context over dashboards

Ikke bygg en stor «analytics dashboard» bare fordi det er mulig.

På bryggedagen er dette mer nyttig:

**Mash temperature**

67,2 °C

Target 67 °C

✓ Good

enn:

- syv grafer
- fem KPI-er
- heatmaps
- widgets

Grafer brukes når historikk faktisk er relevant:

- fermentation temperature
- gravity
- pH
- calibration trends

---

# 56. Design rule: Progressive disclosure

Eksempel:

**Strike temperature**

74,6 °C

`Hvorfor?`

Trykk åpner:

> Recipe target: 67 °C  
> Grain temp: 19 °C  
> System calibration: +2.6 °C  
> Calculated strike: 74.6 °C

Detaljene finnes.

Men brukeren slipper å se dem før de er nødvendige.

---

# 57. Slump Assistant UI

Global floating assistant button.

Åpner bottom sheet på mobil.

Eksempel:

> **Spør om dette brygget**

Quick actions:

`Hva er neste steg?`

`Er pH-en OK?`

`Hva skjer hvis vi bruker Citra?`

`Oppsummer brygget så langt`

Under svaret kan AI generere handling:

> + Logg måling  
> + Legg til notat  
> + Foreslå oppskriftsendring

Ingen handling skjer uten eksplisitt brukertrykk.

---

# 58. Initial design language

Arbeidstittel:

**SLUMP.**

Kan brukes nøkternt.

Ikke over-brand produktet i første omgang.

Prioriter:

- lesbarhet
- datastruktur
- komponentkonsistens
- mobile flows

før illustrasjoner og markedsføringssider.

---

# 59. Definition of Done for implementation

En feature er ikke ferdig før den har:

- fungerende UI
- mobile layout
- loading
- empty state
- error state
- authorization
- validation
- relevante tester
- database migration hvis nødvendig

Ikke godta «happy path only».

---

# 60. Master Goal for Codex

**GOAL**

Build Slump Bryggeri as a simple, mobile-first collaborative brewing PWA that combines brewery calibration, recipes, inventory, brew-day logging and a contextual brewing assistant without becoming an overly complex brewery management system.

Use this implementation package as the product source of truth.

Prioritize a reliable domain model and excellent brew-day UX over feature count.

Use React, Vite and TypeScript with a Cloudflare Worker backend, Cloudflare D1 for structured data and R2 for uploads.

Implement authentication using passwordless email sign-in and enforce brewery membership and roles server-side.

Model recipes independently from batches. Every batch must preserve immutable snapshots of the recipe and equipment/calibration profile used when the batch was created.

Use a normalized recipe representation compatible in spirit with BeerJSON and design import adapters around that internal representation.

Keep brewing calculations in a standalone deterministic, fully tested domain module. Never use the LLM as the source of truth for deterministic brewing calculations.

Build the design system and reusable domain components before expanding feature pages.

The primary UX is mobile brew-day usage: the user should immediately understand the current step, target, measured value and next action.

Advanced brewery calibration must exist but stay outside the normal brew-day workflow.

Build incrementally according to the phases in this specification.

Do not prematurely implement payments, commercial SaaS functionality, native mobile apps, sensor integrations, complex offline synchronization or autonomous AI actions.

The first major product milestone is complete when multiple users can sign in, share one brewery, import/create a recipe, adapt it to the brewery, create a batch and collaboratively record a complete brew using measurements, comments and photos.

Before implementing advanced calculations, create reference fixtures from real BeerSmith exports and validate the calculation engine against known results.

For every feature, include authorization, validation, loading/error/empty states and tests.

When a requirement is ambiguous, preserve simplicity and the product principles in this specification rather than adding functionality.

---

# 61. First implementation sequence for Codex

Codex bør starte med:

**1. Repository foundation**

Cloudflare React/Vite app  
Worker API  
D1  
R2 binding  
tests  
CI

**2. docs/**

Legg hele implementasjonspakken inn som prosjektets source-of-truth.

**3. Design tokens + shell**

Responsive app shell og basis-komponenter.

**4. Auth + Brewery**

Innlogging → create/join brewery → membership.

**5. Database domain**

Recipe, equipment, batch og brew log.

**6. Minimum vertical slice**

Ikke bygg alle subsystemer.

Bygg:

> Create brewery  
> → Create recipe manually  
> → Create batch  
> → Log temperature  
> → See the same measurement from another account

Først når dette fungerer end-to-end skal neste system bygges.

---

# 62. Første referansebatch

Bruk **sunset ipa bryggelogg** som første realistiske fixture.

Den inneholder nok kompleksitet til å teste:

- 75 L batch
- split fermentation
- OG/Brix
- pH
- humle
- misc additions
- gjær
- temperature
- pressure
- fermentation timeline
- cold crash
- fruit variant
- carbonation

Det gjør den bedre som testdata enn en kunstig «hello world»-oppskrift.

---

# 63. Overordnet suksesskriterium

Hvis Slump fungerer riktig skal en brygger kunne stå midt i bryggingen og spørre:

> «Vi målte 68,1 grader etter pumpa. Er det mer tap enn vanlig, og hva skal neste temperatur være?»

Systemet skal da kjenne:

- batchen
- oppskriften
- hvilket steg man er på
- bryggeriets kalibrering
- tidligere målinger
- den nye målingen

beregningsmotoren skal regne,

og AI skal forklare.

Det er kjernen i produktet.
