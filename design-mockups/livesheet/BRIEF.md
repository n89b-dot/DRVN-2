# LIVESHEET — Concept 16

**Thesis:** "A drawing that knows what's happening." · **Family:** hybrid (era-media × artifact — a deliberate cross of Concepts 15 Glance and 04 Werkbank, commissioned by the client)

Werkbank contributed the drawing-office half: warm paper, mono annotations, dimension lines,
measured-not-guessed data, IBM Plex. Glance contributed the device half: widget tiles
separated by surface tone instead of borders, one signal color reserved for *live* states,
spring motion, ticking countdowns, values that change while you watch. The synthesis is the
**live dimension** — a drafting callout whose measured value is real-time ("34 WATCHING",
counting) — and offers handled as arriving *work orders* you accept, counter, or pass.

**Precedents:** Direct lineage from in-house Concepts 04 Werkbank (dimension-line annotation
system, work-order framing) and 15 Glance (live-activity capsules, tone-separated tiles) —
per the client, no external Mobbin pull for this build.

**Showpiece:** the car page hero — Higgsfield studio-dolly video of the Integrale playing
underneath live dimension callouts with leader lines drawn to points on the car, their
watch-counts ticking in real time. Falls back to the hero still as poster; callouts become a
chip row below the image ≤720px; `prefers-reduced-motion` honored.

**Motion:** `c16-motion-orbit.mp4` (Higgsfield kling3_0_turbo — slow lateral studio dolly,
10s loop) as the car-sheet hero. Stills (hero car, coilovers, seat) also generated via
Higgsfield (nano_banana).

## Iteration passes (performed on the built files)

- **Pass 1 — flaws:** Found two real ones. (a) The car-hero callouts collided at narrow
  widths — the LIVE coilover callout was clipped by the seat callout and their leader lines
  crossed; repositioned both anchors/callouts and added a ≤720px fallback where callouts
  become a static chip row and leaders hide. (b) The literal audit caught seven color
  literals I'd written outside the token block (three hover states, four soft rules) —
  tokenized as `--ink-hover/--live-hover/--ghost-hover/--rule-soft/--rule-mid`. The tool
  caught its own author; the rule earns its keep.
- **Pass 2 — elevation:** The greeting's "live." now draws a red underline beneath itself
  (scaleX from left, same spring as the dimension lines) — a second-read detail that makes
  the thesis literal in the first two seconds. Considered animating tile reorder on accept;
  rejected as motion for its own sake.
- **Pass 3 — coherence:** Swept all four pages for voice and system drift. Renamed nothing —
  "sheet" language (car sheet, part sheet, market sheet, "the sheet saw") holds consistently;
  red stays signals-only on every page (verified no red fills or headlines besides the
  live-word device). One deviation logged: the nav marks "Listing" active on a detail page —
  kept deliberately so the prototype's four surfaces are always reachable in one tap.

- **Pass 4 — night sheet & product surfaces (client request):** Added the NIGHT SHEET
  theme as a pure token remap (`[data-theme="dark"]` — warm charcoal paper #171511, chalk
  ink, lifted red #FF4530, dimmed photography, one localStorage source of truth with
  pre-paint scripts on every page) plus three surfaces: dashboard.html (the workbench —
  listings ranked by heat, job cards with advancing pipeline dots, payout ledger),
  explore.html (survey of live sheets with type filters), and a rebuilt market.html (live
  search, Phosphor-iconed category chips, working FITS: DELTA HF switch). Real findings
  fixed during the pass: the fitment switch's ON/OFF label wasn't wired to its toggle
  handler, and KPI numerals clipped at ≤420px (deck now single-column there). Phosphor
  icons used sparingly — category chips and tile heads only, never as decoration.

- **Pass 5 — responsive audit (client request):** Probed all six pages at 375px and 768px
  with an element-level overflow scan (every element checked against the viewport edge, both
  themes). Result: zero horizontal overflow on any page at either width; buy sheet fits at
  335px; car-hero callouts overlay without collisions at 768px and correctly become a chip
  row ≤720px. One real flaw found and fixed: the sticky nav wrapped to three rows (136px)
  on phones, eating a sixth of the viewport — it is now a logo row plus one horizontally
  swipeable pill row (91px), scrollbar hidden, theme toggle kept reachable at the row's end.

- **Pass 6 — car sheet tabs, the build, and spec legibility (client request, Mobbin-grounded):**
  The car page now has Overview / The build / Activity tabs (hash deep-linkable — #build,
  #activity). The old right-aligned 12.5px mono spec table is replaced by the BUILD SHEET:
  the whole build, not just car stats — 18 entries grouped by system (engine & driveline,
  chassis, wheels & brakes, interior, body & maintenance), each a stacked label-over-value
  cell at 16–17px semibold with status chips (FITTED / LISTED $ / PLANNED) and honest notes;
  the two LISTED chips link straight to their listings. Pattern grounded in Mobbin: MyDyson's
  stacked specification cells (https://mobbin.com/screens/ec59fb0f-10d5-4516-a2c2-29102669bf02)
  for the label-above-value mobile form, against eBay's product-details two-column list
  (https://mobbin.com/screens/f5f924ca-5f05-464d-ad0f-9b09ae464f37) which shows why
  right-aligned pairs fail in narrow columns. Also fixed on mobile: for-sale row chips now
  align under the text column instead of stranding full-width (client screenshot), and a
  run-on where build notes rendered inline with values (spans made block).

- **Pass 7 — un-boxing the build (client taste call):** The client disliked the pill tabs
  and boxed cell grid from Pass 6 — too blocky against the sheet's calm. Reverted to the
  ruled-paper language: no tabs; one continuous page with a quiet mono "ON THIS SHEET"
  jump-row (underlined ref-links → #build / #forsale / #activity); the build is now a single
  tile of hairline-ruled rows (label · value · note · status chip on one rule; stacked at
  ≤720px) — keeping Pass 6's content depth (18 grouped entries, LISTED chips linking to
  listings) and its legibility win (15.5–16.5px values), losing the boxes. Activity returned
  to an anchored section. Also caught during the pass: a grid min-width overflow (tiles
  could exceed their track at very narrow widths — fixed with a `.deck > * { min-width: 0 }`
  guard) and recorded a taste signal: prefer ruled/annotated surfaces over segmented
  controls and cell grids for this concept.

- **Pass 8 — de-boxing the dashboard lists (client screenshots):** The listings manager and
  Jobs in Motion sections were boxes-within-boxes with a large hollow band at the tile
  bottom — the band was a nested `.deck` inheriting the section-level 48–80px bottom
  padding. Inner lists are now `.rowlist` ruled rows (transparent rows, 1px hairlines,
  hover tints the part name red) and job cards are ruled `.jobrow`s; the same change
  automatically de-boxed the offers inbox (Sheet) and for-sale rows (car sheet). Tiles now
  close 18px after their last row, measured. Consistent with the Pass 7 taste signal:
  ruled surfaces over cell grids.

- **Pass 9 — Werkbank parity (5 pages):** Studied Werkbank's actual home/orders/profile/
  garage/settings implementations, extracted their feature inventories, and re-expressed
  every feature in Livesheet's ruled-paper language — none of Werkbank's costume. New:
  home.html (public masthead + motion hero under live callouts, 3 ticking steps, sheet
  strip, parts strip, ink-inverted stat band), orders.html (job card #1058 — pipe dots +
  dispatch-due countdown, in-system dispatch form that advances the pipeline, payout math
  as bline rows $310 − fees = $289.96, buyer tile, past-jobs rowlist), profile.html
  (keeper sheet — monogram identity, measured seller-grade blines, follow/message, cars,
  listings rowlist, ruled reviews with VERIFIED PURCHASE chips, live activity),
  garage.html (owner's desk — annotated still hero, owner-mode build sheet where every
  FITTED line carries a quiet [ RELEASE ] action opening one prefilled working modal,
  documents rowlist, second-sheet teaser), settings.html (configuration sheet — every
  group as ruled rows with right-aligned in-system controls, signal matrix, fee schedule,
  theme select that *delegates to the existing bar toggle* — one store, synced both ways
  via MutationObserver — dirty CHANGES PENDING flag, sticky save bar, safe close-the-sheet
  confirm). JS extended in a commented Parity-pass section only (toast helper, release
  prefill, dispatch gating on tracking no., settings dirty/save). Real finding fixed
  during the pass: the payout math as first drafted copied Werkbank's "5% only" example
  ($310 → $294) but the fee schedule ships with 1.4% + 20¢ processing — the job card and
  the settings worked example now both show the honest figure, $289.96; and dashboard's
  job #1058 kept a second, competing "Advance" control after orders.html took over the
  pipeline — replaced with a [ JOB CARD ] link so the pipeline advances in exactly one
  place. Biggest catch: the Pass-5 mobile hero fallback had silently regressed — at ≤720px
  the callout chip row was being clipped to nothing by `.hero-media`'s `overflow:hidden`
  plus the absolutely-sized video's leftover `height:100%`; measured the geometry headless
  (hero box 257px, chips laid out at y+546 — outside it) and fixed the mobile block
  (`overflow:visible`, `height:auto`), restoring the chip row on car.html and the two new
  hero pages.

**Style-emulation prompt:** Design a product where calm engineering paper meets live device
data. Canvas is warm drafting paper (#EFEDE6) under a faint 40px grid; content sits on
soft-cornered (20px) tiles in slightly lighter paper tones, separated by surface tone only —
no borders, no shadows. All text is IBM Plex: Sans 600–650 for headings and giant tabular
numerals, Mono for uppercase microlabels (10.5px, 0.14em tracking), key-values, and
bracketed [ BUTTON ] labels. Exactly one accent — signal red (#F03A20) — reserved for
*live* states: pulsing dots, countdowns, LIVE/NOW chips, arriving events; never fills,
never headlines. The signature device is the "live dimension": drafting leader lines and
dimension rules (1px, end ticks, drawn in with scaleX) whose measured labels are real-time
values that tick upward and flash red on change. Motion is a device spring
(cubic-bezier(.32,.72,0,1), 380ms) for tile entrances and press states, with slower 650ms
draw-ins for rules; honor prefers-reduced-motion. Voice: calm, measured, present-tense —
the interface reports what it just saw.
