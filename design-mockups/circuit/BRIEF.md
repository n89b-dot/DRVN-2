# CIRCUIT — Design Brief

**Concept 11 for DRVN**
Thesis: **Provenance is a wiring diagram.**

---

## The thesis

DRVN is the home for your modified car — show off the build, then sell the parts
behind it. The hard part isn't the storefront; it's *trust*. A buyer staring at
a used turbo needs four answers before money moves: **what car did this come off,
who is the seller and are they credible, will it fit my car, and what was it
paired with.** Most marketplaces bury those answers in a description field and a
star rating. CIRCUIT makes them the interface.

The move is literal. A car becomes a **node**. A part is a smaller node wired to
it. Wire the part to its keeper, to its verified and stated fitment, to the other
parts it ran alongside — and provenance stops being a paragraph you have to trust
and becomes a diagram you can *read*. Hover the turbo node and its wires light:
there's the source car, there's the 4.9 keeper, there's the cyan "verified R34"
and — held deliberately apart in amber — the "stated R33". You didn't read that
it was trustworthy. You saw the circuit.

## Why "provenance as a wiring diagram" beats a list

A list flattens relationships into rows of equal weight; it can't show that the
ECU and the turbo came off the *same* car in the *same* season, or that a fitment
claim is verified while another is only stated. A wiring diagram is *relational
by construction* — its whole grammar is "this connects to that." That maps
perfectly onto DRVN's trust problem, which is entirely about connections between
a part, a car, a person, and a fitment fact. The diagram also does something a
list never can: it lets you **isolate**. Hovering one node dims the noise and
draws exactly the wires that matter to *this* decision. Trust becomes an act of
looking, not reading.

## Reference lineage (the honest version)

- **Electronic schematics & PCB layouts** — the core grammar: nodes, traces,
  round-capped linework, a component that is defined by what it connects to.
  Cyan-on-navy is the "board under test" look, not a decorative choice.
- **Transit / metro network maps** (Beck's London Underground and its
  descendants) — the discipline of drawing *relationships* legibly by hand-placing
  nodes and simplifying the connective tissue. The network page owes this its
  calm, readable neighbourhood highlighting rather than a chaotic hairball.
- **Node-graph editors** — Blender's shader nodes, Figma's connectors, Observable
  and Origami patch editors. They taught the interaction model: a node is a live
  object, edges are first-class, and hovering reveals topology.
- **Wiring-harness / loom diagrams** from workshop manuals — the source of the
  bezier "cable" curves and the idea that a single wire can be traced end to end.
- **Data-viz network graphs** (force-directed layouts) — the *look* of a graph
  without the physics: I hand-placed nodes for composition, then borrowed the
  highlight-neighbourhood interaction that makes those tools legible.

What CIRCUIT deliberately is **not**: it is not a terminal (mono is a data spice,
not the whole voice), not a luxury cockpit (flat matte, no gauges, no glass), not
a blueprint grid (curved connective traces, dark field), and not a social feed.

## Three iteration passes actually performed

1. **Trace legibility pass.** The first hero schematic drew all four traces in
   the same cyan at full strength on load. On the navy field they merged into a
   glowing blob and you couldn't tell which wire went where. *Finding:* traces
   need a resting state (`cyan-dim`, thin) and only light on interaction — the
   diagram must be quiet before it is active. This produced the default/active/dim
   three-state trace system that the whole system now depends on.

2. **The verified-vs-stated pass.** Early on, fitment was one cyan tag. But the
   entire trust promise collapses if a *claimed* R33 fit looks identical to a
   *verified* R34 fit. *Finding:* the amber "keeper-stated" marker had to become a
   first-class, never-conflated token — separate colour, separate node, separate
   trace variant — and used *only* here. That single rule is now the ethical spine
   of the concept and the reason amber exists at all.

3. **Graph-density pass.** The network page first tried ~20 nodes for
   "richness." Hovering felt like untangling wire; the neighbourhood highlight
   couldn't recover legibility. *Finding:* fewer, well-placed nodes (3 cars, 8
   parts, 9 traces) plus filter chips that *subtract* node types beats a dense
   hairball. Trust needs clarity, and clarity has a node budget.

## What a design system for this thesis looks like

It is a **board, not a page kit**. The atoms aren't buttons and cards first —
they're *nodes*, *traces*, and *the three trace states*. Everything else hangs
off those: a card is a node with a picture, a stat is a node's readout, a modal
is a "connection confirm." The colour system is near-monochrome on purpose so the
single cyan accent can carry one unambiguous meaning (connection / verified /
active), with a strictly-rationed amber for its opposite (unverified). Type is
two families — a grotesque for voice, a mono for data — because a schematic needs
labelled coordinates but shouldn't *feel* like a printout. Depth is flat-plus-glow
so nothing competes with the linework. Motion has exactly one job: make wires
*draw* and *isolate*, smoothly, so the eye follows current. A component only earns
its place if it can be explained as part of the circuit.

## The design system in Google's design.md standard

The companion `design.md` encodes this system in Google's design.md format: YAML
frontmatter carrying `version`, `name`, `description`, the full `colors`,
`typography`, `rounded`, `spacing`, `elevation`, `motion`, and `components`
blocks (each component's states referencing tokens like `{colors.cyan}` and
`{rounded.pill}`), followed by prose sections — Overview, Colors, Typography,
Layout, Elevation & Depth, Shapes, Components, and Do's & Don'ts. Every value in
that file matches `circuit.css` exactly, so a coding agent and a human read the
same source of truth. `design.html` renders the same tokens live.

## Portable style-emulation paragraph

> Build it as a **living engineering schematic on deep navy-black `#0A0F1A`**.
> Lay content on flat, matte panels (`#111827`, 1px `#2A3444` borders, 10px
> radius) over a faint dotted grid. Use exactly one accent — **electric cyan
> `#35E0F0`** — for every trace, node dot, price, active state and glow, and keep
> a single warning amber `#F5A524` in reserve *only* for "unverified" markers,
> never conflated with cyan. Draw real **SVG bezier traces with small circle/square
> nodes** wherever two things are related; give traces three states (dim resting,
> cyan active, faded when another node is focused) and let them **draw in via
> `stroke-dashoffset`** and **isolate on hover** — light the relevant wires, dim
> the rest. Set voice in the **Spline Sans** grotesque (400/500/600) and reserve
> **Spline Sans Mono**, uppercase and letterspaced with tabular numerals, for node
> IDs, specs and labels only. Depth is **flat panels plus cyan box-shadow glow —
> never glass, never `backdrop-filter`, never a gauge or specular sheen**. Motion
> is smooth and electric on `cubic-bezier(.4,0,.2,1)`: traces draw, numbers count
> up, nodes pulse gently, glow intensifies on hover — never stepped, never bouncy.
> The result should feel like a beautiful wiring diagram you can see the current
> move through.
