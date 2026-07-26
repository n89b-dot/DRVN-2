---
version: 1.0.0
name: Monograph
description: >
  Concept 09 for DRVN. A cold gallery-white, image-led design system that treats
  each modified car as the subject of a fine-art photography monograph. One thin
  grotesque, a five-value greyscale with no chromatic accent, square corners, no
  shadows, and slow reverent motion. Trust is carried by museum wall-label
  typography, not badges.

colors:
  canvas:     "#FCFCFB"   # gallery white — primary ground
  paper:      "#F4F4F2"   # cooler paper — secondary surface
  ink:        "#111112"   # text, the only weight
  grey:       "#9A9A98"   # captions, secondary text, image fallback
  hairline:   "#E4E4E1"   # the single divider
  focus:      "#5C5F63"   # restrained cool graphite — focus rings only
  ink-70:     "rgba(17,17,18,0.70)"   # secondary prose
  ink-45:     "rgba(17,17,18,0.45)"
  ink-12:     "rgba(17,17,18,0.12)"   # ghost-button hairline
  canvas-92:  "rgba(252,252,251,0.92)" # scrim / bar backing
  canvas-00:  "rgba(252,252,251,0.00)" # transparent hero state

typography:
  font-family: "'Schibsted Grotesk', system-ui, -apple-system, sans-serif"
  weights:
    light:   300
    regular: 400
    medium:  500
    semi:    600
  numerals: tabular          # font-feature-settings "tnum" 1, "lnum" 1
  tracking-display: "-0.02em"
  tracking-label:   "0.18em"
  scale:
    display: "clamp(2.8rem, 7vw, 6.4rem)"   # weight 300
    h1:      "clamp(2.1rem, 4.4vw, 3.6rem)" # weight 300
    h2:      "clamp(1.5rem, 2.6vw, 2.1rem)" # weight 300
    lead:    "clamp(1.05rem, 1.6vw, 1.4rem)"# weight 300, colour ink-70
    body:    "1rem"                          # weight 400, line-height 1.62
    small:   "0.875rem"
    label:   "0.6875rem"                     # 11px museum wall label, uppercase

rounded:
  all: "0"                  # photographs and plates have square corners

spacing:
  gutter:   "clamp(1.25rem, 6vw, 8rem)"   # enormous page margins
  max:      "1440px"
  plate-max:"1180px"
  stack-xl: "clamp(6rem, 14vw, 13rem)"
  stack-l:  "clamp(4rem, 9vw, 8rem)"
  stack-m:  "clamp(2.5rem, 5vw, 4rem)"
  stack-s:  "1.5rem"
  stack-xs: "0.75rem"

motion:
  ease:     "cubic-bezier(.22, 1, .36, 1)"
  duration: "820ms"
  duration-quick: "460ms"
  reveal:   "opacity + scale 1.04 -> 1, translateY 18px -> 0"
  caption-delay: "240ms"       # caption fades in after its image
  drift:    "26s alternate — one hero plate only"

components:
  bar:
    description: Fixed whisper-quiet top bar; dissolves over hero imagery.
    height: "74px"
    states:
      default:    { background: "{colors.canvas-92}", link: "{colors.ink-70}" }
      over-image: { background: "{colors.canvas-00}", link: "{colors.ink-70}", opacity: 0.55 }
      link-hover: { color: "{colors.ink}" }
      focus:      { outline: "2px solid {colors.focus}", offset: "4px" }
  plate:
    description: A photograph in a square-cornered frame; the atomic unit.
    radius: "{rounded.all}"
    fallback: "{colors.grey}"     # background when image missing
    states:
      default: { filter: "saturate(0.86)" }
      hover:   { filter: "saturate(1)" }   # desaturated -> full colour
  wall-label:
    description: Museum caption beneath a plate.
    states:
      default: { size: "{typography.scale.label}", color: "{colors.grey}", transform: uppercase, tracking: "{typography.tracking-label}" }
  button:
    description: Ink button, understated, inverts on hover.
    states:
      default: { background: "{colors.ink}", color: "{colors.canvas}", border: "1px solid {colors.ink}" }
      hover:   { background: "{colors.canvas}", color: "{colors.ink}" }
      focus:   { background: "{colors.canvas}", color: "{colors.ink}", outline: "2px solid {colors.focus}" }
  button-ghost:
    states:
      default: { background: transparent, color: "{colors.ink}", border: "1px solid {colors.ink-12}" }
      hover:   { border: "1px solid {colors.ink}" }
      focus:   { border: "1px solid {colors.ink}", outline: "2px solid {colors.focus}" }
  tlink:
    description: Text link with underline that draws in from the left.
    states:
      default: { color: "{colors.ink}", underline: "scaleX(0)" }
      hover:   { underline: "scaleX(1)" }
      focus:   { underline: "scaleX(1)", outline: "2px solid {colors.focus}" }
  spec-table:
    description: Typographic specification list — hairline rows, no boxes.
    states:
      row: { border-top: "1px solid {colors.hairline}", key: "{colors.grey}", value: "{colors.ink}", numerals: tabular }
  definition-list:
    description: Certificate / provenance list.
    states:
      row: { border-top: "1px solid {colors.hairline}", key: "{colors.grey}", value: "{colors.ink}" }
  fitment:
    description: Verified vs stated fitment — never conflated.
    states:
      verified: { mark: "{colors.ink}" }
      stated:   { mark: "{colors.grey}", note: "{colors.grey} italic" }
  filter:
    description: Collection filter chip; underline marks the active state.
    states:
      default: { color: "{colors.grey}" }
      hover:   { color: "{colors.ink}" }
      pressed: { color: "{colors.ink}", underline: "scaleX(1)" }
      focus:   { outline: "2px solid {colors.focus}" }
  confirm-panel:
    description: Calm in-page Acquire overlay.
    states:
      overlay: { background: "{colors.canvas-92}", blur: "10px" }
      card:    { background: "{colors.canvas}", border-block: "1px solid {colors.ink}", radius: "{rounded.all}" }
---

# Monograph — Design System

## Overview

Monograph is the design language for a marketplace that wants to feel like a museum.
Its premise: a modified car, and every part released from it, deserves to be
*catalogued* rather than *listed*. The interface is a white cube — it removes itself
so the machine and its provenance become the only things in the room. There is no
brand colour; photography supplies all colour. There are no boxes or shadows;
whitespace and hairlines do all the separating. There is one typeface. The result
reads as considered, and considered reads as credible — which is exactly the trust
signal DRVN needs.

## Colors

A five-value greyscale plus derived alphas. **No chromatic accent exists** — this is
the defining rule, not a stylistic preference. `canvas` (#FCFCFB) is the gallery
ground; `paper` (#F4F4F2) backs the rare secondary surface; `ink` (#111112) is text
and the only visual "weight" in the system; `grey` (#9A9A98) carries every caption
and also serves as the fallback ground behind any missing image; `hairline`
(#E4E4E1) is the single divider. The alphas (`ink-70/45/12`, `canvas-92/00`) are
derived from those two hues only, so the palette never drifts. The lone tint,
`focus` (#5C5F63), a cool graphite, is permitted **only** on focus rings.

## Typography

One family: **Schibsted Grotesk**, weights 300/400/500 (600 reserved for the DRVN
wordmark). Display and headings are set **large but light** — weight 300 with -0.02em
tracking — so they read as institutional signage, not marketing. Body is 400 at a
generous 1.62 line-height. The signature element is the **wall label**: 11px
(0.6875rem), uppercase, letterspaced 0.18em, mid-grey — the museum didactic caption,
reused for eyebrows, plate numbers, spec keys and metadata. Numerals are **tabular**
everywhere so prices and specifications align like a catalogue.

## Layout

A gallery hang. Page margins are enormous (`gutter` scales to 8rem). Content lives
on a strict but airy grid inside a 1440px max; plates cap at 1180px. Full-bleed
plates alternate with inset ones. Vertical rhythm comes from a fixed stack scale
(`stack-xs`→`stack-xl`). The collection index hangs cars at slightly different
heights (even items nudged down) for a curated, non-mechanical wall. Everything
collapses to a single column by 900px and remains composed to 390px.

## Elevation & Depth

There is none in the conventional sense — and that is deliberate. **No shadows, no
elevation layers, no borders used as containers.** Depth is created by negative space
and the occasional full-width hairline rule. The only surfaces that ever sit "above"
the page are the top bar (a translucent `canvas-92` wash) and the modal overlays
(a blurred `canvas-92` scrim with a card bounded top-and-bottom by a single ink
hairline). Nothing floats on a shadow.

## Shapes

Square corners only — `rounded: 0` globally. Photographs, plates, buttons, panels
and the confirm card all have hard 90° corners, echoing a matte print and its frame.
Roundness would read as "app"; squareness reads as "print."

## Components

Every interactive component defines `hover` **and** `focus-visible` states; hovers
are subtle (image desaturate→full-colour, underline draw-in, ink-button invert) and
focus is always the 2px graphite ring at 4px offset. The atomic unit is the **plate**
(photo + wall label); heroes, cards, cross-sells and the lightbox are the same object
at different scales. Trust components — the **spec table**, **definition list**, and
**fitment** block — are pure typography on hairlines, with verified and stated
information kept visually distinct. The **confirm panel** delivers the Acquire flow
as a calm two-step (confirm → hold placed) rather than a checkout.

## Do's and Don'ts

**Do**
- Let photography carry all colour; keep the UI greyscale.
- Caption everything like a museum object; keep verified and stated facts separate.
- Use whitespace and one hairline to separate; keep numerals tabular.
- Animate slowly with the single easing curve; honour `prefers-reduced-motion`.

**Don't**
- Introduce a brand hue, gradient, shadow, or rounded corner.
- Box content in cards or use borders as containers.
- Add badges, urgency, or sales-pitch chrome — restraint is the pitch.
- Let an unverified fitment note sit as if it were confirmed fact.
