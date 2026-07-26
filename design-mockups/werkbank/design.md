---
version: 1.0.0
name: WERKBANK
description: >
  Light technical design system for DRVN Concept 04 — "the dashboard is a
  work order." Warm drafting-paper canvas (Livesheet palette), raised plates,
  graphite ink, one live-signal accent, mono-annotated numbers and
  dimension-line callouts. Icon set: Phosphor Icons (regular), shared with
  Livesheet.

colors:
  bg: "#EFEDE6"            # warm drafting paper — app canvas
  surface: "#F8F6F0"       # plate / card surface (raised tile)
  recessed: "#E5E2D8"      # recessed paper — wells, deep tiles
  ink: "#20232A"           # graphite — primary text
  ink-secondary: "#656872" # secondary text, dim labels
  hairline: "#DAD7CC"      # borders, table rules, blueprint grid
  accent: "#F03A20"        # the live signal — callouts, active, primary CTA
  accent-tint: "rgba(240,58,32,0.10)"  # wash for tag fills / focus halos
  blue: "#20232A"          # reference links + chart line — graphite, no blue in this scheme
  fallback: "#E2DFD5"      # image container fallback
  ok: "#2E7D4F"            # sparing status green (FITTED / LIVE / PAID OUT)
  ok-tint: "rgba(46,125,79,0.10)"

typography:
  font-family-ui: '"IBM Plex Sans", -apple-system, "Helvetica Neue", sans-serif'
  font-family-data: '"IBM Plex Mono", "SF Mono", monospace'
  display:                 # page h1
    font: "{typography.font-family-ui}"
    size: clamp(26px, 2.6vw, 30px)
    weight: 600
    letter-spacing: -0.015em
    line-height: 1.15
  h2:                      # plate headers use microlabel style, not scale
    font: "{typography.font-family-ui}"
    size: 17px
    weight: 600
  body:
    font: "{typography.font-family-ui}"
    size: 16px
    weight: 400
    line-height: 1.5
  label:                   # microlabel / drawing callout
    font: "{typography.font-family-data}"
    size: 11.5px
    weight: 500
    letter-spacing: 0.14em
    transform: uppercase
    color: "{colors.ink-secondary}"
  data:                    # every number, ID, dimension, timestamp
    font: "{typography.font-family-data}"
    size: 14.5px
    weight: 400-500
    numerics: tabular-nums
  kpi:
    font: "{typography.font-family-data}"
    size: clamp(40px, 4.4vw, 56px)
    weight: 600
    line-height: 0.95
    letter-spacing: -0.03em

icons:
  set: "Phosphor Icons 2.1 (regular weight)"
  delivery: '<script src="https://unpkg.com/@phosphor-icons/web@2.1.1"></script>'
  markup: '<i class="ph ph-{name}" aria-hidden="true"></i>'
  sizes:
    inline: 18px           # doc rows, sidebar, buttons
    rail: 19px
    tile: 30px             # marketplace categories, home steps
  color: "currentColor — inherits {colors.ink-secondary}, goes {colors.accent} on hover"

rounded:
  plate: 20px              # plates, sheets, hero frames, bands — the soft tile
  control: 12px            # buttons, inputs, textareas, thumbs, avatars, inner images
  chip: 8px                # tags, callout tags, photo refs, stamps
  node: 50%                # pipeline nodes, status dots, radios
  stroke: none             # containers carry NO border — separation is tonal

spacing:
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s5: 24px
  s6: 32px
  s7: 48px
  s8: 64px
  rail-width: 232px        # 64px icon-rail ≤1024px; 56px top bar ≤640px
  grid-cell: 32px          # blueprint background grid pitch

components:
  button-primary:
    background: "{colors.accent}"
    color: "{colors.surface}"
    border: "1px solid {colors.accent}"
    radius: "{rounded.control}"
    padding: "9px 16px"
    font: "{typography.font-family-ui} 13.5px/1 600"
    hover:
      background: "#D22F17"
      border-color: "#D22F17"
    active: "translateY(1px)"
  button-secondary:
    background: transparent
    color: "{colors.ink}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.control}"
    hover:
      background: "{colors.bg}"
      border-color: "{colors.ink-secondary}"
  card-plate:
    background: "{colors.surface}"
    border: none
    radius: "{rounded.plate}"
    overflow: hidden           # flush images take the plate's corner
    shadow: none
    header: "hairline-divided head row — {icons.markup} + {typography.label} plate number"
    hover: "translateY(-2px) scale(1.004) (links only)"
  chip-tag:
    font: "{typography.label} at 11.5px"
    border: "1px solid {colors.hairline}"
    padding: "4px 10px"
    radius: "{rounded.chip}"
    variants:
      accent: "color/border {colors.accent}, background {colors.accent-tint}"
      fill: "background {colors.accent}, color {colors.surface}"
      ok: "color {colors.ok}, background {colors.ok-tint}"
  input:
    font: "{typography.font-family-data} 14px"
    background: "{colors.surface}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.control}"
    padding: "10px 13px"
    focus: "border + 1px ring {colors.accent}"
  sidebar-item:
    font: "{typography.font-family-ui} 14.5px 500"
    color: "{colors.ink-secondary}"
    icon: "{icons.markup} at {icons.sizes.rail}"
    active: "color {colors.ink}, 2px left border {colors.accent}, bg {colors.bg}"
    hover: "color {colors.ink}, bg {colors.bg}"
    index: "right-aligned mono 11px sheet number (01–07)"
  dimension-callout:
    line: "1px {colors.ink-secondary} with 9px perpendicular end-ticks"
    label: "{typography.label} at 11.5px, centered, surface-backed, wraps in place"
    accent-variant: "all strokes + label {colors.accent}"
    motion: "scaleX 0→1 over 600ms cubic-bezier(0.2,0,0,1), label fades in after 450ms"
  kpi-plate:
    base: "{components.card-plate}"
    label: "{icons.markup} + {typography.label}, icon at 19px"
    value: "{typography.kpi} tabular, ticks up 700ms on load"
    annotation: "{components.dimension-callout} beneath the value"
---

# WERKBANK Design System

## Overview
WERKBANK treats a seller's dashboard as an engineer's drawing office. Every
screen is a numbered sheet ("REF 04-B — GARAGE PLATE"), every card is a plate,
every number is set in mono and annotated like a blueprint callout. The
containers, palette, icon set and type scale are Livesheet's — soft strokeless
tiles on warm paper, Phosphor icons leading every plate label, headline figures
set large — while the sheet numbering, dimension-line annotation and mono data
discipline stay WERKBANK's own. Precision plus presence: the drawing office
read, at a legible size.

## Colors
The palette is Livesheet's. The canvas is warm drafting paper (`#EFEDE6`)
overlaid with a faint 32px blueprint grid. Content sits on raised plates
(`#F8F6F0`) — separation is by tone, not by brightness, so nothing is pure
white. Graphite `#20232A` is the only text black; `#656872` handles secondary
copy at AA on both paper and plate. The live signal `#F03A20` is the single
accent — active nav, primary buttons, offers, countdowns, callout lines — and
is reserved for things that are ticking or need a decision. There is no
technical blue in this scheme: hyperlink-style references ("VIEW ORDER →") and
the sales chart line are drawn in graphite and identify themselves by a dotted
rule, going accent on hover. Green `#2E7D4F` appears only in status tags.

Two lighting shifts share the same token names. **Day** is the default sheet
above. **Night** ("the night shift at the drawing office") remaps the tokens:
canvas `#171511`, plates `#201E18`, chalk ink `#F0EEE5`, secondary `#8F8C82`,
hairline `#302E27`, live signal lifted to `#FF4530` (hover `#FF6047`),
references in chalk `#F0EEE5`, green `#57B983` on a 12% tint.
Ink-filled elements invert to chalk fills with dark `on-ink` text (`#171511`);
photography is dimmed (`brightness(.86) contrast(1.05)`) so bright workshop
plates sit comfortably on the dark sheet; the blueprint grid flips to a faint
chalk line. The shift is toggled from the rail ("SHIFT — DAY/NIGHT"), applied
via `[data-theme="dark"]` on the root, and persisted in `localStorage`.
Components must only ever reference semantic tokens — never a literal hex —
so both shifts stay one override block.

## Typography
IBM Plex Sans (400/500/600) sets all UI copy. IBM Plex Mono (400/500) sets
every number, ID, timestamp, dimension and annotation — no exceptions;
`tabular-nums` throughout. The scale runs at Livesheet size: body is 16px,
data 14.5px, microlabels 11.5px mono uppercase with 0.14em tracking, written
like drawing callouts ("PLATE 03 — ACTIVE LISTINGS"). Page headings are Plex
Sans 600 at `clamp(26px, 2.6vw, 30px)`; KPI values are Plex Mono 500 at 38px
with -0.02em tracking.

## Icons
Phosphor Icons 2.1 at regular weight, the same set Livesheet uses, loaded from
`unpkg` and written as `<i class="ph ph-{name}" aria-hidden="true"></i>`. They
inherit `currentColor` — secondary ink at rest, accent on hover for the
category tiles. Inline icons (document rows, buttons) run 18px, rail icons
19px, tile icons 30px. No hand-drawn SVG paths remain outside the sales chart,
which is data, not iconography.

## Layout
A fixed 232px left tool-rail carries nav (numbered 01–07) and the user block.
Content lives in a max-1440px main column with 48px gutters. Plates compose on
a simple grid (`3fr 2fr` for primary/side pairings). At ≤1024px the rail
collapses to a 64px icon-rail; at ≤640px it becomes a 56px sticky top bar with
horizontal nav.

## Elevation & Depth
There are no drop shadows. Depth is expressed purely as a background step
(paper → plate); there is no container border to lean on. Hover on
interactive plates is a 2px upward translate with a 1.004 scale — nothing
grows or glows. Modals sit on a graphite
scrim at 45% and are bordered in full ink.

## Shapes
Containers are soft tiles, not bordered plates: 20px corners, no stroke at
all. A plate is legible because it is a lighter tone on the paper, never
because it is outlined — the only rules left in the system are *internal*
(head dividers, table and row separators). Controls sit a tier down at 12px
and chips at 8px, so nothing reads as a hard-edged relic beside a 20px tile.
Plates clip their contents, so an image flush to a plate edge takes the
plate's corner rather than its own. Circles are reserved for pipeline nodes,
status dots, radios and chart points. Dimension lines — a 1px rule with
perpendicular end-ticks and a centered surface-backed mono label that wraps
in place — are the signature shape and should annotate at least one number
per screen.

## Components
See the frontmatter inventory. Plates always open with a hairline-divided
header row: plate number left, meta or a reference link right. Tables use
mono uppercase 11px column heads and hairline row rules. Status tags come in
neutral, accent (orange = needs attention / for sale), fill (orange solid =
act now), and ok (green = settled). Category plates (`wb-cat`) carry 28px
stroke-drawn line icons in `currentColor` — never photography — and the
garage-fitment switch (`wb-fitswitch`) is the one toggle in the system,
orange only while engaged. Pass 6 adds record tabs (`wb-tabrow` +
`wb-panel`, hash-deep-linkable), provenance document rows (`wb-doc`), and the
mobile menu (`wb-mobilebar` / `wb-burger` / `wb-menu`) — a slide-in sheet
index that replaces the rail below 640px, styled as a plate with rail-item
rules and the live-signal active edge. The menu is cloned from the rail at
runtime and carries the rail's Phosphor icon with it (20px); on the public
masthead, where the links have no icon of their own, one is derived from the
destination sheet so the mobile index never falls back to bare text. Pass 7 adds the square checkbox
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
