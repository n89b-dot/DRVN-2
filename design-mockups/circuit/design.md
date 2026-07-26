---
version: 1.0.0
name: CIRCUIT
description: >
  DRVN Concept 11 — a marketplace-first design system for modified cars where
  provenance is drawn as a wiring diagram. Flat matte navy panels, electric-cyan
  schematic traces and nodes, a technical grotesque paired with a data mono.
  The trust mechanic becomes the visual: you can see what a part was wired to.

colors:
  canvas:      "#0A0F1A"   # deep navy-black page
  panel:       "#111827"   # raised flat panel
  panel-2:     "#0D1420"   # recessed / inset surface
  panel-hi:    "#16213A"   # hover raise
  cyan:        "#35E0F0"   # THE accent — traces, nodes, prices, active
  cyan-dim:    "#1C4A55"   # inactive traces / borders
  cyan-soft:   "rgba(53,224,240,0.14)"  # soft accent wash
  cyan-glow:   "rgba(53,224,240,0.40)"  # glow (box-shadow only)
  slate:       "#4A5568"   # inactive lines / secondary text
  slate-2:     "#2A3444"   # faint borders
  ink:         "#E6EDF3"   # near-white primary text
  ink-dim:     "#8A97A8"   # muted body text
  ink-faint:   "#566173"   # faintest labels
  amber:       "#F5A524"   # unverified / keeper-stated markers (sparingly)
  amber-dim:   "#5A421A"
  amber-soft:  "rgba(245,165,36,0.12)"

typography:
  font-ui:     "'Spline Sans', system-ui, sans-serif"   # UI + headings
  font-mono:   "'Spline Sans Mono', ui-monospace, monospace"  # data labels, node IDs, specs
  weights:     [400, 500, 600]
  numerals:    tabular
  scale:
    h-display: "clamp(38px, 6vw, 78px) / 0.98 / 600"
    h-1:       "clamp(28px, 4vw, 46px) / 1.05 / 600"
    h-2:       "clamp(22px, 3vw, 32px) / 1.05 / 600"
    h-3:       "clamp(17px, 2vw, 21px) / 1.05 / 500"
    lede:      "clamp(16px, 1.6vw, 19px) / 1.6 / 400"
    body:      "16px / 1.55 / 400"
    data-label:"11px / 1.4 / 400 · mono · uppercase · 0.16em"
    eyebrow:   "11px · mono · uppercase · 0.22em · cyan"

rounded:
  panel: "10px"
  node:  "8px"
  sm:    "6px"
  pill:  "90px"

spacing:
  s-1: "4px"
  s-2: "8px"
  s-3: "12px"
  s-4: "16px"
  s-5: "24px"
  s-6: "32px"
  s-7: "48px"
  s-8: "64px"
  s-9: "96px"

elevation:
  method: "flat panels + cyan glow — never glass blur, never backdrop-filter"
  glow-cyan: "0 0 0 1px {colors.cyan-dim}, 0 0 22px -6px {colors.cyan-glow}"
  glow-node: "0 0 14px -2px {colors.cyan-glow}"

motion:
  ease: "cubic-bezier(0.4, 0, 0.2, 1)"
  fast: "180ms"
  base: "320ms"
  slow: "600ms"
  trace-draw: "1000ms · stroke-dashoffset len -> 0"
  character: "smooth and electric — never stepped, never bouncy"

components:
  topbar:
    background: "rgba(10,15,26,0.86)"
    border-bottom: "1px solid {colors.slate-2}"
    height: "64px"
  navlink:
    font: "{typography.font-mono} 12px uppercase 0.12em"
    color: "{colors.ink-dim}"
    hover: "color {colors.ink}; underline trace grows to 100% in {motion.base}"
    current: "color {colors.cyan}; underline full"
    focus-visible: "2px solid {colors.cyan} outline"
  panel:
    background: "{colors.panel}"
    border: "1px solid {colors.slate-2}"
    radius: "{rounded.panel}"
    noded-variant: "cyan-dim node dots at opposing corners"
  btn-primary:
    background: "{colors.cyan}"
    color: "{colors.canvas}"
    radius: "{rounded.pill}"
    font: "{typography.font-mono} 13px uppercase 0.08em 600"
    hover: "box-shadow 0 0 24px -4px {colors.cyan-glow}; translateY(-1px)"
    focus-visible: "2px solid {colors.cyan}"
  btn-ghost:
    border: "1px solid {colors.cyan-dim}"
    color: "{colors.cyan}"
    hover: "border {colors.cyan}; background {colors.cyan-soft}; glow-cyan"
  tag:
    default: "border {colors.slate-2}; color {colors.ink-dim}; pill; mono 10.5px"
    fit: "border {colors.cyan-dim}; color {colors.cyan}; leading node dot"
    warn: "border {colors.amber-dim}; color {colors.amber}; background {colors.amber-soft}"
  trace-path:
    stroke-default: "{colors.cyan-dim}"
    stroke-active: "{colors.cyan} + drop-shadow glow"
    stroke-dim: "opacity 0.28"
    amber-variant: "{colors.amber-dim} default, {colors.amber} active"
    animation: "stroke-dashoffset len->0 over {motion.trace-draw}"
  node-dot:
    fill: "{colors.canvas}"
    stroke: "{colors.cyan}"
    core: "filled {colors.cyan}"
    pulse: "r 5<->7 over 2.6s (decorative core nodes)"
  rel-node:
    background: "{colors.panel-2}"
    border: "1px solid {colors.slate-2}"
    radius: "{rounded.node}"
    active-hover-focus: "border {colors.cyan}; glow-cyan; background {colors.panel-hi}"
    dim: "opacity 0.4"
  ncard:
    background: "{colors.panel}"
    border: "1px solid {colors.slate-2}"
    hover: "border {colors.cyan-dim}; glow-cyan; translateY(-3px)"
    price: "{colors.cyan} · mono · tabular"
  graph-node:
    car: "circle r=26, stroke {colors.cyan}"
    part: "circle r=12, stroke {colors.slate}"
    hot: "fill {colors.cyan-soft}; stroke {colors.cyan}"
    dim: "opacity 0.25"
  filter-btn:
    off: "border {colors.slate-2}; color {colors.ink-dim}; pill"
    on: "color {colors.cyan}; border {colors.cyan}; background {colors.cyan-soft}; glow-cyan"
  modal:
    scrim: "rgba(6,10,18,0.82)"
    panel: "{colors.panel}; border 1px {colors.cyan-dim}; glow-cyan; radius {rounded.panel}"
    motion: "translateY(12px) scale(.98) -> 0 in {motion.base}"
  stat:
    num: "{colors.cyan} · 600 · tabular · count-up 1200ms"
    accent-rule: "1px {colors.cyan-dim} left border"
---

# CIRCUIT — Design System

## Overview

CIRCUIT is DRVN's marketplace-first concept built on one thesis: **provenance is
a wiring diagram**. A modified car is a schematic; every part is a node; every
node traces back — along living cyan linework — to its source car, its keeper,
its verified fitment, and the parts it ran alongside. The trust question DRVN
must answer for every listing ("what car did this come off, who's the seller,
will it fit, what was it paired with") stops being a list of fields and becomes
something you can *see and touch*: hover a node and its wires light while the
rest of the diagram dims.

The surface language is a flat, matte engineering schematic on deep navy-black.
There is no glass, no blur-behind, no luxury sheen. Depth comes only from layered
flat panels and soft cyan **glow** (box-shadow, never `backdrop-filter`). It is a
beautiful technical diagram that happens to be alive.

## Colors

A near-monochrome navy field with a single electric accent. **Cyan `#35E0F0`**
is the only chromatic voice — it means signal, connection, active, price, trust.
Everything else is navy, slate, and near-white so the cyan reads as current
running through the board.

- **Canvas `#0A0F1A`** — the deep navy-black page, carrying a very faint dotted
  schematic grid (`slate` at 16% opacity, 28px pitch).
- **Panel `#111827` / Panel-2 `#0D1420` / Panel-hi `#16213A`** — flat raised,
  recessed, and hover surfaces. Subtly separated by lightness only.
- **Cyan `#35E0F0` + Cyan-dim `#1C4A55`** — active traces/nodes vs. inactive
  linework and borders. `cyan-soft` and `cyan-glow` are the wash and the glow.
- **Slate `#4A5568` / Slate-2 `#2A3444`** — inactive lines and faint borders.
- **Ink `#E6EDF3` / Ink-dim `#8A97A8` / Ink-faint `#566173`** — text tiers.
- **Amber `#F5A524`** — the *only* second hue, and used no more than twice on a
  screen, exclusively for "unverified / keeper-stated" markers. Amber never
  gets conflated with cyan-verified data — that separation is the trust rule.

## Typography

Two families only. **Spline Sans** (400/500/600) carries all headings and body —
a clean technical grotesque, confident but not loud. **Spline Sans Mono** is
reserved for *data*: node IDs, coordinates, prices, spec readouts, eyebrows and
labels — always uppercase and letterspaced. Mono is a spice, not the meal (that
distinction keeps CIRCUIT far from a mono-everything terminal aesthetic). All
numerals are tabular so specs and prices align down a column.

## Layout

Every page is composed as a **live schematic**. Content sits in flat panels with
1px slate borders and a 10px radius; where two things are related, a real cyan
trace connects them. The signature device is SVG bezier/orthogonal linework with
small node dots (circles for cars/keepers, squares for parts). Grids are 3-up and
2-up on a 1200px frame; the dotted background grid reinforces the board metaphor.
Whitespace is generous — a schematic needs air to be legible.

## Elevation & Depth

Flat only. Layering is achieved by (1) panel lightness steps, (2) 1px borders,
and (3) cyan **glow** via `box-shadow` on hover/active/focus. Two glow tokens:
`glow-cyan` (ring + soft bloom for panels/buttons) and `glow-node` (tight bloom
for node dots). There is **no** `backdrop-filter`, no blur-behind, no heavy drop
shadow, no specular edge. If something looks raised, it is because it glows.

## Shapes

Rounded but technical: panels 10px, nodes/cards 8px, small chips 6px, pills 90px
for buttons/tags/filters. Node dots are true circles and small rounded squares.
Traces are round-capped. Nothing is a hard-cornered data cell; nothing is a soft
consumer blob.

## Components

- **Top bar** — slim, sticky, node-glyph wordmark + Network / Marketplace / Sign
  in. Cyan underline traces grow on hover.
- **Panel / noded panel** — the base container; the noded variant adds cyan-dim
  corner dots to read as a board component.
- **Buttons** — primary (solid cyan, glows and lifts) and ghost (cyan hairline,
  fills to `cyan-soft` and glows). Both mono-labelled.
- **Tags** — default (slate), fit (cyan, leading dot = verified) and warn (amber
  = stated/unverified).
- **Traces & node dots** — the star. Traces draw in via `stroke-dashoffset`;
  hovering a node activates its links and dims the rest; core nodes pulse.
- **Rel-node** — an HTML relationship node (source / keeper / fitment / paired).
- **N-card** — car and part cards styled as nodes with an ID chip, connection
  count, and cyan price.
- **Graph** — cars as large nodes, parts as small nodes, provenance traces
  between; hover highlights a neighbourhood, filters show/hide node types.
- **Modal** — the acquire "connection-confirm", flat panel + cyan glow.
- **Stat** — cyan count-up numerals on a cyan-dim rule.

## Do's and Don'ts

**Do**
- Use cyan to mean *connection / verified / active* — one consistent meaning.
- Draw a real trace whenever two elements are genuinely related.
- Keep amber rare and only for unverified/keeper-stated facts.
- Let hover *isolate*: light the relevant wires, dim everything else.
- Keep mono for data; set prose and headings in the grotesque.
- Animate with the smooth cyan ease; traces draw, they do not blink on.

**Don't**
- Don't use `backdrop-filter`, glass panels, or specular sheen.
- Don't add a second accent hue beyond the sparing amber.
- Don't make everything mono (that is a terminal, not a schematic).
- Don't use square hard-bordered data cells or stepped/instant motion.
- Don't bury a relationship in text when a trace can show it.
- Don't let amber-stated and cyan-verified fitment ever be styled the same.
