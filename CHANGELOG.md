# Changelog

## 2026-07-16 — Product framing clarification: marketplace first, provenance as supporting feature

- Clarified the core product thesis across documentation: **DRVN is a marketplace for parts from modified cars** — selection, easy listing, easy buying, and enthusiast identity are the point. The car profile's provenance/trust-context layer (source car, seller credibility, fitment, pairing history) is a **supporting differentiator, not the mission**, and must not be treated as the product's headline in design, copy, or roadmap decisions. Earlier framings over-weighted this layer as "the reason to exist," which had been steering design explorations toward documentation/provenance-centric concepts.
- Updated: `docs/DRVN-PRD-v3.1.md` §3 (Core Product Thesis, now marked *clarified 07.2026*), `docs/product-overview.md` ("What we're trying to create"), and `design-mockups/LEDGER.md` (Product context + diagnosis note) so future design-exploration runs center the marketplace experience rather than provenance. No app code or existing concepts changed.

## 2026-07-08 — Design exploration: three clickable concepts (`design-mockups/`)

- Added `design-mockups/` — three radically distinct, fully clickable static prototypes exploring what DRVN's visual language could be, each with 4 cross-linked pages, custom AI-generated imagery (`design-mockups/assets/`, 16 images), a `BRIEF.md` (thesis, reference lineage, iteration-pass log) and a portable style-emulation prompt: **The Registry** (archival auction-catalogue provenance, ivory/ink/oxblood, Fraunces), **APEX/OS** (telemetry-console brutalism, black/acid, JetBrains Mono, working fitment filter), **After Hours** (scroll-driven night-meet cinema, sodium orange, Clash Display). Hub page at `design-mockups/index.html`; serve with `npx serve -l 4380 design-mockups` (config in `.claude/launch.json`). Exploration only — does not touch app code or the current design system.
- Added a full **design system per concept** in [Google's open `design.md` format](https://github.com/google-labs-code/design.md): a machine-readable YAML token block + prose (`design.md`, source of truth, faithful to each prototype's shipped CSS) mirrored by a live, self-contained `design.html` style guide rendered in that concept's own visual language. Each `BRIEF.md` gained two sections — "The thesis as a design system" and a `design.md` standard explainer with an embedded token excerpt. The hub cards now link Prototype · Brief · Design system.

## 2026-07-08 — PRD v3.1 (as-built revision)

- Added `docs/DRVN-PRD-v3.1.md` as the canonical PRD: v3.0 diffed against the implemented codebase. Records build decisions the old spec didn't know (stub `PaymentProvider` with live 10% fee, heuristic mod parser, cookie cart, one-order-per-seller checkout, messaging schema-only, inline garage editors instead of modals, migrations 0002–0005), stamps every milestone with actual status (M0–M2 + M4 shipped; M3/M5 partial), and re-scopes the remaining roadmap (real payments first, then marketing home, production hygiene, AI parsing, messaging UI).
- Marked `docs/DRVN-PRD-v3.md` as superseded (retained as archive).
- Repointed `docs/product-overview.md` at the new PRD.
