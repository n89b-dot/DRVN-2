---
version: 1.0.0
name: SUNDAY
description: >
  DRVN Concept 07 — mainstream-excellence consumer design system. Cool light
  canvas, white cards, soft layered shadows, rounded geometry, one confident
  electric indigo. Calm, familiar, meticulously polished.
colors:
  canvas: "#F4F6F9"
  card: "#FFFFFF"
  ink: "#16181D"
  secondary: "#626977"
  hairline: "#E3E7ED"
  accent: "#4F46E5"
  accent-hover: "#4338CA"
  accent-tint: "#EEF0FE"
  success: "#16A34A"
  success-tint: "#EAF7EF"
  amber: "#D97706"
  amber-tint: "#FCF3E5"
  dark: "#101217"
  img-fallback: "#E9EDF2"
typography:
  display:
    font: "Manrope"
    weight: 800
    tracking: "-0.02em"
    size: "clamp(38px, 5vw, 58px)"
    line-height: 1.04
  h1:
    font: "Manrope"
    weight: 800
    tracking: "-0.02em"
    size: "clamp(24px, 3vw, 32px)"
  h2:
    font: "Inter"
    weight: 600
    tracking: "-0.02em"
    size: "18px"
  body:
    font: "Inter"
    weight: 400
    size: "15px"
    line-height: 1.55
  label:
    font: "Inter"
    weight: 500
    size: "12.5px"
    color: "{colors.secondary}"
  number:
    font: "Manrope"
    weight: 800
    size: "30px"
    tracking: "-0.02em"
    numeric: "tabular-nums"
rounded:
  card: "12px"
  control: "10px"
  pill: "999px"
  media: "20px"
  sheet: "16px"
spacing:
  base: "8px"
  scale: [8, 16, 24, 32, 40, 48, 64, 96]
  page-max-width: "1160px"
  topbar-height: "64px"
shadows:
  rest: "0 1px 2px rgba(16,24,40,.05)"
  hover: "0 4px 12px rgba(16,24,40,.08)"
  overlay: "0 12px 32px rgba(16,24,40,.12)"
motion:
  ease: "cubic-bezier(.16, 1, .3, 1)"
  fast: "180ms"
  medium: "240ms"
components:
  button-primary:
    background: "{colors.accent}"
    color: "#FFFFFF"
    radius: "{rounded.control}"
    padding: "10px 18px"
    font: "Inter 600 14px"
    shadow: "{shadows.rest}"
    hover:
      background: "{colors.accent-hover}"
      shadow: "{shadows.hover}"
  button-ghost:
    background: "transparent"
    color: "{colors.ink}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.control}"
    padding: "10px 18px"
    font: "Inter 600 14px"
    hover:
      background: "#F8FAFC"
      border-color: "#CBD2DC"
  card:
    background: "{colors.card}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.card}"
    shadow: "{shadows.rest}"
    hover:
      shadow: "{shadows.hover}"
      transform: "translateY(-2px)"
  pill:
    radius: "{rounded.pill}"
    padding: "6px 11px"
    font: "Inter 600 12px"
    background: "{colors.canvas}"
    color: "{colors.secondary}"
    variants:
      indigo: { background: "{colors.accent-tint}", color: "{colors.accent}" }
      success: { background: "{colors.success-tint}", color: "{colors.success}" }
      amber: { background: "{colors.amber-tint}", color: "{colors.amber}" }
      outline: { background: "{colors.card}", border: "1px solid {colors.hairline}" }
  segment:
    track-background: "#E9EDF3"
    radius: "{rounded.pill}"
    padding: "3px"
    item-font: "Inter 500 13.5px"
    active:
      background: "{colors.card}"
      shadow: "{shadows.rest}"
      font-weight: 600
  input:
    background: "{colors.card}"
    border: "1px solid {colors.hairline}"
    radius: "{rounded.control}"
    padding: "10px 12px"
    font: "Inter 400 14px"
    focus:
      border-color: "{colors.accent}"
      ring: "0 0 0 3px {colors.accent-tint}"
  topbar-tab:
    font: "Inter 500 14px"
    color: "{colors.secondary}"
    radius: "{rounded.pill}"
    padding: "8px 14px"
    active:
      color: "{colors.accent}"
      background: "{colors.accent-tint}"
      font-weight: 600
  stat-card:
    extends: "card"
    padding: "24px"
    label: "{typography.label}"
    value: "{typography.number}"
  offer-card:
    extends: "card"
    padding: "24px"
    layout: "thumb 72px / body flex / actions right"
    thumb-radius: "{rounded.control}"
    actions: ["button-primary sm", "button-ghost sm", "button-ghost sm"]
---

# SUNDAY Design System

## Overview

SUNDAY is DRVN's mainstream-excellence idiom: a marketplace for modified cars
that feels like a world-class consumer app — Linear's discipline, Airbnb's
warmth, Things 3's calm, Stripe's dashboard patterns. Trust is the product;
the interface earns it through familiarity and visible care, never spectacle.
Everything that looks pressable is pressable. Nothing decorative carries
information; nothing informational is decorated.

## Colors

The canvas is cool light grey (`{colors.canvas}`), and every content surface
is a pure white card. Ink (`{colors.ink}`) carries primary text; secondary
slate (`{colors.secondary}`) carries metadata. There is exactly **one**
accent: electric indigo (`{colors.accent}`) with its tint
(`{colors.accent-tint}`), reserved for interactivity (buttons, links, active
tabs, focus rings) and "needs your attention" state (offer dots, matching
pills). Success green and amber appear **only** as small status dots and
tinted pills — never as backgrounds, buttons, or large surfaces. One optional
near-black section (`{colors.dark}`) may appear on the marketing page for
contrast rhythm. No gradients, except a whisper-faint radial behind the home
hero.

## Typography

Inter is the working voice — 400 body, 500 labels, 600 headings/buttons, with
-0.01em to -0.02em tracking on headings. Manrope 700/800 is the display voice,
used sparingly: the home headline, the dashboard greeting, and big statistics.
All numerals set `font-variant-numeric: tabular-nums` so prices, counts, and
countdowns never jitter. **No monospace anywhere.** Body is 15px / 1.55.

## Layout

Content lives in a 1160px max-width column with 24px gutters, on an 8pt
spacing rhythm (8, 16, 24, 32, 40, 48, 64, 96). App pages share a sticky 64px
top bar (wordmark, pill tabs, search stub, avatar). The dashboard uses a
`1fr / 320px` main-and-side grid that stacks below 960px. Everything remains
usable at 390px: search hides, stat cards go two-up, listing rows drop their
metrics column, sheet actions stack full-width.

## Elevation & Depth

Shadows are the depth system; borders never carry hierarchy. Three levels:
rest (`{shadows.rest}`), hover (`{shadows.hover}`), overlay
(`{shadows.overlay}` for sheets and toasts). Hairlines (`{colors.hairline}`)
exist only to crisp an edge, at whisper weight. Interactive cards lift 2px on
hover as their shadow blooms — the signature SUNDAY micro-moment.

## Shapes

12px cards, 10px controls, 999px pills, 20px photo masks, 16px sheets.
Corners are always rounded; there are no square or 2px-radius elements.
Status is a 6px dot inside a pill. Avatars are circles with tinted initials.

## Components

- **Buttons** — primary (indigo, white text, shadow bloom on hover), ghost
  (transparent, hairline border), tint (indigo-on-tint); sm/default/lg sizes.
  Active state nudges down 1px at 99% scale.
- **Pills** — neutral, indigo, success, amber, outline; optional leading dot.
- **Cards** — white, hairline, rest shadow; `card-hover` adds the 2px lift.
- **Top bar** — sticky, blurred white; pill tabs with indigo-tint active state.
- **Stat card** — label (12.5px slate, optional dot) over a Manrope 800
  30px value that counts up on first view, over a 12.5px sub-line.
- **Offer card** — 72px thumb, title + meta (offer price bold, asking struck),
  Accept (primary) / Counter / Decline (ghost). Accept opens the confirm sheet.
- **Listing row** — 64px thumb, title + source-car chip + status pill, views
  with inline SVG sparkline, price + best offer, chevron; expands (240ms
  max-height) to offer history and ghost actions. Sold rows render at 62%
  opacity with desaturated thumbs.
- **Segmented control** — pill track `#E9EDF3`, white active thumb with rest
  shadow, indigo count on the active item.
- **Sheet / modal** — 440px, 16px radius, overlay shadow, rises 14px + scales
  from .98 on open; backdrop `rgba(16,18,23,.4)`; Escape and backdrop close.
- **Toast** — ink pill, bottom-center, slides up 240ms, green check disc.
- **Toggle** — 40×24 pill, knob springs (scale .9 while pressed), indigo when on.
- **Inputs** — white, hairline, indigo border + 3px tint ring on focus.

## Do's and Don'ts

**Do**
- Use indigo only where the user can act or must look.
- Let shadows, spacing, and weight do all hierarchy work.
- Keep numbers tabular; animate them gently (≤900ms, ease-out cubic).
- Write copy like a knowledgeable friend: specific, warm, lightly wry.
- Provide visible indigo focus rings on every interactive element.
- Respect `prefers-reduced-motion` for every animation.

**Don't**
- Add a second accent color, gradients on surfaces, or colored backgrounds
  for status.
- Use monospace, squared corners, outlines-as-style, stickers, or annotation
  devices (those belong to other DRVN concepts).
- Make anything look pressable that isn't, or vice versa.
- Exceed 240ms for interface motion, or move anything the user didn't cause
  to move (entrance staggers excepted, once, on load).
- Use more than one emoji per page; prefer drawn SVG icons.
