# SUNDAY — Concept 07 Brief

**Thesis:** *Selling a part should feel like a Sunday morning drive.* DRVN's trust mission does not need a mood; it needs a product. SUNDAY bets on mainstream excellence — the kind of consumer software people describe as "it just feels nice" without being able to say why. Airy cool-light surfaces (#F4F6F9 canvas, white cards), soft layered shadows instead of borders, rounded 12px geometry, one confident electric indigo (#4F46E5), and typography that behaves like a well-made app rather than a mood board. The craft is in restraint, rhythm, and micro-interaction polish. Nothing shouts; everything answers.

## Reference lineage (honest)

- **Linear** — the discipline: one accent used sparingly and with total conviction; hairlines at whisper weight; a segmented control that feels machined; no decorative element that doesn't carry information.
- **Airbnb** — the warmth: photography in generous rounded masks, human copy ("Nice — two offers came in overnight"), trust signalled through faces, ratings, and specifics rather than badges.
- **Things 3** — the calm: white cards on a cool canvas, an interface that feels checked-with-a-coffee rather than managed-like-a-job; motion that is felt more than seen.
- **Stripe Dashboard** — the patterns: stat-card rows with tabular numerals, offer cards with primary/ghost action pairs, expanding rows for detail-on-demand, sparklines as ambient signal rather than analysis.

## Why mainstream polish serves DRVN's trust mission

Trust = familiarity + care. A buyer wiring £540 to a stranger for wheels needs two feelings at once: *this works like the serious products I already use* (familiarity — the top bar, the segment control, the confirm sheet all behave exactly as expected), and *someone sweated the details here, so they probably sweat the details everywhere* (care — the count-up easing, the countdown ticking to the second, the provenance check drawn as a real SVG). Provenance is DRVN's structural trust layer; SUNDAY's job is to make the *container* of that data feel as reliable as the data itself. An exotic aesthetic would make provenance feel like theatre. A calm, world-class-ordinary one makes it feel like fact.

## Iteration passes (performed, logged)

**Pass 1 — Flaws.** Found a real interaction bug: the expanding listing rows animate `max-height` to a pixel value captured at open time, so if the viewport reflowed (rotation, window resize) while a row was open, wrapped content was clipped. Fixed with a resize handler that re-measures every open row's `scrollHeight` (sunday.js). Also confirmed no nested interactive elements inside the row's summary `<button>` — Edit/Pause/End live in the detail region outside it.

**Pass 2 — Elevation.** The app pages landed all at once, which read as static and slightly cheap next to the dashboard's count-ups. Added a quiet staggered entrance — top-level page blocks rise 10px and fade over 500ms with 60ms stagger, ease-out, fully disabled under `prefers-reduced-motion`. It's the difference between a page that *loads* and a page that *arrives*, at zero legibility cost.

**Pass 3 — Coherence.** The home page's "product tease" panel is real markup styled as UI, and its Accept/Counter buttons inherited live hover/lift states — a false affordance that broke the system's honesty (in SUNDAY, everything that looks pressable is pressable). Fixed by disabling pointer events and hover transforms inside `.tease-body`, so the panel reads as an illustration of the product, not a broken instance of it.

## What a design system for this thesis looks like

**Tokens.** A single flat token sheet, all CSS custom properties, named by *role* never by value: `--canvas`, `--card`, `--ink`, `--secondary`, `--hairline`, `--accent`, `--accent-tint`, `--success`, `--amber`; radii `--r-card / --r-control / --r-pill / --r-media`; a three-step shadow scale `--shadow-1/2/3` (shadows are the depth system — borders never carry hierarchy); motion `--ease` (cubic-bezier(.16,1,.3,1)) with two durations `--t-fast` (180ms) and `--t-med` (240ms); an 8pt spacing scale `--s-1 … --s-12`.

**Naming.** Components are nouns (`card`, `pill`, `segment`, `sheet`, `toast`), variants are suffixes (`btn-primary`, `btn-ghost`, `pill-indigo`), states are `is-*` (`is-active`, `is-open`, `is-sold`). No BEM ceremony; the system is small enough to be legible.

**Component inventory.** Button (primary / ghost / tint × sm / default / lg), pill + status dot, card (+ hover-lift modifier), top bar + tab, stat card, offer card, listing row (collapsed/expanded/sold), segmented control, input + select + prefixed input, sheet/modal, toast, toggle, avatar, timeline, sparkline, tips card.

**Governance.** Two hard rules keep SUNDAY coherent as it grows: (1) *one indigo* — the accent may only mark interactivity or "needs you" state; if a second accent ever seems necessary, the layout is wrong; (2) *green and amber are dots, not paint* — status colors appear only in pills and dots, never as surfaces. New components must be composed from existing tokens; a new token requires demonstrating that no existing role fits. Every value in `design.md` mirrors `sunday.css` exactly — the CSS is the source of truth, the doc is its contract.

## The design system in Google's design.md standard

The companion `design.md` follows Google's open **design.md** format: machine-readable YAML frontmatter (name, version, colors, typography, rounded, spacing, and per-component token bundles that reference other tokens via `{colors.accent}`-style paths) followed by human prose sections (Overview, Colors, Typography, Layout, Elevation, Shapes, Components, Do's and Don'ts). A coding agent consumes it by parsing the frontmatter as structured truth — resolving token references before applying values, using component entries as build specs (a `button-primary` entry declares background, radius, weight, and hover deltas) — and reading the prose for judgment calls the YAML can't encode (when to use ghost vs primary, why borders never carry depth). Because the YAML values match `sunday.css` one-to-one, an agent extending the prototype can generate new screens that are indistinguishable in kind from the originals.

## Style-emulation prompt (portable)

> Design this product in the "SUNDAY" idiom: a cool light canvas (#F4F6F9) with pure-white cards, ink text (#16181D), slate secondary text (#626977), and whisper hairlines (#E3E7ED) that never carry hierarchy — depth comes exclusively from soft layered shadows (0 1px 2px rgba(16,24,40,.05) at rest, blooming to 0 4px 12px rgba(16,24,40,.08) on a 2px hover lift). Exactly one accent — electric indigo #4F46E5 with tint #EEF0FE — reserved for interactivity and "needs your attention"; green #16A34A and amber #D97706 exist only as tiny status dots and pills, never as surfaces. Type is Inter (400/500/600) for UI with -0.01/-0.02em heading tracking and tabular numerals, plus Manrope 700/800 for display moments (greetings, big numbers, marketing headlines); no monospace anywhere. Geometry: 12px cards, 10px controls, 999px pills, 20px photo masks; 8pt spacing rhythm throughout. Motion is quietly delightful: 180–240ms ease-out (cubic-bezier(.16,1,.3,1)), gentle count-ups, sliding pill tabs, spring-scaled toggle knobs, a dark rounded toast that slides up from the bottom. Copy is approachable-expert — warm, specific, lightly wry, never salesy. The overall feeling: a world-class consumer app you'd check with a coffee on a Sunday morning.
