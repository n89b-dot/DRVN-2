# MONOGRAPH — Concept 09 for DRVN

> "The car as a gallery monograph."

## Thesis

Treat each build like the subject of a fine-art photography book — reverent, spare,
image-led. The interface disappears so the machine and its provenance can be
contemplated. The emotional target is a hushed museum room, not a storefront.

DRVN's job is trust: every listing must answer four questions — *what car did this
part come off, who's the seller and are they credible, will it fit my car, what was
it paired with.* MONOGRAPH answers them not with badges and trust-signals but with
the oldest credibility device in visual culture: the museum wall label. A plate, a
caption, a provenance line. Nothing shouts. The restraint *is* the argument.

## Reference lineage (the honest version)

This concept did not come from other car sites. Its DNA is:

- **Steidl and Taschen photography monographs** — Gerhard Steidl's books teach that
  a single image, given air and a plain caption, reads as important. The full-bleed
  plate followed by a whisper of type is lifted directly from that grammar.
- **Museum wall-label typography** — the 11px uppercase, letterspaced, mid-grey
  caption ("PLATE 01 — 1992 · CARRERA 2 · GRAPHITE") is the Tate/MoMA didactic label.
  It is the most trusted small-type convention in the culture; borrowing it makes a
  used car part feel *catalogued*, not *listed*.
- **Kinfolk and Cereal editorial** — enormous margins, one idea per spread, cool
  restraint, photography carrying all the colour. The refusal to decorate.
- **The white-cube gallery theory** (O'Doherty, *Inside the White Cube*) — the
  neutral room that removes context so the object becomes pure subject. Our
  `#FCFCFB` canvas is a literal white cube; the car is the only thing with colour.
- **Grotesque wayfinding type** — Schibsted Grotesk at weight 300 gives the
  authority of institutional signage without the warmth of a serif or the coldness
  of a monospace.

Deliberately **not** borrowed: auction paperwork, stamps, certificates, blueprint
grids, terminal telemetry, cinematic haze, pop colour-blocking, glassmorphism. Those
are other concepts' territory.

## Why radical restraint serves the trust mission

Trust online is usually bought with *more* — more badges, more reviews, more
urgency. MONOGRAPH argues the opposite. A part photographed on a plinth, framed in
white, and captioned like a museum object reads as *considered* — and considered
reads as *credible*. The absence of a sales pitch is itself the pitch: this seller
has nothing to hide and nothing to hype. The four trust answers are still all
present on every car and listing page — source car, keeper, fitment, ran-with — but
rendered as calm didactic labels, never as anxious badges. Crucially, verified and
stated fitment are **typographically separated and never conflated**: verified
fitment is set in ink, the keeper's unverified note in grey italic beneath it. The
design refuses to let optimism masquerade as fact.

## Iteration-pass log

Three passes were actually performed against the live prototype. Each logs one real
finding.

### Pass 1 — Flaws (what was broken)
On first build the top bar sat as a solid white strip over the hero, which
guillotined the full-bleed 911 and killed the "walk into a silent room" opening.
**Fix:** added the `[data-over-image]` state driven by an IntersectionObserver
sentinel so the bar dissolves to fully transparent over any hero image and only
resolves into a quiet backed bar once you scroll past it. The entrance now reads as
image-first, chrome-second.

### Pass 2 — Elevation (what was merely fine, made better)
The scroll reveal worked but images and their captions arrived together, which felt
like a single UI event rather than a curatorial one. **Fix:** split the reveal into
two channels — `.reveal` (image: fade up + scale 1.04→1 over 820ms) and
`.reveal-cap` (caption: a shorter fade with a 240ms delay). Now the plate settles
first and the wall label whispers in after it, exactly as your eye moves in a
gallery: object, then label. Small change, large lift in dignity.

### Pass 3 — Coherence (consistency sweep)
Audited every colour value against the token block. Finding: the confirm panel and
the lightbox both needed a semi-opaque canvas scrim, and I was about to hardcode an
`rgba()`. Instead I promoted `--canvas-92` and `--canvas-00` into the token block so
the overlay, the top bar, and any future scrim all derive from one source. Result:
zero colour literals outside `:root` across CSS *and* the inline `design.html`
values match exactly. Nothing visual changed on screen — the pass was about making
the system honest, and that is logged here as its outcome.

## What a design system for this thesis looks like

A MONOGRAPH design system is unusually small on purpose — its discipline is
subtraction:

- **One typeface, three weights.** Schibsted Grotesk 300/400/500(/600 for the
  wordmark only). No secondary family. The restraint is the brand.
- **A five-value greyscale, no accent.** Canvas, paper, ink, grey, hairline. Colour
  is *forbidden* to the interface and *reserved* for photography. A single graphite
  focus tint is the only concession, and only on focus rings.
- **The plate as the atomic unit.** Everything is a photograph in a square-cornered
  frame with a wall label beneath it. Cards, heroes, cross-sells and lightboxes are
  all the same object at different scales.
- **Whitespace and hairlines as the only separators.** No shadows, no boxes, no
  borders-used-as-containers. Depth is negative space.
- **Motion as a single gesture.** One easing curve `cubic-bezier(.22,1,.36,1)`, one
  slow duration band (460–820ms), one reveal (fade + scale), one drift. Reverent,
  never snappy, `prefers-reduced-motion` fully honoured.
- **Numerals are tabular everywhere** so prices and specs align like a catalogue
  raisonné.

The full component set — bar, plate, wall label, spec table, definition list,
fitment block, ink button, text link, filter, confirm panel, colophon — is
documented with live states in `design.html` and as tokens in `design.md`.

## The design system in Google's design.md standard

`design.md` in this folder follows **Google's open `design.md` format**
(github.com/google-labs-code/design.md): a machine-readable **YAML frontmatter**
block (version, name, description, `colors`, `typography`, `rounded`, `spacing`, and
`components` whose states reference tokens like `{colors.ink}`) followed by
human-readable **prose** sections (Overview, Colors, Typography, Layout, Elevation &
Depth, Shapes, Components, Do's and Don'ts).

How an agent consumes it: the frontmatter is the contract. A coding agent parses the
YAML to resolve token names to concrete values, reads each component's `states` map
to know what `hover`/`focus`/`pressed` should do, and treats a reference like
`{colors.ink}` as a pointer into the `colors` map rather than a literal — so themes
can be re-pointed without touching component definitions. The prose is the rationale
the agent reads when a decision isn't fully specified by tokens (e.g. *why* there are
no shadows). Every value in `design.md` matches `monograph.css` exactly, so the
document is a faithful spec, not an aspiration.

## Portable style-emulation paragraph

To emulate MONOGRAPH elsewhere: build a white cube. Set the ground to a cool gallery
white (`#FCFCFB`), text to near-black ink (`#111112`), and forbid every other hue —
let photography supply all colour. Use one thin grotesque (Schibsted Grotesk or
Instrument Sans) at weight 300 for large light headlines with -0.02em tracking, and
set all captions as 11px uppercase letterspaced 0.18em in mid-grey — the museum
wall-label voice. Numerals tabular. Give everything enormous margins and a strict
airy grid; alternate full-bleed plates with inset ones. Square corners only, zero
shadows, zero boxes — separate elements with whitespace and the occasional
full-width hairline. Present each object as a photograph followed by a plain caption
(a "plate"), and render trust facts as calm didactic labels, keeping verified and
stated information typographically distinct. Animate with a single slow easing
`cubic-bezier(.22,1,.36,1)` at 460–820ms: images fade up and scale from 1.04 to 1,
captions whisper in a beat later, one hero drifts slowly sideways. Nothing bounces.
The interface should feel like it is holding its breath.
