# Concept 02 — APEX/OS

**Thesis:** *"Data density is respect."* The marketplace as a motorsport instrument — a race engineer's console where every screen is telemetry and nothing decorative survives that isn't information.

## Pages
`index.html` (command deck) → `market.html` (live listings + working garage-fitment filter) → `listing.html` (G30-770 spec-sheet) → `car.html` (UNIT 07 vehicle telemetry). Fully cross-linked; the FITS: EVO IX toggle actually filters the market grid and updates the results counter.

## Reference lineage
Motorsport pit-wall software and MoTeC/AiM dash layouts; Bloomberg Terminal density-as-status; Teenage Engineering's disciplined industrial ornament; NASA mission-control status bars; brutalist type systems (Space Grotesk + JetBrains Mono); Nothing OS's dot-matrix restraint. Corner tick marks and crosshair image frames from optical calibration targets.

## Why it serves DRVN's trust-and-context mission
Trust is expressed as *measurement*: the listing is a spec-sheet with measured shaft play, logged hours, and a four-step provenance pipeline (SOURCE UNIT → REMOVAL LOG → BENCH INSPECTION → LISTED). The platform/seller fitment split is structural — `FIT:VERIFIED` renders in acid as system truth, `FIT:CLAIMED` in dim as seller statement, with an explicit "never confuse the two" rule on the page. The car is a telemetry unit whose mod log timestamps every removal, so a part's history is literally queryable.

## Visual language
Near-black `#0A0B0D`, panel `#111316`, hairlines `#23262B`, text `#E8EAED`, one acid accent `#D8FF3E` (plus a single red reserved for SOLD). JetBrains Mono for all data; Space Grotesk for display numerals and headings. No border radius, no shadows; every panel a bordered cell with corner ticks; engineering-paper grid in the background. Motion is mechanical: stepped easings ≤120ms, count-up numerals, scanline sweeps, a live event ticker, blinking status dots.

## Iteration pass log
- **Pass 1 — flaws:** Rows without photography showed a bare dim dot in the IMG cell — read as broken, not designed. (Also caught at review: a first-load screenshot with CSS unstyled traced to the server's cleanUrls redirect, not the page — fixed at the server config.)
- **Pass 2 — elevation:** Replaced empty image cells with instrument-native "NO FEED" scan tiles — crosshair axes, part-code chip (AER/1600, ECU/M130…), acid highlight on row hover — turning missing photography into a second-read system detail.
- **Pass 3 — coherence:** Audited all four pages against the thesis: status bars, SYS/xx section codes, tabular numerals, and the acid/dim information hierarchy hold everywhere; the one permitted red appears only on SOLD. No off-voice elements found; no change.

## Style-emulation prompt (portable)
> Design this product as a professional instrument — a console built for operators, where data density is a form of respect. Dark only: near-black base (#0A0B0D), slightly lifted panels (#111316), 1px hairline borders (#23262B), off-white text (#E8EAED), muted labels (#6B7178), and exactly one accent — acid yellow-green (#D8FF3E) — for status, prices, live indicators, and primary actions, plus a single alarm red reserved for one terminal state per screen. All data, labels, and numbers are set in a monospace (JetBrains Mono) with tabular numerals and 10px letterspaced uppercase microlabels; display headings use a tight grotesque (Space Grotesk 500–700) at large scale, often as giant numerals. Zero border radius, zero drop shadows, zero gradients-as-decoration: every module is a bordered cell in a hard visible grid, with CSS corner tick marks, section codes ("SYS/01 — GARAGE"), timestamps, and a subtle engineering-paper grid in the page background. Photography is monochrome, high contrast, framed like a camera feed with crosshairs and feed labels. Motion is instant and mechanical: stepped easings under 120ms, numbers that count up on load, scanline sweeps on hover, blinking status dots, a scrolling event ticker; never a soft 300ms fade. Header and footer are command/status bars (uptime, build number, region). The voice is terminal shorthand: uppercase, abbreviated, exact.

## The thesis as a design system

"Data density is respect" scales into a token system whose whole job is to keep information legible at high density. The governing discipline is **one accent plus one alarm**: acid (`accent #D8FF3E`) is the only signal hue — live status, prices, primary actions, platform-verified truth — and red (`alarm #FF3B30`) is held for exactly one terminal state per screen (a SOLD tag) and nothing else. Everything structural is near-black — `surface #0A0B0D`, `surface-panel #111316`, `surface-panel-2 #0E1013` — separated by a single `hairline #23262B`, so the acid reads as instrumentation against a dark deck.

Type is a **strict functional split**. JetBrains Mono carries every measured value (`data`, `data-strong`, `label`) with tabular numerals so columns align like a readout; the `label` token — `10px`, `0.18em` letterspaced uppercase — renders every microlabel and SYS/xx section code. Space Grotesk carries display: the `display-xl` giant KPI numerals and the `display`/`h2` headings, set tight at weight `700`. The rule is absolute — measured value → mono; headline or KPI → Grotesk — and it makes any new screen legible on sight.

Shape and elevation are laws, not preferences. `rounded.none (0px)` is enforced globally (`border-radius:0 !important`), so every cell, chip, button, and crosshair-framed image stays square. Depth comes only from border-and-contrast — a cell is "raised" because it is outlined and filled one step lighter — never from shadow or glow. The reusable structural patterns are the bordered cell with corner ticks, the command/status bar, the live ticker, and the fitment chip system that encodes the platform's integrity rule directly into the UI: `chip-verified` (acid, platform truth) versus `chip-claimed` (dim, seller statement), which the system must never blur. Motion is a governed rule too — stepped easings (`steps`, ≤120ms), count-up numerals, scanline hovers, blinking dots — so the interface always feels mechanical rather than eased. Every value is a token, so the whole instrument re-skins from the `.md` without touching markup.

## design.md — Google's open standard

[Google's open `design.md` format](https://github.com/google-labs-code/design.md) captures a design system as a single machine-readable file: a YAML token block (colors, typography, rounded, spacing, components) that a coding agent implements from exactly, followed by human prose (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's & Don'ts) explaining the *why*. It is the source of truth, mirrored by a live `design.html` style guide so agent and human read the same system. This maps directly onto DRVN's "everything is a token / swappable design system" principle — these tokens could drop into the real product without rewriting a page.

This concept ships a complete one. An excerpt of the actual token block:

```yaml
colors:
  surface: "#0A0B0D"
  surface-panel: "#111316"
  hairline: "#23262B"
  on-surface: "#E8EAED"
  accent: "#D8FF3E"
  on-accent: "#0A0B0D"
  alarm: "#FF3B30"

components:
  chip-verified:            # platform truth — never interchangeable with chip-claimed
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "3px 8px"
```

Full system: **[design.md](design.md)** (source of truth) · **[design.html](design.html)** (live style guide, rendered in APEX/OS's own language).
