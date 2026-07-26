# Concept Ledger

<!-- ══════════════════════════════════════════════════════════════════
WHAT THIS FILE IS (read me before editing — editing is encouraged)

This ledger is the design exploration's memory. Every time a new batch of
concepts is generated, the AI reads this file FIRST and:
1. Forbids new concepts from resembling any recorded visual signature (the
   costume level: palette, type, devices).
2. Forbids new concepts from re-running over-used GENERATOR FAMILIES (the
   thesis level). A generator family is the kind of question a thesis
   answers — see the tally table below. Without this, the AI re-dresses the
   same idea ("the product as a document-of-record") in new colors forever.
3. Applies every "taste veto" verbatim.

How to edit it:
- Want future concepts to avoid a look? Add a line under CONCEPT SIGNATURES.
- Want to unlock an over-used thesis-shape (e.g. allow another
  document-metaphor concept)? Lower or delete its row in GENERATOR TALLY.
- Changed your mind about a veto? Delete its line under TASTE VETOES.
- Freeform notes go under NOTES; the AI reads them as soft guidance.

Format matters only loosely — one line per entry, keep the section headers.
══════════════════════════════════════════════════════════════════ -->

## Concept signatures
01 · The Registry [family: artifact] — warm ivory paper, hairline rules, Fraunces serif display, oxblood accent, auction-catalogue/archival paperwork motifs (stamps, lot numbers), slow dignified reveals
02 · APEX/OS [family: artifact] — near-black + acid green #D8FF3E, JetBrains Mono everywhere, square bordered cells, corner tick marks, stepped/instant motion, terminal-telemetry density
03 · After Hours [family: emotion] — deep night + sodium orange glow, Clash Display at cinematic scale, haze/bloom, film-slate metadata, scroll-driven parallax cinema
04 · Werkbank [family: artifact] — light drafting-paper grey + safety orange, IBM Plex Sans/Mono, blueprint grid, dimension-line annotations, white plates, 2px corners, instrument motion; has a dark "night shift" token remap
05 · Livery [family: subculture] — cream + flat racing color-blocks (cobalt/red/yellow), Archivo Black/Anton door-number type, sticker chips with hard offset shadows, springy pop motion (RETIRED — see vetoes)
06 · Atelier [family: artifact] — espresso/walnut warm dark + brass keylines, Cormorant Garamond serif with ledger rules instead of cards, certificate double-borders, velvet 400–600ms motion
07 · Sunday [family: anti-metaphor] — cool light #F4F6F9 + white cards + electric indigo #4F46E5, Inter/Manrope, 12px radii, soft layered shadows, mainstream-consumer polish, 180–240ms quiet delight
08 · Meridian [family: artifact] — obsidian glass panels + champagne #D8C79A, Outfit thin numerals, 270° SVG arc gauges, specular panel edges, ignition/boot sequences, smooth automotive glides
09 · Monograph [family: artifact] — cold gallery white #FCFCFB + ink #111112, NO chromatic accent (photography supplies all colour), Schibsted Grotesk 300 large-but-light, 11px uppercase museum wall-label captions, square corners, no shadows/boxes, reverent fade-up+scale reveals
10 · Atlas [family: artifact] — warm kraft/sand #E9DFCB + oat surface, olive #5E6B47 + clay #B5502F (money only), contour tan hairlines, Hanken Grotesk + Spline Sans Mono coordinates, naturalist field-guide specimens, topographic contours + dotted route lines, SVG survey map
11 · Circuit [family: artifact] — deep navy-black #0A0F1A + electric cyan #35E0F0, flat matte panels (no glass), Chivo + Spline Sans Mono (data labels only), SVG wiring-harness traces + node dots, node-hover isolate, amber for unverified only, smooth trace-draw motion
12 · Billet [family: material] — machined-aluminum UI: silver #C8CBD1 surfaces with brushed texture, chamfered blocks via dual inset edge shadows (no drop shadows), milled-slot inputs, press-in buttons, etched dual-text-shadow labels, ONE anodized-blue accent #35507E, slate shop-floor band, tooling-curve motion + clip-path mill-wipe reveals
13 · Counter [family: interaction] — negotiation-thread marketplace: warm stone canvas #EDE7DD, terracotta #B0562F buyer vs moss green seller conversation colors, offer bubbles with lifecycle chips (Open/Countered/Superseded/Accepted), sticky deal header with live expiry, two-color handshake seam on close; soft rounded, chat-adjacent but not a chat app
14 · Tearsheet [family: era-media] — 90s Japanese tuner-press print grammar: paper #F2EFE9 + ink + ONE process red #D62828, ruled columns/hairline grid, condensed uppercase headlines, red-underscored price callouts, flash tags, spec boxes, direct-flash parking-lot photography; print grammar running a modern functional market (no fake-magazine conceits)
15 · Glance [family: era-media] — void-black OLED bento widgets (superellipse 24px tiles, separation by surface tone, no borders/shadows), ONE signal red #FF2D1A for live/urgent chips only, Inter 700 giant numerals + mono microtext/key-values, bracketed mono buttons, cosmic orbital imagery + Higgsfield Earth-drift video backdrop, live-activity capsules with ticking countdowns, notification-center-as-commerce, iOS-spring motion; based on a user-supplied reference image
16 · Livesheet [family: hybrid era-media×artifact — commissioned Glance×Werkbank cross] — warm drafting paper #EFEDE6 + tone-separated 20px tiles (no borders/shadows), IBM Plex Sans/Mono, ONE signal red #F03A20 for live states only, signature = LIVE DIMENSIONS (drafting leader lines/rules whose measured values tick in real time), offers as work-orders, device-spring motion + rule draw-ins, Higgsfield dolly-video car hero under live callouts

## Generator tally
<!-- The next batch must draw from the LOWEST rows. "artifact" (any thesis
     compressible to "the product as a [noun]") gets at most one slot per
     batch — and ZERO while it dominates this table like it currently does. -->
| Family | Count |
|---|---|
| artifact | 8 |
| emotion | 1 |
| subculture | 1 |
| material | 1 |
| interaction | 1 |
| era-media | 2 |
| anti-metaphor | 1 |
| hybrid (commissioned) | 1 |

## Taste vetoes
- No pop/poster color-blocking, sticker chips, hard outlines, or racing-graphics styling (user disliked Livery's approach, 07/2026)

## Selections & signals
- 04 Werkbank — extended five times by request (dark mode, public pages, home/landing + profiles, settings + purchase flow, WebGL hero); revealed preference: complete real product workflows, precision systems, working interactions, and ambitious motion when asked for ("showcase 3js/webgl"). No formal promotion yet.
- User asked twice for dashboard-focused batches over marketing flows — cares about the logged-in product surface.
- 05 Livery — explicit dislike (see veto).
- User flagged sameness across batches (Atlas/Circuit/APEX family resemblance) — origin of the generator quota; values genuine conceptual novelty, not costume swaps.
- User pushed back on rule accumulation limiting creative autonomy — prefers high-trust briefs with hard floors over prescriptive checklists.
- SIGNAL: user supplied the base reference image for 15 Glance (phone-OS bento/widget aesthetic, black+signal-red, cosmic) — strong positive taste signal for device-native, glanceable, live-data design.
- SIGNAL: user commissioned a Glance×Werkbank hybrid (16 Livesheet) — the two concepts they have engaged with most; taste keeps pointing at precise/technical systems carrying live, glanceable data.
- 16 Livesheet taste call — CORRECTED 07.2026: the original entry recorded this as "user rejected pill tabs + boxed cell grids ('too blocky')" and generalized it into a preference for hairline-ruled rows and mono jump-links over segmented controls. That reading was **wrong and over-extended**. The user has since clarified that "too blocky" referred **only to the corner radius** (over-rounding) on those specific elements at that moment — it was never a rejection of tabs or segmented controls as a pattern. Correct guidance: **use real tabs where tabs are the right control** (with genuine panel switching, ARIA and keyboard support); keep the corner radius restrained and consistent with Livesheet's 20px-tile geometry rather than fully-rounded pills. Do not avoid segmented controls on the basis of the old note. Lesson for future entries: record the literal, narrow objection — do not infer a broad design principle from a one-off remark.

## Product context
DRVN is a marketplace for parts from modified cars: "the home for your modified car — show off your build, buy or sell the parts behind it." THE MARKETPLACE IS THE POINT — selection, easy listing, easy buying, and enthusiast identity/car culture around it. Not a social feed, not a Craigslist clone.

IMPORTANT (clarified 07.2026): provenance/trust-context (what car a part came off, seller credibility, fitment, pairing history) is a SUPPORTING FEATURE — a differentiator worth featuring where it naturally appears, but NOT the mission and NOT the design headline. Concepts must NOT be built around provenance/documentation as their central thesis. Design for the marketplace experience and enthusiast culture first; let trust context appear as well-placed detail, the way ratings appear on any good marketplace without being its identity.

## Notes
- Batches 04–08 were dashboard-focused; 06–08 also carry marketing home pages; 09–11 are image-led showcase flows.
- Werkbank (04) is the most-developed concept: 12+ pages, dark mode, mobile menu, purchase flow, settings; extensions must follow its token-only rule.
- Imagery grammar per concept lives in the genimg scripts; assets are shared in design-mockups/assets/ with c<N>- prefixes.
- 07.2026 diagnosis: 8 of 11 concepts came from the artifact generator ("provenance as a document/instrument"). Two causes, both now corrected: (1) nameable artifact-metaphors are the model's cheapest coherence device (fixed by the generator quota above); (2) the docs and briefs over-weighted provenance as DRVN's mission, when it is actually a supporting feature of a parts marketplace (fixed in the PRD, product-overview, and the Product context section above). Batch 4 (12–14 Billet/Counter/Tearsheet) executed this correction: material / interaction / era-media, all marketplace-first. Subsequent batches: keep artifact locked out; the remaining under-explored families are emotion, subculture, and anti-metaphor (1 entry each).
