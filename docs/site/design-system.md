# Livesheet — how the design system functions

> "A drawing that knows what's happening." Warm drafting-paper surfaces, ruled
> and precise, whose annotations are alive: dimension lines measure real-time
> values, offers arrive as work orders, countdowns tick on the sheet.

Origin: `design-mockups/livesheet/livesheet.css`. The current contract is
`design-mockups/livesheet/design.md` (updated 2026-09-24, served at
`/docs/md/livesheet-design-md`); these `docs/site` pages go into more depth, and
the production CSS in `src/app/styles/` is the final word on values.
Production tokens live in `src/app/styles/00-tokens-base.css` (Tailwind v4 `@theme` +
`:root` custom properties).

## 1. The concept

Every page is a **sheet** — a drafting drawing of the user's world. Content
sits on raised **plates** (tiles) over a papery canvas with a faint 40px
graticule. Text annotations use mono microlabels, values are measured with
**live dimension lines**, and the one accent color marks what is happening
right now. The system's signature component is the `livedim`: a measured
value drawn the way a draftsman dimensions a part — with a spine, ticks, a
microlabel and a mono value — that turns red and pulses when the value is
live.

## 2. Token architecture

Two layers:

1. **Scale tokens** — declared in Tailwind v4 `@theme` so they become
   utilities (`bg-paper`, `text-ink`, `text-dim`, `bg-tile`, `rounded-r`…):
   paper, paper-deep, tile, tile-2, ink, dim, live, ok, warn, info,
   destructive (aliases live), on-ink, img-fallback, the two font stacks, and
   the radius scale.
2. **Alpha + state tokens** — plain custom properties on `:root` (dimline,
   grid-line, live-tint, ok-tint, warn/warn-tint, info/info-tint,
   destructive, scrim, ink-hover,
   live-hover, ghost-fill, ghost-hover, rule-soft, rule-mid, ghost,
   ghost-strong, photo-filter). Used directly via `var(...)` in component
   CSS.
3. **Photo overlay tokens** — `--photo-scrim`, `--on-photo`,
   `--on-photo-dim`: text laid over a photograph (the garage hero, a
   profile's featured build). One value in both themes, because the photo
   underneath doesn't change with the theme; the scrim is a dark fade under
   the caption only, never a paper wash over the car.

Legacy aliases (`--color-background`, `--bg-surface`, `--text-primary`…) map
old utility names onto Livesheet tones so pre-Livesheet code shifts palette in
one move. The radius scale also keeps legacy aliases — `--radius-card` /
`--radius-tile` (16px), `--radius-input` (10px) and `--radius-pill` (10px:
pills are banned, so the "pill" alias is a soft rectangle).

Beyond colour and radius, `@theme` carries the **type scale** — a 4px grid
with 8px display jumps, every product font size drawn from it — as
`text-*` utilities:

| Token / utility | Size | Line height |
| --- | --- | --- |
| `--text-micro` / `text-micro` | 12px | 16px |
| `--text-body` / `text-body` | 16px | 24px |
| `--text-section` / `text-section` | 20px | 28px |
| `--text-sub` / `text-sub` | 24px | 32px |
| `--text-head` / `text-head` | 32px | 40px |
| `--text-display` / `text-display` | 40px | 48px |
| `--text-display-lg` / `text-display-lg` | 48px | 56px |
| `--text-display-xl` / `text-display-xl` | 64px | 1.1 |

Also in `@theme`: `--ease-spring` (the same `cubic-bezier(0.32, 0.72, 0, 1)`
as `--spring`, exposed for Tailwind `ease-*`).

Other `:root` tokens worth knowing:

| Token | Day / night | Role |
| --- | --- | --- |
| `--live-text`, `--ok-text`, `--warn-text`, `--info-text` | one step deeper than the status hues by day (`#a82410` / `#145c35` / `#6f4a00` / `#14527f`), a step brighter at night (`#ff7a66` / `#6cc794` / `#e6b45e` / `#8ec4ea`) | chip and small-text colour on the tints, kept ≥4.5:1 where the fill tokens alone would not be |
| `--lightbox` | `#0a0b0e`, both themes | the lightbox stage — near-opaque, so the page behind a photo is gone |
| `--maxw` | 1200px | the content column (`.wrap`) |
| `--gutter` | `clamp(16px, 4vw, 40px)` — published on `.wrap` (`01-foundation.css`) | the column's side padding, so a full-bleed child can cancel exactly this much |
| `--rail-w` | 232px, 68px when `.shell[data-rail="closed"]` (`02-shell.css`) | the register rail's width |

Tailwind's generated `text-live` utility would paint the `--live` **fill**
hue as small text, which misses AA on recessed day surfaces, so
`00-tokens-base.css` overrides `.text-live`, `.!text-live`, `.hover:text-live`
and `.group-hover:text-live` to use `--live-text` instead.

**z-index ladder.** One ordering, every fixed or sticky surface agrees on it:

| Level | Surface |
| --- | --- |
| 120 | `.toast` |
| 90 | `.sheetwrap` (Dialog scrim) and `.bsheet` (BottomSheet) |
| 61 / 60 / 55 | the signed-in register `.rail` (fixed, ≥1081px, `11-responsive.css`) / the sticky top `.bar` / `.indexwrap` (the Index sheet) |
| 50 | `.savebar` |
| 40 | `.buybar` and the pinned `.composer--pin` |

Only one bottom surface may own the bottom edge on a route at a time; they
all reserve `--bottom-surface-h` (76px) plus the safe area.

## 3. Theming: DAY and NIGHT

- NIGHT is a **token remap only**, declared once under
  `[data-theme="dark"]` on `<html>`. No component rule is duplicated for
  dark. `--ghost-fill` is the one token whose ROLE flips: recessed
  (paper-deep) by day, raised (#242830) at night, so a secondary button sits
  above the graphite instead of reading as a black slab cut into it. Selected
  chips and category rows at night are a tile plate with an accent edge, not
  a white inversion. The only dark-specific rules are four: the photo filter
  (`brightness(0.86) contrast(1.05)` on img/video — `00-tokens-base.css`),
  the theme-pip fill (`.bar__theme .sw` — `02-shell.css`), the `select.ctl`
  chevron (an inline SVG, so it carries `dim` as a literal in both themes —
  `08-forms.css`), and the selected category row / filter chip plate
  (`.catside__row[aria-current="page"]`, `.fbtn.is-on` — the tile plate with
  an accent edge described above, `12-overrides.css`).
- NIGHT moved from warm sepia to a **cooler graphite paper** in September
  2026 (PRD 2026-09 §3) — see the night table in
  [brand](brand.md#night-the-drawing-office-after-hours) for the values and
  the re-measured contrast. Because it is a remap, nothing outside the one
  block changed: the day theme, the accent, the status hues and every
  component rule are untouched.
- Theme is a cookie (`ls-theme`, values `day` / `night`). An inline script in
  the root layout (`src/app/layout.tsx`) stamps `data-theme` before first
  paint so there is no flash, without forcing routes out of static rendering.
  `prefers-color-scheme` is only the initial default.

## 4. Geometry

Radius descends with the size of the thing. **Nothing is a pill.**

| Token | Value | Applies to |
| --- | --- | --- |
| `--r` | 16px | tiles, sheets, hero media, dropzones, band, savebar |
| `--r-ctl` | 10px | buttons, controls, inner media, monograms, callouts, capsules |
| `--r-chip` | 6px | chips, badges, stamps |
| `--r-meter` | 3px | bars and tracks |
| circle | 50% | ONLY live dots, pipeline pips, thumb-remove badges |

Layout: max width 1200px (`--maxw`, `.wrap`), with three narrower steps that
keep the same responsive gutter — `.wrap--narrow` 720px (auth, legal,
single-column forms), `.wrap--medium` 900px (settings, sell/edit forms),
`.wrap--wide` 1060px (cart, checkout); `NarrowColumn width="narrow|medium|wide"`
renders `wrap wrap--<width>`. The one grid gap is 16px (`.deck`); tile padding
20px; section bottom padding `clamp(48px, 7vw, 80px)`.

## Spacing

An 8px grid with 4px half-steps where a whole step is too coarse. Every
padding, margin and gap in the product is one of these values; nothing else
(no 6, 10, 14, 18, 22 or 28). Tokens live in `00-tokens-base.css` as
`--space-N`, where N is the value in 4px units — the same number Tailwind's
`gap-N` / `p-N` / `mt-N` utilities use, so `gap: var(--space-3)` and
`className="gap-3"` are both 12px.

| Token | Value | Role |
| --- | --- | --- |
| `--space-1` | 4px | tight — binds a line to the one above (a caption under a title) |
| `--space-2` | 8px | group — opens a new line; chip and control inner air |
| `--space-3` | 12px | control padding, row gaps |
| `--space-4` | 16px | the grid gap (`.deck`); plate padding on phones |
| `--space-5` | 20px | tile padding |
| `--space-6` | 24px | section gaps |
| `--space-8` … `--space-20` | 32 · 40 · 48 · 64 · 80px | bands and page rhythm; multiples of 8 only above 24 |
| `--touch` | 40px | the touch floor — primary controls, chips, bar icons |

0, 1 and 2px are hairlines (rules, outline offsets, optical nudges), not
spacing. Element sizes that are not spacing — icon boxes, pips, meters,
column widths — may sit off the grid; mark such a declaration with a
trailing `/* size */` comment. `spacing-ratchet.test.ts` counts off-scale
values in the stylesheets and in Tailwind utilities (`gap-1.5`, `mt-0.5`,
`min-h-11` are all off) and only lets the count fall.

Separation is **tonal** — plates are lighter than the paper, not boxed.
Hairlines (`rule-soft` / `rule-mid`) rule rows inside plates and outline
controls that sit on a raised surface; `dimline` alpha is reserved for
dimension and leader lines. The deliberate exceptions: a 1px `rule-mid` edge
on the marketplace card, the frosted top bar, soft `--scrim` shadows on things
that float (popovers, dragged items), and photo overlays (the dark caption
fade and the small chips drawn on photos). Nothing else takes a border,
shadow, gradient or blur.

## 5. Motion

The full motion language (philosophy, Motion for React vs CSS boundary,
springs, recipes, reduced motion) lives in **[motion.md](motion.md)** /
`/docs/motion`. Summary: **Motion for React** (`motion` package, foundation
in `src/lib/motion`) drives behavioral and structural animation — presence,
expand/collapse, orchestration, gestures — while **CSS keeps** cosmetic
transitions (hover color, shimmer, pulses, the `.is-in` draw cascade). Both
share one timing vocabulary:

| Token | Value | Used for |
| --- | --- | --- |
| `--spring` / `ease` | `cubic-bezier(0.32, 0.72, 0, 1)` | everything duration-based that moves |
| `--t-fast` / `durations.fast` | 160ms | color/background/press |
| `--t-standard` / `durations.standard` | 240ms | default fades, small state swaps |
| `--t-move` / `durations.move` | 380ms | tiles, sheets, orders, toast travel |
| `--t-draw` / `durations.draw` | 650ms | rules drawing themselves in |
| `springs.*` | snappy / responsive / spatial / gentle | Motion spring presets (see motion.md §4) |
| stagger | 70ms per index | reveal groups |
| pulse | 2.2s ease-in-out infinite | live dots |
| toast dwell | 3200ms | `.toast` |

Behavior primitives (production) are **components**, not hooks:
`MotionPolicy` (`src/components/ui/motion-policy.tsx` — the app-level
`MotionConfig reducedMotion="user"`, mounted once in the root layout) and,
in `src/components/livesheet.tsx`: `Rv` (Motion-driven reveal wrapper, 70ms
stagger via its `stagger` prop, still emitting `is-in` for the CSS draw
cascade), `LiveDim` (the signature measured value — `live` red + pulsing
dot, `blank` dashed spine) and `Countdown` (server-authoritative H:MM:SS
from `expiresAt`). The real hooks live in `src/lib/hooks/`:
`useFinePointer`, `useReducedMotion`, `useKonamiCode`, `useHydrated`. Supabase Realtime is
used in one place: `src/features/commerce/live-messages.tsx` subscribes to
`messages` (an open conversation) and `conversation_unreads` (the Messages
badge) and calls `router.refresh()` — the server render stays the source of
truth. It hands Realtime the member's session before subscribing; without
that the join is anonymous and RLS delivers nothing.

`prefers-reduced-motion`: Motion-driven transforms are disabled globally by
`MotionPolicy` (opacity still communicates state); reveals/draws render
settled, pulses and sweeps stop, ticks never start — **countdowns keep
running** (information, not decoration). (There is no count-up animation in
production: KPI numerals print their value.)

## 6. The live color contract

`--live` is the system's one signal. It is earned only by:

- things happening right now (pulsing dots, arriving events, LIVE chips,
  countdowns, "you" markers);
- at most **one** primary CTA per surface (`.btn--live`) — the one red
  fill, and the only button that wears the `[ ]` brackets. The shell's red is
  the top bar's Post; the rail's List a part, card cart buttons and every
  secondary action are outlined or ghost;
- one `.live-word` per page, in the h1 only, with a draw-in underline.

Everything else is ink, dim, ok or warn. A second accent is banned; status
colors are never navigation, and `--ok` is a status (settled / done /
verified) — prices are ink, never green.

## 7. Empty, loading and edge states

- Empty regions keep the same geometry as real content: the `.undrawn`
  dashed plate with a cross-hair mark and factual copy.
- Loading is **ghost rows** (`.ghostrow`, `.gbar`, `.gbox`) with a drawing
  sweep — never spinners.
- Empty values print `—`; empty **money** prints `$0.00`. A KPI with nothing
  counted yet shows the real zero, dimmed (`MetricCard blank`), because a
  dash in a giant numeral reads as loading.
- An empty page says one thing and offers one next step: no filter bars,
  sort controls or search boxes over nothing.
- Spent/expired content desaturates (`.chip--spent`, stamp) — it does not
  disappear.
- Media without an image renders the img-fallback tone; listing covers
  without a photo render the undrawn plate language (`.plate-undrawn`).

## 8. File map

| Concern | File |
| --- | --- |
| Production tokens | `src/app/styles/00-tokens-base.css` (`@theme`, `:root`, night block, element defaults) |
| Component CSS, by recipe family | `src/app/styles/01-foundation.css` … `09-states-content.css` (all `@layer components`), then `10-unlayered-motion.css`, `11-responsive.css`, `12-overrides.css` (unlayered on purpose) — imported in filename order by `src/app/globals.css`; import order is the cascade, guarded by `styles-ratchet.test.ts` |
| Source mockups + contract | `design-mockups/livesheet/` (`design.md`, `design.html`, `livesheet.css`) |
| React chrome + primitives | `src/components/ui/` |
| Behavior components (Rv, LiveDim, Countdown) | `src/components/livesheet.tsx` |
| Theme bootstrap | `src/app/layout.tsx` |
| This microsite | `src/app/(docs)/` + `docs/site/*.md` |
| Docs registry (pages + reference library) | `src/lib/docs/site.ts` |
