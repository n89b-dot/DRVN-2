# TEARSHEET Design System

Print grammar of the 90s Japanese tuner press, ported to a living parts marketplace. Paper, ink, one red. Structure from rules; hierarchy from scale, weight, and red — never from depth.

```yaml
name: TEARSHEET
version: 1.0.0

color:
  paper: "#FAFAF7"        # app background, warm print white
  ink: "#141414"          # text, rules, solid buttons, borders
  mid: "#6E6E6A"          # secondary text, metadata, deks
  red: "#D42B1E"          # THE red — kickers, price underscores, tags, active states, focus
  paper-dim: "#F1F1EC"    # recessed paper: spec boxes, thumbs, hover fills
  rule: "#141414"         # 1px structural ink rules
  rule-soft: "#C9C9C2"    # hairline rules inside dense lists
  paper-on-ink: "#FAFAF7" # text on ink surfaces
  grain-line: "rgba(20, 20, 20, 0.012)"   # paper-grain stripe
  halftone-line: "rgba(20, 20, 20, 0.03)" # fallback halftone stripe
  scrim: "rgba(20, 20, 20, 0.55)"         # modal backdrop

typography:
  font-display: '"Archivo Narrow", "Oswald", "Arial Narrow", sans-serif'  # headlines, kickers, prices, buttons
  font-body: '"Inter", "Helvetica Neue", sans-serif'                       # body, metadata
  fs-body: 13px
  fs-small: 11px
  fs-micro: 10px
  lh-tight: 1.35
  headline-lead: "clamp(40px, 6.2vw, 84px) / 0.95, 700, uppercase"
  headline-sect: "clamp(22px, 2.6vw, 34px) / 0.95, 700, uppercase"
  headline-card: "16px / 1.1, 600, uppercase"
  kicker: "12px, 700, uppercase, tracking 0.18em"

spacing:
  gap: 16px
  gap-lg: 28px
  pad: 14px
  nav-h: 52px
  frame: 1240px

rounded:
  all: 0px   # print has no corners

depth:
  shadows: none   # flat; hierarchy = scale + weight + rules + red

motion:
  t-fast: 150ms        # content crossfades (filter grid, hover fills)
  t-underscore: 180ms  # red underscore slide on nav/tabs
  forbidden: [parallax, scroll-cinematics, slide-transitions, floating]
```

## Principles

1. **Grammar, not artifact.** Take the tuner-press typography, density, and layout rhythm; never pretend the interface is a magazine (no page numbers, mastheads, issue conceits).
2. **Rules do structure.** Visible 1px ink rules between columns and around modules; 3px rules under section heads; hairline `rule-soft` inside dense lists. No shadows, no radii, no gradients.
3. **Red is a budget.** Red touches only: kickers, price underscores, flash tags, active/hover state, focus outlines. Never decoration.
4. **Density is selection.** Prefer more listings per viewport, set legibly with rules, over whitespace-led sparseness.

## Components

### Kicker
`.kicker` — 12px Archivo Narrow 700, uppercase, 0.18em tracking, red. Sits above a headline; the pair sits above a 3px rule (`.rule--heavy`). `.kicker--ink` for rare non-red uses.

### Rule
`.rule` 1px ink hr; `.rule--heavy` 3px (section heads); `.rule--soft` hairline grey (inside lists). The rule is the primary layout instrument.

### Price callout
`.price` — Archivo Narrow 700 with a red bottom border (the underscore). Sizes: `--sm` 18px/2px (list rows), `--md` 24px/3px (cards), `--xl` 56px/4px (product spread). Optional `.price__was` strike-through comparison in body grey. Price is content — never set it in body type.

### Flash tag
`.flash` — micro condensed uppercase on solid red ("FITS YOUR CAR", "ORDER CONFIRMED"). `.flash--ghost` red-outline variant = seller-stated (unverified) claims; solid = platform-verified. The solid/ghost distinction is a trust signal, keep it.

### Spec box
`.specbox` — 1px ink border, reversed ink title bar, two-column ruled table (labels micro uppercase grey, values 11px medium). Used for part specs and build specs identically.

### Row list
`.rowlist` — dense ruled rows: 56px thumb, condensed title + grey meta, right-aligned `.price--sm/--md`. Hover: `paper-dim` fill, title turns red.

### Card grid
`.grid` — 4-col desktop, shared 1px ink borders (border-collapse pattern: grid has left+top, cards have right+bottom). Photo cards (`aspect 4/3`, image bled to edges inside the rule) and text-only cards (`.card--text` with a category eyebrow) mix freely. Filter changes crossfade the whole grid in 150ms.

### Buttons
`.btn` solid ink → red on hover. `.btn--ghost` ruled outline, red text/border on hover. Uppercase condensed 14px. Focus: 2px red outline, 2px offset (global rule).

### Tabs & chips
`.tab` — condensed uppercase, grey; active = ink with a 3px red underscore that slides in over 180ms. `.chip` — ruled toggle, solid red when active.

### Photo module
`.photo` — 1px ink frame, `paper-dim` base, image object-fit cover. Missing image → `.photo--fallback`: halftone-striped paper with the alt text set as a small caption (JS applies it on img error).

### Confirm sheet
`.sheet` — centered dialog, 2px ink border, ruled line-item list, two steps (summary → confirmed). Backdrop uses `scrim`. Escape and backdrop close.

## Voice
Headlines shout, deks explain, metadata is terse ("Cond. B+ · 42k km"). Provenance appears as an editorial cross-reference line, never as a certificate device.
