---
version: alpha
name: The Registry
description: An archival auction-catalogue design system for DRVN — ivory paper, a single oxblood accent, and provenance rendered as paperwork.
colors:
  surface: "#F4F0E6"
  surface-panel: "#ECE7D9"
  on-surface: "#171412"
  on-surface-muted: "#6E675B"
  hairline: "#C9C1AE"
  accent: "#7A2E24"
  accent-deep: "#5E211A"
  on-accent: "#F4F0E6"
  image-fallback: "#E7E2D6"
typography:
  display:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2.9rem, 8.4vw, 7.6rem)"
    fontWeight: 340
    lineHeight: 0.98
    letterSpacing: "-0.025em"
    fontFeature: "'opsz' auto"
  h1:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(2rem, 4.4vw, 3.4rem)"
    fontWeight: 400
    lineHeight: 1.04
    letterSpacing: "-0.015em"
  h2:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(1.5rem, 2.4vw, 2rem)"
    fontWeight: 400
    lineHeight: 1.1
  body:
    fontFamily: "Archivo, Inter, sans-serif"
    fontSize: "15.5px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Archivo, Inter, sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.18em"
  price:
    fontFamily: "Fraunces, Georgia, serif"
    fontSize: "clamp(1.6rem, 3vw, 2.4rem)"
    fontWeight: 400
    lineHeight: 1
rounded:
  none: "0px"
  stamp: "3px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "20px"
  lg: "32px"
  xl: "56px"
  xxl: "clamp(64px, 9vw, 128px)"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "15px 32px"
  button-primary-hover:
    backgroundColor: "{colors.accent-deep}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "15px 32px"
  button-ink:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "15px 32px"
  button-ink-hover:
    backgroundColor: "{colors.on-surface}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "15px 32px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    rounded: "{rounded.none}"
    padding: "0px"
  chip:
    backgroundColor: "{colors.surface-panel}"
    textColor: "{colors.on-surface-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "12px 14px"
  stamp:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.label}"
    rounded: "{rounded.stamp}"
    padding: "8px 14px"
  ledger-entry:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.on-surface}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "24px 0px"
  price:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.price}"
    rounded: "{rounded.none}"
    padding: "0px"
---

# The Registry — Design System

## Overview
The Registry treats a modified-car marketplace as an archival institution: every car is a registry entry, every part a documented artifact with a certificate of provenance. The emotional target is *quiet authority* — the calm of a Sotheby's catalogue, not the noise of a classifieds board. It is light-mode only, printed on warm ivory paper, and it must never read as a generic e-commerce store or a photo-first social feed. Trust is the product, and trust here is rendered as paperwork: serial numbers, dated ledgers, condition grades, and rubber stamps.

## Colors
The palette is a single sheet of warm paper (`surface #F4F0E6`) with a slightly deeper panel (`surface-panel #ECE7D9`) for insets, near-black ink for text (`on-surface #171412`), and a muted ink (`on-surface-muted #6E675B`) for metadata. Structure is drawn with one hairline rule (`hairline #C9C1AE`) rather than boxes or fills. There is exactly one accent — oxblood (`accent #7A2E24`, deepening to `accent-deep #5E211A` on press) — reserved for links, prices, and stamps, so that the car photography (always shot on the same ivory seamless) supplies all other color. `image-fallback #E7E2D6` fills any missing plate so a broken image still reads as paper, never as a hole. Ink-on-paper contrast clears WCAG AA comfortably; oxblood is used on paper for emphasis text and as fills behind ivory type.

## Typography
Two families with strict, non-overlapping roles. Fraunces — a high-contrast optical serif — carries all display and editorial voice, set enormous (up to `7.6rem`) at a light `340` weight with tight `-0.025em` tracking and italic reserved for emotional words. Archivo (falling back to Inter) is the grotesque that carries every piece of UI metadata: the `label` token is an `11px`, `500`-weight, `0.18em` letterspaced uppercase style used for lot numbers, accession dates, and folio lines. Prices are set in Fraunces (`price` token) so money reads as a headline, not a form field. The pairing prevents "font soup": if it is a sentence a human reads for pleasure it is serif; if it is a coordinate the system records it is grotesque smallcaps.

## Layout
Everything sits on a strict editorial paper grid inside a `1360px` maximum with a fluid `gutter` (`clamp(20px, 4vw, 56px)`). The spacing scale is a printer's rhythm — `xs 8` / `sm 12` / `md 20` / `lg 32` / `xl 56` — with section padding opening up to `xxl (clamp(64px, 9vw, 128px))` so pages breathe like catalogue spreads. Columns are asymmetric and annotated: numbered section folios (01, 02…), running heads, page-corner metadata, and footnote-style side notes. Visible hairline column rules appear where the catalogue logic calls for them, and collapse cleanly to a single column by 720px.

## Elevation & Depth
There are no drop shadows. Depth is entirely paper craft: hairline rules, a subtle fractal-noise grain over the whole surface, and the tactile `stamp` — a 2px oxblood-bordered mark, rotated ~4°, with a turbulence mask that roughens its edges like real ink on a page. Layering is achieved by the `surface-panel` inset tone and by rules that draw themselves in (`scaleX`) on scroll. The result feels physical and printed rather than glassy or floating.

## Shapes
The shape language is near-sharp, because paper documents have corners. `rounded.none (0px)` governs cards, buttons, inputs, and chips — anything that behaves like a printed field stays square. The only exception is `rounded.stamp (3px)`, a barely-there softening that, combined with the rough mask, sells the stamp as a physical rubber impression. A card rounded past ~4px would read as an app card and break the archival illusion.

## Components
Buttons are rectangular paper buttons with a 1px border and `label` typography: `button-primary` is solid oxblood on ivory and deepens to `accent-deep` on hover; `button-ink` is ink-bordered and inverts to solid ink on hover. `chip` is a squared `surface-panel` tag for grades and categories. `input` is a square field with a hairline border and body type. The signature components are documentary: `stamp` (the rotated "Verified Provenance" mark), `ledger-entry` (a dated provenance row that cross-references the lots it released), and `price` (Fraunces oxblood). Text links are oxblood with an underline whose offset grows on hover. Every state is defined as its own token (`-hover`) so the system never guesses.

## Do's and Don'ts
**Do**
- Keep exactly one accent hue — oxblood — for links, prices, and stamps; let photography carry all other color.
- Set every human-readable headline in Fraunces and every machine coordinate (lot no., date, folio) in Archivo smallcaps `label`.
- Draw structure with the `hairline` rule and paper grain, not with boxes or shadows.
- Give each listing a real certificate: source car, seller of record, fitment, and companion history.

**Don't**
- Don't round a card, button, or input past `0px` (the `3px` stamp is the sole exception).
- Don't add a drop shadow — depth comes from rules, grain, and the stamp only.
- Don't state seller fitment as fact; stamp it "seller-stated — not verified."
- Don't let motion get quick or bouncy; reveals stay 400–700ms and dignified.
