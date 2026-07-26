# WERKBANK — Design Brief
**DRVN Concept 04 of 5 · Dashboard-first · "The dashboard is a work order."**

## Thesis

WERKBANK treats the seller's dashboard as an engineer's drawing office. Where
the earlier concepts pitched DRVN, this one *operates* it: every page is a
numbered sheet, every card a technical plate, every figure a mono-set,
dimension-annotated callout. The emotional register is competence — the calm
of a well-lit workshop where the paperwork is as precise as the machining.
Drama comes from precision, not scale: 22px headings, hairline rules, one
safety-orange accent that only ever means "decide something here."

## Reference lineage

- **Braun / Dieter Rams instrument panels** — the discipline of one signal
  color on a neutral field; controls that read as facts, not decoration.
- **Technical drawing & DIN 824/6771 title blocks** — sheet numbers
  ("REF 04-B — GARAGE PLATE · SHEET 2 OF 4"), revision stamps, and the
  dimension line with perpendicular end-ticks, lifted directly as the
  system's signature annotation device.
- **Linear's density discipline** — small type, tabular numerals, hover
  states that change border and background rather than size; the conviction
  that a work tool earns beauty through restraint.
- **Teenage Engineering's annotation culture** — labels that talk like a
  service manual ("C-02 AP RACING CP9660 · REMOVED-FOR-SALE"), turning
  metadata into the visual texture itself.

## Why this serves DRVN's trust-and-context mission

DRVN's core claim is that the car profile is the trust layer: every listing
answers *what car did this come off, who's the seller, will it fit, what was
it paired with*. WERKBANK makes that provenance literal drawing-office
paperwork. The garage hero is an annotated elevation whose callouts point at
the actual components for sale; the mod sheet cross-references listings; the
order sheet restates provenance ("Fitted 05/2023, removed 06/2026, paired
with KW Clubsport") on the job card; the payout is dimension-annotated like a
tolerance. A marketplace that documents parts the way engineers document
assemblies *feels* trustworthy before a single review is read — and the
blueprint conceit gives sellers pride of authorship over their build records,
which is the flywheel that keeps garages up to date.

## Iteration-pass log

- **Pass 1 — flaws:** Live review of the built pages found the orange ACTION
  badge colliding with the "OFFERS AWAITING REPLY" KPI label, and KPI
  annotations floating at inconsistent heights because plates stretch to the
  tallest (chart) card.
- **Pass 2 — elevation:** Made KPI plates flex columns with `margin-top:auto`
  on the dimension line so every annotation sits on a common datum line
  (very drawing-like), and reserved 88px of label clearance under the badge.
- **Pass 3 — coherence:** Cross-checked all four sheets plus mobile (375px):
  top-bar nav, plates, and dims hold; the only incoherence found was source-car
  reference links wrapping mid-token in the listings table — fixed with
  `white-space: nowrap` on in-table ref-links. Tokens in `design.md`
  re-verified against `werkbank.css` one-to-one.
- **Pass 4 — night shift (dark mode, added on request):** Referenced dark
  console dashboards on Mobbin (Cloudflare analytics, Vapi metrics) for
  hairline-on-near-black panel discipline; rebuilt the palette as a token
  remap (`[data-theme="dark"]`) rather than a second stylesheet. Found and
  fixed two literals that dodged the token system (the mint fill behind
  `wb-tag--ok`, the body grid line), added `on-ink`/`ink-hover`/`ok-tint`
  semantic tokens, dimmed photography 12%, and verified all four sheets plus
  the style guide with the rail "SHIFT — DAY/NIGHT" toggle persisting across
  pages.

- **Pass 5 — public surfaces:** Added the three buyer-facing sheets — `car.html`
  (public car record: registry-plate hero, keeper card, verified-vs-stated spec
  matrix, public build log, "parts released from this car"), `explore.html`
  (survey sheet with a filterable masonry of car / build-log / part plates) and
  `market.html` (search-order plate, six line-icon category plates, a
  "FITS: UNIT A" garage-fitment switch and a live-filtered results grid) —
  and extended the tool-rail to seven numbered items across every sheet.
  Real finding fixed while building: the first cut of the explore part cards
  nested a source-car `ref-link` anchor inside the card's own anchor — invalid
  HTML that browsers silently split apart — replaced with a keyboard-operable
  `role="link"` span so the whole card and the cross-reference both stay
  clickable.

- **Pass 6 — public identity & mobile:** Added `home.html` (logged-out marketing
  face with a masthead instead of the rail, registry-specimen hero, three-op
  "how the workshop runs" plates, registry and parts strips, and an ink-band
  stat row that stays inverted in both shifts) and `profile.html` (keeper
  record for @werk7 with a dimension-annotated seller-grade stat row and
  Overview / Listings / Reviews / Activity panels), extended `car.html` with a
  hash-deep-linkable Overview / Activity / Documents tab row and a six-row
  provenance file, and replaced the ≤640px rail-as-topbar with a real mobile
  menu — fixed bar, two-line burger, slide-in sheet index built by JS from the
  rail (or masthead) with `aria-expanded`, Escape- and scrim-to-close, and the
  SHIFT toggle mirrored inside. Real finding fixed: at ≤640px the old rail
  collapsed into a horizontally scrolling strip whose items had their labels
  hidden at 1024px *and* their icons squeezed — Settings and the theme toggle
  were effectively unreachable on phones; the menu sheet now lists all seven
  numbered items, the shift switch, and the keeper block at full size.

- **Pass 7 — configuration & commerce:** Added `settings.html` (REF 04-I —
  workshop configuration as five stacked numbered plates: keeper details,
  garage units with a default-fitment radio that feeds the marketplace FITS
  toggle, an in-app/email notification checkbox matrix, payments with a
  dimension-annotated fee schedule, and appearance/conduct with a restrained
  alert-red "close the workshop" row that always cancels safely) and
  `part.html` (REF 04-J — the buyer sheet for lot L-118: photo plate with a
  swappable three-thumb strip, purchase panel, PLATE 02 provenance
  certificate answering the four trust questions with platform-verified vs
  seller-stated fitment kept visually distinct, spec and condition-report
  plates with a measured-vs-minimum disc-thickness gauge, keeper Q&A,
  same-car cross-sell, a floor-validated offer sheet, and a working
  three-step purchase sheet — summary → delivery & payment → stamped
  "ORDER FILED — JOB CARD #1048" with the orders pipeline previewed —
  full-screen at ≤640px). Un-stubbed the Settings 07 rail item into a real
  link on every sheet. Real finding fixed: the first cut of the settings
  "Shift" preference select wrote the theme itself, creating a second source
  of truth that fought the rail toggle (select said DAY while the sheet was
  dark after a rail click); it now drives the canonical `#wbTheme` button
  and re-syncs its own value whenever that button fires, so localStorage
  `wb-theme` remains the single authority.

## What a design system for this thesis looks like

**Token architecture.** A single flat namespace prefixed `--wb-` (werkbank),
grouped as `colors` (bg / surface / ink / ink-2 / hairline / accent /
accent-tint / blue / ok / fallback), `type` (two families only: `--wb-sans`
for UI, `--wb-mono` for *every* numeral, ID and annotation — this is a hard
rule, not a preference), an 8-step 4px spacing scale (`s1–s8`), one radius
token (`--wb-r: 2px`) and one easing token. No semantic aliasing layers: the
system is small enough that the raw tokens *are* the semantics.

**Naming.** Components are named after drawing-office artifacts: `plate`
(card), `dim` (dimension callout), `microlabel` (title-block text), `ledger`,
`mod sheet`, `job card`, `tool-rail`. Names carry the metaphor so new
contributors extend the fiction rather than dilute it.

**Component inventory.** Tool-rail + rail-item, page header with sheet
reference, plate (+ head/body), KPI plate, dimension callout (ink/accent),
button (ink / accent / ghost / danger-ghost), tag (neutral / accent / fill /
ok), data table, ledger row, offer row, accordion row, filter tab, pipeline,
hero callout, input/select, confirm sheet, toast.

**Governance rules.** (1) Orange is a verb — it may only mark things awaiting
a decision or actively for sale; using it decoratively is a review-blocking
defect. (2) Blue is a noun — cross-references only, never actions. (3) Any
number a user might act on must be mono, tabular, and where load-bearing,
dimension-annotated. (4) No shadows, no radius above 2px, no dark theme,
no type above 30px. (5) Every page carries a sheet reference and every plate
a plate number — unnumbered surfaces don't ship.

## The design system in Google's design.md standard

`design.md` in this folder follows Google's open **design.md** format: YAML
frontmatter holding the machine-readable tokens — `colors`, `typography`
(display / h2 / body / label / data / kpi), `rounded`, `spacing`, and a
`components` block where every value references tokens (e.g. background:
`{colors.accent}`) — followed by prose sections (Overview, Colors,
Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts).
An agent consuming it should parse the frontmatter for exact values, resolve
`{token}` references before emitting CSS, treat the prose as constraints of
equal force to the tokens, and diff any new component against the Do's and
Don'ts. The frontmatter values mirror `werkbank.css` custom properties
one-to-one, so the file can also be used to lint drift between spec and
implementation. `design.html` renders the same tokens live for human review.

## Style-emulation prompt

> Design a light-mode, drafting-office product interface: warm paper-grey
> canvas (#F0EFEB) with a faint 32px blueprint grid, content on white
> "plates" with 1px #D8D6CF hairline borders and 2px corners maximum, no
> shadows or gradients. Type is IBM Plex Sans 400/500/600 for UI (headings
> ≤22px, tight) and IBM Plex Mono for every number, ID, timestamp and label;
> microlabels are 10px mono uppercase with 0.14em tracking written like
> drawing callouts ("PLATE 03 — ACTIVE LISTINGS", "REF 04-B · SHEET 2 OF 4").
> Ink is graphite #24262A with #7B7E85 secondary; exactly one accent, safety
> orange #FF4D00, reserved for decisions, active states and annotation lines,
> plus technical blue #2B5BD7 for hyperlink-style cross-references only. The
> signature device is the dimension line — a 1px rule with perpendicular
> end-ticks and a centered mono label — drawn under key figures and animated
> scaleX 0→1 over 600ms; all other motion is instrument-like 120ms ease-out
> snaps, 1px hover lifts with border darkening, and numbers that tick up on
> load. Number every page like an engineering sheet and annotate every
> load-bearing figure.

- **Pass 8 — Sheet B, the live drawing (home-v2.html):** Rebuilt the landing
  as a WebGL piece: a procedurally-modelled brake assembly rendered as a
  living technical drawing (isometric orthographic camera, flat paper fills +
  ink edge lines, drafting-grid floor) that explodes apart on scroll — each
  separated component picks up a safety-orange leader line and a live-tracked
  listing chip (caliper → lot L-118 → part.html), so the hero literally
  performs the product: a documented part-out. Theme-reactive (materials
  re-read the CSS tokens on SHIFT), pointer parallax, teardown progress rail,
  reduced-motion and no-WebGL fallbacks. Original landing retained as Sheet A;
  the two cross-link in their mastheads.

- **Pass 9 — responsive hardening:** Audited all 12 sheets at 375px and 768px
  with an in-browser overflow probe (document scrollWidth vs viewport, walking
  the DOM for the widening element). Four real defects found and fixed, all in
  the token layer or a shared rule: (1) the marketplace's fitment-legend
  dimension label was `nowrap` at 91 characters — labels now wrap under 760px;
  (2) grid children kept `min-width:auto`, so wide mod-sheet tables widened
  the page instead of scrolling inside their plate — `.wb-stack > *`,
  `.wb-plate` and `.wb-table-wrap` now allow shrinking; (3) two inline
  `grid-template-columns` plates on the order sheet (180px item grid, 3-col
  dispatch form) never collapsed — inline column grids now stack under 640px;
  (4) the style guide's fixed 220px type-specimen column and fixed-width
  input/sidebar demos overflowed — its own mobile block now stacks them.
  All 12 pages re-verified at zero horizontal overflow on phone and tablet,
  including the open purchase sheet.
