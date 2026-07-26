---
version: 1.0.0
name: LIVERY
description: Racing-livery pop modernism for DRVN's seller dashboard — flat livery inks on cream stock, door-number typography, sticker chips, pit-board urgency. No gradients, hard offset shadows only.

colors:
  cream: "#F5EDDD"          # page stock
  cream-panel: "#F2E9DA"    # recessed panels, image fallback
  ink: "#1B1B1E"            # all borders, rules, display type
  cobalt: "#1D4ED8"         # live / informational
  red: "#E4342C"            # needs action / urgency
  yellow: "#FFC700"         # money / highlight / primary action
  powder: "#9EC5E8"         # passive context
  green: "#1E9E52"          # done / sold / success
  white: "#FFFFFF"          # stickers, cards, roundels
  accent: "{colors.yellow}"
  text-muted: "#6B6B72"

typography:
  display:
    font: "Archivo Black, sans-serif"
    size: "clamp(26px, 4.5vw, 46px)"
    transform: uppercase
    letter-spacing: "-0.01em"
    line-height: 0.95
  h1:
    font: "Archivo Black, sans-serif"
    size: "clamp(30px, 4vw, 52px)"
    transform: uppercase
  h2:
    font: "Archivo Black, sans-serif"
    size: "clamp(20px, 3vw, 30px)"
    transform: uppercase
  body:
    font: "Archivo, sans-serif"
    size: "15px"
    weight: 400
    line-height: 1.5
  label:
    font: "Archivo, sans-serif"
    size: "10px"
    weight: 600
    transform: uppercase
    letter-spacing: "0.18em"
  number:
    font: "Anton, sans-serif"
    size: "clamp(52px, 6vw, 84px)"   # KPI scale; smaller uses inherit the face
    weight: 400
    numeric: tabular-nums            # required on anything that ticks

rounded:
  card: "0px"        # blocks are square-cut
  chip: "90px"       # sticker pills
  roundel: "50%"     # door-number circles
  none-elsewhere: true

spacing:
  sp-1: "4px"
  sp-2: "8px"
  sp-3: "12px"
  sp-4: "16px"
  sp-5: "24px"
  sp-6: "32px"
  sp-7: "48px"
  sp-8: "64px"
  max-width: "1280px"
  nav-height: "68px"

motion:
  spring: "cubic-bezier(.34, 1.56, .64, 1)"
  duration: "240ms"
  max-duration: "300ms"

components:
  button-primary:
    background: "{colors.yellow}"
    color: "{colors.ink}"
    border: "2px solid {colors.ink}"
    shadow: "4px 4px 0 {colors.ink}"
    font: "{typography.display.font} 12px uppercase"
    padding: "12px 22px"
    hover:
      transform: "translate(-2px, -2px)"
      shadow: "6px 6px 0 {colors.ink}"
  button-secondary:
    background: "{colors.white}"
    color: "{colors.ink}"
    border: "2px solid {colors.ink}"
    shadow: "4px 4px 0 {colors.ink}"
    hover:
      transform: "translate(-2px, -2px)"
      shadow: "6px 6px 0 {colors.ink}"
  card-block:
    background: "{colors.white}"      # or any livery ink as a solid field
    border: "2px solid {colors.ink}"
    radius: "{rounded.card}"
    padding: "{spacing.sp-5}"
    hover: "translate(-2px,-2px) + shadow grows 4px→6px"
  sticker-chip:
    background: "{colors.white}"
    border: "2px solid {colors.ink}"
    radius: "{rounded.chip}"
    shadow: "4px 4px 0 {colors.ink}"
    font: "10px / 700 / uppercase / 0.14em"
    padding: "4px 14px"
    hover: "rotate(-2deg) translate(-1px,-1px)"
    variants: [yellow, red, cobalt, green, powder, ink]
  roundel:
    shape: circle
    background: "{colors.white}"
    border: "3px solid {colors.ink}"
    font: "{typography.number.font}"
    sizes: { sm: "38px", md: "56px", lg: "84px" }
  input:
    background: "{colors.white}"
    border: "2px solid {colors.ink}"
    padding: "11px 14px"
    focus: "3px 3px 0 {colors.cobalt} + translate(-1px,-1px)"
  nav-band:
    background: "{colors.ink}"
    color: "{colors.cream}"
    height: "{spacing.nav-height}"
    stripe: "10px band — cobalt / red / yellow thirds"
    active-link: "background {colors.red}, white border"
  race-lights:
    shape: "circle, 4px cream border on ink field"
    pending: "#3A3A40"
    current: "{colors.red} + scale(1.12)"
    done: "{colors.green}"
---

# LIVERY Design System

## Overview
LIVERY styles DRVN's logged-in seller surfaces as a race team's pit wall. It borrows from 60s–70s racing liveries (Gulf/Martini/BRE), F1 pit boards and timing towers, and risograph poster culture. Color is structural, numbers are heroes, statuses are stickers, and urgency is a countdown. Everything is flat, hard-edged, and fast.

## Colors
Cream `#F5EDDD` is the paper; ink `#1B1B1E` is every border and display glyph. The five livery inks are semantic and closed: **red** = needs action, **cobalt** = live/informational, **yellow** = money/highlight/primary CTA, **green** = done/sold, **powder** = passive context. Inks are always applied flat and full-bleed within a block — never as tints, gradients, or translucent overlays. Text on cobalt/red/green is white; on yellow/powder/cream it is ink.

## Typography
Three faces, three jobs. **Archivo Black** for all display headings — always uppercase, tight, line-height ≤ 1. **Anton** for every number that matters (KPIs, prices, countdowns, positions) at door-number scale; ticking numbers must set `tabular-nums`. **Archivo** 400–700 for body and UI, with 10px letterspaced uppercase microlabels doing wayfinding. Body copy never exceeds 15px; hierarchy comes from scale jumps, not weight creep.

## Layout
A 1280px frame with chunky asymmetric grids. Blocks butt against each other separated by 2px ink rules (the KPI row is one bordered grid, not four floating cards). Sections are separated by skewed diagonal stripe dividers (cobalt/red/yellow/powder) that slide in on scroll. At ≤760px everything stacks to one column and the nav collapses to a burger.

## Elevation & Depth
There is no soft elevation. Depth is exclusively the hard offset "sticker" shadow: `4px 4px 0 ink`, growing to `6px 6px 0` as the element pops `translate(-2px,-2px)` on hover. A blur radius anywhere in the file is a defect. Overlays use a flat 70% ink scrim.

## Shapes
Three shapes only: the square-cut block (0 radius), the 90px sticker pill, and the perfect circle (roundels, race lights). Interactive elements always carry a 2px ink outline. Stripe bands skew at −24°.

## Components
Nav band (ink bar + tricolor stripe, red active link, sticker user chip) · Roundel (sm/md/lg door-number circle) · Sticker chip (6 ink variants, wobble hover) · Buttons (display-face, hard shadow, 5 ink variants + sm) · KPI block · Offer card (countdown chip + tri-split action row) · Pit board (ink panel, yellow microlabel, flip slot) · Board overlay (yellow-bordered ink dialog, red offset shadow) · Team/part cards (image field + meta bar) · Spec sticker · Timing tower (ink header, expandable rows, offer history) · Tabs (ink-active with count roundels) · Flag chip (CSS color square, no emoji) · Race lights stepper · Payout podium (stepped P2/P1/P3 blocks) · Results table · Input (cobalt focus offset) · Toast (green sticker) · Stripe divider.

## Do's and Don'ts
**Do** make every meaningful number Anton and huge. **Do** put a source-car sticker on every listing surface. **Do** keep motion 200–300ms on the single spring curve. **Do** keep color semantic — red means "act now" everywhere. **Don't** use gradients, blurs, soft shadows, or rounded cards. **Don't** exceed 300ms or add a second easing curve. **Don't** use emoji for flags — flags are CSS squares. **Don't** introduce a sixth livery ink or reassign a color's meaning. **Don't** let display type go lowercase.
