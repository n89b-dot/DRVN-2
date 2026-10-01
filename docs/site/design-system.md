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
one move.

## 3. Theming: DAY and NIGHT

- NIGHT is a **token remap only**, declared once under
  `[data-theme="dark"]` on `<html>`. No component rule is duplicated for
  dark. `--ghost-fill` is the one token whose ROLE flips: recessed
  (paper-deep) by day, raised (#242830) at night, so a secondary button sits
  above the graphite instead of reading as a black slab cut into it. Selected
  chips and category rows at night are a tile plate with an accent edge, not
  a white inversion. The only dark-specific rules are the photo filter
  (`brightness(0.86) contrast(1.05)` on img/video), the theme-pip fill and
  the `select` chevron, which is an inline SVG and so carries `dim` as a
  literal in both themes.
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

Layout: max width 1200px (`--maxw`, `.wrap`); the one grid gap is 16px
(`.deck`); tile padding 20px; section bottom padding `clamp(48px, 7vw, 80px)`.

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
| count-up | 900ms ease-out cubic | `[data-count]` numerals |
| toast dwell | 3200ms | `.toast` |

Behavior primitives (production) are **components**, not hooks:
`MotionPolicy` (`src/components/ui/motion-policy.tsx` — the app-level
`MotionConfig reducedMotion="user"`, mounted once in the root layout) and,
in `src/components/livesheet.tsx`: `Rv` (Motion-driven reveal wrapper, 70ms
stagger via its `stagger` prop, still emitting `is-in` for the CSS draw
cascade), `LiveDim` (the signature measured value — `live` red + pulsing
dot, `blank` dashed spine) and `Countdown` (server-authoritative H:MM:SS
from `expiresAt`). The real hooks live in `src/lib/hooks/`:
`useFinePointer`, `useReducedMotion`, `useKonamiCode`. Supabase Realtime is
used in one place: `src/features/commerce/live-messages.tsx` subscribes to
`messages` (an open conversation) and `conversation_unreads` (the Messages
badge) and calls `router.refresh()` — the server render stays the source of
truth. It hands Realtime the member's session before subscribing; without
that the join is anonymous and RLS delivers nothing.

`prefers-reduced-motion`: Motion-driven transforms are disabled globally by
`MotionPolicy` (opacity still communicates state); reveals/draws render
settled, pulses and sweeps stop, count-ups print the final value, ticks
never start — **countdowns keep running** (information, not decoration).

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
