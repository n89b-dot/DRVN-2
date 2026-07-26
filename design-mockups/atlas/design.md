---
version: 1.0.0
name: ATLAS
description: >
  Field-guide trust system for DRVN Concept 10 — "every build is a documented
  specimen." Warm kraft paper, olive field-notes, clay marks for money,
  topographic contour linework and dotted provenance routes. A humanist sans
  for reading, a coordinate mono for the record. Values mirror atlas.css
  custom properties one-to-one.

colors:
  kraft: "#E9DFCB"          # canvas — warm kraft/sand
  oat: "#F3ECDD"            # surface — lighter oat, field cards
  oat-deep: "#E4D9BF"       # pressed / nested surface, image fallback
  ink: "#2C271E"            # deep ink-brown — primary text
  ink-2: "#6E6552"          # muted warm brown — secondary text
  olive: "#5E6B47"          # PRIMARY accent — links, active, primary CTA, verified
  olive-deep: "#495337"     # olive hover / pressed
  olive-tint: "#E1E0CC"     # faint olive wash — fills, halos, banners
  clay: "#B5502F"           # SECONDARY accent — prices, key marks (sparing)
  clay-deep: "#96401F"      # clay hover
  clay-tint: "#EFD9CC"      # faint clay wash
  contour: "#C7B48F"        # faded contour — hairlines, borders, map lines
  contour-soft: "#D6C7A6"   # softer contour for background field

alpha:
  scrim: "rgba(44, 39, 30, 0.46)"        # modal scrim
  shadow-soft: "0 2px 10px rgba(44, 39, 30, 0.06)"
  shadow-lift: "0 10px 28px rgba(44, 39, 30, 0.10)"
  focus-ring: "0 0 0 3px rgba(94, 107, 71, 0.32)"

typography:
  font-sans: '"Hanken Grotesk", "Bricolage Grotesque", system-ui, sans-serif'
  font-mono: '"Spline Sans Mono", "IBM Plex Mono", ui-monospace, monospace'
  h1:
    font: "{typography.font-sans}"
    size: "clamp(38px, 5.6vw, 74px)"
    weight: 600
    letter-spacing: "-0.015em"
    line-height: 1.08
  h2:
    font: "{typography.font-sans}"
    size: "clamp(26px, 3.4vw, 40px)"
    weight: 600
    letter-spacing: "-0.015em"
  h3:
    font: "{typography.font-sans}"
    size: "clamp(19px, 2vw, 24px)"
    weight: 600
  body:
    font: "{typography.font-sans}"
    size: 16px
    weight: 400
    line-height: 1.55
    color: "{colors.ink-2}"
  microlabel:               # uppercase mono field label
    font: "{typography.font-mono}"
    size: 11px
    weight: 500
    letter-spacing: "0.16em"
    transform: uppercase
    color: "{colors.olive}"
  coord:                    # coordinates, catalog nos., dates, measurements
    font: "{typography.font-mono}"
    size: 12px
    weight: 400
    letter-spacing: "0.04em"
    color: "{colors.ink-2}"
    numerics: tabular-nums
  price:
    font: "{typography.font-mono}"
    weight: 600
    color: "{colors.clay}"
    numerics: tabular-nums

rounded:
  card: 6px                 # field cards, panels, media
  sm: 4px                   # inner elements, thumbs
  tag: 4px                  # tags, buttons, pins-as-chips
  pin: 50%                  # map pins, keeper avatar, status dots

spacing:
  s1: 4px
  s2: 8px
  s3: 12px
  s4: 16px
  s5: 24px
  s6: 32px
  s7: 48px
  s8: 72px
  s9: 104px
  maxw: 1180px
  bar-h: 66px

motion:
  ease: "cubic-bezier(0.22, 1, 0.36, 1)"
  dur: 480ms               # card rise / fade, base reveal
  route-draw: 720ms        # dotted route line stroke-dashoffset
  count: 900ms             # number settle
  range: "400–550ms ease-out; calm, grounded, no bounce"

components:
  masthead:
    background: "{colors.kraft}"
    border-bottom: "1px solid {colors.contour}"
    height: "{spacing.bar-h}"
    wordmark: "{typography.font-mono} 14px 600, 0.18em tracking, uppercase; ' · FIELD GUIDE' in {colors.olive}"
    nav-link: "{typography.font-mono} 11.5px uppercase {colors.ink-2}"
    nav-link-hover: "color {colors.ink}, border-bottom {colors.contour}"
    nav-link-active: "color {colors.olive}, border-bottom {colors.olive}"
    signin: "background {colors.olive}, color {colors.oat}, radius {rounded.tag}"
  button-primary:
    background: "{colors.olive}"
    color: "{colors.oat}"
    border: "1px solid {colors.olive}"
    radius: "{rounded.tag}"
    padding: "12px 20px"
    font: "{typography.font-mono} 12px 500 uppercase, 0.1em tracking"
    hover: "background {colors.olive-deep}"
    active: "translateY(1px)"
    focus-visible: "box-shadow {alpha.focus-ring}"
  button-clay:
    extends: "{components.button-primary}"
    background: "{colors.clay}"
    border: "1px solid {colors.clay}"
    hover: "background {colors.clay-deep}"
  button-ghost:
    background: transparent
    color: "{colors.ink}"
    border: "1px solid {colors.contour}"
    radius: "{rounded.tag}"
    hover: "background {colors.oat}, border {colors.ink-2}"
  field-card:
    background: "{colors.oat}"
    border: "1px solid {colors.contour}"
    radius: "{rounded.card}"
    shadow: "{alpha.shadow-soft}"
    hover: "translateY(-6px), shadow {alpha.shadow-lift}, border {colors.olive}"
    media: "aspect 4/3, background-color {colors.oat-deep} fallback, 1px {colors.contour} base border"
    specimen-no: "microlabel on {colors.kraft} chip, 1px {colors.contour} border"
  tag:
    font: "{typography.font-mono} 10px 500 uppercase, 0.12em tracking"
    border: "1px solid {colors.contour}"
    background: "{colors.oat}"
    color: "{colors.ink-2}"
    radius: "{rounded.tag}"
    variant-fit: "color/border {colors.olive}, background {colors.olive-tint}  (PLATFORM-VERIFIED)"
    variant-stated: "color {colors.ink-2}, border {colors.contour}  (KEEPER-STATED)"
    variant-clay: "color/border {colors.clay}, background {colors.clay-tint}"
  route-link:
    font: "{typography.font-mono} 10.5px uppercase, 0.08em tracking"
    color: "{colors.olive}"
    marker: "leading 22px dotted rule in {colors.olive} (8px dash pitch)"
    hover: "color {colors.olive-deep}"
  route-line:               # the trust primitive — part -> source vehicle
    stroke: "{colors.olive}"
    stroke-width: 1.5px
    dash: "3 6 (dotted)"
    draw: "stroke-dashoffset 0 over {motion.route-draw} {motion.ease}, then settle to static dash"
    geometry: "computed from element getBoundingClientRect(); redrawn on resize"
  field-table:              # spec matrix
    head: "{typography.font-mono} 10px uppercase {colors.olive}, 1px {colors.contour} underline"
    row-key: "{typography.font-sans} 14px 500 {colors.ink-2}"
    row-val: "{typography.font-mono} 13.5px {colors.ink}, tabular-nums"
    row-rule: "1px {colors.contour}"
    basis-verified: "{typography.font-mono} 10px uppercase {colors.olive}"
    basis-stated: "{typography.font-mono} 10px uppercase {colors.ink-2}"
  provenance:
    container: "{components.field-card} without hover"
    head: "background {colors.oat-deep}, 1px {colors.contour} divider"
    row: "grid 34%/1fr; key = microlabel {colors.olive}; value = 14.5px {colors.ink}"
    link: "underline in {colors.contour}, hover {colors.olive}"
  map-pin:
    core: "fill {colors.olive}, 2px {colors.kraft} stroke, r 4.5"
    halo: "fill {colors.olive-tint}, opacity 0 -> 1 on hot"
    active: "core fill {colors.clay}, r 8"
    dimmed: "opacity 0.28 when filtered out"
    label: "{typography.font-mono} 9px {colors.ink-2}"
  reg-row:                  # atlas specimen list row
    base: "grid auto/1fr/auto, 1px {colors.contour} bottom rule"
    hover: "background {colors.oat}, border {colors.olive}, translateX(2px)"
    hot: "same as hover — driven by map-pin hover (bidirectional)"
    no: "{typography.font-mono} 11px {colors.olive} chip on {colors.kraft}"
  filter-btn:
    font: "{typography.font-mono} 11px uppercase, 0.1em tracking"
    rest: "border {colors.contour}, background {colors.oat}, color {colors.ink-2}"
    pressed: "background {colors.olive}, color {colors.oat}"
  claim-panel:
    scrim: "{alpha.scrim}"
    panel: "background {colors.oat}, 1px {colors.contour}, radius {rounded.card}, shadow {alpha.shadow-lift}"
    enter: "opacity + translateY(12px) scale(0.98) -> none, 260–320ms {motion.ease}"
    steps: "two — claim (summary + confirm/ghost), done (olive check + notice)"
  stat:
    value: "{typography.font-mono} clamp(38px,5vw,58px) 600 {colors.ink}, tabular-nums, settles via data-count"
    label: "{typography.microlabel}"
  contour-field:
    role: "ambient background — procedural topographic rings, {colors.contour-soft}"
    opacity: 0.5
    generation: "atlas.js buildContours() — nested sine-perturbed closed loops around 2 peaks"
---

# ATLAS Design System

## Overview
ATLAS presents DRVN as a naturalist's field guide. Cars are *field entries* and
the parts that come off them are *catalogued specimens*, each numbered, plotted
to coordinates, dated, and traced to its source by a dotted route line. The
emotional target is a well-worn expedition journal: warm, matte, authoritative,
rigorously kept. Drama comes from the record itself — provenance you can watch —
not from scale or gloss. Every value below mirrors a custom property in
`atlas.css`; components reference tokens only, never raw literals.

## Colors
The canvas is warm kraft/sand `#E9DFCB`; surfaces are a lighter oat `#F3ECDD`
with a deeper oat `#E4D9BF` for nested and pressed states and image fallbacks.
Text is deep ink-brown `#2C271E`, with `#6E6552` for secondary copy. There are
exactly two accents, separated by job. **Olive `#5E6B47` is structural** — links,
active nav, primary buttons, verified-fitment tags, map pins at rest, route
lines. **Clay/terracotta `#B5502F` is for money and the single mark that
matters** — prices, and the one highlighted map pin. Clay is used sparingly on
purpose: its rarity is what makes a price read as the loudest thing on the page.
All hairlines, borders and map linework are faded contour tan `#C7B48F`
(`#D6C7A6` for the softer background field). No pure white, no cool grey, no
bright saturated hue ever appears.

## Typography
Two voices. **Hanken Grotesk** (400/500/600) sets everything you read —
headlines warm and confident, never thin. **Spline Sans Mono** (400/500/600)
is the instrument voice, used *only* for coordinates, catalog numbers, dates,
measurements and microlabels — with `tabular-nums` throughout. Microlabels are
11px mono, uppercase, 0.16em tracking, in olive: they read like field-note
captions ("SPECIMEN 01 · OVERLAND"). Coordinates are 12px mono in secondary
brown. Keeping the mono off body copy is precisely what makes it feel like data
rather than decoration.

## Layout
Content lives in a max-1180px column with fluid 20–48px gutters, under a 66px
sticky masthead styled as a field-guide masthead (mono wordmark "DRVN · FIELD
GUIDE", nav Atlas / Marketplace / Sign in). Pages compose from *field cards* and
full-bleed *bands*. The listing and atlas views use a two-column split
(specimen/record, map/list) that collapses to a single column at ≤1024px — the
sticky gallery and the map panel move above their lists. Card strips are 3-up,
dropping to 2-up at ≤860px and 1-up at ≤640px. The layout holds to 390px:
type scales via `clamp()`, the masthead wraps, and the map panel sits above the
registry list.

## Elevation & Depth
There are no heavy shadows. Depth is built from layered warm tones (kraft →
oat → oat-deep) and a 1px contour-colored border — the way a stack of field
cards would sit. The only shadows are a whisper-soft warm lift
(`0 2px 10px` at 6% ink) at rest and a slightly stronger one
(`0 10px 28px` at 10%) on card hover, which also rises the card 6px. Modals sit
on a 46% warm ink scrim.

## Shapes
Corners are a soft **6px** on cards, panels and media; **4px** on tags, buttons
and inner elements. Circles are reserved for map pins, the keeper avatar and
status dots. The two signature shapes are the **topographic contour** — organic,
closed, hand-surveyed loops, never a grid — which sits faintly behind every page
and becomes the foreground in the atlas map; and the **dotted route line**
(1.5px olive, `3 6` dash) that traces a part back to its source vehicle and is
the system's trust primitive.

## Components
See the frontmatter inventory for exact recipes. Field cards open with a media
plate carrying a specimen number and close with a body of microlabel, title,
coordinate and a card row pairing a basis tag with a price or route link. The
spec matrix is a field table whose final column always prints the fitment
*basis* (`PLATFORM-VERIFIED` in olive vs `KEEPER-STATED` in brown). The
provenance record is a definition list (source vehicle → keeper → fitment → ran
with → terrain) sitting beside a route line back to the source car. The atlas
map is a pure SVG survey — no map API — with contour terrain and plotted pins;
hovering a list row lights its pin and vice versa, and a terrain filter (All /
Overland / Track / Street) dims both list and pins together. The claim panel is
a two-step confirm (reserve → held-48-hours) that traps focus and closes on Esc
or scrim click.

## Do's and Don'ts
**Do**
- Set every coordinate, catalog number, date and measurement in Spline Sans
  Mono with tabular figures.
- Number your specimens and caption them with coordinates.
- Mark the *basis* of any fitment claim — never imply certainty you don't have.
- Use olive for structure and links; reserve clay almost entirely for prices.
- Keep motion calm: 400–550ms ease-out, lines that draw, cards that rise 6px,
  numbers that settle.

**Don't**
- Don't use pure white, cool grey, or any bright saturated colour.
- Don't turn the contour into a regular grid or use dimension lines — that is a
  different concept's language.
- Don't add radii above 6px, or shadows heavier than the soft warm lift.
- Don't spend clay on decoration; if everything is clay, the price stops
  mattering.
- Don't set body copy or headings in the mono — the mono is the record's voice,
  not the reader's.

## Consuming this file
This document follows Google's open **design.md** format: machine-readable
tokens in the YAML frontmatter (with `{token}` cross-references), human
rationale in the prose. An agent building for ATLAS should resolve token
references from the frontmatter, treat the prose sections as hard constraints,
and check every new component against the Do's and Don'ts. All values mirror the
`--*` custom properties in `atlas.css` one-to-one — that CSS, this file, and the
live `design.html` are three views of a single source of truth.
