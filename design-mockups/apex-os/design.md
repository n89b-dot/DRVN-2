---
version: alpha
name: APEX/OS
description: A telemetry-instrument design system for DRVN — near-black cells, one acid accent, monospaced data, and zero decoration that isn't information.
colors:
  surface: "#0A0B0D"
  surface-panel: "#111316"
  surface-panel-2: "#0E1013"
  hairline: "#23262B"
  on-surface: "#E8EAED"
  on-surface-dim: "#6B7178"
  accent: "#D8FF3E"
  on-accent: "#0A0B0D"
  alarm: "#FF3B30"
typography:
  display-xl:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "clamp(34px, 4.4vw, 58px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "-0.03em"
  display:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "clamp(28px, 3.4vw, 44px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  h2:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.02em"
  data:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  data-strong:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "14px"
    fontWeight: 500
    lineHeight: 1.4
  label:
    fontFamily: "JetBrains Mono, monospace"
    fontSize: "10px"
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: "0.18em"
  price:
    fontFamily: "Space Grotesk, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1
rounded:
  none: "0px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "14px"
  lg: "20px"
  xl: "26px"
  xxl: "40px"
components:
  listing-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.data}"
    rounded: "{rounded.none}"
    padding: "14px"
  listing-row-hover:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface}"
    typography: "{typography.data}"
    rounded: "{rounded.none}"
    padding: "14px"
  stat-cell:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.accent}"
    typography: "{typography.display-xl}"
    rounded: "{rounded.none}"
    padding: "20px"
  chip-verified:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  chip-claimed:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  chip-sold:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.alarm}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
  button-acid:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "14px 26px"
  button-acid-hover:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "14px 26px"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "14px 26px"
  ticker:
    backgroundColor: "{colors.surface-panel-2}"
    textColor: "{colors.on-surface-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  corner-panel:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface}"
    typography: "{typography.data}"
    rounded: "{rounded.none}"
    padding: "20px"
  price:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.price}"
    rounded: "{rounded.none}"
    padding: "0px"
---

# APEX/OS — Design System

## Overview
APEX/OS treats the marketplace as a race engineer's console: every screen is an instrument, and data density is a form of respect for an audience that reads spec sheets for pleasure. The emotional target is *precision under load* — a pit-wall calm where nothing decorative survives that isn't information. It is dark only, and it must never soften into a lifestyle app or a photo feed. Trust is expressed as measurement: logged hours, measured shaft play, and a provenance chain rendered like a signal path.

## Colors
The system is near-black end to end — `surface #0A0B0D` for the deck, `surface-panel #111316` and `surface-panel-2 #0E1013` for cells and insets — separated only by a `hairline #23262B`. Text is off-white (`on-surface #E8EAED`) with a dim grey (`on-surface-dim #6B7178`) for labels and secondary data. There is exactly one accent: acid `#D8FF3E`, used for live status, prices, primary actions, and platform-verified truth. A single alarm red (`alarm #FF3B30`) is held in reserve for one terminal state per screen — a SOLD tag — and nothing else. The acid-on-black and white-on-black pairings clear WCAG AA; acid is never used as body text, only as signal.

## Typography
Two families, split by function. JetBrains Mono carries all *data* — the `data`, `data-strong`, `label`, and inline numeric styles — with tabular numerals so columns align like a readout; the `label` token is a `10px`, `0.18em` letterspaced uppercase style used for microlabels and section codes (SYS/01). Space Grotesk carries *display* — the `display-xl` giant numerals on the dashboard and the `display`/`h2` headings — set tight (`-0.02em` to `-0.03em`) at weight `700`. The rule is absolute: if it is a measured value the instrument reports, it is mono; if it is a headline or a giant KPI, it is Grotesk.

## Layout
The layout is a hard, visible grid: every module is a bordered cell, aligned to a dense rhythm (`xs 6` / `sm 8` / `md 14` / `lg 20` / `xl 26` / `xxl 40`). A faint engineering-paper grid sits behind the whole surface. Header and footer are command/status bars carrying operator, region, build number, and a live clock. Cells carry corner tick marks and SYS/xx section codes; tables and stat blocks pack tightly because the density *is* the design. Below ~640px the grid collapses to stacked full-width cells without losing the bordered-cell logic.

## Elevation & Depth
There are no shadows and no gradients-as-decoration. Depth is created purely by border and contrast: a cell reads as raised because it is outlined by a `hairline` and filled a step lighter (`surface-panel`) than the deck. Emphasis comes from the acid accent and from motion — scanline sweeps on hover, blinking status dots, count-up numerals — not from lifting elements off the plane. Flatness is the point: an instrument panel has no drop shadows.

## Shapes
`rounded.none (0px)` is a law, not a default — corners are square everywhere, on every cell, chip, button, and image frame. Photography is framed with corner ticks and crosshair overlays rather than rounded masks. Any radius above zero would read as a consumer app and break the instrument metaphor instantly.

## Components
`listing-row` is the workhorse — a dense grid row (image, part/fitment, source unit, seller, condition, price/status) that lightens to `surface-panel` and runs a scanline on hover. `stat-cell` pairs a `label` with a `display-xl` acid numeral. The fitment chips encode the platform's integrity rule structurally: `chip-verified` is acid (platform truth) and `chip-claimed` is dim grey (seller statement) — never interchangeable — while `chip-sold` is the one red state. `button-acid` is a square solid-acid action that inverts to acid-on-black on hover; `button-ghost` is the dim secondary. `ticker`, `corner-panel`, and `price` round out the kit. Every hover is its own token (`-hover`) and every transition is stepped (`steps`, ≤120ms) so the UI feels mechanical, never easing.

## Do's and Don'ts
**Do**
- Keep one accent (acid) for status, prices, and primary actions; keep red for exactly one terminal state per screen.
- Set every measured value in JetBrains Mono with tabular numerals; set headlines and KPIs in Space Grotesk.
- Build every module as a bordered cell with corner ticks; create depth with border and contrast.
- Encode fitment as `chip-verified` (platform) vs `chip-claimed` (seller) and never blur the two.

**Don't**
- Don't use any `border-radius` above `0px`.
- Don't add drop shadows, glows, or decorative gradients.
- Don't introduce a second accent hue, or use red for anything but the single terminal state.
- Don't animate with soft 300ms eases; transitions are stepped and ≤120ms.
