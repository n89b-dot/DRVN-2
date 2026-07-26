---
version: 1.0.0
name: ATELIER
description: >
  Warm dark luxury-ledger design system for DRVN Concept 06 — espresso
  surfaces, brass rules, tan-leather warmth, serif-numbered records.
colors:
  bg: "#1E1813"
  panel: "#292219"
  inset: "#171310"
  imgFallback: "#241E19"
  text: "#EFE7DA"
  muted: "#A6988A"
  accent: "#C9A96A"
  accentDim: "#8C7350"
  rule: "rgba(140, 115, 80, 0.32)"
  ruleStrong: "rgba(140, 115, 80, 0.55)"
  tan: "#B4835B"
typography:
  display:
    font: "Cormorant Garamond"
    weight: 500
    size: "clamp(40px, 4.6vw, 58px)"
    lineHeight: 1.12
    style: "italic accents allowed"
  h1:
    font: "Cormorant Garamond"
    weight: 500
    size: "clamp(34px, 3.6vw, 46px)"
    lineHeight: 1.12
  h2:
    font: "Cormorant Garamond"
    weight: 500
    size: "22px"
  body:
    font: "Figtree"
    weight: 400
    size: "15px"
    lineHeight: 1.65
  label:
    font: "Figtree"
    weight: 500
    size: "10.5px"
    transform: "uppercase"
    letterSpacing: "0.16em"
    color: "{colors.accentDim}"
  price:
    font: "Cormorant Garamond"
    weight: 600
    size: "24px"
    color: "{colors.accent}"
    numerals: "tabular"
rounded:
  default: "4px"
  frameInner: "2px"
  max: "4px"
spacing:
  containerMax: "1180px"
  containerPad: "40px"
  containerPadMobile: "22px"
  sectionGap: "72px"
  rowPad: "26px"
  navHeight: "76px"
motion:
  ease: "cubic-bezier(.25, 1, .35, 1)"
  duration: "500ms"
  range: "400–600ms"
  reveal: "opacity + 6px rise"
components:
  button-primary:
    border: "1px solid {colors.accent}"
    color: "{colors.accent}"
    background: "transparent"
    padding: "15px 34px"
    radius: "{rounded.default}"
    typography: "{typography.label}"
    hover:
      background: "{colors.accent}"
      color: "{colors.inset}"
  button-text:
    color: "{colors.muted}"
    typography: "{typography.label}"
    borderBottom: "1px solid transparent"
    hover:
      color: "{colors.accent}"
      borderBottom: "1px solid {colors.accent}"
  ledger-row:
    display: "flex, gap 28px"
    padding: "26px 4px"
    borderBottom: "1px solid {colors.rule}"
    title: "{typography.h2}"
    hover:
      background: "rgba(41, 34, 25, 0.55)"
      titleColor: "{colors.accent}"
  framed-panel:
    outerBorder: "1px solid {colors.accentDim}"
    innerBorder: "1px solid {colors.ruleStrong}"
    gap: "7px"
    background: "{colors.panel}"
    radius: "{rounded.default}"
    emphasisBorder: "1px solid {colors.accent}"
  tag:
    border: "1px solid rgba(180, 131, 91, 0.45)"
    color: "{colors.tan}"
    padding: "4px 10px"
    radius: "2px"
    fontSize: "9.5px"
    letterSpacing: "0.16em"
  input:
    background: "{colors.inset}"
    border: "1px solid {colors.ruleStrong}"
    color: "{colors.text}"
    padding: "13px 15px"
    radius: "{rounded.default}"
    focusBorder: "{colors.accent}"
  nav-item:
    typography: "{typography.label}"
    color: "{colors.muted}"
    activeColor: "{colors.text}"
    activeUnderline: "1px solid {colors.accent}"
    hoverColor: "{colors.accent}"
  offer-record:
    padding: "28px 4px"
    borderBottom: "1px solid {colors.rule}"
    bid: "Cormorant Garamond 600 26px {colors.accent}"
    actions: "{components.button-text}"
---

# ATELIER — Design System

## Overview

ATELIER is the design language of a private coach-builder's ledger: a
marketplace back office rendered in old-money materials with modern software
discipline. Content is composed as **records** — ruled rows in a book — not as
cards in a feed. One accent (brass) does all accent work; warmth itself is the
trust signal. Values in this document match `atelier.css` exactly; the CSS
custom properties in `:root` are the implementation of the frontmatter tokens.

## Colors

Three warm surfaces create depth without shadows: `bg` #1E1813 (espresso page),
`panel` #292219 (raised paper), `inset` #171310 (recessed wells — inputs,
expanded row interiors). Text is warm parchment #EFE7DA with muted #A6988A for
secondary lines. Brass is the only accent: #8C7350 at 0.32/0.55 alpha for
hairline rules, full #C9A96A for money, active states, emphasis keylines.
Saddle tan #B4835B provides secondary warmth for avatars and stamps only.
Empty image containers fall back to #241E19. **No pure black, no pure white,
no cool hue anywhere.**

## Typography

- **Cormorant Garamond 500/600** — headings, ledger titles, and *all money*.
  Prices are serif 600 in brass; italics are real and used for emphasis words
  and roman section numerals.
- **Figtree 400/500** — body and UI at 15px/1.65.
- **Labels** — uppercase 10.5px, letterspacing .16em, dim brass. This is the
  system's wayfinding voice: section heads, table headers, field labels, tabs.
- Numerals in tables and countdowns are tabular (`font-variant-numeric:
  tabular-nums`).

## Layout

A 1180px container with 40px side padding (22px under 640px). Ledger
architecture: records are horizontal rows separated by 1px brass-tinted rules
with generous (26px+) vertical padding. Section headers are small-caps labels
with flanking hairline rules and roman numerals (No. I, No. II). The summary
strip is a single ruled band divided by vertical hairlines — never boxed KPI
cards. Responsive to 390px: rows wrap, the summary stacks, the nav collapses
behind a bordered "Menu" control.

## Elevation & Depth

No drop shadows. Depth is layered warm tone (bg → panel → inset) plus brass
keylines. The **framed panel** — a double-line certificate border (1px
`accentDim` outer, 7px air, 1px `ruleStrong` inner; full brass outer for the
`--emphasis` variant) — is the highest elevation and is reserved for the single
most important object on a page. The home hero alone may carry a subtle warm
radial glow.

## Shapes

Corners are 4px maximum (2px inside frames and on tags). No pills, no circles
except the user avatar. Rules are always 1px.

## Components

- **button-primary** — brass outline, small-caps label; fills brass with inset
  ink on hover. For the one decisive action in a context.
- **button-text** — muted small-caps text; warms to brass with a drawn
  underline on hover. For Accept / Counter / Decline / Amend / Withdraw.
- **ledger-row** — the workhorse record: roman numeral, thumbnail, serif
  title, muted meta, right-aligned serif figure. Hover warms the background
  and the title, never moves geometry.
- **framed-panel** — the certificate frame; `--emphasis` (full brass) at most
  once per page.
- **tag** — hairline stamp in tan (state), brass (certified: "Provenance
  recorded", "Sold"), or muted (neutral: "Open").
- **input / select** — inset well with `ruleStrong` border; focus brightens
  the border to brass. Labels above in the label voice.
- **nav-item** — muted small-caps; active gets parchment ink and a brass
  underline; hover warms to brass.
- **offer-record** — a ledger row carrying a bid figure (serif 26px brass
  against a muted asking line) and text-button actions; acceptance opens an
  inline framed confirm panel rather than a popup.

## Do's and Don'ts

**Do**
- Separate records with rules; reserve boxes for certification (frames) and
  confirmation (modal, confirm panel).
- Set every price, taking and figure-of-record in brass serif.
- Keep motion at 400–600ms on `cubic-bezier(.25,1,.35,1)`: fades, ≤6px rises,
  rules that draw in.
- Let hover states *warm* (parchment → brass, borders brighten).
- Write UI copy in the courteous auction-house register: "offers awaiting your
  consideration", "entered into the ledger".

**Don't**
- Don't use cool hues, pure black, pure white, or drop shadows.
- Don't box metrics into KPI cards or exceed 4px corner radius.
- Don't let brass serif numerals mean anything but money or count-of-record.
- Don't repeat the emphasis frame on a page, and don't animate with bounce,
  snap, or anything under 400ms.
- Don't letterspace the serif; only the sans label voice is tracked.
