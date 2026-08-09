# Livesheet — how the design system functions

> "A drawing that knows what's happening." Warm drafting-paper surfaces, ruled
> and precise, whose annotations are alive: dimension lines measure real-time
> values, offers arrive as work orders, countdowns tick on the sheet.

Source of truth: `design-mockups/livesheet/livesheet.css`, contracted in
`design-mockups/livesheet/design.md` (served at `/docs/md/livesheet-design-md`).
Production port lives in `src/app/globals.css` (Tailwind v4 `@theme` +
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
   paper, paper-deep, tile, tile-2, ink, dim, live, ok, on-ink, img-fallback,
   the two font stacks, and the radius scale.
2. **Alpha + state tokens** — plain custom properties on `:root` (dimline,
   grid-line, live-tint, ok-tint, warn/warn-tint, scrim, ink-hover,
   live-hover, ghost-hover, rule-soft, rule-mid, ghost, ghost-strong,
   photo-filter). Used directly via `var(...)` in component CSS.

Legacy aliases (`--color-background`, `--bg-surface`, `--text-primary`…) map
old utility names onto Livesheet tones so pre-Livesheet code shifts palette in
one move.

## 3. Theming: DAY and NIGHT

- NIGHT is a **token remap only**, declared once under
  `[data-theme="dark"]` on `<html>`. No component rule is duplicated for
  dark. The only dark-specific rules are the photo filter
  (`brightness(0.86) contrast(1.05)` on img/video) and the theme-pip fill.
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

Layout: max width 1200px (`--maxw`, `.wrap`); the one grid gap is 14px
(`.deck`); tile padding 18px; section bottom padding `clamp(48px, 7vw, 80px)`.

Separation is **tonal** — no borders, no shadows, no glass, no gradients.
Hairlines (`rule-soft` / `rule-mid`) rule rows inside plates; `dimline` alpha
is reserved for dimension and leader lines.

## 5. Motion

| Token | Value | Used for |
| --- | --- | --- |
| `--spring` | `cubic-bezier(0.32, 0.72, 0, 1)` | everything that moves |
| `--t-fast` | 160ms | color/background/press |
| `--t-move` | 380ms | tiles, sheets, orders, toast travel |
| `--t-draw` | 650ms | rules drawing themselves in |
| stagger | 70ms per index | reveal groups |
| pulse | 2.2s ease-in-out infinite | live dots |
| count-up | 900ms ease-out cubic | `[data-count]` numerals |
| toast dwell | 2600ms | `.toast` |

Behavior hooks (production): `useReveal` (IntersectionObserver reveals),
`useCountUp`, `useLiveCount` (Supabase Realtime ticks with a 900ms live
flash), `useCountdown(expiresAt)` (server-authoritative H:MM:SS).

`prefers-reduced-motion`: reveals/draws render settled, pulses and sweeps
stop, count-ups print the final value, ticks never start — **countdowns keep
running** (information, not decoration).

## 6. The live color contract

`--live` is the system's one signal. It is earned only by:

- things happening right now (pulsing dots, arriving events, LIVE chips,
  countdowns, "you" markers);
- at most **one** primary CTA per surface (`.btn--live`);
- one `.live-word` per page, in the h1 only, with a draw-in underline.

Everything else is ink, dim, ok or warn. A second accent is banned; status
colors are never navigation.

## 7. Empty, loading and edge states

- Empty regions keep the same geometry as real content: the `.undrawn`
  dashed plate with a cross-hair mark and factual copy.
- Loading is **ghost rows** (`.ghostrow`, `.gbar`, `.gbox`) with a drawing
  sweep — never spinners.
- Empty values print `—`; empty **money** prints `$0.00`.
- Spent/expired content desaturates (`.chip--spent`, stamp) — it does not
  disappear.
- Media without an image renders the img-fallback tone; listing covers
  without a photo render the undrawn plate language (`.plate-undrawn`).

## 8. File map

| Concern | File |
| --- | --- |
| Production tokens + all component CSS | `src/app/globals.css` |
| Source mockups + contract | `design-mockups/livesheet/` (`design.md`, `design.html`, `livesheet.css`) |
| React chrome + primitives | `src/components/ui/` |
| Theme bootstrap | `src/app/layout.tsx` |
| This microsite | `src/app/(docs)/` + `docs/site/*.md` |
