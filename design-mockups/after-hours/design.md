---
version: alpha
name: After Hours
description: A cinematic night design system for DRVN — a night base, sodium orange used as light, cinematic display type, and glow-and-haze instead of shadow.
colors:
  surface: "#0A0D13"
  surface-2: "#0B0E14"
  shadow-teal: "#0E1720"
  on-surface: "#F5EFE6"
  on-surface-dim: "#8A93A6"
  accent: "#FF7A1F"
  on-accent: "#0A0D13"
  hairline: "#161C26"
typography:
  display-giant:
    fontFamily: "Clash Display, Arial Narrow, sans-serif"
    fontSize: "clamp(52px, 11vw, 168px)"
    fontWeight: 600
    lineHeight: 0.92
    letterSpacing: "-0.015em"
  display:
    fontFamily: "Clash Display, Arial Narrow, sans-serif"
    fontSize: "clamp(38px, 7.5vw, 110px)"
    fontWeight: 600
    lineHeight: 0.94
    letterSpacing: "-0.01em"
  h2:
    fontFamily: "Clash Display, Arial Narrow, sans-serif"
    fontSize: "clamp(24px, 3.4vw, 44px)"
    fontWeight: 500
    lineHeight: 1.05
  kicker:
    fontFamily: "Satoshi, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.34em"
  body:
    fontFamily: "Satoshi, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Satoshi, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.16em"
  slate:
    fontFamily: "Satoshi, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.3em"
  price:
    fontFamily: "Clash Display, Arial Narrow, sans-serif"
    fontSize: "clamp(28px, 4vw, 44px)"
    fontWeight: 600
    lineHeight: 1
rounded:
  sm: "2px"
  card: "4px"
  pill: "90px"
  circle: "50%"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "28px"
  xl: "44px"
  xxl: "clamp(80px, 12vh, 160px)"
components:
  button-sodium:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "18px 36px"
  button-sodium-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "18px 36px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "18px 36px"
  chip-spec:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  chip-dim:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.on-surface-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "9px 16px"
  scene-card:
    backgroundColor: "{colors.shadow-teal}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "28px"
  slate:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-dim}"
    typography: "{typography.slate}"
    rounded: "{rounded.sm}"
    padding: "0px"
  kicker:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.kicker}"
    rounded: "{rounded.sm}"
    padding: "0px"
  nav-link:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "6px 2px"
  price:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.price}"
    rounded: "{rounded.sm}"
    padding: "0px"
---

# After Hours — Design System

## Overview
After Hours treats the marketplace as cinema — the feeling of a 1am parking-garage meet, sodium light and haze, rendered as scroll-driven film. Every page is a scene and every part is a prop with a past. The emotional target is *romance and nerve*: lean-back, atmospheric, a little in love with the machines. It is night-only and image-led, and it must never flatten into a bright utilitarian storefront. Trust is carried emotionally — provenance is staged as a part's screen credits — then backed by the same honest fitment discipline as the rest of DRVN.

## Colors
The base is deep night — `surface #0A0D13`, `surface-2 #0B0E14` for raised scenes, and `shadow-teal #0E1720` as the cool floor of every shadow. Text is warm white (`on-surface #F5EFE6`) with a cool grey (`on-surface-dim #8A93A6`) for secondary lines and slates. There is exactly one hot accent — sodium orange (`accent #FF7A1F`) — and the discipline that defines the whole system is that sodium is treated as *light, not paint*: it appears as glow, edge, and text, plus a single filled CTA, but never as a large flat fill. The warm-white-on-night pairing clears WCAG AA; sodium is used for emphasis and light, never as body text.

## Typography
Two families with cinematic roles. Clash Display carries all display — the `display-giant` full-viewport words, the `display`/`h2` headings, and even `price` — often with mixed weights and outline strokes inside a single headline so a line can move from solid to hollow to glowing. Satoshi carries everything a person reads calmly: `body`, `label`, `kicker`, and the `slate` metadata. The `kicker` (`0.34em` letterspaced) and `slate` (`0.3em`) tokens set the film-slate voice — scene numbers, timestamps, location stamps — with occasional katakana as texture. The rule: cinematic statements are Clash; calm reading and film metadata are Satoshi.

## Layout
Pages are stacked full-bleed scenes cut like film, each at least a viewport tall, with content floating over imagery on a heavy vertical rhythm (`xs 8` → `xxl clamp(80px, 12vh, 160px)`). Every scene carries film-slate metadata in its four corners. Type layers overlap the imagery at different z-depths and parallax speeds; a horizontal scroll-snap rail handles the meet feed. The fixed nav appears only after the first scroll, and hero slates drop below it when it is visible. Below ~390px scenes stack and display type steps down, but the letterbox-and-slate framing is preserved.

## Elevation & Depth
Depth is glow and haze, not shadow. A large blurred sodium aura sits behind key elements as their "elevation," a continuously drifting haze layer adds atmosphere, and hot words carry a `text-shadow` bloom. Scenes deepen with a teal-to-night gradient floor rather than a drop shadow. Where copy sits over bright imagery, a feathered radial scrim reads as pooled darkness — an atmospheric effect, never a visible UI panel. The overall sense is depth of field and light, the way a night photograph has depth.

## Shapes
The shape language is soft but restrained. `rounded.sm (2px)` and `rounded.card (4px)` govern buttons and scene cards; `rounded.pill (90px)` is reserved for spec chips; `rounded.circle (50%)` for avatars and status dots. Softness signals warmth and approachability against the hard night, but radii stay small on rectangular surfaces so the look never turns bubbly — the drama comes from light and type, not from rounded corners.

## Components
`button-sodium` is the one place sodium fills a solid area — a small `rounded.sm` CTA that blooms with an orange glow on hover; `button-outline` is the sodium-edged secondary. `chip-spec` (pill) carries build specs and glows on hover; `chip-dim` is its muted variant. `scene-card` is a teal-floored `rounded.card` block for content over night. The structural film-language components — `slate` (corner metadata), `kicker` (the sodium eyebrow with a glowing rule), and `nav-link` (with an underline sweep) — appear on every scene. `price` is Clash Display in warm white. States like the button bloom are their own tokens (`-hover`), and all motion is long and cinematic (600–900ms, `cubic-bezier(.16,1,.3,1)`).

## Do's and Don'ts
**Do**
- Treat sodium as light — glow, edge, text, and a single filled CTA per view.
- Set cinematic statements in Clash Display; set calm reading and film-slates in Satoshi.
- Give every scene a film-slate (scene number, timestamp, location) in its corners.
- Build depth from glow, haze, and a teal shadow floor.

**Don't**
- Don't use sodium as a large flat fill beyond one CTA.
- Don't lighten the night base past `shadow-teal #0E1720` for content surfaces.
- Don't round rectangular surfaces past `4px` (pills and circles excepted).
- Don't make motion quick or linear; scenes ease long at `cubic-bezier(.16,1,.3,1)`.
