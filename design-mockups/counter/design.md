# COUNTER Design System

The deal is the design. Two parties, two colors, one thread. This file follows Google's design.md standard: YAML tokens first (1:1 with `counter.css` `:root`), prose after.

```yaml
name: COUNTER
version: 1.0.0
description: Warm, conversation-first marketplace system for DRVN concept 13.

color:
  canvas:
    stone: "#EFEBE4"        # page background
    putty: "#E2DCD2"        # insets, image wells, input fills
    paper: "#FBF9F6"        # warm white cards & bubbles
  text:
    ink: "#262320"          # primary, warm charcoal
    taupe: "#857D72"        # secondary
  line:
    hairline: "rgba(38, 35, 32, 0.12)"
    hairline-soft: "rgba(38, 35, 32, 0.07)"
  party:
    mine: "#C4593A"         # buyer/self — terracotta rust
    mine-tint: "#F4E2DA"    # my bubble fill
    mine-deep: "#A2472E"    # hover/pressed
    theirs: "#4F5D42"       # counterparty — deep moss
    theirs-tint: "#E3E6DC"  # their bubble fill
    theirs-deep: "#3E4A33"
  state:
    ok: "#4F5D42"           # accepted
    warn: "#B0813B"         # open / expiring
    expired: "#9A938A"
  overlay:
    scrim: "rgba(38, 35, 32, 0.35)"

typography:
  family:
    base: '"General Sans", "Cabinet Grotesk", system-ui, sans-serif'
  weight: { body: 400, medium: 500, semibold: 600, bold: 700 }
  scale:
    display: "clamp(38px, 5vw, 60px) / 1.06, weight 700, -0.02em"
    h1-page: "34px, weight 700"
    h2-section: "27px, weight 700"
    bubble-amount: "26px, weight 600, tabular-nums"
    body: "16px / 1.55"
    meta: "12–13px, taupe"
  money: "inline, weight 600, 1.08em bump, tabular-nums — never monospace, never boxed"

rounded:
  card: 14px
  bubble: 18px            # author-side bottom corner reduced to 6px
  pill: 999px

shadow:
  breath: "0 1px 3px rgba(38, 35, 32, 0.06)"   # the only shadow permitted

spacing:
  nav-height: 68px
  max-width: 1200px
  section-pad: 56px
  card-pad: 16–22px
  thread-gap: 14px

motion:
  bubble-in: "220ms ease-out, +8px slide-up, then 180ms 2px spring settle (newest only)"
  nudge: "260ms horizontal ±4px, for validation corrections"
  seam-draw: "600ms ease-out clip-path reveal, once, on deal close"
  hover: "160–180ms transitions; cards lift 2–3px max"
  reduced-motion: "all animation collapses to ~0ms"
```

## Principles

1. **Authorship before content.** Terracotta = me, moss = them, everywhere: bubbles, avatars, buttons, seam. A viewer knows who is speaking before reading a word.
2. **Money is speech.** Prices and offers are inline emphasized text (semibold, tabular numerals), part of the sentence — never a dashboard readout.
3. **A breath of depth.** One shadow token. Hierarchy comes from warm surface steps (stone → putty → paper) and hairlines, not elevation.
4. **Conversational motion only.** Things move the way messages arrive; nothing scrolls-jacks, parallaxes, or flashes.

## Components

### Offer bubble (signature)
Anatomy: amount (26px semibold, party color) → optional note (14.5px ink) → meta row (timestamp + state chip). Mine: right-aligned, `mine-tint` fill, bottom-right corner 6px. Theirs: left-aligned, `theirs-tint` fill, bottom-left 6px. Border is the party color at 22% opacity.

States (chips, the system's only status vocabulary):
- **Open** — warn tint; the live offer awaiting a response. Only one bubble may be Open.
- **Countered** — putty/taupe; superseded by a later offer.
- **Accepted** — ok tint; the closing figure.
- **Expired** — putty with strikethrough label.

When a new offer is sent or received, all prior Open chips demote to Countered.

### Handshake band (signature)
Full-width close of a deal: two halves (`mine-tint` left with buyer avatar, `theirs-tint` right with seller avatar) joined by a 2px vertical seam of alternating terracotta/moss dashes, with a centered paper pill: "Shaken on £N". On creation the seam draws top-to-bottom over 600ms. A closed deal previews in lists as the same split bar at 8px height.

### System row
Centered 13px taupe text flanked by soft hairlines — for non-party events (price drops, counters sent, deals closed, walk-aways).

### Offer composer
Amount field (£ prefix, 20px semibold input, stone fill, rust border on focus) beside a note textarea; hint line above anchors expectations ("listed £1,250 · recent similar sales £1,100–1,200"). Validation errors speak negotiation logic in plain language and nudge the field horizontally; they never turn the UI red-alert.

### Part card
Paper panel, 14px radius, putty image well (4:3), title → condition → price + "or best offer" in rust → seller rating + watchers. Hover lifts 3px and reveals an inline "Make an offer" button. Platform-verified fitment ("Fits your E36") is a paper pill with moss check — visually distinct from seller-stated copy.

### Buttons
Pill radius. Primary = rust fill (my actions); moss fill = closing/counterparty-positive actions (Accept, Pay); ghost = hairline outline; quiet = taupe text. All have hover and `:focus-visible` (2px rust outline, 2px offset).

## Accessibility
Ink on stone ≈ 12:1; taupe reserved for meta text ≥12px. All interactive elements keyboard-reachable with visible focus. Thread container is `aria-live="polite"`; handshake band is `role="status"`. `prefers-reduced-motion` honored globally.
