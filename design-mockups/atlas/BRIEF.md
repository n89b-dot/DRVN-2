# ATLAS — Concept 10

**"Every build is a documented specimen."**

DRVN Atlas treats the platform like a naturalist's field guide. Cars and the
parts that come off them are catalogued the way an expedition survey catalogues
the wild: each specimen numbered, plotted to coordinates, dated, and logged with
its provenance and the terrain it was tested on. The trust doesn't come from a
badge or a five-star average — it comes from the felt sense of a *rigorously
kept record*. Warm kraft paper, olive field-notes, clay marks for the numbers
that matter, and topographic contour lines under everything.

---

## Thesis

A modified-car marketplace lives or dies on four questions a buyer asks before
they part with money:

1. **What car did this part come off?**
2. **Who's the seller, and are they credible?**
3. **Will it fit my car?**
4. **What was it paired with?**

Most marketplaces answer these with a photo and a paragraph. ATLAS answers them
with a **record**. Every listing is a *catalogued specimen* whose provenance
block traces — by an animated dotted route line — back to its source vehicle's
*field entry*. The car profile is not a vanity page; it is the trust-and-context
layer, the baseline every part is measured against. Fitment is stated as a
*basis*: `PLATFORM-VERIFIED` versus `KEEPER-STATED`, never a vague "fits most."
The keeper carries a legible history — rating, parts released, years on record.
The result reads less like Craigslist and more like a herbarium sheet: this
specimen, from this place, kept by this person, tested on this ground.

---

## Reference lineage (honest)

This concept is built from a specific, real visual heritage — not a mood board
of adjacent car sites:

- **Audubon's *Birds of America* and 19th-century natural-history plates** —
  the specimen-as-document idea: a single subject, catalogued, captioned,
  numbered, given a Latin gravity. The "SPECIMEN 01" numbering and the
  field-entry layout descend directly from plate conventions.
- **USGS / Ordnance Survey topographic maps** — the contour line as the
  concept's core mark. Elevation contours are warm, organic, hand-surveyed
  linework, the opposite of a cold blueprint grid. They carry the "terrain"
  half of the trust story and set the palette register (kraft, olive, faded
  tan).
- **Filson and Snow Peak field catalogues** — matte, warm, utilitarian
  product photography and a typography that is confident but never luxurious.
  The "warm-but-authoritative, well-worn journal" emotional target comes from
  here.
- **National Geographic cartography (the mid-century map supplements)** — how
  to plot points of interest on stylized terrain with mono coordinate labels
  and a legend, without a live map API.
- **Overland Journal / Expedition Portal editorial** — the actual voice of the
  persona: builds documented as expeditions, parts discussed by how they held
  up on real ground, dates and distances logged.

What ATLAS deliberately is **not**: it is not warm-ivory auction paperwork with
a serif and oxblood stamps (that is Concept 01, The Registry); not a blueprint
grid with safety-orange dimension lines (Concept 04, Werkbank); not dark luxury
with brass and certificate borders (Concept 06, Atelier). ATLAS is light, matte
kraft; a humanist sans with a coordinate mono; contours and route lines, not
rules and stamps; olive and clay, not oxblood or orange.

---

## Why the field-record framing serves the trust mission

Trust is a *feeling produced by evidence*, and the field-guide format is a
machine for presenting evidence as if it has always been kept:

- **Provenance becomes literal.** The dotted route line animating from a part
  back to its source vehicle is the trust thesis made visible — you can *see*
  that this rack came off *that* Land Cruiser. Nothing about the interface lets
  a part float free of its origin.
- **Fitment gets an epistemology.** By printing the *basis* of every spec
  (`PLATFORM-VERIFIED` vs `KEEPER-STATED`) the design refuses false certainty.
  A field guide that overclaims loses authority; one that marks its confidence
  keeps it. Buyers trust a record that admits what it doesn't know.
- **The keeper is a documented figure, not an avatar.** Rating, parts released,
  coordinates, years on record — presented as survey metadata, they read as
  history rather than marketing.
- **Terrain answers "what was it paired with / how was it used."** "Ran with
  ARB bar + 120W solar; ~14,000 km logged under load" is exactly the context a
  buyer needs, delivered in the register of an expedition log.

The warmth matters as much as the rigor: a *cold* record feels bureaucratic and
invites suspicion; a *warm, well-worn* record feels honest, like a journal kept
by someone who was actually there.

---

## Iteration passes actually performed

**Pass 1 — "Contours, not a grid."**
The first background attempt was a faint repeating line grid (fast, cheap). On
screen it read as graph paper and immediately collided with Concept 04's
blueprint identity — cold, technical, wrong emotional register. *Finding:* the
contour has to be *organic and closed* to feel surveyed rather than drafted, so
the background is now generated in JS (`buildContours`) as nested, sine-perturbed
elevation rings around two "peaks." Irregular closed loops read as terrain; even
spacing reads as engineering. The single change moved the whole page from
"drawing office" to "field survey."

**Pass 2 — "Make provenance a line you can watch."**
Provenance started as a plain definition list (source vehicle, keeper, fitment).
Correct, but inert — it didn't *perform* the trust claim. *Finding:* animating a
dotted route line from each released part to its source-vehicle banner (the
`route-canvas` on `car.html`, computed from live element geometry and redrawn on
resize) turned a static fact into a visible relationship. Watching the line
trace is the moment the concept's thesis lands. This forced a real engineering
decision: the connector paths can't be authored by hand — they're built from
`getBoundingClientRect()` so they stay correct across breakpoints.

**Pass 3 — "Two accents, ruthlessly separated."**
An early draft used clay/terracotta for both prices *and* active navigation,
and olive for links. It looked busy and the price stopped feeling special.
*Finding:* assigning the accents by *job* fixed it — **olive** owns everything
structural and navigational (active nav, links, primary CTA, verified-fitment,
map pins at rest), **clay** is reserved almost entirely for *money and the one
mark that matters* (prices, the highlighted map pin). Because clay now appears
rarely, a £680 price reads as the loudest thing on the specimen page — which is
exactly right for a marketplace.

---

## What a design system for this thesis looks like

A field-guide trust system is defined by a small number of load-bearing rules,
not a big component library:

- **A canvas that reads as paper, never as UI chrome.** Warm kraft `#E9DFCB`
  with a lighter oat `#F3ECDD` surface; no pure white anywhere, no cool grey,
  no shadow heavier than a soft warm lift. Depth comes from layered warm tones
  and a 1px contour-colored border, the way a stack of field cards would.
- **A two-voice type system.** A humanist sans (Hanken Grotesk) for reading —
  warm, confident, never thin — paired with a coordinate mono (Spline Sans
  Mono) used *only* for coordinates, catalog numbers, dates, measurements and
  microlabels. The mono is the "instrument readout" of the guide; keeping it
  off body copy is what makes it feel like data.
- **Numbered specimens and logged basis.** Every catalogued thing carries an ID
  (`SPECIMEN 01`, `CAT. NO. 08-A`) and, where it's a claim about fitment, an
  explicit *basis* tag. The system would rather show its confidence level than
  fake certainty.
- **The route line as a first-class component.** The dotted connector that ties
  a part to its vehicle is not decoration — it is the system's trust primitive
  and appears wherever a relationship needs proving.
- **Contours as the ambient signature.** A faint topographic field sits under
  every page; the map view promotes it to the foreground as a plotted survey.
- **Motion that is calm and grounded.** 400–550ms ease-out. Lines draw in,
  cards rise 6px and fade, numbers settle. Nothing bounces, nothing flashes —
  the register is a steady hand keeping a record.

Full token values, component states and Do's/Don'ts live in `design.md`, with a
live rendering in `design.html`.

---

## The design system in Google's design.md standard

`design.md` follows Google's open **design.md** format: a single file with
machine-readable **YAML frontmatter** (versioned tokens — `colors`,
`typography`, `rounded`, `spacing`, and `components` whose properties reference
other tokens with `{token}` syntax) followed by human-readable **prose** that
explains the rationale and the constraints (Overview, Colors, Typography,
Layout, Elevation, Shapes, Components, Do's and Don'ts).

The point of the format is **dual consumption**. A coding agent building for
ATLAS reads the frontmatter, resolves `{colors.olive}`-style references to
concrete values, and can construct any component from its token recipe without
guessing. A human reads the prose to understand *why* olive is structural and
clay is reserved for money, or why the corner radius never exceeds 6px. The two
halves are kept in exact sync with `atlas.css`'s custom properties (`--olive`,
`--clay`, `--r-card`, …) so there is one source of truth: change a token, change
it in three mirrored places (CSS, frontmatter, prose) and nowhere else. An agent
should treat the prose sections as hard constraints and check every new
component against the Do's and Don'ts before shipping it.

---

## Portable style-emulation paragraph

To emulate ATLAS elsewhere: build on **warm kraft/sand paper** (`#E9DFCB`
canvas, `#F3ECDD` surface) with **deep ink-brown** text (`#2C271E`) — never pure
white, never cool grey. Use **muted olive** (`#5E6B47`) as the single structural
accent for links, active states, primary buttons and verified marks, and
**clay/terracotta** (`#B5502F`) sparingly, almost exclusively for prices and the
one highlighted point. Draw all hairlines, borders and map lines in a **faded
contour tan** (`#C7B48F`), and float a very faint **topographic contour pattern**
(organic, closed, hand-surveyed — never a grid) behind everything. Set reading
copy in a **humanist sans** (Hanken Grotesk, 400–600, warm and confident) and
reserve a **coordinate mono** (Spline Sans Mono) for coordinates, catalog
numbers, dates and measurements only, uppercase and letterspaced for
microlabels. Corners are a soft **6px**; depth is layered warm tone plus a 1px
contour border and at most a whisper of warm shadow. Number your content like
specimens, caption it with coordinates, mark the *basis* of any claim, and tie
related things together with a **dotted route line**. Motion is **calm and
grounded** — 400–550ms ease-out, lines that draw in, cards that rise 6px, numbers
that settle. The whole thing should feel like a well-worn expedition journal:
warm, authoritative, and rigorously kept.
