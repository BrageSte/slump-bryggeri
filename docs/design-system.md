# Designsystem

Implementert i `src/design-system/`. Bygger på §23–33 i implementasjonspakken.

## Prinsipper

- **Brew day first**: telefon, stående, én hånd, våte hender, dårlig lys.
- Interaktive flater er minst 44 px høye (`min-h-11`); primærknapper på bryggedagen er 56 px (`size="lg"`).
- Viktige tall er store og bruker `tabular` (tabular-nums) så de ikke hopper.
- Én primær handling per område. Avanserte detaljer bak «Hvorfor?» / «Se beregninger» (progressive disclosure).
- Farge brukes aldri alene: statuschips har alltid tekst og ikon (✓ OK, ↑ Høy, ↓ Lav, ⚠ Usikker, ⏱ Ikke målt).

## Tokens

Definert som CSS-variabler i `tokens.css` og eksponert som Tailwind-farger (`bg-surface`, `text-muted` …).

| Token | Lys | Mørk |
|---|---|---|
| `bg` | `#F4F1E8` | `#121916` |
| `surface` | `#FFFEFA` | `#1A2420` |
| `text` | `#18231F` | `#EDF2EE` |
| `text-muted` | `#68736D` | `#9DABA2` |
| `primary` (flater) | `#294A3D` | `#3A6B57` |
| `primary-strong` (tekst/ikoner) | `#294A3D` | `#9CCBB2` |
| `primary-soft` | `#DDE8E0` | `#22352D` |
| `accent` | `#C68B42` | `#D9A15E` |
| `success` | `#3F7653` | `#7CC095` |
| `warning` | `#9A6423` ¹ | `#E0AC6B` |
| `danger` | `#A84E42` | `#E8958A` |
| `info` | `#426C83` | `#86B6D1` |

¹ Spesifikasjonen sier `#B6782E`; den gir for lav kontrast som tekst (≈ 3:1), så lys varselfarge er mørknet.

Mørkt tema følger systemet, eller brukerens valg under Mer → Innstillinger (`data-theme` på `<html>`).

Typografi (§28): `text-display` 40/44, `text-title` 28/34, `text-section` 20/26, `text-body` 16/24,
`text-small` 14/20, `text-caption` 12/16. Font: Inter hvis installert, ellers systemfont.

Form (§30): `rounded-sm` 8, `rounded-md` 12, `rounded-card` 16, `rounded-full` for piller. Lite skygger.

## Komponenter

| Gruppe | Komponenter |
|---|---|
| Navigasjon | `AppShell` (MobileBottomNav + DesktopSidebar), `PageHeader`, `SegmentedControl`, `ListLink` |
| Data | `Measurement`, `MetricCard`, `StatusChip`, `TargetStatusChip`, `TargetVsActual` |
| Bryggedag | `MeasurementInput`, `BrewLog`, `LogSheet` (i `features/batches/`) |
| Innhold | `Card` (`highlight` for NESTE), `Section`, `SectionLabel`, `ListCard`, `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton` |
| Interaksjon | `Button` (primary/secondary/ghost/danger), `IconButton`, `BottomSheet` (`<dialog>`), `ConfirmDialog`, `Toast` |
| Skjema | `Field`, `TextInput`, `Select`, `TextArea`, `parseDecimal` |
| Ikoner | `Icon` — eget, lite strek-ikonsett (ingen ikonbibliotek) |

## Tall og enheter

- `parseDecimal` godtar norsk desimalkomma («66,5»).
- `MeasurementInput` lar bryggeren velge enhet ved siden av tallet og viser samtidig lagret kanonisk verdi.
- SG skrives med punktum (1.061); «1061» eller «61» tolkes som 1.061 i måleinput.
- Brix før gjæring viser live «≈ SG» med bryggeriets refraktometer-WCF; etter gjæring kreves opprinnelig Brix og resultatet merkes som beregnet.

## Tilgjengelighet

- `<dialog>` gir fokusfelle og Escape; arket fokuserer første felt så talltastaturet kommer opp.
- Synlig fokusring (`--focus`), `aria-current` i navigasjon, `role="alert"` på feil.
- `prefers-reduced-motion` respekteres.
