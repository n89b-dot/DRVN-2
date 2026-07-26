# BILLET — Design Brief

**Concept 12 for DRVN — a marketplace for parts from modified cars.**

## Thesis

*An interface machined from billet.* Every surface, edge, control, and motion in this prototype is derived from one material: machined and anodized 6061 aluminum. Cards are billet blocks with chamfered edges that catch light on the top-left and fall into shadow bottom-right. Inputs are milled slots. Buttons are machined controls that press *in* when you actuate them. Labels are laser-etched. The single accent — deep anodized blue #35507E — comes from real anodizing chemistry, and it appears exactly where anodize appears on real parts: on the details you paid extra for.

## Generator family: MATERIAL

This concept answers the question *"what physical material governs every surface?"* — not "what artifact is the product like?" Eight prior DRVN concepts were document/record metaphors (registry, terminal log, blueprint, ledger, monograph, field guide, schematic, instrument cluster). BILLET deliberately refuses metaphor. There is no catalogue number system, no ledger rule, no specimen label. When a part number appears, it appears because sellers of machined parts genuinely stamp part numbers — the material's world, not a borrowed document's.

Every element re-derives from the material's real behaviour:

| UI element | Machining reality it derives from |
|---|---|
| Card edge treatment | A 1 mm chamfer catching overhead shop light: bright top/left, dark bottom/right — an edge bevel, never a drop shadow |
| Surface texture | 1 px vertical brushed-grain striations, barely visible, like a fine-grit belt finish |
| Section dividers | Machined grooves: a dark cut line with a light burr-break line below it |
| Buttons | Raised chamfered faces at rest; a pressed-*in* inset state on `:active` — machined controls travel inward |
| Inputs | Milled slots — recessed pockets with inner shadow at the top edge where the cutter entered |
| Toggle | A machined switch whose puck slides with dampened tolerance, no bounce |
| Labels | Laser etching: dual text-shadow, light above / dark below, exactly how engraved metal reads |
| Motion | Tooling motion — 250–350 ms `cubic-bezier(.3,0,.1,1)` slides that seat with a 1 px settle; the signature reveal is a left-to-right `clip-path` wipe, a face pass on a mill |
| Accent | One anodize colour, used the way anodize is used: interactive states, prices, and the occasional bolt detail |

## Reference lineage (honest)

- **Teenage Engineering** — the OP-1/TX-6 metalwork: how small chamfers, engraved labels, and tight radii make an object feel precise and expensive without ornament.
- **Leica / high-end camera milling** — knurled and chamfered controls whose affordance *is* their machining.
- **Billet aftermarket brands (CSF, Radium Engineering, IAG)** — the actual product photography vocabulary: raw machine finish, anodized accents, part numbers etched not printed.
- **Dieter Rams-era material honesty** — surfaces say what they are; nothing pretends to be another material; the accent colour marks the point of interaction (Braun's single spot of colour on the control that matters).

## Why material-derived design serves a MARKETPLACE

A parts marketplace lives or dies on whether the goods feel worth their price. When the interface itself has the fit-and-finish of a machined part, every listing inherits that quality by association — the £1,850 manifold sits in a frame that feels like it was made on the same machine. Buying feels like handling the part: buttons press in with tolerance, the purchase sheet slides like a tray, the confirmation seats with a click. And for sellers, the live-preview card on the sell page is the pride moment — watching your listing get machined into shape as you type. Trust context (verified fitment, seller rating, "off my GT4 build") appears the way ratings appear on any good marketplace: present, quiet, never the headline.

## Iteration passes (actually performed)

- **Pass 1 — flaws:** The first cut of the chamfer system used a conventional drop-shadow under cards, which instantly read as generic SaaS elevation and contradicted the thesis (metal blocks sit *on* a surface; they don't float). Finding: replaced with dual inset box-shadows (light top/left, dark bottom/right) plus a hairline contact shadow only — cards now read as blocks resting on the bench.
- **Pass 2 — elevation:** The anodized blue was leaking everywhere — chips, tags, prices, links, borders — flattening its value. Finding: pulled it back to the anodize rule ("colour only where you paid for anodize"): interactive/selected states, prices, and the verified-fitment tag. Category chips at rest are now bare aluminum; only the *engaged* chip is anodized, which makes selection state legible at a glance.
- **Pass 3 — coherence:** The sheets (purchase/offer) originally faded in like modals — the only element in the system that floated. Finding: rebuilt them as trays that slide in from the right edge on the tooling curve, with a machined left edge highlight; the whole system now shares one physics.

## What a design system for this thesis looks like

Not a component library first — a **material spec** first. The root of the system is four physical laws: (1) the edge law (chamfer light/dark orientation, fixed light source top-left), (2) the recession law (anything you type into or read out of is milled *below* the surface; anything you press is raised *above* it), (3) the anodize law (one accent, only on paid-for details and engaged states), (4) the motion law (tooling curves, no overshoot, everything seats). Components — blocks, slots, switches, trays, grooves, etched labels — are then just shapes that obey the laws. A new component is validated by asking "could this be milled from one billet?" rather than by matching a screenshot.

## The design system in Google's design.md standard

`design.md` (in this folder) follows Google's open design.md format: a YAML frontmatter block that machines can parse — exact colour tokens, typography stacks, radius and spacing scales, and per-component state definitions matching `billet.css` one-for-one — followed by prose sections (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts) that a human or a coding agent reads for intent. The frontmatter is the single source of truth: if a value in `billet.css` changes, the YAML changes with it. `design.html` renders the same tokens live as a self-contained style guide.

## Portable style emulation

To reproduce BILLET elsewhere: set a mill-silver ground (#C9CCD1) with a barely-visible 1 px vertical brushed grain, raise panels in brushed light (#DEE1E5) with 6 px radii and a chamfer built from inset box-shadows (light top/left rgba(255,255,255,.85), dark bottom/right rgba(27,29,33,.28)) — never drop shadows. Recess all inputs as milled slots with a top-edge inner shadow. Use Archivo for prose and IBM Plex Mono only for prices, part numbers, and tolerances; render all small labels as 10.5 px letterspaced uppercase with an etched dual text-shadow (dark above, light below). Permit exactly one accent — deep anodized blue #35507E — restricted to engaged states, prices, and verified tags. Animate only with 250–350 ms cubic-bezier(.3,0,.1,1) slides and left-to-right clip-path wipes; buttons must visually travel 1 px inward on press. Ground dark sections in shop-floor slate #2A2D33 with the same grain and edge laws inverted.
