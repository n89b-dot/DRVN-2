# DRVN — Brand

## Name and wordmark

- The product is **DRVN** — always uppercase, no vowels, no periods except the
  brand full stop: the wordmark is `DRVN.` where the terminal dot is set in the
  live signal color. The dot is the brand's one flourish — it reads as the
  "recording" light on the sheet.
- The wordmark is set in IBM Plex Sans at weight 600 with tight tracking; it is
  typography, not a drawn logo. There is no separate icon mark — in tight
  spaces (favicons, monograms) use a `D` on an ink plate with radius 10px.
- Beside the wordmark, chrome may carry the microlabel `BUILDS AND PARTS`
  (mono, 12px, uppercase, 0.14em tracking, dim). It names both front doors in
  three words; it read `PARTS MARKETPLACE` until September 2026, when the
  lockup stopped describing DRVN as only a marketplace (F-2).

## Positioning

DRVN is **the home for your car and its build** — follow what others are
building, and buy or sell the parts that come off. One product, two front
doors (Explore and the Marketplace), with the car in the middle. Provenance —
every part pointing back at the build it came off — is what makes both doors
work, and it is now load-bearing rather than a supporting fact. Marketplace
routes keep marketplace wording for the people and search engines arriving to
shop. The product leads; the story follows.

## Voice

- **Factual, workshop-adjacent, quiet.** Copy reads like annotations on a
  drawing, not marketing. "3 offers open" beats "You've got offers!".
- **Microlabels are the connective tissue** — 2–6 words, uppercase mono,
  labeling what a region of the sheet is: `WORK ORDERS`, `ON THIS SHEET`,
  `OFF THIS CAR`.
- **Money is exact.** `$0.00`, never "Free!!" — zero money is still money.
  Empty non-money values print an em dash `—`.
- **Waiting copy states fact, not apology.** "No offers yet. Your listing is
  live." rather than "Oops, nothing here!".
- Never fake liveness. The live color and pulsing dots are earned by real
  events only.

## Palette

Two lightings of one sheet. NIGHT is a token remap of DAY — same variables,
different values — never a second stylesheet.

### DAY (paper)

| Token | Hex | Role |
| --- | --- | --- |
| `paper` | `#EFEDE6` | canvas / page background |
| `paper-deep` | `#E5E2D8` | recessed — ghost buttons, chips, controls |
| `tile` | `#F8F6F0` | raised widget plate |
| `tile-2` | `#F1EFE8` | secondary / deeper plate |
| `ink` | `#20232A` | text; ink-inverted surfaces |
| `dim` | `#565963` (`:root`) / `#63666F` (`@theme`) | secondary text, microlabels |
| `live` | `#C02C14` (`:root`) / `#F03A20` (`@theme`) | THE signal — live states only |
| `ok` | `#256B42` (`:root`) / `#2E7D4F` (`@theme`) | settled / done / verified |
| `warn` | `#8A5A00` | held money, due work |
| `info` | `#1D5C8A` (+ `--info-tint`) | neutral explainer status tone — never a CTA |
| `destructive` | aliases `live` | destructive actions; same hue, distinct semantic name |
| `on-ink` | `#F8F6F0` | text on ink surfaces |
| `img-fallback` | `#E2DFD5` | media box before an image |

> **Trap avoidance — `:root` vs `@theme` diverge on DAY.** The R3 contrast
> pass (see `src/app/globals.css`, ~line 79) darkened `--dim`, `--live` and
> `--ok` on `:root` so text usage clears WCAG 4.5:1 on paper, while the
> `@theme` scale tokens (`text-dim`, `text-live`, `text-ok` utilities) kept
> the original hues. This is deliberate: check *which* layer you are reading
> before copying a hex. Dark theme values were already passing and match.

The "one accent" rule applies to the *signal* accent (`live`); `info` is a
status tone alongside `ok`/`warn`, never a call to action.

### NIGHT (the drawing office after hours)

Cooler paper since September 2026 (PRD 2026-09 §3). The night sheet used to be
warm sepia — a lit drawing board — which tinted the shadows of every car photo
towards brown. It is now a cool graphite sheet. The accent, the status hues and
the whole day palette are unchanged.

| Token | Hex |
| --- | --- |
| `paper` | `#121418` |
| `paper-deep` | `#0C0E11` |
| `tile` | `#1C1F25` |
| `tile-2` | `#171A1F` |
| `ink` | `#ECEEF2` |
| `dim` | `#8A909B` |
| `live` | `#FF4530` |
| `live-tint` | `rgba(255, 69, 48, 0.2)` |
| `ok` | `#57B983` |
| `ok-tint` | `rgba(87, 185, 131, 0.18)` |
| `warn` | `#D9A13C` |
| `warn-tint` | `rgba(217, 161, 60, 0.18)` |
| `info` | `#6CB2DF` |
| `info-tint` | `rgba(108, 178, 223, 0.2)` |
| `on-ink` | `#14161A` |
| `img-fallback` | `#22262D` |
| `ink-hover` | `#D7D8DC` |
| `ghost-hover` | `#262A31` |
| `scrim` | `rgba(5, 6, 7, 0.62)` |

Alpha-ink tokens (`dimline`, `grid-line`, `rule-soft`, `rule-mid`, `ghost`,
`ghost-strong`) are cut from `236, 238, 242` — the night ink — at the same
alphas as before.

Measured on the switch, against the new paper: ink 15.87:1 on `paper` and
14.21:1 on `tile`; `dim` 5.74:1 on `paper` (up from 5.52) and 5.14:1 on `tile`
(up from 4.95); `on-ink` 15.59:1 on ink and 5.30:1 on the live fill; each
status text token clears 5.7:1 on its own tint over paper. Every pairing held
or improved — the cooler sheet is very slightly darker, so secondary text
gained a little room.

### Palette rules

- **One accent.** Live red is reserved for things happening *right now*
  (live dots, countdowns, LIVE chips, arriving events) plus at most one
  primary CTA per surface. A second accent color is banned.
- `ok` green marks terminal good states; `warn` amber marks held money and due
  work — attention without alarm.
- Hairlines come from alpha ink (`rule-soft`, `rule-mid`); `dimline` is for
  dimension/leader lines only, never card borders.
- All text/ground pairs must clear WCAG AA 4.5:1 in both lightings (dim, live
  and ok were specifically darkened on DAY to pass).

## Surfaces and texture

- The body carries a faint 40px **graticule** (grid of `grid-line`) — the
  drafting sheet itself.
- Plates (`tile`) separate by **tone, not borders or shadows**. Nothing casts
  a shadow; nothing is glass; no gradients.
- In NIGHT, photographs get `brightness(0.86) contrast(1.05)` so imagery sits
  into the sheet rather than glowing on it.

## Photography

- Photography is documentary: real cars, real parts, garage light. No studio
  gradients, no lifestyle stock.
- Media sits in rounded frames (`16px` outer, `10px` inner) on the
  `img-fallback` tone while loading.
- A listing without a photo is not an error: it renders as an **undrawn
  plate** — dashed construction rule and cross-hair mark — "a plate nobody has
  drawn yet."
