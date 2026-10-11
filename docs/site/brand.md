# DRVN — Brand

## Name and wordmark

- The product is **DRVN** — always uppercase, no vowels, no periods except the
  brand full stop: the wordmark is `DRVN.` where the terminal dot is set in the
  live signal color. The dot is the brand's one flourish — it reads as the
  "recording" light on the sheet.
- The wordmark is set in IBM Plex Sans at weight 700, 16px, with a touch of
  open tracking (`letter-spacing: 0.02em` — `.bar__logo` and `.rail__logo` in
  `src/app/styles/02-shell.css`); it is typography, not a drawn logo. There is
  no separate drawn icon mark — in tight spaces (favicons, monograms) use a
  `D` on an ink plate with radius 10px. That mark ships as the app icon
  (`src/app/icon.tsx`, `src/app/apple-icon.tsx`) and the collapsed register
  rail shows the wordmark's own short form, a text `D.` with the live dot
  (`.rail__logo-mark` in `src/components/ui/app-shell.tsx`).
- Beside the wordmark, chrome may carry the microlabel `BUILDS AND PARTS`
  (source text "Builds and parts" in `src/components/ui/livesheet-bar.tsx`,
  uppercased by the `.microlabel` recipe — mono, 12px, 0.14em tracking, dim).
  It names both front doors in three words; it read `PARTS MARKETPLACE` until
  September 2026, when the lockup stopped describing DRVN as only a
  marketplace (F-2).

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
| `paper-deep` | `#E5E2D8` | recessed — form controls on paper; the day `ghost-fill` |
| `tile` | `#F8F6F0` | raised widget plate |
| `tile-2` | `#F1EFE8` | secondary / deeper plate |
| `ink` | `#20232A` | text; ink-inverted surfaces |
| `dim` | `#565963` | secondary text, microlabels |
| `live` | `#C02C14` | THE signal — live states only |
| `ok` | `#256B42` | settled / done / verified |
| `warn` | `#8A5A00` | held money, due work |
| `info` | `#1D5C8A` (+ `--info-tint`) | neutral explainer status tone — never a CTA |
| `live-text` / `ok-text` / `warn-text` / `info-text` | `#A82410` / `#145C35` / `#6F4A00` / `#14527F` | chip text — one step deeper than the status hues so type clears 4.5:1 on its tint |
| `destructive` | aliases `live` | destructive actions; same hue, distinct semantic name |
| `on-ink` | `#F8F6F0` | text on ink surfaces |
| `ink-hover` | `#33363E` | hover of ink-filled controls |
| `live-hover` | `#A52410` | hover of the live fill |
| `img-fallback` | `#E2DFD5` | media box before an image |
| `ghost-fill` | `var(--paper-deep)` | secondary (ghost) button fill — recessed by day |
| `ghost-hover` | `#DBD8CD` | hover of the ghost fill |
| `scrim` | `rgba(32, 35, 42, 0.45)` | behind dialogs and sheets |
| `lightbox` | `#0A0B0E` | the lightbox stage — near-opaque, so the page behind a photo is gone |
| `photo-scrim` / `on-photo` / `on-photo-dim` | `rgba(10, 11, 14, 0.74)` / `#FFFFFF` / `rgba(255, 255, 255, 0.78)` | text over a photograph (garage hero, featured build) — same in both lightings |

> **One source per hue.** The R3 contrast pass darkened `--dim`, `--live` and
> `--ok` on `:root` so text clears WCAG 4.5:1 on paper. The `@theme` scale
> tokens (`--color-dim`, `--color-live`, `--color-ok` → `text-dim`,
> `text-live`, `text-ok` utilities) are `var()` references to those same
> `:root` values (`src/app/styles/00-tokens-base.css`), so utilities and
> component CSS cannot diverge.

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
| `live-text` / `ok-text` / `warn-text` / `info-text` | `#FF7A66` / `#6CC794` / `#E6B45E` / `#8EC4EA` — brightened a step over the night status hues |
| `on-ink` | `#14161A` |
| `img-fallback` | `#22262D` |
| `ink-hover` | `#D7D8DC` |
| `live-hover` | `#FF6047` |
| `ghost-fill` | `#242830` — raised above the graphite, so a ghost button never reads as a black slab |
| `ghost-hover` | `#2E333B` |
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
- `ok` green marks terminal good states only — never a price, never a kind
  label; `warn` amber marks held money and due work — attention without
  alarm.
- One red fill per surface: the primary action (the only bracketed button).
  Card cart buttons are outlined and the rail's List a part is a ghost
  button; the top bar's Post is the shell's red.
- Hairlines come from alpha ink (`rule-soft`, `rule-mid`); `dimline` is for
  dimension/leader lines only, never card borders.
- All text/ground pairs must clear WCAG AA 4.5:1 in both lightings (dim, live
  and ok were specifically darkened on DAY to pass).

## Surfaces and texture

- The body carries a faint 40px **graticule** (grid of `grid-line`) — the
  drafting sheet itself.
- Plates (`tile`) separate by **tone, not borders or shadows**. Nothing casts
  a drop shadow; nothing is glass; no gradients. The two `box-shadow` rings
  in the stylesheet are focus/state outlines, not elevation: the destructive
  button's inset 1.5px live ring (`.btn--destructive`,
  `src/app/styles/04-actions-rows.css`) and the search pill's 2px ink ring on
  `:focus-within` (`.search`, `src/app/styles/07-navigation.css`). The
  floating exceptions (popovers, dragged items, chips on photos) are listed in
  `/docs/rules`.
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

## Share cards

Routes that get shared carry a designed Open Graph image (`opengraph-image.tsx`
beside the page, 1200×630): cars, posts, activity posts, listings, profiles and
the root. Each is the brand's own plate — an ink ground with on-ink text, the
`DRVN.` wordmark with its live dot, and the object's photo filling one side
when it has one. Type in these cards is the system sans, not Plex:
`ImageResponse` renders outside the app's `next/font` pipeline, so the cards
set `fontFamily: "sans-serif"` rather than loading the typeface.
