@AGENTS.md

## Product direction — read before planning product or UI work

The current product definition is `docs/DRVN-PRD-2026-09.md`; the work that delivers it is `docs/plans/2026-09-direction-build-plan.md`. One product, two front doors (Explore, Marketplace), the car in the middle; a member's store is the Parts tab on their profile; every post is about a car or a part and has a photo. `docs/DRVN-PRD-v3.1.md` is superseded. The PRD's non-goals are rulings — do not re-propose them. Typeface (IBM Plex), accent and light theme do not change.

The agent and the car-and-parts graph (PRD §4.9 Intelligence, added 2026-10-17) are delivered by `docs/plans/2026-10-agent-and-graph-plan.md`, a repo copy of the living Claude Doc where Neil rules. The shapes every phase builds to (who the agent acts for, capabilities, lock order, the floor and snapshot rules) are fixed in `docs/decisions/agent-foundations.md`. One agent per member; rules set prices, never the model; every task works without it. The mobile bottom bar is back (N-4 reversed): Explore · Marketplace · Home · Garage · Agent.

## Component system — non-negotiable workflow for any UI work

DRVN's UI is a governed component platform (Livesheet). Before writing **any** JSX:

1. **Look it up first.** `src/components/registry.ts` lists every reusable component with layer, import path, and when/when-NOT-to-use. The taxonomy ("which card/row/message/chip/form piece do I use?") is §12 of `docs/site/components.md`. If a pattern plausibly exists, find it — do not rebuild it.
2. **Compose, never re-type recipes.** Screens are built from `@/components/ui` (primitives) and `@/components/commerce` (DRVN domain patterns). Never hand-write markup for a recipe that has a component: `.btn`→`Button`/`ButtonLink` · `.field`/`.ctl`→`TextField`/`TextArea`/`Select`/`Checkbox`/`FormField` · `.pagehead`→`PageHead` · `.tile__head`→`TileHead` · `.undrawn`→`EmptyState` · `.alert`→`Alert` · `.order` rows→`ObjectRow` · `.msg`/`.thread`/`.composer`→`Message`/`MessageThread`/`MessageComposer` · `.steps`→`Stepper` · `.bline`→`DataRow` · KPI tiles→`MetricCard` · stars→`RatingStars` · pagination→`Pagination` · skeletons→`Skeleton*` · image upload→`uploadImages` in `src/lib/media-upload.ts`.
3. **New component = built from the system, then registered.** If a screen needs something no component covers: build it by composing existing primitives and existing stylesheet recipes (new CSS goes in the family file under `src/app/styles/` — `globals.css` only imports them, and import order is the cascade — as a named recipe, tokens only, no inline hex/radii; extend a selector's first definition rather than redefining it, which `src/app/styles/styles-ratchet.test.ts` enforces). Type rules: mono only for ≤12px labels/data; buttons, tabs and prices per `docs/site/typography.md`. If the pattern is reusable (2+ contexts, or meaningful interaction/a11y behavior), it lives in `src/components/ui` (product-agnostic) or `src/components/commerce` (knows DRVN objects), is exported from that barrel, gets a `registry.ts` entry, then `npm run docs:components` and a specimen in `src/app/(docs)/docs/components/page.tsx` if visual. One-off page layout stays plain JSX in the route — do not create wrapper components with no contract.
4. **Feature logic stays in the route/feature.** Data fetching, server actions, state machines never move into `src/components`. Extract the visual contract, keep the orchestration local.
5. **The tests enforce all of this** (`npm test`): registry↔export sync, registry↔docs sync, route-boundary imports (no importing another route's components — share via `src/components`), and a **recipe ratchet** (`src/components/recipe-ratchet.test.ts`): raw recipe markup in feature code may only decrease. If the ratchet fails, you should be composing from the component — only a reviewed, deliberate exception may edit `recipe-baseline.json` upward.

## Skills

Committed in `.claude/skills/` — available in local and cloud sessions.

**Design & taste:** `taste-skill` (anti-generic frontend design direction) · `soft-skill` (high-end agency visual polish) · `minimalist-skill` (clean editorial monochrome interfaces) · `design-better` (UX craft and accessibility heuristics) · `design-system` (token extraction skill; in DRVN the contract is design-mockups/livesheet/design.md — do not re-derive tokens)

**Build & iterate:** `build-loop-claude-code` (build, review, test, fix loop) · `iteration-pass` (adversarial polish passes on designs) · `redesign-skill` (upgrade existing UI to premium) · `output-skill` (no truncation, complete code output)

**Reference & visuals:** `mobbin-claude-rodeo` (real-app UI references via Mobbin MCP) · `image-to-code-skill` (generate design images, then implement) · `imagegen-frontend-web` (per-section website design references)

**Thinking & specs:** `constraints-analysis` (pre-mortem on plans and designs) · `spechammer` (turn discussion into design brief) · `phial-forge` (author reusable, potent prompts)

The `mobbin` MCP server is declared at project scope in `.mcp.json`.
