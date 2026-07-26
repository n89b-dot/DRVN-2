---
name: BILLET
description: DRVN marketplace concept 12 — an interface machined from billet aluminum.
colors:
  al-mill: "#C9CCD1"        # mill-finish silver — page ground
  al-brushed: "#DEE1E5"     # brushed light — raised faces (cards, nav, buttons)
  al-bright: "#EAECEF"      # freshly-faced highlight
  slate: "#2A2D33"          # shop-floor dark sections
  slate-deep: "#22242A"     # recessed pockets on slate
  graphite: "#1B1D21"       # primary/engraved text
  shadow: "#9AA0A8"         # machined-shadow secondary (on slate)
  shadow-deep: "#7E848D"    # secondary text on light
  anodize: "#35507E"        # THE accent — deep anodized blue
  anodize-bright: "#46639A" # anodize catching light (hover)
  anodize-deep: "#2A4066"   # anodize in shadow (active)
  anodize-tint: "#B8C3D6"   # anodize dust — tag borders
  anodize-wash: "#DCE2EC"   # faint anodize wash — tag fills
typography:
  body:
    family: "Archivo, system-ui, sans-serif"
    weights: [400, 500, 600, 700]
    base-size: 16px
    line-height: 1.55
  mono:
    family: "IBM Plex Mono, ui-monospace, monospace"
    use: "part numbers, tolerances, prices, counts ONLY"
  etched-label:
    size: 10.5px
    weight: 600
    letter-spacing: 0.14em
    transform: uppercase
    text-shadow: "0 -1px 0 rgba(27,29,33,.25), 0 1px 0 rgba(255,255,255,.7)"
  h1: "clamp(34px, 4.6vw, 56px) / 1.06 / 700 / -0.015em"
  h2: "clamp(22px, 2.6vw, 30px) / 700"
rounded:
  block: 6px      # machined corner
  small: 4px
  slot: 3px       # milled input slots
  pill: none      # BILLET has no pills — metal is not soft
spacing:
  frame: 1200px
  nav-height: 64px
  section: 72px
  card-gap: 18px
  page-gutter: 28px (18px at ≤640px)
motion:
  curve: "cubic-bezier(0.3, 0, 0.1, 1)"   # tooling — dampened, no overshoot
  fast: 180ms
  medium: 280ms
  slow: 340ms
  signature: "clip-path inset wipe, left to right (.mill/.milled), 600ms"
components:
  block:
    rest: "bg al-brushed + 1px vertical grain; inset 1px light top/left, inset 1px dark bottom/right; 1px contact shadow"
    hover: "top/left inset edge turns anodize-bright"
    focus-visible: "2px anodize outline, 2px offset"
  pocket:
    rest: "bg al-mill recessed; top-left inner shadow (cutter entry), bottom-right light burr"
  btn:
    rest: "raised block face, grain, chamfer edges"
    hover: "chamfer edges take anodize"
    active: "translateY(1px) + inset dark shadow — pressed IN"
    focus-visible: "2px anodize outline"
  btn-primary:
    rest: "bg anodize, text al-bright, anodize-bright top edge"
    hover: "bg anodize-bright"
    active: "bg anodize-deep, inset shadow"
  btn-ghost:
    rest: "1px shadow-colored inset ring, transparent"
    hover: "ring + text anodize"
  slot (input/select):
    rest: "recessed al-mill, inner top shadow"
    focus-visible: "2px anodize ring, no outline"
    invalid: "2px anodize-deep ring + field-err message"
  chip:
    rest: "small raised block, shadow-deep text"
    pressed(true): "bg anodize, grain-dark, inset — reads as engaged detent"
  switch:
    rest: "recessed track al-mill, machined puck with dome gradient"
    checked: "track anodize, puck slides 24px on medium tooling curve"
    active: "puck scales 0.95 — compresses under finger"
  tag-fit: "anodize-wash fill, anodize text, anodize-tint 1px ring — platform-verified"
  tag-seller: "no fill, shadow ring — seller-stated, visually weaker by design"
  groove: "2px divider: dark line over light line (machined groove + burr break)"
  bolt: "10px domed circle, slot cut at 28°, used sparingly as accent"
  sheet: "side tray, slides in 340ms tooling curve, machined left edge highlight"
  toast: "block that slides up from bottom, seats, retracts after 3.2s"
---

# BILLET Design System

## Overview

BILLET is a material-generated system: every rule derives from how 6061 aluminum
is milled, chamfered, brushed, and anodized. The governing laws are:

1. **Edge law** — one light source, top-left. Every raised face shows a light
   top/left chamfer and a dark bottom/right chamfer, built with inset
   box-shadows. Drop shadows are forbidden except a 1px contact line.
2. **Recession law** — things you press are raised; things you type into or
   read out of are milled below the surface.
3. **Anodize law** — one accent (#35507E), only where anodize would really be:
   engaged states, prices, verified tags, the occasional bolt.
4. **Motion law** — tooling curves only. Nothing bounces or floats; elements
   slide, seat, and press in.

## Colors

Neutrals are aluminum at different finishes: `al-mill` is the bench, `al-brushed`
is a raised face, `al-bright` is a freshly faced edge. `slate` grounds dark
sections (the shop floor). Text is `graphite` (engraved) with `shadow-deep`
secondary. The anodize family covers the accent's three lighting conditions
(base / catching light / in shadow) plus two tints for tag fills. Never
introduce a second hue; never use pure white or pure black.

## Typography

Archivo carries all prose and headings — an engineered grotesque with no
decorative agenda. IBM Plex Mono is reserved for figures that would be etched
on a real part: prices, part numbers, weights, counts. The etched label
(10.5px uppercase, 0.14em tracking, dual text-shadow light-below/dark-above)
is the system's signature micro-typography and marks every section and field.

## Layout

1200px frame, 28px gutters. Sections separated by machined grooves, 72px
vertical rhythm. Market grid is `auto-fill minmax(250px, 1fr)`. Listing and
sell pages are asymmetric two-column (≈1.05/0.95), collapsing to one column
at 1000px. Fully usable at 390px.

## Elevation & Depth

There is no z-axis stack of floating layers. Depth is *cut*: raised faces
(blocks, buttons) sit ~1mm proud via chamfer highlights; pockets and slots are
milled ~1mm deep via inner shadows. The only overlays — sheets and toast — are
trays that slide in from an edge, never fade in from nowhere.

## Shapes

6px radii on blocks (a machined corner break), 3–4px on slots and small parts.
No pills, no circles except bolt heads, avatars, and switch pucks — the shapes
a mill and lathe actually produce.

## Components

See frontmatter for exact state definitions. Canon set: `block`, `pocket`,
`btn` (default / primary / ghost), `slot`, `chip`, `switch`, `tag-fit` /
`tag-seller`, `groove`, `bolt`, `part-card`, `sheet`, `toast`, `etch-label`.
Every interactive component defines rest, hover, focus-visible, and active;
buttons must travel visually inward on active.

## Do's and Don'ts

**Do**
- Build every new surface by asking "raised face or milled pocket?"
- Keep the anodize accent scarce; scarcity is what makes it read as paid-for.
- Use the clip-path mill wipe for reveals; respect `prefers-reduced-motion`.
- Etch labels with the dual text-shadow on both light and slate grounds.

**Don't**
- No drop shadows, glows, gradients-as-decoration, or glassmorphism.
- No pills, no rounded-2xl, no neon, no pure white/black.
- No mono type in prose; no accent colour on resting/unengaged elements.
- No bounce/overshoot easing; no fade-in modals.
- No document metaphors — no ledger rules, spec-sheet frames, or catalogue
  numbering systems as decoration.
