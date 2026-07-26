---
version: 1.0.0
name: WERKBANK
description: >
  Light technical design system for DRVN Concept 04 — "the dashboard is a
  work order." Drafting-paper canvas, white plates, graphite ink, one safety
  orange accent, mono-annotated numbers and dimension-line callouts.

colors:
  bg: "#F0EFEB"            # drafting paper grey — app canvas
  surface: "#FFFFFF"       # plate / card surface
  ink: "#24262A"           # graphite — primary text
  ink-secondary: "#7B7E85" # secondary text, dim labels
  hairline: "#D8D6CF"      # borders, table rules, blueprint grid
  accent: "#FF4D00"        # safety orange — callouts, active, primary CTA
  accent-tint: "#FFF0E9"   # orange wash for tag fills / focus halos
  blue: "#2B5BD7"          # technical blue — reference links + one chart line ONLY
  fallback: "#E8E6E1"      # image container fallback
  ok: "#2E7D4F"            # sparing status green (FITTED / LIVE / PAID OUT)

typography:
  font-family-ui: '"IBM Plex Sans", -apple-system, "Helvetica Neue", sans-serif'
  font-family-data: '"IBM Plex Mono", "SF Mono", monospace'
  display:                 # page h1
    font: "{typography.font-family-ui}"
    size: 22px
    weight: 600
    letter-spacing: -0.01em
    line-height: 1.2
  h2:                      # plate headers use microlabel style, not scale
    font: "{typography.font-family-ui}"
    size: 15px
    weight: 600
  body:
    font: "{typography.font-family-ui}"
    size: 14px
    weight: 400
    line-height: 1.5
  label:                   # microlabel / drawing callout
    font: "{typography.font-family-data}"
    size: 10px
    weight: 500
    letter-spacing: 0.14em
    transform: uppercase
    color: "{colors.ink-secondary}"
  data:                    # every number, ID, dimension, timestamp
    font: "{typography.font-family-data}"
    size: 13px
    weight: 400-500
    numerics: tabular-nums
  kpi:
    font: "{typography.font-family-data}"
    size: 30px
    weight: 500

rounded:
  plate: 2px               # cards, buttons, inputs, tags — 2px corners MAX
  pill: none               # pills are banned in WERKBANK
  avatar: 2px
  node: 50%                # only pipeline nodes and status dots are circular

spacing:
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s5: 24px
  s6: 32px
  s7: 48px
  s8: 64px
  rail-width: 224px        # 64px icon-rail ≤1024px; 56px top bar ≤640px
  grid-cell: 32px          # blueprint background grid pitch

components:
  button-primary:
    background: "{colors.accent}"
    color: "#FFFFFF"
    border: "1px solid {colors.accent}"
    radius: "{rounded.plate}"
    padding: "7px 14px"
    font: "{typography.font-family-ui} 12px/1 600"
    hover:
      background: "#E04400"
      border-color: "#E04400"
    active: "translateY(1px)"
  button-secondary:
    background: transparent
    color: "{colors.ink}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.plate}"
    hover:
      background: "{colors.bg}"
      border-color: "{colors.ink-secondary}"
  card-plate:
    background: "{colors.surface}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.plate}"
    shadow: none
    header: "hairline-divided head row with {typography.label} plate number"
    hover: "translateY(-1px) + border-color {colors.ink-secondary} (links only)"
  chip-tag:
    font: "{typography.label} at 10px"
    border: "1px solid {colors.hairline}"
    padding: "2px 8px"
    radius: "{rounded.plate}"
    variants:
      accent: "color/border {colors.accent}, background {colors.accent-tint}"
      fill: "background {colors.accent}, color #FFFFFF"
      ok: "color {colors.ok}, background #EDF6F0"
  input:
    font: "{typography.font-family-data} 13px"
    background: "{colors.surface}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.plate}"
    padding: "8px 10px"
    focus: "border + 1px ring {colors.accent}"
  sidebar-item:
    font: "{typography.font-family-ui} 13px 500"
    color: "{colors.ink-secondary}"
    active: "color {colors.ink}, 2px left border {colors.accent}, bg {colors.bg}"
    hover: "color {colors.ink}, bg {colors.bg}"
    index: "right-aligned mono 10px sheet number (01–05)"
  dimension-callout:
    line: "1px {colors.ink-secondary} with 9px perpendicular end-ticks"
    label: "{typography.label} at 9px, centered, surface-backed"
    accent-variant: "all strokes + label {colors.accent}"
    motion: "scaleX 0→1 over 600ms cubic-bezier(0.2,0,0,1), label fades in after 450ms"
  kpi-plate:
    base: "{components.card-plate}"
    label: "{typography.label}"
    value: "{typography.kpi} tabular, ticks up 700ms on load"
    annotation: "{components.dimension-callout} beneath the value"
---

# WERKBANK Design System

## Overview
WERKBANK treats a seller's dashboard as an engineer's drawing office. Every
screen is a numbered sheet ("REF 04-B — GARAGE PLATE"), every card is a plate,
every number is set in mono and annotated like a blueprint callout. The drama
comes from precision, not scale: modest type sizes, hairline rules, one loud
safety-orange accent reserved for the things that need a decision.

## Colors
The canvas is warm drafting-paper grey (`#F0EFEB`) overlaid with a faint 32px
blueprint grid. Content sits on white plates. Graphite `#24262A` is the only
text black; `#7B7E85` handles secondary copy. Safety orange `#FF4D00` is the
single accent — active nav, primary buttons, offers, countdowns, callout
lines. Technical blue `#2B5BD7` exists solely for hyperlink-style references
("VIEW ORDER →") and the sales chart line. Green `#2E7D4F` appears only in
status tags.

Two lighting shifts share the same token names. **Day** is the default sheet
above. **Night** ("the night shift at the drawing office") remaps the tokens:
canvas `#141519`, plates `#1C1E23`, chalk ink `#E9E8E2` on graphite, secondary
`#94979F`, hairline `#2D2F35`, safety orange lifted to `#FF5A1F` (hover
`#FF7038`), technical blue `#7E9EF5`, green `#4EB77E` on tint `#12211A`.
Ink-filled elements invert to chalk fills with dark `on-ink` text (`#16171A`);
photography is dimmed (`brightness(.88) contrast(1.04)`) so bright workshop
plates sit comfortably on the dark sheet; the blueprint grid flips to a faint
chalk line. The shift is toggled from the rail ("SHIFT — DAY/NIGHT"), applied
via `[data-theme="dark"]` on the root, and persisted in `localStorage`.
Components must only ever reference semantic tokens — never a literal hex —
so both shifts stay one override block.

## Typography
IBM Plex Sans (400/500/600) sets all UI copy. IBM Plex Mono (400/500) sets
every number, ID, timestamp, dimension and annotation — no exceptions;
`tabular-nums` throughout. Microlabels are 10px mono uppercase with 0.14em
tracking, written like drawing callouts: "PLATE 03 — ACTIVE LISTINGS".
Headings are Plex Sans 600 at 22px max.

## Layout
A fixed 224px left tool-rail carries nav (numbered 01–05) and the user block.
Content lives in a max-1440px main column with 48px gutters. Plates compose on
a simple grid (`3fr 2fr` for primary/side pairings). At ≤1024px the rail
collapses to a 64px icon-rail; at ≤640px it becomes a 56px sticky top bar with
horizontal nav.

## Elevation & Depth
There are no drop shadows. Depth is expressed with hairlines and background
steps (paper → plate). Hover on interactive plates is a 1px upward translate
plus a border darkening — nothing grows or glows. Modals sit on a graphite
scrim at 42% and are bordered in full ink.

## Shapes
2px corner radius maximum on every rectangle. No pills, no circles except
pipeline nodes, status dots and chart points. Dimension lines — a 1px rule
with perpendicular end-ticks and a centered surface-backed mono label — are
the signature shape and should annotate at least one number per screen.

## Components
See the frontmatter inventory. Plates always open with a hairline-divided
header row: plate number left, meta or a blue reference link right. Tables use
mono uppercase 10px column heads and hairline row rules. Status tags come in
neutral, accent (orange = needs attention / for sale), fill (orange solid =
act now), and ok (green = settled). Category plates (`wb-cat`) carry 28px
stroke-drawn line icons in `currentColor` — never photography — and the
garage-fitment switch (`wb-fitswitch`) is the one toggle in the system,
orange only while engaged. Pass 6 adds record tabs (`wb-tabrow` +
`wb-panel`, hash-deep-linkable), provenance document rows (`wb-doc`), and the
mobile menu (`wb-mobilebar` / `wb-burger` / `wb-menu`) — a slide-in sheet
index that replaces the rail below 640px, styled as a plate with rail-item
rules and the safety-orange active edge. Pass 7 adds the square checkbox
matrix and fitment radio (`wb-check` / `wb-radio`, orange only when set), the
thumb strip (`wb-thumbs`, accent border marks the active angle), the
measured-vs-minimum gauge (`wb-gauge`), and the multi-step purchase sheet
(`wb-sheet--wide` + `wb-ticks` numbered progress + `wb-step-panel`, going
full-screen via `wb-scrim--full` below 640px) — plus the one sanctioned red:
`--wb-danger`, reserved for the close-the-workshop row and destructive
confirms only.

## Do's and Don'ts
**Do**
- Set every numeral in Plex Mono with tabular figures.
- Number your plates and sheets; annotate key figures with dimension lines.
- Keep motion instrument-like: 120ms ease-out snaps, 600ms line draws.
- Reserve orange for decisions and blue for references.

**Don't**
- Don't add shadows, gradients, or radii above 2px.
- Don't use orange for decoration or blue for buttons.
- Don't introduce a dark theme, serif faces, or display-size type.
- Don't let an unannotated hero number ship — if it matters, dimension it.

## Consuming this file
This document follows Google's open design.md format: machine-readable tokens
in the YAML frontmatter (colors, typography, rounded, spacing, components with
`{token}` references), human rationale in the prose. An agent building for
WERKBANK should resolve token references from the frontmatter, treat prose
sections as constraints, and check any new component against Do's and Don'ts.
Values here mirror `werkbank.css` custom properties one-to-one (`--wb-*`).
