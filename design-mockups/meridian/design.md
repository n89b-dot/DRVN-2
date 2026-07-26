---
version: 1.0.0
name: MERIDIAN
description: >
  Dark automotive-HMI design system for DRVN Concept 08. Obsidian canvas,
  glass panels, champagne accent, 270-degree arc gauges, Outfit type at
  thin weights. The cockpit for your build's second life.

colors:
  canvas: "#0E1013"
  canvas-deep: "#0A0C0F"
  glass: "rgba(255, 255, 255, 0.05)"
  glass-strong: "rgba(255, 255, 255, 0.07)"
  glass-solid: "#16191E"          # backdrop-filter fallback
  border: "rgba(255, 255, 255, 0.09)"
  border-bright: "rgba(255, 255, 255, 0.18)"
  specular: "rgba(255, 255, 255, 0.16)"
  text: "#E8EAEE"
  text-secondary: "#8B929E"
  text-tertiary: "#5A6068"
  accent: "#D8C79A"               # champagne — money, active, needles
  accent-dim: "rgba(216, 199, 154, 0.35)"
  accent-faint: "rgba(216, 199, 154, 0.12)"
  ice: "#7FB4C9"                  # petrol-ice — secondary data series ONLY
  green: "#58C27D"                # status dots only
  amber: "#D8A15A"                # pending/warning zone
  red: "#C97F7F"                  # destructive hover only
  image-fallback: "#16181C"
  on-accent: "#14120C"

typography:
  font-family: "'Outfit', 'Helvetica Neue', Arial, sans-serif"
  display:
    size: "clamp(38px, 6.2vw, 78px)"
    weight: 300
    line-height: 1.06
    letter-spacing: "-0.01em"
  h1:
    size: "clamp(26px, 3.4vw, 38px)"
    weight: 300
    letter-spacing: "0.02em"
  h2:
    size: "clamp(24px, 3vw, 34px)"
    weight: 300
  body:
    size: "14px"
    weight: 400
    line-height: 1.6
    color: "{colors.text}"
  label:                          # HMI cluster micro-label
    size: "11px"
    weight: 500
    letter-spacing: "0.22em"
    transform: "uppercase"
    color: "{colors.text-secondary}"
  numeral:                        # gauge / price numerals
    size: "42px"
    weight: 300
    variant: "tabular-nums"
    color: "{colors.text}"

rounded:
  panel: "14px"
  small: "9px"
  pill: "90px"

spacing:
  unit: "4px"
  panel-pad: "24px"
  grid-gap: "20px"
  section: "84px"
  page-max: "1240px"
  nav-height: "64px"

motion:
  ease: "cubic-bezier(0.3, 0.7, 0.2, 1)"
  duration: "600ms"
  duration-gauge: "900ms"
  ignition-stagger: "110ms"

components:
  glass-panel:
    background: "{colors.glass}"
    background-fallback: "{colors.glass-solid}"
    border: "1px solid {colors.border}"
    radius: "{rounded.panel}"
    backdrop-blur: "18px"
    shadow: "inset 0 1px 0 {colors.specular}, 0 18px 40px -24px rgba(0,0,0,0.7)"
    hover:
      border: "1px solid {colors.border-bright}"
      background: "{colors.glass-strong}"
  button-keyline:
    border: "1px solid {colors.accent-dim}"
    color: "{colors.accent}"
    background: "transparent"
    radius: "{rounded.pill}"
    padding: "13px 30px"
    font: "11px / 600 / 0.22em uppercase"
    hover:
      border: "1px solid {colors.accent}"
      background: "{colors.accent-faint}"
  button-fill:
    background: "{colors.accent}"
    color: "{colors.on-accent}"
    radius: "{rounded.pill}"
    hover:
      background: "#E6D8B0"
      transform: "translateY(-1px)"
  gauge:
    sweep: "270deg"
    track: "rgba(255,255,255,0.07)"
    arc: "{colors.accent}"
    arc-warning: "{colors.amber}"
    stroke-width: "5"
    linecap: "round"
    animation: "stroke-dashoffset {motion.duration-gauge} {motion.ease}"
  tag:
    radius: "{rounded.pill}"
    padding: "4px 12px"
    font: "10px / 500 / 0.18em uppercase"
    border: "1px solid {colors.border}"
    variants:
      sale: { border: "1px solid {colors.accent-dim}", color: "{colors.accent}" }
      live: { border: "1px solid rgba(88,194,125,0.4)", color: "{colors.green}" }
      offer: { border: "1px solid rgba(216,161,90,0.45)", color: "{colors.amber}" }
      sold: { color: "{colors.text-tertiary}" }
  input:
    background: "rgba(255,255,255,0.04)"
    border: "1px solid {colors.border}"
    radius: "{rounded.small}"
    padding: "12px 16px"
    focus-border: "1px solid {colors.accent-dim}"
  nav-tab:
    font: "11px / 500 / 0.2em uppercase"
    color: "{colors.text-secondary}"
    active-color: "{colors.text}"
    active-indicator: "2px {colors.accent} trim line"
  offer-row:
    layout: "grid 1fr auto auto"
    divider: "1px solid {colors.border}"
    bid-color: "{colors.accent}"
    bid-size: "24px / 300"
---

# MERIDIAN Design System

## Overview

MERIDIAN is the instrument cluster of a flagship car, rendered as a
marketplace UI. Every screen behaves like a cockpit: it boots from black,
its gauges sweep to their readings, and its data is labeled like avionics.
Restraint is the aesthetic — one typeface, one warm accent, one easing
curve. Trust is communicated by instrumentation, not persuasion.

## Colors

Obsidian `#0E1013` is the canvas, with a barely-perceptible cool vertical
gradient down to `#0A0C0F`; never use pure black for surfaces. All panels
are white-alpha glass over that canvas. Champagne `#D8C79A` is the only
warm note and must be earned: prices, active states, gauge arcs/needles,
and the trim-line tick. Petrol-ice `#7FB4C9` exists solely as a secondary
series in charts and sparklines — it is data ink, never chrome. Green
`#58C27D` appears only as 6px status dots; amber marks pending states and
warning gauge zones; red appears only on destructive-action hover.

## Typography

Outfit everywhere, weights 300–600, no monospace. Big numbers are the
voice of the system: weight 300, tabular figures, sized like a
speedometer (42px in gauges, up to 78px in the hero). Micro-labels are
the second voice: 11px, 500, uppercase, tracked at .22em, muted silver —
identical inside SVG charts and HTML. Body copy is quiet 14px/400.
Weight 600 is reserved for buttons and tiny emphasis. The one sanctioned
deviation: dense table sub-labels may drop to 9–10px at the same tracking.

## Layout

Content maxes at 1240px with 28px gutters. The nav is a 64px sticky glass
bar: wordmark left, three centered tabs, user chip right. Pages open with
a micro-label + thin 300-weight H1, then a trim line. Grids use 20px gaps;
sections breathe at 84px. Everything stacks cleanly to 390px — gauges go
single-column, the nav condenses, table columns hide via `.l-hide`.

## Elevation & Depth

Depth comes from glass, not shadow stacks: a panel is `glass` fill + 1px
border + 18px backdrop blur (solid `#16191C` fallback where unsupported) +
a 1px specular inset along the top edge, plus one soft ambient drop shadow.
Hover elevates by brightening the border to `border-bright` and nudging
fill to `glass-strong`; large cards may translate up 3px or tilt ≤1.5°.
Overlays dim the page with `rgba(8,9,11,.7)` and 8px blur.

## Shapes

Panels: 14px radius. Inner elements (inputs, thumbs): 9px. Buttons, tags,
and segmented controls: full pill (90px). Gauges are 270° arcs, 5px
stroke, round caps, gap at the bottom. Trim lines are 1px hairlines with
a 44px × 3px champagne tick at the left end.

## Components

- **Glass panel** — the universal container; add `--hover` for
  interactive brightening, `--tilt` for the subtle parallax.
- **Arc gauge** — SVG primitive animated by `sweepGauge()`; value is the
  arc fraction, numeral counts up in sync. Amber variant for pressure
  and warning readings.
- **Buttons** — keyline (primary, champagne outline), fill (confirm,
  champagne solid on `#14120C` text), ghost (tertiary, hairline).
- **Tags** — pill status chips: live / under offer / sold / for-sale link.
- **Rows** — offer rows (part, bid vs asking, three actions), mod rows,
  log rows, activity rows; all divided by hairlines, never zebra fills.
- **Listing row** — collapsible glass panel with thumbnail, source-car
  link, watcher sparkline, prices, status tag; expands 600ms to offer
  history and Amend/Pause/End.
- **Segmented control** — pill group with a sliding champagne trim line.
- **Modal & toast** — glass surfaces; modal scales in from 98%, toast
  rises from the bottom center with a status dot.

## Do's and Don'ts

**Do** boot every page from black with staggered ignition; sweep gauges
on load and re-sweep them when their value changes; use tabular numerals
for anything that ticks; label everything like a cluster; keep motion on
the single `cubic-bezier(.3,.7,.2,1)` curve.

**Don't** use pure #000 or neon; don't let champagne bleed into headings
or body text; don't use petrol-ice for anything but data series; don't
add monospace, bounce easing, stepped animation, zebra striping, or new
radii; don't ship a blurred panel without its solid fallback; don't
animate more than opacity, transform, and stroke-dashoffset.
