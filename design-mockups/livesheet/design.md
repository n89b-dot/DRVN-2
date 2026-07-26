---
version: 1.0.0
name: Livesheet
description: >
  DRVN's design system. A drawing that knows what's happening — warm drafting-paper
  surfaces, ruled and precise, whose annotations are alive. Live dimension lines measure
  real-time values, offers arrive as work orders, countdowns tick on the sheet. Two
  lightings: DAY (paper) and NIGHT (the drawing office after hours). Built for a
  marketplace for parts pulled off modified cars.
source_of_truth: livesheet.css
themes: [day, night]

colors:
  # ---- DAY (:root) ----
  paper:        "#EFEDE6"   # canvas / page background
  paper-deep:   "#E5E2D8"   # recessed — ghost buttons, chips, controls, week cells
  tile:         "#F8F6F0"   # raised widget tile (the plate content sits on)
  tile-2:       "#F1EFE8"   # secondary / deeper tile, used for tile--deep
  ink:          "#20232A"   # primary text, ink-inverted surfaces (buttons, band, capsule)
  dim:          "#656872"   # secondary text, microlabels, metadata
  dimline:      "rgba(32,35,42,0.28)"   # dimension + leader lines ONLY — never card borders
  grid-line:    "rgba(32,35,42,0.030)"  # the 40px body graticule
  live:         "#F03A20"   # THE signal color — dots, countdowns, LIVE chips, arriving events
  live-tint:    "rgba(240,58,32,0.10)"
  ok:           "#2E7D4F"   # settled / done / verified
  ok-tint:      "rgba(46,125,79,0.10)"
  on-ink:       "#F8F6F0"   # text on ink surfaces
  scrim:        "rgba(32,35,42,0.45)" # modal backdrop
  img-fallback: "#E2DFD5"   # media box before/without an image
  ink-hover:    "#33363E"   # .btn hover
  live-hover:   "#D22F17"   # .btn--live hover
  ghost-hover:  "#DBD8CD"   # .btn--ghost hover
  rule-soft:    "rgba(32,35,42,0.07)"  # hairline between ruled rows
  rule-mid:     "rgba(32,35,42,0.09)"  # hairline for footers, mail frames, msg spines
  ghost:        "rgba(32,35,42,0.055)" # skeleton / dashed-plate fill
  ghost-strong: "rgba(32,35,42,0.10)"  # skeleton bar, spent chip, guide track
  photo-filter: "none"      # not a color — a filter applied to img/video

  dark:
    _note: >
      NIGHT is a TOKEN REMAP, not a second stylesheet. Identical variable names,
      different values, declared once under [data-theme="dark"] on <html>. No component
      rule anywhere in livesheet.css is duplicated for dark; the only dark-specific
      selectors are the photo filter and the theme-switch pip fill.
    paper:        "#171511"
    paper-deep:   "#100F0C"
    tile:         "#201E18"
    tile-2:       "#1B1914"
    ink:          "#F0EEE5"
    dim:          "#8F8C82"
    dimline:      "rgba(240,238,229,0.30)"
    grid-line:    "rgba(240,238,229,0.035)"
    live:         "#FF4530"
    live-tint:    "rgba(255,69,48,0.14)"
    ok:           "#57B983"
    ok-tint:      "rgba(87,185,131,0.12)"
    on-ink:       "#171511"
    scrim:        "rgba(6,5,3,0.62)"
    img-fallback: "#262319"
    ink-hover:    "#DBD9CF"
    live-hover:   "#FF6047"
    ghost-hover:  "#2B2820"
    rule-soft:    "rgba(240,238,229,0.09)"
    rule-mid:     "rgba(240,238,229,0.12)"
    ghost:        "rgba(240,238,229,0.06)"
    ghost-strong: "rgba(240,238,229,0.11)"
    photo-filter: "brightness(0.86) contrast(1.05)"

typography:
  families:
    sans: '"IBM Plex Sans", -apple-system, "Helvetica Neue", sans-serif'   # --sans
    mono: '"IBM Plex Mono", "SF Mono", monospace'                          # --mono
  loaded_weights:
    sans: [400, 500, 600, 700]
    mono: [400, 500]
  scale:
    display:            # .pagehead h1 — the only display type in the system
      family: "{typography.families.sans}"
      size: "clamp(28px, 4vw, 44px)"
      weight: 650
      line-height: 1.05
      letter-spacing: "-0.02em"
    num-giant:          # .num-giant — measured values, the KPI numerals
      family: "{typography.families.sans}"
      size: "clamp(40px, 5.4vw, 64px)"
      weight: 650
      line-height: 0.95
      letter-spacing: "-0.03em"
      font-variant-numeric: "tabular-nums"
    h2:                 # .undrawn h3 / .prose h2 tier
      family: "{typography.families.sans}"
      size: "18px"
      weight: 650
      line-height: 1.4
      letter-spacing: "-0.01em"
    h3:                 # .drop h4 / .alert h4 / .mail__subj / .undrawn h3
      family: "{typography.families.sans}"
      size: "14px–17px"
      weight: 650
      line-height: 1.4
      letter-spacing: "normal"
    value:              # .bline__val / .step__t — the ruled-row value cell
      family: "{typography.families.sans}"
      size: "15.5px (16.5px ≤720px)"
      weight: 600
      line-height: 1.35
      letter-spacing: "-0.01em"
    body:               # <body> default
      family: "{typography.families.sans}"
      size: "15px"
      weight: 400
      line-height: 1.5
      letter-spacing: "normal"
    body-sm:            # .feed li / .review p / .spec td / notes
      family: "{typography.families.sans}"
      size: "13.5px"
      weight: 400
      line-height: 1.5
    body-prose:         # .prose p / .prose li
      family: "{typography.families.sans}"
      size: "14px"
      weight: 400
      line-height: 1.65
    label:              # .microlabel — the system's connective tissue
      family: "{typography.families.mono}"
      size: "10.5px"
      weight: 500
      line-height: 1.5
      letter-spacing: "0.14em"
      text-transform: "uppercase"
      color: "{colors.dim}"
    label-row:          # .bline__label / .msg__who — row labels
      family: "{typography.families.mono}"
      size: "10.5px"
      weight: 400
      letter-spacing: "0.12em–0.13em"
      text-transform: "uppercase"
      color: "{colors.dim}"
    label-nav:          # .bar__link / .jumplink / .fbtn
      family: "{typography.families.mono}"
      size: "11px–11.5px"
      weight: 400
      letter-spacing: "0.1em–0.12em"
      text-transform: "uppercase"
    label-btn:          # .btn
      family: "{typography.families.mono}"
      size: "12px"
      weight: 400
      letter-spacing: "0.1em"
      text-transform: "uppercase"
    mono-data:          # .kv / .livedim .val / .spec td:last-child / .capsule
      family: "{typography.families.mono}"
      size: "12px–13px"
      weight: 500
      letter-spacing: "0.06em (capsule) / normal (values)"
      font-variant-numeric: "tabular-nums"
    mono-meta:          # .order__meta / .feed time / .msg__meta / .mail__foot
      family: "{typography.families.mono}"
      size: "10px–11px"
      weight: 400
      color: "{colors.dim}"

rounded:
  r:      "20px"    # --r — tiles, sheets, hero media, undrawn, drop, mail, band, savebar
  r-cap:  "999px"   # --r-cap — nav pills, chips, capsules, filters, search, toast, gbar
  tile-img: "12px"  # calc(var(--r) - 8px)
  md:     "14px"    # .week__day
  sm:     "12px"    # .btn, .cat-ico, .alert, .ctl__prefix, .monogram--sm, .undrawn__mark
  xs:     "10px"    # .callout, .order__img, .ctl, .msg__attach, .thumb
  xxs:    "8px"     # .sheet .stamp
  focus:  "4px"     # :focus-visible outline radius
  monogram: "16px"

spacing:
  base: "2px"
  rhythm: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 26, 28, 32]
  deck-gap: "14px"          # the one grid gap in the system
  tile-pad: "18px"
  tile-head-gap: "12px"     # margin-bottom under .tile__head
  row-pad-y: "12px–13px"    # .bline, .rowlist .order, .step, .ghostrow
  section-pad-bottom: "clamp(48px, 7vw, 80px)"
  pagehead-pad: "clamp(28px, 5vw, 52px) 0 18px"
  wrap-pad-x: "clamp(16px, 4vw, 40px)"
  bar-pad: "14px clamp(16px, 4vw, 40px)"
  maxw: "1200px"            # --maxw

motion:
  spring: "cubic-bezier(0.32, 0.72, 0, 1)"   # --spring
  t-fast: "160ms"   # color/background/press
  t-move: "380ms"   # tiles, sheets, orders, toast travel
  t-draw: "650ms"   # rules drawing themselves in
  stagger: "70ms per data-stagger index"
  pulse: "2.2s ease-in-out infinite (live dots)"
  skeleton: "1.5s ease-in-out infinite (@keyframes draw)"
  count-up: "900ms, ease-out cubic (1 - (1-p)^3)"
  tick-interval: "4200ms, 40% chance of +1, 900ms red flash on change"
  countdown-interval: "1000ms"
  toast-dwell: "2600ms"
  order-exit: "420ms then removed from DOM"

components:
  button:
    class: ".btn"
    base:
      font: "{typography.scale.label-btn}"
      padding: "13px 20px"
      radius: "{rounded.sm}"
      background: "{colors.ink}"
      color: "{colors.on-ink}"
      decoration: "::before '[ ' and ::after ' ]' at 0.5 opacity"
      transition: "transform {motion.t-fast} {motion.spring}, background {motion.t-fast} ease"
    states:
      hover: { background: "{colors.ink-hover}" }
      active: { transform: "scale(0.97)" }
      focus-visible: { outline: "2px solid {colors.live}", outline-offset: "3px" }
    variants:
      live:  { background: "{colors.live}", hover: "{colors.live-hover}" }
      ghost: { background: "{colors.paper-deep}", color: "{colors.ink}", hover: "{colors.ghost-hover}" }
  tile:
    class: ".tile"
    base: { background: "{colors.tile}", radius: "{rounded.r}", padding: "{spacing.tile-pad}", border: "none", shadow: "none" }
    variants:
      deep:  { background: "{colors.tile-2}" }
      hover: { transform: "translateY(-2px) scale(1.005)", applies-to: ".tile--hover:hover, a.tile:hover" }
    slots: [".tile__head", ".tile__img (radius {rounded.tile-img}, background {colors.img-fallback})"]
  rowlist-row:
    class: ".rowlist .order / .rowlist .jobrow"
    base:
      background: "transparent"
      radius: "0"
      border-top: "1px solid {colors.rule-soft}"
      padding: "13px 2px"
      grid: "56px 1fr auto, gap 14px"
    states:
      first-child: { border-top: "0", padding-top: "4px" }
      hover: { ".order__name": "{colors.live}" }
      done: { class: ".is-done", background: "{colors.ok-tint}", meta-color: "{colors.ok}" }
      gone: { class: ".is-gone", opacity: 0, transform: "translateX(24px)" }
    responsive: { "≤640px": "44px 1fr auto; button clusters drop to column 2" }
  bline:
    class: ".bline"
    base:
      grid: "190px 1fr auto, gap 4px 16px, align baseline"
      padding: "12px 0"
      border-top: "1px solid {colors.rule-soft}"
    slots:
      label: { class: ".bline__label", font: "{typography.scale.label-row}" }
      value: { class: ".bline__val", font: "{typography.scale.value}" }
      note:  { class: ".bline__note", size: "12.5px", color: "{colors.dim}" }
      status: { class: ".chip", position: "grid-row 1 / column 3, justify-self end" }
    variants:
      ctl: { class: ".bline--ctl", note: "control sits in the value column, align-items center" }
      own: { class: ".bline--own", grid: "190px 1fr auto auto", adds: ".relbtn in column 4" }
    responsive: { "≤720px": "1fr auto; label spans both, value 16.5px, chip moves to row 2" }
  chip:
    class: ".chip"
    base:
      font: "{typography.families.mono} 10px / 0.12em / uppercase"
      padding: "4px 10px"
      radius: "{rounded.r-cap}"
      background: "{colors.paper-deep}"
      color: "{colors.dim}"
    variants:
      live:  { background: "{colors.live-tint}",   color: "{colors.live}" }
      ok:    { background: "{colors.ok-tint}",     color: "{colors.ok}" }
      ink:   { background: "{colors.ink}",         color: "{colors.on-ink}" }
      spent: { background: "{colors.ghost-strong}", color: "{colors.dim}" }
    responsive: { "≤640px inside .order__actions": "9px / 3px 8px / 0.1em" }
  capsule:
    class: ".capsule"
    base:
      background: "{colors.ink}"
      color: "{colors.on-ink}"
      radius: "{rounded.r-cap}"
      padding: "10px 16px"
      font: "{typography.families.mono} 12px / 0.06em"
      slots: [".dot (7px, {colors.live}, pulse)", ".cd (countdown, {colors.live}, tabular-nums)"]
    variants:
      paper: { background: "{colors.tile}", color: "{colors.ink}", hairline: "0 1px 0 {colors.dimline}" }
      quiet: { background: "{colors.paper-deep}", color: "{colors.dim}", dot: "{colors.dim}, animation none" }
  livedim:
    class: ".livedim"
    description: "The signature device — a drafting leader line whose measured value is alive."
    base:
      padding-left: "18px"
      spine: "::before 1px full-height {colors.dimline}"
      ticks: "::after (top) and .livedim__tick (bottom), 7px × 1px {colors.dimline}"
      label: "{typography.scale.label}, display block"
      value: { class: ".val", font: "{typography.families.mono} 13px/500", color: "{colors.ink}", numeric: "tabular-nums" }
    variants:
      live:  { value-color: "{colors.live}", adds: "6px pulsing {colors.live} dot after the microlabel" }
      blank: { spine: "dashed gradient of {colors.dimline}", value-color: "{colors.dim}" }
  dimline-h:
    class: ".dimline-h"
    base: { height: "1px", background: "{colors.dimline}", end-ticks: "1px × 7px at both ends" }
    motion: { from: "scaleX(0) origin left", to: "scaleX(1) on .is-in", timing: "{motion.t-draw} {motion.spring} 120ms" }
  field:
    class: ".field"
    base: { display: "grid", gap: "7px", margin-bottom: "16px" }
    slots: [".microlabel", ".ctl", ".field__hint", ".field__err (hidden)", ".field__ok (hidden)"]
    states:
      rest:    { hint: "visible", err: "display none", ok: "display none" }
      invalid: { class: ".is-invalid", err: "display flex, {colors.live}, ▸ marker", ctl-background: "{colors.live-tint}" }
      ok:      { class: ".is-ok", ok-text: "display block, {colors.ok}" }
    known-issue: >
      .ctl declares `border: 0`, so the `border-color` set by `.field.is-invalid .ctl`
      and `.field.is-ok .ctl` has nothing to paint. Invalid is therefore signalled by the
      live-tint fill + the error line; valid is signalled by the .field__ok line only.
    variants: { row: { class: ".field--row", grid: "1fr 1fr, collapses to 1fr ≤640px" } }
  ctl:
    class: ".ctl"
    base:
      font: "{typography.families.mono} 12.5px"
      color: "{colors.ink}"
      background: "{colors.paper-deep}"
      border: "0"
      radius: "{rounded.xs}"
      padding: "10px 12px"
      max-width: "320px"
    variants:
      textarea: { font: "{typography.families.sans} 13.5px/1.5", min-height: "88px", resize: "vertical", max-width: "none" }
      block: { class: ".ctl--block", width: "100%" }
      prefix: { class: ".ctl__prefix", frame: "1px solid {colors.rule-mid}, radius {rounded.sm}, background {colors.paper-deep}" }
      checkbox: { class: "input.sq", size: "16px", accent-color: "{colors.live}", radius: "0" }
  drop:
    class: ".drop"
    base: { border: "1px dashed {colors.dimline}", radius: "{rounded.r}", background: "{colors.ghost}", padding: "clamp(20px,4vw,34px) 18px" }
    states:
      hover / focus-visible / is-over: { border-color: "{colors.live}", background: "{colors.live-tint}" }
    companions: [".thumbs", ".thumb", ".thumb__x", ".thumb__tag", ".thumb--ghost"]
  alert:
    class: ".alert"
    base:
      grid: "auto 1fr, gap 4px 12px"
      padding: "14px 16px"
      radius: "{rounded.sm}"
      background: "{colors.paper-deep}"
      border-left: "2px solid {colors.dimline}"
    variants:
      live: { border-left-color: "{colors.live}", background: "{colors.live-tint}", icon: "{colors.live}" }
      ok:   { border-left-color: "{colors.ok}",   background: "{colors.ok-tint}",   icon: "{colors.ok}" }
  msg:
    class: ".msg"
    base: { padding: "13px 0 13px 14px", border-left: "2px solid {colors.rule-mid}", body: "14.5px/1.55, max-width 62ch" }
    variants:
      me:  { border-left-color: "{colors.live}", who-color: "{colors.live}" }
      sys: { border-left-style: "dashed" }
    companions: [".msg__who", ".msg__meta", ".msg__attach", ".composer"]
  mail:
    class: ".mail"
    base: { frame: "1px solid {colors.rule-mid}", radius: "{rounded.r}", background: "{colors.tile}" }
    slots:
      bar:  { background: "{colors.paper-deep}", border-bottom: "1px solid {colors.rule-mid}" }
      body: { padding: "18px 16px", p: "13.5px/1.6, max-width 58ch" }
      foot: { border-top: "1px solid {colors.rule-soft}", font: "{typography.families.mono} 10px", color: "{colors.dim}" }
  steps:
    class: ".steps > .step"
    base: { grid: "34px 1fr auto", padding: "13px 0", border-top: "1px solid {colors.rule-soft}", counter: "0N via counter-increment" }
    states:
      now:  { class: ".is-now",  number: "{colors.live}", title: "{colors.ink}" }
      done: { class: ".is-done", title: "{colors.dim}", desc: "{colors.dim}" }
    responsive: { "≤640px": "28px 1fr; chip drops to row 2" }
  pipe:
    class: ".pipe"
    base: { pip: "9px circle {colors.paper-deep}", connector: "14px × 1px {colors.dimline} between pips", label: "{typography.families.mono} 10px {colors.dim}" }
    states: { on: { class: ".is-on", background: "{colors.live}" } }
  undrawn:
    class: ".undrawn"
    base: { border: "1px dashed {colors.dimline}", radius: "{rounded.r}", background: "{colors.ghost}", padding: "clamp(24px,5vw,44px) 20px" }
    slots: [".undrawn__mark (42px dashed square)", "h3 (17px/650)", "p ({colors.dim}, max-width 42ch)"]
    variants: { hero: { class: ".undrawn--hero", min-height: "clamp(200px, 34vw, 320px)" } }
  ghostrow:
    class: ".ghostrow"
    base: { grid: "56px 1fr 76px", padding: "13px 2px", border-top: "1px solid {colors.rule-soft}" }
    parts: { gbar: "9px, {colors.ghost-strong}", "gbar--sm": "7px, {colors.ghost}", gbox: "56×44, {colors.ghost-strong}" }
    states: { loading: { class: ".is-loading (on the parent)", animation: "draw 1.5s — 200% gradient sweep left" } }
    responsive: { "≤720px": "44px 1fr; third column hidden" }
  toast:
    class: ".toast"
    base: { position: "fixed bottom 24px, centered", background: "{colors.ink}", color: "{colors.on-ink}", radius: "{rounded.r-cap}", padding: "12px 20px" }
    states: { shown: { class: ".is-shown", opacity: 1, transform: "translate(-50%, 0)" } }
    api: "window.lsToast(message) — or any element with [data-toast=\"MESSAGE\"]; role=status; dwell 2600ms"
  search:
    class: ".search"
    base: { background: "{colors.tile}", radius: "{rounded.r-cap}", padding: "12px 18px", width: "min(420px, 100%)", input: "borderless, inherits mono 13px" }
  fbtn:
    class: ".fbtn"
    base: { font: "{typography.families.mono} 11px / 0.1em / uppercase", padding: "8px 14px", radius: "{rounded.r-cap}", background: "{colors.paper-deep}", color: "{colors.dim}" }
    states:
      hover:   { color: "{colors.ink}" }
      on:      { class: ".is-on", background: "{colors.ink}", color: "{colors.on-ink}" }
      pressed: { selector: "[aria-pressed=true]", background: "{colors.live}", color: "{colors.on-ink}" }
  jumplink:
    class: ".jumprow > .jumplink"
    base: { font: "{typography.families.mono} 11px / 0.12em / uppercase", color: "{colors.ink}", border-bottom: "1px solid {colors.dimline}", padding-bottom: "2px" }
    states: { hover: { color: "{colors.live}", border-color: "{colors.live}" } }
    rule: "Replaces tab rows and segmented controls everywhere in this system."
---

# Livesheet — DRVN Design System

## Overview

**Thesis: "A drawing that knows what's happening."**

Livesheet is a working drawing. The surface is warm drafting paper under a faint 40px
graticule; content sits on soft-cornered plates in slightly lighter paper tones. Nothing
is boxed by borders and nothing floats on a shadow — plates separate from the page by
*tone*, and rows separate from each other by *hairline rule*. Onto that calm, measured
surface the system draws **annotations that are alive**: dimension lines whose measured
labels tick upward in real time, countdowns that run down while you read them, offers
that arrive as work orders you accept, counter or pass.

DRVN is a marketplace for parts pulled off modified cars. **The marketplace is the
point.** Provenance — the fact that every part on the sheet can be traced back to the
build line it came off — is the supporting differentiator that makes buying here safer
than buying from a forum classified. It is never the headline. The headline is always
the part, the price, and the clock.

**What this system must never read as:** a dashboard, a fintech app, a "crypto" console,
a Bloomberg terminal, a blog, or a car-culture magazine. Not neon-on-black. Not
gradient-heavy. Not glassy. Not boxes inside boxes. The reference is a drawing office —
calm, ruled, precise — with a live data feed running through it.

**Voice:** calm, measured, present tense. The interface reports what it just saw.
"Two offers arrived overnight." "The sheet saw 34 watching." Never exclamatory, never
gamified, never "🔥 Hot deal!".

---

## Colors

### The single-accent rule

There is exactly one accent: **`--live`** (`#F03A20` day / `#FF4530` night). It is
reserved for **signals** — things that are happening *now*:

- pulsing dots (`.capsule .dot`, `.bar__link .dot`, `.livedim--live` label dot)
- countdowns and lapse clocks (`.cd`, `[data-seconds]`)
- LIVE / NOW / OPEN chips (`.chip--live`) and arriving events (`.amt--live`)
- the single primary call to action on a surface (`.btn--live`)
- the focus ring, the text selection, the leader-line dot on a photo callout

It is **not** a brand fill and **not** a heading color. There are exactly four places in
`livesheet.css` where `--live` is used as a background, and each is a signal, not
decoration: `.btn--live` (one primary action per surface), `.week__day--hot` (the one
day something is happening), `.pipe .pip.is-on` (the stage a job has reached), and
`::selection`. The tints (`--live-tint`, `--ok-tint`) are the only "colored surfaces"
in the system, and they carry state — a live chip, an invalid field, a settled order —
never brand.

The one deliberate exception is the **live-word device**: a single word in a page
headline (`.live-word`) takes `--live` and draws a 3px red underline beneath itself on
entry. Once per page, in the h1 only. It makes the thesis literal in the first two
seconds.

`--ok` is not a second accent; it is a **terminal state** color — accepted, sold,
dispatched, verified. It never competes for attention because it only appears after the
live thing has stopped being live.

### Surfaces separate by tone, not by border

The stack is `paper-deep` → `paper` → `tile-2` → `tile`, ascending in lightness in DAY
and (deliberately) also ascending in lightness in NIGHT. A `.tile` has no border and no
shadow; it reads as raised because it is lighter than the page. `--dimline` exists **only**
for dimension lines, leader lines, dashed empty plates and the `.jumplink` underline —
never as a card border. Row separation uses `--rule-soft`; structural frames (footer,
mail, message spine, `.ctl__prefix`) use `--rule-mid`.

`--ghost` / `--ghost-strong` are the "nothing here yet" fills: skeleton bars, dashed
plates, spent chips, the price-guidance track.

### NIGHT — the drawing office after hours

NIGHT is a **token remap**. Same variable names, different values, declared once in
`[data-theme="dark"]` on `<html>`. There is no dark stylesheet, no duplicated component
rules, no `.dark\:` variants. Only two dark-specific selectors exist in the whole file:

```css
[data-theme="dark"] img, [data-theme="dark"] video { filter: var(--photo-filter); }
[data-theme="dark"] .bar__theme .sw { background: var(--live); }
```

Paper becomes warm charcoal (`#171511`, not neutral black — the paper stays paper), ink
becomes chalk (`#F0EEE5`), and `--live` lifts to `#FF4530` so it holds its signal weight
against a dark ground. Photography is dimmed with `brightness(0.86) contrast(1.05)` so
images don't glare out of a dark sheet. Every component gets night for free.

If you add a token, you must add both values. A token that exists only in `:root` is a
bug.

---

## Typography

Two families, both IBM Plex. **No third family, ever.**

- **IBM Plex Sans** — everything a human reads as language, plus the giant measured
  numerals. Weights 400 / 500 / 600 / 650 / 700.
- **IBM Plex Mono** — everything the *sheet* says about itself: microlabels, key-values,
  timestamps, countdowns, button labels, nav, chips, filters, spec tables, error lines.

The split is semantic, not decorative. Mono means "this is annotation" — a label the
drawing office wrote on the drawing. Sans means "this is content".

### The microlabel

The connective tissue of the whole system:

```
font-family: IBM Plex Mono;
font-size: 10.5px;
font-weight: 500;
text-transform: uppercase;
letter-spacing: 0.14em;
color: var(--dim);
```

Modifiers: `.microlabel--ink` (promotes it to a section heading inside a `.tile__head`)
and `.microlabel--live` (a live annotation). Microlabels are always short — two to six
words. They label; they don't explain.

### Tabular numerals

Any number that changes while you look at it must not reflow. `font-variant-numeric:
tabular-nums` is set on `.num-giant`, `.livedim .val`, `.capsule .cd`, `.order__meta .cd`
and `.week__day b`. Any new live value must set it too.

### Bracketed buttons

`.btn` renders `[ LABEL ]` via `::before`/`::after` at 0.5 opacity. This is a
drawing-office convention (a control drawn on a plan), not a skin — do not remove the
brackets to "clean up" a button.

### Known discrepancy

The stylesheet asks for `font-weight: 650` on `.pagehead h1`, `.num-giant`, `.undrawn h3`,
`.week__day b`, `.mail__subj`, `.drop h4`, `.alert h4` and `.prose h2`, but the pages load
only the static faces 400/500/600/700. Browsers resolve 650 to the nearest available face
(700). In production, load **IBM Plex Sans Variable** so 650 renders as specified — it is
noticeably calmer than 700 at display sizes.

---

## Layout

- **`.wrap`** — `max-width: var(--maxw)` (1200px), `padding: 0 clamp(16px, 4vw, 40px)`,
  centered. Every page uses it; nothing is full-bleed.
- **`.deck`** — the one grid primitive. `display: grid; gap: 14px;` with
  `padding-bottom: clamp(48px, 7vw, 80px)` so a section always closes cleanly. Variants:
  `--kpi` (4 columns), `--two` (1.35fr 1fr), `--three` (3 columns). Every deck child
  carries `min-width: 0` so long values can't blow out a track.
- Breakpoints: **980px** (decks collapse to 1–2 columns), **720px** (ruled rows stack,
  hero callouts become a chip row), **640px** (nav becomes one horizontally scrollable
  row; order rows compact), **420px** (KPI deck goes single-column).
- **The ruled-row principle.** Inside a plate, lists are *ruled rows*, not cards. A
  `.rowlist` strips the row's own background and radius and gives it a 1px `--rule-soft`
  top border. `.bline`, `.step`, `.feed li`, `.review`, `.ghostrow`, `.spec tr` and
  `.toc a` are all the same idea: a label column, a value column, an optional status at
  the end of the rule. This is the system's answer to almost every list.

---

## Elevation & Depth

**There are no shadows.** Depth is expressed by exactly two means:

1. **Surface tone** — a plate is lighter than the page (`--tile` on `--paper`); a
   recessed control is darker (`--paper-deep`).
2. **Hairline rules** — `--rule-soft` between rows, `--rule-mid` for structural frames,
   `--dimline` for drawn annotation lines.

Three components carry `box-shadow: 0 1px 0 var(--dimline)` — `.callout`,
`.capsule--paper` and `.savebar`. This is not a drop shadow; it is a **1px baseline
rule** drawn under an element that sits over content, using the shadow property because
it must not affect layout. Do not extend it to blur or spread. A blurred shadow anywhere
in this system is a bug.

The only blur in the system is `backdrop-filter: blur(14px)` on the sticky `.bar`, which
sits over an 86% `--paper` mix so the graticule stays faintly visible through it.

Layering is `z-index`: bar 60, savebar 50, buy/release sheet 90, toast 120, callouts 3
over leaders 2.

---

## Shapes

Soft-cornered, superellipse-*feeling* plates on paper. Radii descend with the size of the
thing: `--r` 20px for plates and sheets, 14px for week cells, 12px for buttons, alerts,
icon plates and tile images (`calc(var(--r) - 8px)`), 10px for small media and controls,
8px for the stamp, and `--r-cap` 999px for anything pill-shaped (nav links, chips,
capsules, filters, search, toast, skeleton bars).

Nothing is a perfect circle except live dots (6–9px) and thumbnail close buttons.
Nothing is square-cornered except the checkbox (`input.sq`, `border-radius: 0` — a drawn
tick box) and ruled rows (radius 0 by definition).

---

## Motion

One spring, three durations.

```css
--spring: cubic-bezier(0.32, 0.72, 0, 1);
--t-fast: 160ms;   /* color, background, press */
--t-move: 380ms;   /* tiles, sheets, orders, toast travel */
--t-draw: 650ms;   /* rules drawing themselves in */
```

**Reveals.** `.rv` starts at `opacity: 0; translateY(12px) scale(0.985)` and springs to
rest when an IntersectionObserver (threshold 0.15) adds `.is-in`. `data-stagger="N"`
delays by `N × 70ms`, so a deck of tiles arrives in sequence rather than as a slab. Each
element is unobserved after it fires — reveals never replay.

**Draw-ins.** `.dimline-h` scales from `scaleX(0)` at the left origin over `--t-draw`
with a 120ms lead-in, triggered by the same `.is-in`. The `.live-word` underline uses the
same spring at a 400ms delay. The drawing draws itself; then the data starts moving.

**Live behaviour.**
- `[data-count]` counts from 0 to target over 900ms with an ease-out cubic, then stops.
  Used for values that are true but newly arrived.
- `[data-tick]` is the live one: every 4200ms it has a 40% chance of incrementing by 1
  and flashing the numeral to `--live` for 900ms via the Web Animations API. It never
  decrements. This is what makes the sheet feel watched.
- `[data-seconds]` renders `H:MM:SS` (hours only when non-zero) and decrements every
  1000ms, stopping at zero.
- `.is-loading` sweeps a 200%-wide gradient across skeleton bars every 1.5s — ink being
  drawn left to right, never a spinner.

**`prefers-reduced-motion: reduce` obligations.** Both CSS and JS honour it and both are
required:

- CSS: `.rv` renders at rest with no transition; `.dimline-h` renders drawn; all `pulse`
  animations stop; the skeleton `draw` sweep stops; the `.live-word` underline renders
  static.
- JS: reveals are applied immediately without the observer; `[data-count]` prints its
  final value; `[data-tick]` prints its value and **never starts its interval**.
- Countdowns keep running under reduced motion, deliberately. A countdown is information,
  not decoration — hiding it would remove a fact the user needs.

---

## Components

Full state tables live in the frontmatter above and are rendered live in `design.html`.
The notes that matter:

**`.btn`** — one `.btn--live` per surface, maximum. `.btn` (ink) is the default action,
`.btn--ghost` is secondary. Press is `scale(0.97)`; there is no loading spinner variant —
a button that has fired is replaced by a `.chip--ok` reporting what happened.

**`.tile`** — a plate. Never nest a `.tile` inside a `.tile`. If you need structure
inside a plate, use ruled rows (`.rowlist`, `.bline`, `.step`).

**`.livedim`** — the signature. Use it whenever a static number needs a live footnote:
the KPI value is the fact, the dimension line beneath it is what's happening to that fact
right now. `--live` variant when the annotation is genuinely live; `--blank` (dashed
spine, dim value) when there is nothing to measure yet.

**`.order`** — an offer as a work order. Inside a `.rowlist` it de-boxes to a ruled row.
Its three actions are Accept (`.btn--live`) / Counter (ghost) / Pass (ghost). Accepting
turns the row `.is-done` (ok-tint) and replaces the actions with a `.chip--ok`; passing
slides it out and removes it after 420ms. Countering swaps the actions for an inline
price input.

**`.chip`** — status, never navigation. Four states: base (neutral fact), `--live`
(happening now), `--ok` (settled), `--spent` (expired/sold — desaturated, still legible).

**`.capsule`** — a live furniture band: ink ground, pulsing dot, countdown. `--paper` for
a light ground, `--quiet` when the furniture is there but nothing is live.

**`.field` / `.ctl`** — stacked microlabel, control, hint. Invalid shows `.field__err`
with a `▸` marker and tints the control; valid shows `.field__ok`. See the known issue in
the frontmatter: the border-color changes are inert because `.ctl` has `border: 0`.

**`.alert`** — a left-ruled banner, never a modal. `--live` for something requiring
attention now, `--ok` for confirmation, base for explanation.

**`.steps`** — numbered ruled rows (`01`, `02`, …) for multi-step flows. `.is-now` marks
the number live; `.is-done` dims the whole row. Not a progress bar, not a stepper widget.

**`.pipe`** — order lifecycle as dots with 1px connectors. Show the *empty* pipeline at
reduced opacity before the user has any orders, so the stages are learned in advance.

**`.msg`** — messages are annotations, not chat bubbles: a 2px left spine, an uppercase
mono author, body text at 14.5px. `--me` turns the spine live; `--sys` dashes it.

**`.mail`** — the only framed component in the system (`1px solid --rule-mid`), because
it is depicting an artifact that exists outside the app.

**`.undrawn` / `.ghostrow`** — empty and loading are the same geometry. The dashed plate
is exactly the size of the real content so nothing reflows on arrival.

**`.toast`** — `window.lsToast(msg)` or `[data-toast="MESSAGE"]` on any element. Ink pill,
`role="status"`, 2600ms dwell. Uppercase mono, telegraphic: "SHEET SAVED — REV 17 FILED".

**`.jumprow` / `.jumplink`** — the system's tab replacement. See Do's and Don'ts.

---

## Do's and Don'ts

**Do**

- Separate surfaces by **tone**. A lighter plate on darker paper reads as raised.
- Use **ruled rows** for every list. Label · value · note · status, on one rule.
- Reserve `--live` for things that are **happening**. If it isn't moving, changing, or
  about to expire, it isn't live.
- Let empty values read **"—"**, and label what will fill them. An empty state names the
  mechanism ("release a part from the build line") rather than saying "no data".
- Keep money **factual when zero**: `$0.00`, not `—`. Money must never look broken.
- Make **spent states desaturate**, not disappear. An expired offer becomes
  `.chip--spent`; a sold listing keeps its row. History is part of the sheet.
- Set `tabular-nums` on anything that ticks.
- Use `.jumprow` — a quiet "ON THIS SHEET" row of underlined mono ref-links — instead of
  tabs.
- Keep the **ruling**; drop the ink. When a surface feels busy, remove fills and borders
  before you remove information.

**Don't**

- **No pill tab-rows or segmented controls.** They were built in Pass 6 and removed in
  Pass 7 — too blocky against the sheet's calm. Use `.jumprow` and one continuous page.
- **No boxes inside boxes.** A `.tile` inside a `.tile` is always wrong; so is a bordered
  list item inside a plate. This was the Pass 8 finding on the dashboard.
- **No nested `.deck`s.** A nested deck inherits the section's 48–80px bottom padding and
  leaves a hollow band at the bottom of its parent tile.
- **No shadows, no gradients on surfaces, no glass.** The only gradients in the system
  are the body graticule and the skeleton sweep.
- **No borders as card edges.** `--dimline` is for drawn lines only.
- **No second accent.** `--ok` is a terminal state, not a brand color. No blues, no
  purples, no "info" color — explanation uses `--dim`.
- **No spinners.** Loading is ghost rows drawing themselves.
- **No fake data in a public view.** If an owner hasn't logged their build, the section
  headings stay and the entries read "NO ENTRIES".
- **Never lead with provenance.** Lead with the part, the price, the clock. Provenance is
  the line underneath that makes the price believable.

---

## Accessibility commitments

- **Focus:** a global `:focus-visible { outline: 2px solid var(--live); outline-offset: 3px;
  border-radius: 4px; }`. The ring is the accent precisely because the accent is otherwise
  scarce — nothing competes with it. It measures 3.36:1 against `--paper` in DAY and
  5.42:1 in NIGHT, clearing the 3:1 non-text requirement in both.
- **Contrast, honestly measured:**
  - `--ink` on `--paper`: **13.6:1** DAY. Excellent.
  - `--on-ink` on `--ink`: **14.7:1**. Excellent.
  - `--dim` on `--tile` is 5.15:1 and on `--paper` 4.75:1 in DAY — both clear WCAG AA for normal text (raised from 3.5:1 on 2026-07-20).5:1 DAY / 5.0:1 NIGHT.** DAY fails AA for body text.
    Acceptable for microlabels and non-essential metadata whose content is duplicated
    elsewhere; **not acceptable** for the running prose that currently uses it
    (`.pagehead .sub`, `.alert p`, `.undrawn p`, `.step__d`, `.drop p`). Production fix:
    darken DAY `--dim` to approximately `#6B6E78` (4.7:1) — a change to one token.
  - `--live` on `--paper`: **3.4:1 DAY / 5.4:1 NIGHT.** DAY fails AA for small text, so a
    live value must never be the *only* carrier of its meaning: pair it with a pulsing
    dot, a "LAPSES IN" microlabel, or an `.is-done`/`.chip` state change.
  - `--live` on `--live-tint` (`.chip--live`): **3.2:1 DAY.** The weakest pair in the
    system. Chips are redundant labels by design, but production should darken the chip
    foreground rather than the tint.
  - `--ok` on `--ok-tint`: **4.2:1 DAY.** Marginal; same treatment.
- **Reduced motion:** honoured in CSS and JS as specified in Motion. Nothing essential is
  animation-only.
- **Target sizes:** `.btn` is ~40px tall, `.bar__link` ~32px, `.fbtn` ~32px. These clear
  WCAG 2.2 target-size minimum (24×24) but fall short of the 44×44 platform guideline.
  Production should raise the primary `.btn` to 44px and give nav links a 44px hit area
  via padding or a pseudo-element.
- **Labels:** `.search` is a `<label>` wrapping its input; `.field` associates its
  `.microlabel` with the control. Icon-only controls carry `aria-label` (`.bar__link` to
  settings, notifications).
- **ARIA patterns in use:** `aria-pressed` on toggles (`[data-fitswitch]`,
  `[data-follow]`, and the fbtn `[aria-pressed="true"]` style hook); `role="status"` on
  the toast; `aria-hidden="true"` on every decorative Phosphor icon, every `.dimline-h`,
  and every purely-shape `.ghostrow`; `aria-busy="true"` belongs on any container carrying
  `.is-loading`; `aria-label="Primary"` on the nav.
- **Semantics:** live regions that tick (`[data-tick]`) are deliberately *not* announced —
  a value that changes every four seconds would flood a screen reader. The countdown is
  announced only when a user focuses the row.

---

## Porting to production

Target: the DRVN 2 Next.js app (App Router, TypeScript, Tailwind CSS v4, Supabase).

### 1. Tokens → Tailwind v4 `@theme`

Tailwind v4 is CSS-first. The token block moves almost verbatim into `globals.css`:

```css
@import "tailwindcss";

@theme {
  --color-paper: #EFEDE6;
  --color-paper-deep: #E5E2D8;
  --color-tile: #F8F6F0;
  --color-tile-2: #F1EFE8;
  --color-ink: #20232A;
  --color-dim: #6B6E78;          /* darkened from #656872 — see Accessibility */
  --color-live: #F03A20;
  --color-ok: #2E7D4F;
  --color-on-ink: #F8F6F0;
  --color-img-fallback: #E2DFD5;

  --font-sans: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --radius-r: 20px;
  --radius-cap: 999px;

  --ease-spring: cubic-bezier(0.32, 0.72, 0, 1);
}
```

That gives you `bg-tile`, `text-dim`, `rounded-r`, `ease-spring` etc. for free.

The **alpha tokens** (`--dimline`, `--rule-soft`, `--rule-mid`, `--ghost`,
`--ghost-strong`, `--live-tint`, `--ok-tint`, `--scrim`, `--grid-line`) and the
**hover/state tokens** (`--ink-hover`, `--live-hover`, `--ghost-hover`) are plain custom
properties declared on `:root` alongside `@theme`, because they must be swappable by the
theme remap and are not scale values Tailwind should generate utilities for. Reference
them with arbitrary values (`border-t-[1px] border-[color:var(--rule-soft)]`) or, better,
in the handful of `@layer components` classes below.

Do **not** try to express `.bline`, `.livedim`, `.order` or `.msg` as utility soups. They
are grid recipes with responsive rearrangements; keep them as `@layer components` classes
lifted straight from `livesheet.css`, and use utilities for one-off layout.

### 2. The theme mechanism — cookie, not localStorage

The prototype uses `localStorage` plus a pre-paint inline script. **In the Next.js app,
swap localStorage for a cookie.** The server must know the theme at render time so the
correct `data-theme` is on `<html>` in the initial HTML — otherwise every navigation
flashes DAY before hydration corrects it.

- Store `ls-theme=day|night` in a cookie (1 year, `SameSite=Lax`, not `httpOnly` so the
  client toggle can write it optimistically).
- Read it in the root layout with `cookies()` and set `<html data-theme={...}>` server-side.
- The toggle writes the cookie, flips `document.documentElement.dataset.theme`
  immediately for instant feedback, and (optionally) calls a server action so the cookie
  is authoritative.
- Keep `[data-theme="dark"]` as the selector so the token remap ports unchanged. Add
  `@custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));` if you want
  Tailwind's `dark:` prefix to follow the same attribute — but you should rarely need it,
  because the remap already handles every component.
- Respect `prefers-color-scheme` only as the *initial* default when no cookie exists.

### 3. Behaviours → hooks

| Prototype behaviour | Production hook | Notes |
|---|---|---|
| `[data-count]` | `useCountUp(target, { duration: 900 })` | Returns a formatted string; short-circuits to the final value under `prefers-reduced-motion`. Fire on first intersection, not on mount. |
| `[data-seconds]` | `useCountdown(expiresAt: Date)` | **Server-authoritative.** The prototype counts a client-side integer; production must take an absolute `expires_at` timestamp from Postgres, compute remaining time against a server-corrected clock offset, and re-sync on tab focus and on reconnect. Never trust `Date.now()` alone — a user with a skewed clock must not see a different lapse time from the seller. Render `—` server-side and hydrate to avoid a mismatch. |
| `.rv` + `data-stagger` | `useReveal(index)` | One shared IntersectionObserver in a context provider, not one per element. Returns `{ ref, className }`; adds `is-in` immediately when reduced motion is set. |
| `[data-tick]` | `useLiveCount(channel)` | Replace the random walk with **Supabase Realtime presence** on a per-listing/per-car channel for watcher counts, and Postgres Changes for offer/bid counts. Keep the 900ms `--live` flash on change — it is the thing that makes the sheet feel alive. Throttle to at most one visible update per ~2s so the number is readable. |
| `[data-order]` accept/counter/pass | server actions + optimistic UI | Optimistically apply `.is-done` / `.is-gone`, then reconcile. A failed accept must restore the row and toast the reason. |
| `window.lsToast` | `useToast()` | Single `role="status"` region mounted in the root layout. |
| `.fbtn` filters, `[data-search]` | URL search params | Filters and queries belong in the URL so a market view is shareable and server-renderable. |
| `.is-loading` ghost rows | React Suspense fallbacks | The skeleton must have the *same geometry* as the real row. Set `aria-busy="true"` on the container. |

### 4. Component inventory — build in this order

1. **Primitives:** `Tile`, `Deck` (kpi / two / three), `Microlabel`, `Chip`
   (base/live/ok/spent/ink), `Btn` (ink/live/ghost), `Rule` (`dimline-h`).
2. **The signature:** `LiveDim` (base / live / blank) and `NumGiant` — these carry the
   concept; get them right before anything else.
3. **Ruled rows:** `RowList`, `BLine` (label/value/note/status, plus `--ctl` and `--own`),
   `Step`, `Feed`.
4. **Marketplace:** `MarketCard` (`.mkt` tile), `SearchField`, `FilterRow`, `Capsule`,
   `Pipe`.
5. **Transactional:** `OrderRow` (the work order — accept/counter/pass), `BuySheet`,
   `Alert`, `Toast`.
6. **Forms:** `Field` (+ `Ctl`, `CtlPrefix`, `Drop`, `Thumbs`) — and fix the inert
   `border-color` on `.ctl` by giving it `border: 1px solid transparent` at rest so the
   invalid/ok border-color actually paints.
7. **Empty & loading:** `Undrawn`, `GhostRow` — build these *with* each surface, not after.
8. **Shell:** `Bar` (nav + theme toggle), `JumpRow`, `Foot`, `SaveBar`.

Ship `design.html` alongside the app as the living reference. If a component in the app
and its specimen in the style guide disagree, the style guide is wrong — it links the
same stylesheet, so it can only drift if someone forks a value.
