# DRVN — Brand

## Name and wordmark

- The product is **DRVN** — always uppercase, no vowels, no periods except the
  brand full stop: the wordmark is `DRVN.` where the terminal dot is set in the
  live signal color. The dot is the brand's one flourish — it reads as the
  "recording" light on the sheet.
- The wordmark is set in IBM Plex Sans at weight 600 with tight tracking; it is
  typography, not a drawn logo. There is no separate icon mark — in tight
  spaces (favicons, monograms) use a `D` on an ink plate with radius 10px.
- Beside the wordmark, chrome may carry the microlabel `PARTS MARKETPLACE`
  (mono, 12px, uppercase, 0.14em tracking, dim).

## Positioning

DRVN is **the marketplace for used and take-off parts from modified cars**.
The differentiator is provenance — every part can point back at the build it
came off — but provenance is a supporting fact, never the headline. The
product leads; the story follows.

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

| Token | Hex |
| --- | --- |
| `paper` | `#171511` |
| `paper-deep` | `#100F0C` |
| `tile` | `#201E18` |
| `tile-2` | `#1B1914` |
| `ink` | `#F0EEE5` |
| `dim` | `#8F8C82` |
| `live` | `#FF4530` |
| `ok` | `#57B983` |
| `warn` | `#D9A13C` |
| `warn-tint` | `rgba(217, 161, 60, 0.14)` |
| `info` | `#6CB2DF` |
| `info-tint` | `rgba(108, 178, 223, 0.16)` |
| `on-ink` | `#171511` |
| `img-fallback` | `#262319` |

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
