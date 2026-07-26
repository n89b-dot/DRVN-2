# LIVERY — DRVN Concept 05 Design Brief

**Thesis: "Run your garage like a race team."** The seller dashboard as a pit wall. Selling take-off parts is scored like a race weekend: offers are deadlines before lights out, listings sit in a timing tower ranked by heat, orders progress through five start lights, payouts land on a podium. Racing-livery pop modernism — flat saturated color blocks, door-number typography, sticker chips, pit-board flips — turns marketplace admin into something a weekend racer *wants* to check.

## Reference lineage

- **60s–70s racing livery design — Gulf, Martini, BRE Datsun.** The core palette (powder blue + marigold-adjacent yellow, cobalt, racing red on warm cream) and the idea that color is *structural*: a livery isn't decoration, it's identity applied in flat panels with hard edges. Whole cards here are solid color fields with ink or cream type, exactly like a door panel.
- **F1 pit boards & timing towers.** The greeting banner is a literal pit board ("BOX BOX, RAE") with a flip counter; the listings manager is a timing screen — position roundel, gap-to-asking column ("−£40"), expandable rows. Pit boards taught us the hierarchy: one huge number, terse uppercase, everything readable at 180 mph.
- **Door numbers & race roundels.** The white circle with a thick border and an Anton numeral is the system's signature atom — used for the DRVN 23 logo, KPI counts, timing positions, and finishing order.
- **Risograph poster culture.** No gradients, no blur, limited flat inks on off-white stock, 2px rules doing the compositional work. The hard 4px offset shadow is the riso misregistration made deliberate.
- **Gumball-era sticker sheets.** Status chips ("UNDER OFFER", "P1 SELLER", "SOLD") are white pills with ink borders and hard shadows that wobble 2° on hover — stickers you could peel off the page. The garage spec block is literally a "sticker sheet."

## Why this serves DRVN's trust-and-context mission

DRVN's premise is that the **car profile is the trust layer**: every listing must answer "what car did this come off, who's the seller, will it fit, what was it paired with." LIVERY makes provenance the aesthetic:

- **Source-car stickers on every row and card** ("Gulf Girl · 911", "Pepperpot · Mini") make the part→car link a first-class visual token, not metadata in a footer.
- **The race-weekend mod log** (FP1 — installed KW Clubsports) is the provenance document buyers read before bidding; the garage page frames the build history as the sales asset it actually is.
- **The team-identity framing** (roundel, "TEAM RO23", P1 SELLER chip, 100% feedback) turns seller reputation into a racing license — persistent, earned, visible on every surface.
- **Deadline mechanics** (countdowns, "respond before lights out") encode the marketplace's liveness honestly: offers really do expire, and the pit-wall metaphor makes urgency legible instead of dark-pattern-ish.

## Iteration-pass log

- **Pass 1 — flaws.** Found: the timing-tower source stickers shipped with a 🏁 emoji, directly violating the "colored flag chips, emoji-free" rule the Race Control feed follows (its flags are pure CSS squares). Removed the emoji from all seven stickers so flags are rendered exclusively by the `.flag::before` CSS system.
- **Pass 2 — elevation.** Found: countdown digits ("02:58:41") were re-rendering every second in proportional figures, causing horizontal jitter in the chips and the pit-board clock — exactly the kind of micro-sloppiness a timing screen can't have. Added `[data-countdown] { font-variant-numeric: tabular-nums; }` so every ticking clock holds its width. Also verified the money reconciles like real telemetry: the £2,140 30-day KPI equals the results-table sum (680+540+290+265+185+180) and the 5% fee math is consistent everywhere (£340 → −£17 → £323).
- **Pass 3 — coherence.** Found: garage.html contradicted listings.html — the OZ wheels wore an UNDER OFFER chip while the timing tower had them LIVE, and the KWs the reverse. Swapped both chips so status is identical across surfaces, and reworded the rack subtitle to "Team RO23 take-off rack" since the rack includes a Pepperpot part under a Gulf Girl hero (the source sticker on each card now carries the car attribution, which is truer to the thesis anyway).

## What a design system for this thesis looks like

**Token architecture.** Three tiers. (1) *Ink & stock*: `--cream`, `--cream-panel`, `--ink` — the paper and the pen; these never carry meaning. (2) *Livery inks*: `--cobalt`, `--red`, `--yellow`, `--powder`, `--green` — a closed set of five flat inks; adding a sixth requires a governance decision, like adding a color to a race car. (3) *Structural tokens*: `--rule` (2px ink), `--shadow-sticker` (4px offset), `--spring` (the one easing curve), `--radius-chip` (90px, the only curve besides circles).

**Naming.** Components are named in pit-lane vocabulary and that naming is normative: `roundel` (circular count), `chip` (sticker status), `pitboard` (announcement panel), `tower-row` (data row), `race-lights` (stepper), `podium` (financial breakdown), `stripe-divider` (section break), `flag` (event type). If a new component can't be named from the metaphor, it probably doesn't belong in LIVERY.

**Component inventory.** Nav band + stripe · roundel (sm/md/lg) · sticker chip (6 ink variants) · button (display-face, 5 variants + sm) · color-block card · KPI block · offer card · pit board / board overlay · team card · part card · spec sticker · timing tower (head/row/detail) · tabs · flag chip · feed row · race lights · podium · results table · form field · toast · stripe divider.

**Governance rules.** (1) Color assignments are semantic and fixed: red = needs action/urgency, cobalt = live/informational, yellow = money/highlight, green = done/sold, powder = passive context. (2) Shadows are only ever hard ink offsets — a blur radius anywhere is a defect. (3) All display type is uppercase Archivo Black; all numbers that matter are Anton; body text never exceeds 15px. (4) Motion is capped at 300ms and always uses the single spring curve; anything slower reads as a lag, not a style. (5) Every listing surface must carry a source-car sticker — provenance is not optional chrome.

## The design system in Google's design.md standard

`design.md` in this folder follows **Google's open design.md format**: a YAML frontmatter block declaring machine-readable tokens — `colors`, `typography` (display/h1/h2/body/label/number), `rounded`, `spacing`, and `components` (each referencing tokens by interpolation, e.g. `background: "{colors.accent}"`) — followed by prose sections (Overview, Colors, Typography, Layout, Elevation & Depth, Shapes, Components, Do's and Don'ts) that explain intent and judgment the tokens can't encode.

**How an agent should consume it:** parse the frontmatter first and treat it as the source of truth for any value it emits — never invent a hex, radius, or duration; interpolate `{token.path}` references before use. Read the prose second for the rules that constrain composition (e.g. "no gradients," "shadows are hard offsets only"), and treat the Do's and Don'ts as lint rules for its own output. Values in `design.md` are kept byte-identical to `livery.css`; if they diverge, the CSS wins and `design.md` must be patched in the same change.

## Style-emulation prompt

> Design this product in **racing-livery pop modernism**: a warm cream page (#F5EDDD) treated like poster stock, near-black ink (#1B1B1E) for all rules and type, and a closed set of flat livery inks — cobalt #1D4ED8, racing red #E4342C, signal yellow #FFC700, powder blue #9EC5E8 — applied as whole solid-color card blocks, never as tints or gradients. Structure everything with hard 2px ink borders and asymmetric chunky grids; the only shadows allowed are hard 4px-offset ink blocks that grow to 6px on hover as the element pops up-left. Set display type in uppercase Archivo Black, all meaningful numbers huge in Anton with door-number roundel treatment (white circles, thick ink border), body in Archivo with 10px letterspaced uppercase microlabels. Statuses are white sticker-pill chips with 2px ink borders and hard shadows that wobble two degrees on hover; sections break with skewed diagonal stripe bands in cobalt/red/yellow that slide in on scroll. Motion is snappy and springy — cubic-bezier(.34,1.56,.64,1), 200–300ms, never longer. Voice is pit-lane terse: uppercase imperatives, countdowns, positions, gaps. The result should feel like a 1970s Gulf race car crossed with an F1 timing tower and a risograph poster — playful, flat, disciplined, and fast.
