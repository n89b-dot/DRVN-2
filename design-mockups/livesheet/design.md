---
version: 2.0.0
name: Livesheet
current_as_of: "2026-09-24"
description: >
  DRVN's design system. A drawing that knows what's happening: drafting-paper
  surfaces, ruled and precise, whose annotations are alive. Measured values sit on
  dimension lines, offers arrive as work orders, countdowns run on the sheet. Two
  lightings: DAY (warm paper) and NIGHT (a cool graphite sheet). Built for DRVN,
  the home for your car and its build: follow what others are building, and buy or
  sell the parts that come off.
source_of_truth: "src/app/styles/ (tokens in 00-tokens-base.css; recipe families 01- to 12-, imported in order by src/app/globals.css)"
themes: [day, night]

colors:
  # ---- DAY (:root in 00-tokens-base.css) ----
  paper:         "#EFEDE6"   # canvas / page background
  paper-deep:    "#E5E2D8"   # recessed: form controls on paper, week cells, quiet capsule
  tile:          "#F8F6F0"   # raised plate (tile, sheet, bottom sheet, search)
  tile-2:        "#F1EFE8"   # secondary plate; the ground for controls on a raised surface
  ink:           "#20232A"   # primary text; ink-inverted surfaces (button, toast, monogram)
  dim:           "#565963"   # secondary text, microlabels, metadata (5.97:1 on paper)
  dimline:       "rgba(32,35,42,0.28)"   # dimension, leader and dashed construction lines ONLY
  grid-line:     "rgba(32,35,42,0.03)"   # the 40px body graticule
  live:          "#C02C14"   # THE signal: live states, the one primary fill, focus ring
  live-tint:     "rgba(203,49,24,0.14)"
  live-text:     "#A82410"   # live text on its tint (chips, text-live utility)
  ok:            "#256B42"   # status only: settled / done / verified. Never a price.
  ok-tint:       "rgba(34,128,74,0.16)"
  ok-text:       "#145C35"
  warn:          "#8A5A00"   # held money, due work: attention without alarm
  warn-tint:     "rgba(196,140,20,0.18)"
  warn-text:     "#6F4A00"
  info:          "#1D5C8A"   # neutral explainer status; never a call to action
  info-tint:     "rgba(38,113,163,0.15)"
  info-text:     "#14527F"
  destructive:   "var(--live)"   # same hue as live; a distinct semantic name
  on-ink:        "#F8F6F0"   # text on ink and live fills
  scrim:         "rgba(32,35,42,0.45)"   # modal / sheet backdrop
  photo-scrim:   "rgba(10,11,14,0.74)"   # dark caption fade over a photo (same in both themes)
  on-photo:      "#FFFFFF"   # text over a photo (same in both themes)
  on-photo-dim:  "rgba(255,255,255,0.78)"  # secondary text over a photo (same in both themes)
  lightbox:      "#0A0B0E"   # the lightbox stage (same in both themes)
  img-fallback:  "#E2DFD5"   # media box before / without an image
  ink-hover:     "#33363E"   # .btn hover
  live-hover:    "#A52410"   # .btn--live hover
  ghost-fill:    "var(--paper-deep)"   # .btn--ghost fill: recessed by day
  ghost-hover:   "#DBD8CD"   # .btn--ghost hover
  rule-soft:     "rgba(32,35,42,0.07)"   # hairline between ruled rows
  rule-mid:      "rgba(32,35,42,0.09)"   # structural hairline: frames, outlines, footers
  ghost:         "rgba(32,35,42,0.055)"  # skeleton / dashed-plate fill
  ghost-strong:  "rgba(32,35,42,0.10)"   # skeleton bar, spent chip, guide track
  photo-filter:  "none"      # not a colour: a filter on img/video

  theme_layer:
    _note: >
      Tailwind v4 @theme holds the scale tokens that become utilities (bg-paper,
      text-ink, rounded-ctl, ease-spring). paper, paper-deep, tile, tile-2, ink,
      on-ink and img-fallback are literal hexes in @theme and are re-declared as
      --color-* inside the night block. --color-dim, --color-live, --color-ok,
      --color-warn and --color-info are var() references to the :root tokens, so
      the contrast-darkened day values (dim, live, ok) have one source and the
      utilities follow them. --color-destructive aliases --color-live. The
      generated text-live utility is re-pointed at --live-text so small red text
      clears AA. @theme also carries the 4px type scale, the radius scale and
      legacy aliases (--color-background, --bg-surface, --text-primary...).

  dark:
    _note: >
      NIGHT is a TOKEN REMAP under [data-theme="dark"] on <html>: same variable
      names, different values, no duplicated component rules. The cool graphite
      sheet replaced the warm sepia night in September 2026 because warm paper
      tinted every car photo's shadows brown. The dark-specific selectors are
      the photo filter on img/video, the theme-switch pip, the select chevron,
      and the selected-chip / category-row plate (see components.fbtn).
    paper:         "#121418"
    paper-deep:    "#0C0E11"
    tile:          "#1C1F25"
    tile-2:        "#171A1F"
    ink:           "#ECEEF2"
    dim:           "#8A909B"
    dimline:       "rgba(236,238,242,0.30)"
    grid-line:     "rgba(236,238,242,0.035)"
    live:          "#FF4530"
    live-tint:     "rgba(255,69,48,0.20)"
    live-text:     "#FF7A66"
    ok:            "#57B983"
    ok-tint:       "rgba(87,185,131,0.18)"
    ok-text:       "#6CC794"
    warn:          "#D9A13C"
    warn-tint:     "rgba(217,161,60,0.18)"
    warn-text:     "#E6B45E"
    info:          "#6CB2DF"
    info-tint:     "rgba(108,178,223,0.20)"
    info-text:     "#8EC4EA"
    on-ink:        "#14161A"
    scrim:         "rgba(5,6,7,0.62)"
    img-fallback:  "#22262D"
    ink-hover:     "#D7D8DC"
    live-hover:    "#FF6047"
    ghost-fill:    "#242830"   # raised ABOVE the graphite, so a ghost button never reads as a black slab
    ghost-hover:   "#2E333B"
    rule-soft:     "rgba(236,238,242,0.09)"
    rule-mid:      "rgba(236,238,242,0.12)"
    ghost:         "rgba(236,238,242,0.06)"
    ghost-strong:  "rgba(236,238,242,0.11)"
    photo-filter:  "brightness(0.86) contrast(1.05)"
    unchanged:     "photo-scrim, on-photo, on-photo-dim, lightbox (the photo underneath does not change with the theme)"

typography:
  families:
    sans: '"IBM Plex Sans" (next/font --font-plex-sans), -apple-system, "Helvetica Neue", sans-serif'   # --sans
    mono: '"IBM Plex Mono" (next/font --font-plex-mono), "SF Mono", monospace'                          # --mono
  loaded_weights:
    sans: [400, 500, 600, 700]
    mono: [400, 500]
  voice_rule: >
    Sans carries everything read or typed at reading size: prose, names, values,
    prices, inputs, tabs, secondary buttons, notes. Mono carries labels and data
    at 12px and under: microlabels, chips, counts, timestamps, spec tags, the ink
    and live button labels. Every number that ticks or aligns is tabular-nums.
  size_scale: "4px grid: 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 (@theme --text-micro, -body, -section, -sub, -head, -display, -display-lg, -display-xl)"
  scale:
    display:            # .pagehead h1, the only display type on a page
      family: "{typography.families.sans}"
      size: "clamp(32px, 4vw, 48px)"
      weight: 600
      line-height: 1.14
      letter-spacing: "-0.02em"
      wrap: "text-wrap: balance"
      variants:
        tight: ".pagehead--tight h1: clamp(26px, 2.6vw, 34px)"
        item: ".pagehead--item h1 (listing PDP): clamp(24px, 2.2vw, 32px) / 1.2, max 40ch"
        console: ".console-main .pagehead h1: clamp(24px, 2.6vw, 32px) / 1.25 / -0.008em"
    num-giant:          # .num-giant, the KPI numerals
      family: "{typography.families.sans}"
      size: "clamp(40px, 5.4vw, 64px)  (console: clamp(24px, 2.1vw, 32px))"
      weight: 600
      line-height: 0.95
      letter-spacing: "-0.03em"
      font-variant-numeric: "tabular-nums"
    section-head:       # .tile__head > .microlabel--ink, .bsec > .microlabel--ink
      family: "{typography.families.sans}"
      size: "20px"
      weight: 600
      line-height: 1.3
      letter-spacing: "-0.01em"
      text-transform: "none (sentence case)"
      note: "A heading-position microlabel promotes to heading scale; it must outweigh every button in its section."
    h2:                 # .undrawn h3, .prose h2
      family: "{typography.families.sans}"
      size: "20px"
      weight: 600
      letter-spacing: "-0.01em"
    h3:                 # .alert h4, .drop h4, .mail__subj, .prose h3
      family: "{typography.families.sans}"
      size: "16px"
      weight: 600
    value:              # .bline__val, .step__t, the ruled-row value cell
      family: "{typography.families.sans}"
      size: "16px"
      weight: 600
      line-height: 1.35
      letter-spacing: "-0.01em"
    body:               # <body>; also .feed li, .review p, .alert p, .undrawn p, .bline__note, .step__d, .msg__body
      family: "{typography.families.sans}"
      size: "16px"
      weight: 400
      line-height: "1.5 (1.55 in rows and messages)"
    body-prose:         # .prose p / li
      family: "{typography.families.sans}"
      size: "16px"
      weight: 400
      line-height: 1.7
    note:               # .spec-note, footnotes under spec tables
      family: "{typography.families.sans}"
      size: "13px"
      weight: 400
      line-height: 1.6
      color: "{colors.dim}"
    input:              # .ctl, textarea.ctl, .search
      family: "{typography.families.sans}"
      size: "16px (.search: 15px, 16px at 639px and below)"
      weight: 400
    tab:                # .tabstrip [role=tab]
      family: "{typography.families.sans}"
      size: "15px (14px at 640px and below); count .n 13px (12px)"
      weight: 500
    price:              # .mcell__price, .marketplace-card__price
      family: "{typography.families.sans}"
      size: "18px on a mosaic cell (22px from a 232px cell); 20px / 28px on the marketplace card"
      weight: 600
      font-variant-numeric: "tabular-nums"
      color: "{colors.ink}"
    figure:             # .kv, figures and names at reading size
      family: "{typography.families.sans}"
      size: "16px"
      weight: "400 (b: 500, ink)"
      font-variant-numeric: "tabular-nums"
    label-btn-secondary:  # .btn--ghost, .btn--destructive
      family: "{typography.families.sans}"
      size: "14px"
      weight: 500
      letter-spacing: "0"
      text-transform: "none (sentence case, as written)"
    label-row-action:   # .relbtn
      family: "{typography.families.sans}"
      size: "13px"
      weight: 500
    label:              # .microlabel, .field__label: the connective tissue
      family: "{typography.families.mono}"
      size: "12px"
      weight: 500
      letter-spacing: "0.14em"
      text-transform: "uppercase"
      color: "{colors.dim}"
    label-row:          # .bline__label (0.13em), .msg__who (0.12em), .ledger th (500, 0.12em)
      family: "{typography.families.mono}"
      size: "12px"
      weight: 400
      letter-spacing: "0.12em to 0.13em"
      text-transform: "uppercase"
      color: "{colors.dim}"
    label-nav:          # .bar__link (0.1em), .jumplink (0.12em), .fbtn (0.08em)
      family: "{typography.families.mono}"
      size: "12px (FilterGroup fit on a phone: 10px / 0.04em)"
      weight: 400
      letter-spacing: "0.08em to 0.12em"
      text-transform: "uppercase"
    label-btn:          # .btn (ink) and .btn--live
      family: "{typography.families.mono}"
      size: "12px"
      weight: 500
      letter-spacing: "0.1em"
      text-transform: "uppercase"
    chip:               # .chip, .toast
      family: "{typography.families.mono}"
      size: "12px (card kind badge .mcell__kind: 9px)"
      weight: 400
      letter-spacing: "0.12em (toast 0.1em)"
      text-transform: "uppercase"
    mono-data:          # .livedim .val, .ledger__num, .spec td:first-child
      family: "{typography.families.mono}"
      size: "12px"
      weight: "500 (.livedim .val)"
      font-variant-numeric: "tabular-nums"
    mono-meta:          # .feed time, .mail__foot, .field__hint / __err / __ok, .indexrow__n
      family: "{typography.families.mono}"
      size: "12px"
      weight: 400
      color: "{colors.dim}"

rounded:
  # Four tokens. Radius descends with the size of the thing.
  r:      "16px"    # --r: tiles, sheets, hero media, undrawn, drop, mail, band, savebar, marketplace card
  ctl:    "10px"    # --r-ctl: buttons, controls, search, filters, nav links, inner media,
                    #   monograms, capsules, callouts, alerts, toast, week cells, dialog close
  chip:   "6px"     # --r-chip: chips, badges, the stamp, photo-corner tags
  meter:  "3px"     # --r-meter: skeleton bars, guide track
  focus:  "4px"     # :focus-visible outline radius
  circle: "50%"     # live dots, pipeline pips, thumb-remove badges, theme pip

spacing:
  grid: "4px (type and most spacing sit on it)"
  deck-gap: "16px (.deck; KPI deck 8px at 640px and below; mosaic 12px, 8px in a 600px container; marketplace grid 16px, 12px under 480px)"
  tile-pad: "20px"
  tile-head-gap: "14px (margin under .tile__head)"
  row-pad-y: "14px (.bline, .rowlist .order, .step); 13px (.ghostrow)"
  section-pad-bottom: "clamp(48px, 7vw, 80px)"
  pagehead-pad: "clamp(28px, 5vw, 52px) 0 clamp(28px, 3.5vw, 40px)"
  wrap-gutter: "clamp(16px, 4vw, 40px) (published as --gutter)"
  wrap-widths: "1200px (--maxw); .wrap--narrow 720px, --medium 900px, --wide 1060px"
  bar-pad: "14px clamp(16px, 4vw, 40px)"
  bottom-surface-h: "76px (--bottom-surface-h: a 64px bar plus 12px of air, plus the safe area)"
  touch-floor: "44px for primary controls, filter chips, tabs, dialog close, bar icons on phones"

motion:
  spring: "cubic-bezier(0.32, 0.72, 0, 1)"   # --spring; Motion `ease`
  t-fast: "160ms"      # colour, background, press
  t-standard: "240ms"  # default fades, small state swaps
  t-move: "380ms"      # spatial movement: tiles, sheets, rows, index sheet
  t-draw: "650ms"      # rules drawing themselves in
  springs: "snappy 500/34/0.7 · responsive 380/32/0.9 · spatial 260/30/1 · gentle 170/26/1 (stiffness / damping / mass, src/lib/motion)"
  distances: "micro 2 · small 6 · medium 12 · large 24 (px)"
  stagger: "70ms per Rv index; 45ms per index row"
  pulse: "2.2s ease-in-out infinite (live dots)"
  skeleton: "1.5s ease-in-out infinite (@keyframes draw)"
  toast-dwell: "3200ms"
  press: "scale(0.97)"

components:
  button:
    class: ".btn"
    react: "Button / ButtonLink (@/components/ui)"
    base:
      font: "{typography.scale.label-btn}"
      padding: "13px 20px (about 44px tall)"
      radius: "{rounded.ctl}"
      background: "{colors.ink}"
      color: "{colors.on-ink}"
      decoration: "none: ink buttons carry no brackets"
      transition: "transform {motion.t-fast} {motion.spring}, background {motion.t-fast} ease"
    states:
      hover: { background: "{colors.ink-hover}" }
      active: { transform: "scale(0.97)" }
      focus-visible: { outline: "2px solid {colors.live}", outline-offset: "3px" }
      loading: { note: "Button loading + pendingLabel ('Saving...'), aria-busy; the fill stays. No spinner." }
    variants:
      live:
        background: "{colors.live}"
        hover: "{colors.live-hover}"
        decoration: "::before '[ ' and ::after ' ]' at 0.5 opacity; the only variant with brackets"
        rule: "THE action on a surface: one red fill per surface"
        disabled: "paper-deep ground, dim text, full opacity (not a faded red)"
      ghost:
        font: "{typography.scale.label-btn-secondary}"
        padding: "12px 18px"
        background: "{colors.ghost-fill}"
        color: "{colors.ink}"
        hover: "{colors.ghost-hover}"
        on-undrawn: "tile ground with a 1px rule-mid inset outline"
      destructive:
        font: "{typography.scale.label-btn-secondary}"
        padding: "12px 18px"
        background: "transparent"
        color: "{colors.live}"
        outline: "inset 0 0 0 1.5px {colors.live}"
        hover: "{colors.live-tint}"
        rule: "Outlined, never filled, so the surface keeps one red fill."
      quiet:
        class: ".relbtn"
        font: "{typography.scale.label-row-action}"
        color: "{colors.dim}"
        underline: "1px {colors.dimline} bottom rule; live on hover"
        use: "row-level release / remove actions, sheet dismiss words"
  tile:
    class: ".tile"
    base: { background: "{colors.tile}", radius: "{rounded.r}", padding: "{spacing.tile-pad}", border: "none", shadow: "none" }
    variants:
      deep:  { background: "{colors.tile-2}" }
      hover: { transform: "translateY(-2px) scale(1.005)", applies-to: ".tile--hover:hover, a.tile:hover" }
    slots: [".tile__head (flex, gap 10px, margin-bottom 14px)", ".tile__img (radius {rounded.ctl}, background {colors.img-fallback})"]
  deck:
    class: ".deck"
    base: { display: "grid", gap: "16px", padding-bottom: "{spacing.section-pad-bottom}", children: "min-width 0" }
    variants:
      kpi:   "4 columns; 2 at 980px and below (gap 8px at 640px)"
      two:   "1.35fr 1fr"
      three: "3 columns"
      aside: "one column; minmax(0,1fr) 320px from 1024px (profile tabs beside a rail)"
  rowlist-row:
    class: ".rowlist .order / .rowlist .jobrow"
    react: "ObjectRow (@/components/ui)"
    base:
      background: "transparent"
      radius: "0"
      border-top: "1px solid {colors.rule-soft}"
      padding: "14px 2px"
      layout: "flex: .order__img 56x44 (radius ctl) + one text column (flex 1 1 10rem: .order__name Sans 600 16px over .order__meta) + .order__actions"
    states:
      first-child: { border-top: "0", padding-top: "4px" }
      hover: { ".order__name": "{colors.live} (linked rows)" }
      done: { class: ".is-done", background: "{colors.ok-tint}", meta-color: "{colors.ok}" }
      gone: { class: ".is-gone", opacity: 0, transform: "translateX(24px) over {motion.t-move}" }
      invalid: { class: ".is-invalid", opacity: 0.55 }
    responsive: { "640px and below": "56px thumb column + text; actions drop under the text in column 2" }
  bline:
    class: ".bline"
    react: "DataRow (@/components/ui)"
    base:
      grid: "190px minmax(0,1fr) auto, gap 5px 18px, align baseline"
      padding: "14px 0"
      border-top: "1px solid {colors.rule-soft}"
    slots:
      label: { class: ".bline__label", font: "{typography.scale.label-row}" }
      value: { class: ".bline__val", font: "{typography.scale.value}" }
      note:  { class: ".bline__note", size: "16px / 1.55", color: "{colors.dim}", max-width: "64ch" }
      status: { class: ".chip", position: "row 1, column 3, justify-self end" }
    variants:
      ctl: { class: ".bline--ctl", note: "a control in the value column" }
      own: { class: ".bline--own", grid: "190px 1fr auto auto", adds: ".relbtn in column 4" }
    responsive: { "720px and below": "minmax(0,1fr) auto; label spans the row, chip moves to row 2" }
  ledger:
    class: ".ledger"
    description: >
      The seller's listings register: the one genuinely tabular surface, many
      short columns scanned down (views, watchers, asking, top offer). Everywhere
      else the ruled row is the answer; a two-column list never uses it.
    base:
      th: "mono 12px / 500 / 0.12em uppercase dim, padding 0 24px 14px 0, border-bottom 1px {colors.rule-mid}"
      td: "padding 18px 24px 18px 0, border-top 1px {colors.rule-soft}, vertical-align top"
    slots:
      num:    { class: ".ledger__num", font: "{typography.families.mono} 12px", numeric: "tabular-nums", align: "right" }
      detail: { class: ".ledger__detail", note: "the disclosed row, opened with the Motion `expand` recipe" }
    states:
      open: { class: ".is-open on the tr", background: "{colors.tile-2}", note: "the open row lifts by tone, never by shadow" }
    responsive:
      "860px and below": "each tr.ledger__row becomes a compact card: title + actions, car + status, then Views, Watch, Asking, Top offer side by side; the title wraps to two lines instead of an ellipsis"
  chip:
    class: ".chip"
    base:
      font: "{typography.scale.chip}"
      padding: "4px 10px"
      radius: "{rounded.chip}"
      background: "{colors.paper-deep}"
      color: "{colors.dim}"
    variants:
      live:   { background: "{colors.live-tint}",   color: "{colors.live-text}" }
      ok:     { background: "{colors.ok-tint}",     color: "{colors.ok-text}" }
      warn:   { background: "{colors.warn-tint}",   color: "{colors.warn-text}" }
      info:   { background: "{colors.info-tint}",   color: "{colors.info-text}" }
      ink:    { background: "{colors.ink}",         color: "{colors.on-ink}" }
      spent:  { background: "{colors.ghost-strong}", color: "{colors.dim}" }
      danger: { background: "{colors.live}",        color: "{colors.on-ink}", note: "terminal negative (failed, suspended); admin console only" }
      kind:   { background: "transparent", outline: "inset 0 0 0 1px {colors.rule-mid}", color: "{colors.dim}" }
      state:  { background: "{colors.tile-2}", color: "{colors.ink}" }
      x:      { note: "removable applied-filter chip (ActiveFilterChip), 44px on the marketplace" }
    rule: "Status, never navigation."
  badge:
    react: "Badge / KindBadge (@/components/ui)"
    kind: "variant=kind: Build, Update, For sale. Emits .chip.chip--kind + icon: a neutral outline, identical on every card. Kind never spends colour."
    state: "variant=state: Used, Grade B, Sold, Reserved. A tint: tone neutral (.chip--state) for a plain fact, ok / live / spent only for a real state."
    lifecycle: "Order and offer lifecycle states use StatusChip (@/components/commerce), not Badge."
  livedim:
    class: ".livedim"
    react: "LiveDim (@/components/livesheet)"
    description: "The signature device: a drafting leader line whose measured value can be live."
    base:
      padding-left: "18px"
      spine: "::before 1px full-height {colors.dimline}"
      ticks: "::after (top) and .livedim__tick (bottom), 7px x 1px {colors.dimline}"
      label: "{typography.scale.label}, display block"
      value: { class: ".val", font: "{typography.families.mono} 12px / 500", color: "{colors.ink}", numeric: "tabular-nums" }
    variants:
      live:  { value-color: "{colors.live}", adds: "6px pulsing {colors.live} dot after the microlabel" }
      blank: { spine: "dashed {colors.dimline}", value-color: "{colors.dim}" }
  dimline-h:
    class: ".dimline-h"
    base: { height: "1px", background: "{colors.dimline}", end-ticks: "1px x 7px at both ends" }
    motion: { from: "scaleX(0), origin left", to: "scaleX(1) under .is-in", timing: "{motion.t-draw} {motion.spring} 120ms" }
  field:
    class: ".field"
    react: "FormField / TextField / TextArea / Select / ComboField / PasswordField / CountedField"
    base: { display: "grid", gap: "8px", margin-bottom: "18px" }
    slots: [".microlabel or .field__label", ".ctl", ".field__hint (mono 12 dim)", ".field__err (mono 12 live, ▸ marker, hidden when empty)", ".field__ok (mono 12 ok, hidden)", "status (polite live region)"]
    states:
      invalid: { class: ".is-invalid", ctl: "border {colors.live}, background {colors.live-tint}" }
      ok:      { class: ".is-ok", ctl: "border {colors.ok}", ok-line: "display block" }
    variants: { row: { class: ".field--row", grid: "1fr 1fr, gap 18px 16px; one column at 640px and below" } }
    note: "Validation appears after blur; aria-describedby / aria-invalid are wired by the React contracts."
  ctl:
    class: ".ctl"
    base:
      font: "{typography.scale.input}"
      color: "{colors.ink}"
      background: "{colors.paper-deep}"
      border: "1px solid transparent (so validation borders never shift layout)"
      radius: "{rounded.ctl}"
      padding: "10px 12px"
      width: "100%, max-width 320px"
    states:
      hover: { border-color: "{colors.rule-mid}" }
      disabled: { opacity: 0.55 }
    on-raised-surface:
      selector: ":where(.tile, .sheet, .bsheet__panel, .finder__refine) .ctl"
      background: "{colors.tile-2}"
      border-color: "{colors.rule-mid}"
      note: "Outlined on a raised plate; recessed paper-deep only when the control sits on paper."
    variants:
      textarea: { font: "Sans 16px / 1.55", min-height: "88px", resize: "vertical", max-width: "none" }
      select: { note: "appearance none, inline-SVG chevron (dim literal, re-set at night), padding-right 38px" }
      block: { class: ".ctl--block", width: "100%" }
      prefix: { class: ".ctl__prefix", frame: "1px solid {colors.rule-mid}, radius {rounded.ctl}, background {colors.paper-deep}" }
      checkbox: { class: "input.sq", size: "16px", accent-color: "{colors.live}", radius: "0" }
  search:
    class: ".search"
    react: "SearchField / SuggestingSearchField / Finder"
    base:
      background: "{colors.tile}"
      radius: "{rounded.ctl}"
      padding: "12px 18px"
      width: "min(560px, 100%)"
      font: "Sans 15px (16px at 639px and below; placeholder 14px)"
      input: "borderless; no WebKit clear glyph"
    states:
      focus-within: { ring: "box-shadow 0 0 0 2px {colors.ink}; the input draws no ring of its own" }
  drop:
    class: ".drop"
    react: "DropZone + uploadImages (src/lib/media-upload.ts)"
    base: { border: "1px dashed {colors.dimline}", radius: "{rounded.r}", background: "{colors.ghost}", padding: "clamp(20px,4vw,34px) 18px" }
    states:
      hover / focus-visible / is-over: { border-color: "{colors.live}", background: "{colors.live-tint}" }
    companions: [".thumbs", ".thumb", ".thumb__x", ".thumb__tag", ".thumb--ghost"]
  alert:
    class: ".alert"
    react: "Alert (@/components/ui), tone default / live / ok"
    base:
      grid: "auto 1fr, gap 4px 12px"
      padding: "14px 16px"
      radius: "{rounded.ctl}"
      background: "{colors.paper-deep}"
      border: "none"
      head: "Sans 16px / 600"
      body: "Sans 16px / 1.55 dim, max 62ch"
    variants:
      live: { background: "{colors.live-tint}", icon: "{colors.live}" }
      ok:   { background: "{colors.ok-tint}",   icon: "{colors.ok}" }
  msg:
    class: ".msg"
    react: "Message / MessageThread / MessageComposer / ThreadDivider"
    base: { padding: "14px 0 14px 16px", border-left: "2px solid {colors.rule-mid}", who: "mono 12px / 0.12em uppercase dim", body: "Sans 16px / 1.55, max 62ch" }
    variants:
      me:  { border-left-color: "{colors.live}" }
      sys: { border-left-style: "dashed" }
  mail:
    class: ".mail"
    base: { frame: "1px solid {colors.rule-mid}", radius: "{rounded.r}", background: "{colors.tile}" }
    slots:
      bar:  { background: "{colors.paper-deep}", border-bottom: "1px solid {colors.rule-mid}", subject: "Sans 16px / 600" }
      foot: { border-top: "1px solid {colors.rule-soft}", font: "{typography.families.mono} 12px", color: "{colors.dim}" }
  steps:
    class: ".steps > .step"
    react: "Stepper (@/components/ui)"
    base: { grid: "34px 1fr auto, gap 5px 14px", padding: "14px 0", border-top: "1px solid {colors.rule-soft}", counter: "01, 02... via counter-increment" }
    states:
      now:  { class: ".is-now",  number: "{colors.live}", title: "{colors.ink}" }
      done: { class: ".is-done", title: "{colors.dim}", desc: "{colors.dim}" }
    responsive: { "640px and below": "28px 1fr; chip drops under the title" }
  pipe:
    class: ".pipe"
    react: "OrderPipeline (@/components/commerce)"
    base: { pip: "9px circle {colors.paper-deep}", connector: "14px x 1px {colors.dimline}", label: "{typography.families.mono} {colors.dim}" }
    states: { on: { class: ".pip.is-on", background: "{colors.live}" } }
  undrawn:
    class: ".undrawn"
    react: "EmptyState (@/components/ui)"
    base: { border: "1px dashed {colors.dimline}", radius: "{rounded.r}", background: "{colors.ghost}", padding: "clamp(24px,5vw,44px) 20px", gap: "10px" }
    slots: [".undrawn__mark (42px dashed square, radius ctl)", "h3 (20px / 600)", "p (16px dim, max 42ch)", "one action"]
    variants:
      hero: { class: ".undrawn--hero", min-height: "clamp(200px, 34vw, 320px)" }
      plate: { class: ".plate-undrawn", note: "a photoless card cover: dashed rule + the undrawn mark (declared unlayered)" }
    rule: "One message and one next step. No filters, sort or search over nothing."
  ghostrow:
    class: ".ghostrow"
    react: "SkeletonRows and the Skeleton* family"
    base: { grid: "56px 1fr 76px, gap 14px", padding: "13px 2px", border-top: "1px solid {colors.rule-soft}" }
    parts: { gbar: "9px, radius meter, {colors.ghost-strong}", gbox: "56x44, radius ctl, {colors.ghost-strong}" }
    states: { loading: { class: ".is-loading (on the parent)", animation: "draw 1.5s: a gradient sweep, never a spinner" } }
    responsive: { "720px and below": "44px 1fr; third column hidden" }
  metric:
    react: "MetricCard (@/components/ui)"
    anatomy: "tile + microlabel + .num-giant + LiveDim line + footer link"
    blank: ".num-giant--blank: the real zero ('0', '$0') in {colors.dim} at full size; never a dash, which reads as loading"
  toast:
    class: ".toast"
    react: "Toast (@/components/ui), rendered as <output> (implicit status role), portalled to body"
    base: { position: "fixed, bottom 24px + safe area, centred, z-index 120", background: "{colors.ink}", color: "{colors.on-ink}", radius: "{rounded.ctl}", padding: "12px 20px", font: "{typography.scale.chip}" }
    dwell: "{motion.toast-dwell}"
  fbtn:
    class: ".fbtn (inside .filters)"
    react: "FilterGroup + FilterLink (aria-current) / FilterButton (aria-pressed)"
    base:
      font: "{typography.families.mono} 12px / 400 / 0.08em uppercase"
      padding: "6px 12px"
      min-height: "44px"
      radius: "{rounded.ctl}"
      background: "transparent"
      outline: "inset 0 0 0 1px {colors.rule-mid}"
      color: "{colors.dim}"
      count: ".n: tabular, 0.6 opacity"
    states:
      hover:   { color: "{colors.ink}" }
      on:      { class: ".is-on", background: "{colors.ink}", color: "{colors.on-ink}" }
      on-night: { background: "{colors.tile}", color: "{colors.ink}", edge: "inset 1px {colors.rule-mid} ring + inset 3px {colors.live} left edge", also: "selected .catside__row" }
      pressed: { selector: "[aria-pressed=true]", background: "{colors.live}", color: "{colors.on-ink}", use: "the fitment switch" }
    group-axes:
      stack: "primary row"
      sub: "quieter row: 8px 11px, 11px type, rule-soft border"
      scroll: "one line that rides the gutter at 760px and below, edge fades where supported"
      fit: "a short fixed set (Explore's five segments) sharing one phone row: equal columns, icon over word, 56px tall, never scrolls"
  tabstrip:
    class: ".tabstrip"
    react: "SheetTabs (@/components/ui), URL-backed"
    base:
      layout: "flex, gap 2px 18px (14px column gap at 640px and below), border-bottom 1px {colors.rule-mid}"
      tab: "{typography.scale.tab}; padding 10px 0 12px; min-height 44px; {colors.dim}; 2px transparent underline"
    states:
      hover: { color: "{colors.ink}" }
      selected: { selector: "[aria-selected=true]", color: "{colors.ink}", underline: "2px {colors.live}" }
    count: ".n tabular at 0.75 opacity; .n--live in {colors.live}"
    rule: "Five tabs with counts fit a 358px phone column: every tab visible. The 760px scroll rule is an overflow safety net, not a layout."
  jumplink:
    class: ".jumprow > .jumplink"
    react: "TabNav (@/components/ui)"
    base: { font: "{typography.families.mono} 12px / 0.12em uppercase", color: "{colors.ink}", border-bottom: "1px solid {colors.dimline}", padding-bottom: "2px" }
    states: { hover: { color: "{colors.live}", border-color: "{colors.live}" } }
    rule: "In-page references ('ON THIS SHEET') only. Panels switch with SheetTabs."
  bar:
    class: ".bar"
    react: "LivesheetBar via AppShell"
    base:
      position: "sticky top, z-index 60"
      background: "color-mix(in srgb, {colors.paper} 86%, transparent)"
      blur: "-webkit-backdrop-filter: blur(14px) declared BEFORE backdrop-filter: blur(14px)"
      inner: "max-width {spacing.wrap-widths}, padding {spacing.bar-pad}"
      link: ".bar__link mono 12px / 0.1em uppercase, 8px 14px, radius ctl, dim; hover paper-deep; .is-active ink ground"
      search: ".bar__search, max 560px; hidden below 980px (the Index leads with search there); on every page otherwise — the bar is identical everywhere"
      badges: ".barbadge: a live count on cart and notifications"
    responsive: { "1080px and below": "text links go; the Index owns navigation", "640px and below": "44px icon targets" }
  index:
    class: ".indexbtn / .indexwrap / .indexsheet / .indexrow"
    base:
      sheet: "full-page paper sheet with the graticule, revealed by clip-path over {motion.t-move}"
      row: "48px single-line rows: 34px mono number column, icon + Sans 600 17px label; child rows 15px / 500 at 44px"
      order: "search first, then Post, then one row per destination; the current row is marked in {colors.live} ('Here')"
      stagger: "45ms per row"
  dialog:
    class: ".sheetwrap > .dialogbox > .sheet"
    react: "Dialog / ConfirmDialog (@/components/ui)"
    base:
      scrim: "{colors.scrim}, z-index 90"
      panel: "width min(480px, 100vw - 40px), {colors.tile}, radius {rounded.r}, padding 22px"
      close: ".dialogbox__close: inside the panel's top-right corner (top 8px, right 10px), Sans 13px / 500 dim, 44px tall; the sheet's first child keeps 56px clear for it. Never on the scrim."
    behaviour: "focus trap, Escape, restore focus, body scroll lock; AnimatePresence enter and exit"
  bottom-sheet:
    class: ".bsheet > .bsheet__panel"
    react: "BottomSheet / FinderRefineSheet"
    base: { panel: "min(640px, 100%), max-height 85dvh, {colors.tile}, radius {rounded.r} {rounded.r} 0 0, padding 22px + safe area", scrim: "{colors.scrim}, z-index 90" }
    variants:
      inline-sm: ".bsheet--inline-sm: dissolves inline (display contents) from 640px"
      inline-lg: ".bsheet--inline-lg: dissolves inline from 1024px"
      center: ".bsheet--center: a centred 480px dialog from 640px"
    close: "On phones a quiet dismiss word (closeLabel, default Done) under the content; closeLabel={null} when the content already ends in its own Done / Cancel."
  mosaic-cell:
    class: ".mosaic > .mcell"
    react: "MosaicCell, FeedMosaicCell, ListingMosaicCell, MasonryFeed, Mosaic"
    base:
      grid: "4 columns, 3 in a 900px container, 2 in a 600px container; gap 12px (8px)"
      kind: "KindBadge + time at the top"
      caption: "title, lede, value, then the price row; foot anchored to the caption floor: byline, then the car or the activity line"
      price: "{typography.scale.price}; never truncates, the detail wraps under it"
    uniform-wall:
      class: ".mosaic--uniform (Explore)"
      frame: "one 4:3 photo frame per card (3:2 in a wall container of 600px and below); cells size to content, rows stretch to align"
  marketplace-card:
    class: ".marketplace-card"
    react: "ListingCard variant=shopping (@/components/ui)"
    base:
      plate: "{colors.tile}, radius {rounded.r}, 1px {colors.rule-mid} border, overflow hidden"
      image: "4:3, object-fit cover, tile-2 while loading; a status flag (Sold, Reserved) as an ink tag on the image corner"
      body: "padding 16px, gap 8px: brand (mono micro), title (Sans 600 16px / 24px, two lines then ellipsis), price ({typography.scale.price}), delivery line, condition and place, fitment only with evidence, seller"
      foot: "'Off my {car}' provenance line, then icon Save and an outlined cart square"
    grid: "4 across; 3 under an 820px container, 2 under 560px, 1 under 308px; gap 16px (12px under 480px)"
    phone: "the delivery line and the seller's blurb drop out at phone-width cells"
  photo-hero:
    class: ".carfocus--photo (garage hero) / .featbuild--photo (profile featured build)"
    base:
      fade: "linear-gradient(to top, {colors.photo-scrim} 0%, transparent 62% (carfocus) / 55% (featbuild)): under the caption only; the top of the car stays untouched"
      text: "{colors.on-photo}; microlabels and links {colors.on-photo-dim}"
    rule: "Never a paper wash over the car. No user text is drawn into the image."
  capsule:
    class: ".capsule"
    status: "CSS recipe in 03-page.css; no product call sites today"
    base: { background: "{colors.ink}", color: "{colors.on-ink}", radius: "{rounded.ctl}", padding: "10px 16px", slots: ".dot (pulse), .cd (countdown, live, tabular)" }
    variants:
      paper: { background: "{colors.tile}", color: "{colors.ink}" }
      quiet: { background: "{colors.paper-deep}", color: "{colors.dim}", dot: "dim, no animation" }
---

# Livesheet — DRVN Design System

This contract is current as of 2026-09-24. The production CSS lives in `src/app/styles/`
and is the final word on any value; `docs/site` goes into more depth.

## Overview

**Thesis: "A drawing that knows what's happening."**

Livesheet is a working drawing. The surface is drafting paper under a faint 40px
graticule. Content sits on soft-cornered plates in slightly lighter tones. Plates
separate from the page by *tone*, rows separate from each other by *hairline rule*, and
nothing floats on a shadow. Onto that calm surface the system draws annotations that
can be live: measured values on dimension lines, countdowns that run while you read,
offers that arrive as work orders you accept, counter or pass.

DRVN is **the home for your car and its build**: follow what others are building, and
buy or sell the parts that come off. One product, two front doors (Explore and the
Marketplace), with the car in the middle. Provenance, every part pointing back at the
build it came off, is what makes both doors work. It is load-bearing, but it never
leads the story; the car and the part do.

**What this system must never read as:** a dashboard, a fintech app, a crypto console,
a Bloomberg terminal, a blog or a car magazine. Not neon on black, not glassy, not
boxes inside boxes. The reference is a drawing office: calm, ruled, precise.

**Voice:** calm, factual, present tense. The interface reports what it saw. "3 offers
open." "No offers yet. Your listing is live." Never exclamatory, never gamified.

---

## Colors

### The single-accent rule

There is one signal accent: **`--live`** (`#C02C14` day, `#FF4530` night). It marks
what is happening now:

- pulsing dots, countdowns, LIVE chips, arriving amounts, "here" markers in navigation
- count badges on cart and notifications (`.barbadge`), which are live numbers
- the one primary action on a surface (`.btn--live`)
- the focus ring and the text selection
- one `.live-word` per page: a single word in the h1 that takes `--live` and draws a
  3px underline on entry

As a *fill of any size*, red appears only on `.btn--live`, the fitment switch
(`.fbtn[aria-pressed=true]`), the console's `.chip--danger`, `.pip.is-on` and
`::selection`. Everything else it touches is a dot, a pip or a hairline mark.

**One red fill per surface.** The primary action is the only filled red button and the
only one with brackets. The shell's red is the top bar's Post; the rail's "List a
part", card cart buttons, destructive actions and every secondary action are outlined
or ghost.

`--live` is too light for small text on the recessed day surfaces, so text states use
`--live-text` (`#A82410` day, `#FF7A66` night). The `text-live` utility is re-pointed at
it.

### Status tones

`ok`, `warn` and `info` are status tones, never navigation, calls to action or prices.

- **`ok`** marks terminal good states: accepted, sold, dispatched, verified.
- **`warn`** marks held money and due work: attention without alarm.
- **`info`** is a neutral explainer tone.
- **`destructive`** is the same hue as `live` under its own semantic name.
  `.btn--destructive` is outlined, so it never becomes a second red fill.

Each tone has a tint for chip and alert grounds, and a `*-text` token one step deeper
(day) or brighter (night), so chip text clears 4.5:1 on its own tint.

**Prices are ink.** Sans 600, tabular, `--ink`. A green price reads as a status and is
wrong.

### `:root` and `@theme`

The `:root` day values of `--dim`, `--live` and `--ok` were darkened for contrast
(dim 5.97:1, live 4.96:1, ok 5.50:1 on paper). The Tailwind `@theme` colours
`--color-dim`, `--color-live`, `--color-ok`, `--color-warn` and `--color-info` are
`var()` references to those `:root` tokens, so utilities and component CSS paint the
same audited values. Paper, tile, ink, on-ink and img-fallback are literal hexes in
both layers, and the night block re-declares their `--color-*` twins. Alpha, tint,
hover and photo tokens exist only on `:root`: they must follow the theme remap, and
they are not scale values Tailwind should generate utilities for.

### Surfaces separate by tone, not by border

The stack is `paper-deep` → `paper` → `tile-2` → `tile`. A `.tile` has no border and no
shadow; it reads as raised because it is lighter than the page. `--dimline` is
reserved for dimension lines, leader lines, dashed empty plates and the `.jumplink`
underline, never a card edge. Rows separate with `--rule-soft`. Structural frames and
outlines (the mail frame, the footer, the prefix frame, outlined controls, filter chips)
use `--rule-mid`.

**Controls on a raised surface are outlined.** On paper a control is recessed
(`paper-deep`). On a tile, sheet, bottom sheet or finder panel it sits on `--tile-2`
with a `--rule-mid` border, because a recessed well inside a raised plate reads as a
hole.

`--ghost` and `--ghost-strong` are the "nothing here yet" fills: skeleton bars, dashed
plates, spent chips.

### Photographs

Text over a photograph uses the photo tokens, the same in both themes because the photo
doesn't change with the theme: a `--photo-scrim` fade rising under the caption only,
`--on-photo` text and `--on-photo-dim` secondary text. A photo is never washed with
paper. The lightbox stage is `--lightbox`, near-opaque, so the page behind a photo is
gone.

### NIGHT: a cool graphite sheet

NIGHT is a **token remap**, declared once under `[data-theme="dark"]` on `<html>`. There
is no dark stylesheet and no duplicated component rule. Paper becomes graphite
(`#121418`), ink becomes a cool white (`#ECEEF2`), and `--live` lifts to `#FF4530` so it
keeps its weight on a dark ground. Night was warm sepia until September 2026; it moved
to graphite because warm paper tinted every car photo's shadows brown.

Two roles change at night rather than just their values:

- **`--ghost-fill`** is recessed by day (`paper-deep`) and raised at night (`#242830`,
  hover `#2E333B`), so a secondary button sits above the graphite instead of reading as
  a black slab cut into it.
- **Selected chips and category rows** are a tile plate with a `--rule-mid` ring and a
  3px accent edge on the left, not a white inversion glaring out of the sheet.

The dark-specific selectors are those two selection rules, the photo filter
(`brightness(0.86) contrast(1.05)` on `img` and `video`), the theme-switch pip and the
`select` chevron, which is an inline SVG with the dim colour as a literal.

If you add a token, add both values. A token that exists only in `:root` is a bug,
unless it is a photo token that is deliberately the same in both lightings.

---

## Typography

Two families, both IBM Plex, loaded with `next/font`: Sans 400/500/600/700 and Mono
400/500. **No third family.**

The split is semantic. **Sans carries everything read or typed at reading size:** prose,
names, values, prices, inputs, search, tabs, secondary buttons, notes. **Mono carries
labels and data at 12px and under:** microlabels, chips, counts, timestamps, spec tags,
the ink and live button labels. Mono means "the sheet annotating itself". At 16px it
read like code, so figures and names moved to Sans (`.kv`).

Sizes sit on a 4px grid (12 / 16 / 20 / 24 / 32 / 40 / 48 / 64, the `@theme --text-*`
scale). Body copy is 16px. See the front matter for every tier.

### The microlabel

```
font-family: IBM Plex Mono;
font-size: 12px;
font-weight: 500;
text-transform: uppercase;
letter-spacing: 0.14em;
color: var(--dim);
```

Two to six words; they label regions, never full sentences. `.microlabel--live` is a
live annotation. `.microlabel--ink` in heading position (leading a `.tile__head` or
`.bsec` row) promotes to a section head: Sans 600 20px, sentence case, larger than any
button in its section.

### Buttons

Hierarchy shows in the type as well as the fill:

- **`.btn--live`**: mono 12px/500 caps, red fill, `[ LABEL ]` brackets at 0.5 opacity.
  The brackets are a drawing-office convention for the one control that matters.
- **`.btn`** (ink): the same mono caps voice, no brackets.
- **`.btn--ghost`** and **`.btn--destructive`**: Sans 14px/500, sentence case as
  written. Words, not stamps.
- **`.relbtn`**: Sans 13px/500, dim, a dotted underline. Row actions and dismiss words.

The brackets used to sit on every button and stopped meaning anything, so they now mark
only the primary action.

### Tabular numerals

Anything that ticks, counts or aligns in a column sets `font-variant-numeric:
tabular-nums`, in either face: `.num-giant`, prices, `.kv`, `.livedim .val`,
`.ledger__num`, countdowns, tab and filter counts.

### Known discrepancies

- **Weights that are not loaded.** Sans loads 400/500/600/700, but a few rules still
  ask for in-between weights: `650` on `.feedprice--lead` and the composer title
  (`.bsc__title`), `640` on the console audit actor. The browser snaps or synthesises
  them. The display, KPI and heading tiers were moved from 650 to 600. Mono loads only
  400/500, yet `.perfcard__value`, `.milestone__value` and `.evo__year` ask for mono
  600.
- **Mono above 12px.** Converted on 2026-09-24: `.order__meta`, `.vehicle__meta`,
  `.feed .amt`, `.spec td:last-child`, `.buybar__price` and `.ordersum__total` are now Plex
  Sans (tabular). Remaining holdouts: `.capsule` at 16px (mockup-only, no product call
  site) and `.mkt__price` (20px/500, landing only).

---

## Layout

- **`.wrap`**: `max-width: 1200px`, gutter `clamp(16px, 4vw, 40px)` published as
  `--gutter`. Narrow pages pair it with `.wrap--narrow` (720), `--medium` (900) or
  `--wide` (1060) rather than inventing a width. `NarrowColumn` is the React contract.
- **`.deck`**: the grid primitive. `gap: 16px`, `padding-bottom: clamp(48px, 7vw,
  80px)` so a section closes cleanly. `--kpi` (4 columns, 2 at 980px), `--two`
  (1.35fr 1fr), `--three`, `--aside` (content beside a 320px rail from 1024px). Children
  carry `min-width: 0`. Never nest decks.
- **Breakpoints.** Four semantic roles, from `docs/site/material.md`: compact ≤640px
  (phone anatomy, sheeted refinements, stacked commits), handheld ≤768px (one-column
  tasks; tab and filter rails may scroll from 760px), collapsed shell ≤1080px (no
  register rail; the Index owns navigation), and split-capable from 981px (a route
  decides). Component-owned exceptions: the PDP splits at 981px, the cart and checkout
  summary rail returns at 1024px, ledgers linearise at 860px, rows stack at 720px.
  Card grids respond to their container (`@container`), not the viewport.
- **One bottom surface per route.** Buybar, savebar or the thread composer, never two.
  Each pads the safe area and content reserves `--bottom-surface-h` (76px).
- **The ruled-row principle.** Inside a plate, lists are ruled rows, not cards. A
  `.rowlist` strips the row's background and radius and gives it a 1px `--rule-soft`
  top. `.bline`, `.step`, `.feed li`, `.review`, `.ghostrow`, `.spec tr` and `.toc a`
  are the same idea: a label column, a value column, an optional status at the end of
  the rule.
- **Card walls.** Browse surfaces use the mosaic family. Explore is one uniform wall:
  every card gets one 4:3 photo frame, and cells size to content. The marketplace is a
  4-across grid of shopping cards.

---

## Elevation & Depth

Depth comes from two things:

1. **Surface tone.** A plate is lighter than the page (`--tile` on `--paper`). A
   recessed control is darker (`--paper-deep`). At night the ghost button fill is raised.
2. **Hairline rules.** `--rule-soft` between rows, `--rule-mid` for frames and outlines,
   `--dimline` for drawn annotation lines.

`.callout`, `.capsule--paper` and `.savebar` carry `box-shadow: 0 1px 0 var(--dimline)`.
It is a 1px baseline rule under an element that sits over content, not a drop shadow.
Outlines are also drawn with inset box-shadows (`.fbtn`, `.chip--kind`,
`.btn--destructive`) so they cost no layout.

**A blurred shadow is reserved for things physically lifted over content:** the combo
popover, a dragged sortable tile, the showcase card and photo-overlay grips, each in
`--scrim`. A plate, card or sheet never casts one.

The top bar is the one frosted surface: 86% `--paper` with `blur(14px)`, so the
graticule stays faintly visible through it. The build keeps only the last of a
prefixed pair, so `-webkit-backdrop-filter` must be declared **before**
`backdrop-filter`.

Layering, bottom to top: callouts 3, bar 60, register rail 61, index sheet 55 (under
the bar), savebar 50, buybar and composer 40, sheets and dialogs 90, skip link 100,
toast 120.

---

## Shapes

Soft-cornered plates on paper: soft, not round. Radius descends with the size of the
thing:

- `--r` 16px: plates, sheets, hero media, bands and the marketplace card
- `--r-ctl` 10px: everything you operate or that sits inside a plate
- `--r-chip` 6px: chips, badges and the stamp
- `--r-meter` 3px: thin bars and tracks

**Nothing is a pill.** A chip, filter, capsule or toast is a rectangle with a soft
corner. `--radius-pill` exists only as a legacy alias and resolves to 10px.

Nothing is a circle except where the circle *is* the meaning: live dots, pipeline pips,
thumb-remove badges and the theme pip. Nothing is square-cornered except the checkbox
(`input.sq`, a drawn tick box) and ruled rows.

**No accent stroke down one side of a card.** An alert carries its meaning in the icon
colour and a tinted ground. On a rounded card a side bar gets clipped by the corners and
reads as a stray mark. The left rule survives only where it is a drafting device on a
flat surface: the `.livedim` leader, the `.msg` spine and the night selection edge on a
selected chip or category row.

---

## Motion

One curve, four durations, shared by CSS and Motion for React (`src/lib/motion`):

```css
--spring: cubic-bezier(0.32, 0.72, 0, 1);
--t-fast: 160ms;      /* colour, background, press */
--t-standard: 240ms;  /* default fades, small state swaps */
--t-move: 380ms;      /* spatial movement: sheets, rows, reveals */
--t-draw: 650ms;      /* rules drawing themselves in */
```

**Motion for React owns behaviour:** presence (Dialog, BottomSheet, Toast, ResultNote),
expand and collapse (the offer counter composer, ledger detail rows, the sell-form
checklist), list insertion and staggered reveals. `Rv` is the reveal: a 12px rise and
fade, 70ms per stagger index, still emitting `is-in` for the CSS draw cascade. Springs
are tuned mechanical (snappy, responsive, spatial, gentle), with nothing visibly
oscillating. Press feedback is `scale(0.97)`.

**CSS keeps the cosmetic layer:** hover colour, focus rings, the skeleton sweep, the
live-dot pulse and the `.is-in` draw cascade. `.dimline-h` scales in from the left over
`--t-draw` after 120ms, and the `.live-word` underline follows at 400ms. The drawing
draws itself, then the data moves.

**Live behaviour in production:**

- `Countdown` renders H:MM:SS from an absolute, server-authoritative `expiresAt`.
- `.is-loading` sweeps a gradient across skeleton bars every 1.5s, like ink being drawn.
  There is no spinner.
- Live dots pulse on a 2.2s cycle, and only on real events.

The mockup's `[data-count]` count-up and `[data-tick]` random watcher ticks are
mockup-only. Live counts over Supabase Realtime are planned, not built. Never fake a
tick.

**Reduced motion.** `MotionPolicy` (`MotionConfig reducedMotion="user"`, mounted once in
the root layout) turns off Motion-driven transforms globally, while opacity still
carries state. `Rv` renders settled, with a timing failsafe so content can never stay
invisible. The CSS guards stop pulses and the sweep, render draws settled and show the
index sheet without its clip. **Countdowns keep running:** a countdown is information,
not decoration.

---

## Components

The full specs are in the front matter above, and live specimens are at
`/docs/components`. Every recipe has a React contract in `src/components/ui` or
`src/components/commerce`, indexed by `src/components/registry.ts`. Compose those; never
hand-write the recipe markup. The notes that matter:

**Buttons**: one `live` action, one red fill, per surface. `default` (ink) is the
contained action, `ghost` the secondary one, `destructive` outlined red, and `quiet`
(`.relbtn`) the row action. Async buttons use `loading` + `pendingLabel` with
`aria-busy`; a finished action is reported by a chip or a `ResultNote`.

**Tiles**: a plate. Never nest a `.tile` inside a `.tile`. Structure inside a plate is
ruled rows.

**Tabs and chips**: panels switch with `SheetTabs` (`.tabstrip`): Sans labels on a ruled
baseline, the current tab inked with a 2px accent underline, and every tab visible on a
phone. The jumprow (`TabNav`) is for in-page references only. Filters are `.fbtn` chips
in a `FilterGroup`: hairline-outlined mono labels, ink when on, 44px tall. `fit` puts a
short fixed set (Explore's five segments) in one phone row, icon over word, never
scrolling.

**Badges**: kind (Build, Update, For sale) is a neutral outline with an icon and never
spends colour. State (Used, Grade B, Sold, Reserved) is a tint, coloured only for a real
state. Order and offer lifecycle states use `StatusChip`.

**`.livedim`**: the signature. The KPI is the fact; the dimension line under it says
what is happening to that fact. `--live` only when it is genuinely live; `--blank`
(dashed spine, dim value) when there is nothing to measure yet.

**`.order` / `ObjectRow`**: any object in a dense list, and the offer as a work order:
Accept (`live`), Counter and Pass (ghost). Accepting tints the row `.is-done`; passing
slides it out.

**Fields**: `TextField` and its siblings wire label, hint, error (after blur), ok and
live status. The `.ctl` keeps a transparent 1px border at rest so the invalid and ok
borders paint without shifting layout. Controls on a raised surface are outlined on
`--tile-2`.

**Search**: `SearchField` / `SuggestingSearchField` / `Finder`. There is one ring, on the
field (`:focus-within`, 2px ink), and no Search button: Enter submits, and every search
is a URL.

**Top bar and index**: the bar is 86% paper plus blur. Its search hides below 980px (the Index
leads with it there); otherwise the bar is identical on every page, Explore and
Marketplace included — they add their own scoped search below it. On phones the Index is a full-page
menu of 48px single-line rows: search first, then Post, then one row per destination.

**Dialog**: the `.sheet` plate over the scrim. Close is a quiet word inside the panel's
top-right corner, never on the scrim. **BottomSheet** keeps its children mounted,
dissolves inline at its breakpoint and adds a Done word on phones; pass
`closeLabel={null}` when the content already ends in its own Done or Cancel.

**Cards**: one family on `MosaicCell`. `ListingCard variant="shopping"` is the
marketplace card: a 4:3 cover-cropped photo, a two-line title, an ink price, condition
and place, the seller, "Off my {car}", an icon Save and an outlined cart. Fitment shows
only with evidence. **Photo heroes** (`.carfocus--photo`, `.featbuild--photo`) put a
dark `--photo-scrim` fade under the caption only.

**`.msg`**: messages are annotations, not chat bubbles: a 2px left spine, a mono author
line, a 16px body. `--me` makes the spine live and `--sys` dashes it.

**`.mail`**: the one framed component (`1px solid --rule-mid`), because it depicts an
artifact that exists outside the app.

**Empty and loading**: `EmptyState` (`.undrawn`) and the skeletons share the geometry
of the real content, so nothing reflows on arrival. An empty state says one thing and
offers one next step. A blank KPI (`MetricCard blank`) shows the real zero, dimmed.

**Toast**: an `<output>` (implicit status role), ink, mono caps, 3200ms dwell.
Telegraphic: "SAVED".

**Recipes with no product call sites:** `.capsule`, `.week`, `.callout`, `.guide`,
`.stamp` and `.savebar` still have CSS and docs specimens, but no product screen renders
them today. `.mkt` and `.band` survive only on the landing page. Everything under
`design-mockups/livesheet/*.html` is the original mockup; where a page there differs
from this contract, the mockup is the idea and this file is production.

---

## Do's and Don'ts

**Do**

- Separate surfaces by **tone**. A lighter plate on darker paper reads as raised.
- Use **ruled rows** for lists inside a plate: label, value, note, status on one rule.
- Reserve `--live` for things that are **happening**, plus one primary action per
  surface.
- Keep prices **ink**, Sans 600, tabular.
- Print `—` for empty values and `$0.00` for empty money. A blank KPI is a dimmed real
  zero.
- Give an empty page **one message and one next step**. Filters, sort and search appear
  once there is something to filter.
- **Desaturate** spent states (`.chip--spent`); don't delete them.
- Switch panels with underline tabs, every tab visible on a phone. Use the jumprow for
  in-page references.
- Outline controls that sit on a raised surface.
- Set `tabular-nums` on anything that ticks or aligns.
- When a surface feels busy, remove fills and borders before you remove information.

**Don't**

- **No filled pill tab rows or filled segmented blocks.** Filled pills read as blocky
  against the sheet. Tabs are underlines, segments are hairline `.fbtn` chips.
- **No boxes inside boxes.** No tile in a tile, and no bordered list item inside a plate.
- **No nested decks.** A nested deck inherits the section's bottom padding and leaves a
  hollow band.
- **No shadows on plates, no gradients on surfaces, no glass.** The permitted gradients
  are the graticule, the skeleton sweep, the photo scrim and the scroll-rail edge fades.
  The permitted blur is the top bar.
- **No borders as card edges.** `--dimline` is for drawn lines only.
- **No second signal accent** and **no green prices.** `ok`, `warn` and `info` are status
  tones.
- **No brackets except on the primary action.**
- **No sideways-scrolling tab rows** on a phone.
- **No white inversions at night.** A selected chip is a tile plate with an accent edge.
- **No spinners.** Loading is ghost rows drawing themselves.
- **No fake data or fake liveness** in a public view.
- **No paper wash over a photograph.** Text on a photo sits on a dark fade under the
  caption.

---

## Accessibility commitments

- **Focus:** a global `:focus-visible { outline: 2px solid var(--live); outline-offset:
  3px; border-radius: 4px; }`, never removed. The accent is otherwise scarce, so nothing
  competes with the ring. It measures 4.96:1 on day paper and 5.40:1 on night paper.
  Search fields draw a 2px ink ring on the field instead of a ring on the input.
- **Contrast:** every text/ground pair clears WCAG AA 4.5:1 in both lightings. Re-check
  whenever a token moves.
  - Day: ink on paper 13.4:1; on-ink on ink 14.6:1; dim 5.97:1 on paper and 5.39:1 on
    paper-deep; live 4.96:1 and ok 5.50:1 on paper; on-ink on the live fill 5.38:1;
    chip text on its tint 5.0 to 5.9:1 (the `*-text` tokens).
  - Night: ink 15.87:1 on paper and 14.21:1 on tile; dim 5.74:1 on paper and 5.14:1 on
    tile; on-ink 15.59:1 on ink and 5.30:1 on the live fill; each status text token
    clears 5.7:1 on its own tint.
  - `--live` still never carries meaning alone. A live value is paired with a dot, a
    microlabel or a state change.
- **Target sizes:** 44px for primary controls: `.btn` (about 44px), filter chips, tabs,
  dialog close, bar icons on phones, full-width commits in stacked save rows, and the
  marketplace card's Save and cart squares. The discovery wall's cart square is 32px, in
  the card's engagement strip.
- **Reduced motion:** as specified in Motion. Nothing essential is animation-only, and
  countdowns keep running.
- **Labels:** search fields need an accessible name (`SearchField` requires one). Field
  labels, hints, errors and status are tied to the control with
  `aria-describedby` / `aria-invalid`. Icon-only controls carry `aria-label`.
- **ARIA patterns:** `aria-pressed` on toggles (the fitment switch, Follow, Save,
  `FilterButton`); `aria-current` on `FilterLink` and navigation; roving tabindex with
  arrow, Home and End keys on `SheetTabs`; ARIA combobox on `ComboField` and
  `SuggestingSearchField`; `<output>` for toasts; `aria-busy` on loading buttons; a
  polite sr-only status line ("Loading ...") inside every skeleton; `aria-hidden` on
  decorative icons and dimension lines.
- **Dialogs and sheets** trap focus, close on Escape, restore focus and lock body scroll.
- **Live regions:** `FormField`'s `status` is a stable polite region for checks.
  Countdowns are not announced every second.

---

## In production

The port is done. The system lives in the app:

| Concern | Where |
| --- | --- |
| Tokens | `src/app/styles/00-tokens-base.css`: Tailwind v4 `@theme` (scale tokens → utilities), the `:root` day tokens, the `[data-theme="dark"]` night block, element defaults |
| Recipes | `src/app/styles/01-foundation.css` … `09-states-content.css` (`@layer components`, by recipe family), then `10-unlayered-motion.css`, `11-responsive.css`, `12-overrides.css` (unlayered on purpose) |
| Cascade | `src/app/globals.css` only imports those files, in filename order. Import order is the cascade. |
| React contracts | `src/components/ui` (primitives), `src/components/commerce` (DRVN objects), `src/components/livesheet.tsx` (`Rv`, `LiveDim`, `Countdown`), `src/lib/motion` |
| Registry | `src/components/registry.ts`: every reusable component with its layer, import path and when to use it |
| Theme | the `ls-theme` cookie (`day` / `night`), stamped as `data-theme` on `<html>` by an inline script in `src/app/layout.tsx` before first paint; `prefers-color-scheme` is only the initial default |

**Night is a token remap.** Add a token in `:root` *and* in the night block, and never
write a dark-specific component rule. The only exceptions are the ones listed under
Colors.

**Gates (`npm test`):**

- `src/app/styles/styles-ratchet.test.ts`: `globals.css` must import every style file in
  order, and a selector defined twice in the same context may not appear or grow. Extend
  the first definition instead.
- `src/components/recipe-ratchet.test.ts`: raw recipe markup (`.btn`, `.pagehead`,
  `.undrawn`, `.msg`…) in feature code may only decrease against `recipe-baseline.json`.
- `src/components/registry.test.ts`: the registry and the barrel exports stay in sync.
- `src/lib/docs/registry-docs.test.ts`: the component table in `docs/site/components.md`
  is generated from the registry and fails when stale.
- `src/components/architecture.test.ts`: routes never import another route's components.

**Rules for new CSS:** use tokens only, with no inline hex, radius or duration. Add a
new value as a token here and in `00-tokens-base.css`. Put the rule in its family's
file. Rules in `@layer components` are tree-shaken when nothing references them, so
app-global classes go in the unlayered files. Declare `-webkit-` prefixed properties
before the unprefixed one.

**Going deeper:** `docs/site` (served at `/docs`) has more detail:
[design-system](../../docs/site/design-system.md) (how the system works),
[brand](../../docs/site/brand.md) (palette tables and measured contrast),
[typography](../../docs/site/typography.md), [components](../../docs/site/components.md)
(§01–§13, including the "which component do I use?" taxonomy), [rules](../../docs/site/rules.md),
[patterns](../../docs/site/patterns.md), [motion](../../docs/site/motion.md) and
[material](../../docs/site/material.md) (behaviour borrowed from Material 3, and the
adaptive model).
