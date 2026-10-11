# Material 3 as a behavioral reference

> MATERIAL DETERMINES WHAT A COMPONENT DOES.
> LIVESHEET DETERMINES WHAT THE COMPONENT LOOKS LIKE.
> DRVN DETERMINES WHEN AND WHY THE COMPONENT IS USED.

The Livesheet component library (src/components/ui) borrows Material 3's
*behavioral* architecture — and nothing else. This page is the boundary
marker: it exists so no future contributor reads the architecture as
permission to import Google styling.

## 1. The contract

**Material informs:** component anatomy and taxonomy · interaction states ·
accessibility behavior · sizing philosophy and touch targets · adaptive
composition (compact / medium / expanded) · action hierarchy · selection
semantics · focus and keyboard contracts · motion relationships.

**Material never defines:** DRVN color · IBM Plex typography · Livesheet
geometry (16 surfaces / 10 controls / 6 chips / 3 meters — nothing is a
pill) · navigation (LivesheetBar, Register Rail, Index, marketplace family
nav) · cards and ledgers · surface aesthetics · iconography · the
technical-drawing metaphor · the one-live-accent philosophy.

`@material/web` is not a dependency and must not become one. The stack is:
Material 3 specification → DRVN component contracts → Livesheet
implementation → React/Next.js.

## 2. The adaptive model

Semantic layout modes mapped onto the breakpoints the stylesheet already
uses (Material's window-size classes informed the model, not the numbers):

| Mode | Range | Behavior |
| --- | --- | --- |
| Compact | ≤640px | Full-width controls and commits (40px floor); filter rails scroll in the gutter; saverows stack deliberately; buybar exists; modrows recompose into labelled records; dense refinements sheet (BottomSheet). |
| Medium | 641–1080px | Top bar without the rail; tabstrips/filter rails scroll to 760px; ledgers linearize at 860px; the wide buybar carries cart/checkout to 1023px. |
| Expanded | ≥1081px | Register rail exists; list-detail and supporting-pane compositions run (checkout summary rail, PDP purchase rail); finders render refinements inline. |

A component answers "how do I behave in each mode" once, in its own
contract, instead of every page re-deciding with flex-wrap.

### Semantic roles and their thresholds

The modes above resolve into four named roles. New responsive work binds to
one of these (or documents a route exception below) — it does not invent a
fresh number:

| Role | Threshold | Meaning |
| --- | --- | --- |
| `compact` | ≤640px | Phone anatomy: sheeted refinements, stacked commits, task pageheads drop their standfirst, garage manage-rows, pinned thread composer (to 768). |
| `handheld` | ≤768px | One-column task composition; tabstrips/filter rails scroll (760); sectionnav is a horizontal rail; thread composer pins. |
| `collapsed-shell` | ≤1080px | No register rail; the Index owns navigation; the bar collapses progressively (text links go at 1080, labels at 640). |
| `split-capable` | ≥981px (route-decided) | A route may return its secondary pane when both panes meet minimum widths — the route, not the viewport alone, decides. |

Two further widths recur in `src/app/styles/11-responsive.css` and behave as
roles of their own rather than route exceptions: **720px**, where the car hero
recomposes (callouts drop their leaders and go static, media takes a 16:10
frame), `.bline` rows stack label-over-value, and `.savebar` becomes a fixed
bottom bar with the `.has-savebar` clearance; and **980px**, where
`.deck--two` / `.deck--three` fall to one column, `.deck--kpi` to two, and the
`.mkt` grid steps to two columns (so the market grid runs 3 → 2 → 1 rather
than dropping straight to one). **1024px** (Tailwind `lg`) is the third:
the profile's `.deck--aside` rail returns there and the cart/checkout
summary rail returns there too.

The marketplace grid does not read the viewport at all. `.marketplace-grid`
is a `container: mktgrid / inline-size`, and its `.mosaic` counts columns from
the room it has — four, then three at a container width ≤819px, two ≤559px,
one ≤307px (`src/app/styles/12-overrides.css`) — because the same grid sits
full-width on the marketplace, beside the filter sidebar, and inside a
member's profile column as their store. Two more container rules
(`@container (max-width: 900px)` in `06-cards-feeds.css` and
`12-overrides.css`) set `--mcols: 3` and the taller commerce card ratio. Only
the loading skeleton, which has no container, keeps viewport rules.

A known inconsistency: the compact edge is written several ways across the
family files — `max-width: 640px`, `639px`, `639.98px`, and the inverse
`min-width: 641px` / `640px` — so a 640px-wide window can match both sides of
a rule pair. Treat 640 as the intended boundary; new work should use
`max-width: 640px` / `min-width: 641px`.

**Documented route exceptions** (legitimate, component-owned):

- **PDP split + buybar** — the listing page splits media/rail at **981px**,
  and the buybar retires at the same width; the split is gated on both
  columns having workable minimums, not on a shell breakpoint.
- **Cart/checkout wide buybar** — the summary rail returns at Tailwind `lg`
  (**1024px**), so `.buybar--wide` carries the checkout action through
  981–1023px where the one-column layout persists.
- **Ledgers** — tables linearize into labelled records at **860px**
  (`.ledger`) because that is where the column set stops fitting, not at a
  shell threshold. Stacked, the title wraps to two lines instead of an
  ellipsis, so similar parts can be told apart.
- **Register rail** — exists only ≥**1081px**; measured ("the last width
  that fits the full register"), not themed.

Bottom-surface contract: `--bottom-surface-h` (76px) is the one clearance
number; every fixed bottom bar pads `env(safe-area-inset-bottom)` and only
one surface may own the bottom edge of a route at a time (buybar, savebar,
or the thread composer — never two).

## 3. Concept → contract → Livesheet

| Material concept | Behavioral contract | Livesheet implementation | Borrowed |
| --- | --- | --- | --- |
| Filled button | Primary contained action | `[ BUY NOW ]` — Button variant="live": mono brackets (the only variant that wears them), live fill, one per surface. The other variants are `default` (the ink-contained workhorse), `ghost` (a recessed fill), `destructive` (outlined red — never `live` styling) and `quiet` (the bracketed mono row action), in Plex Sans | Action hierarchy; disabled/loading states; 40px floor; aria-busy narration |
| Text field | Label, supporting text, error, prefix | TextField — microlabel + 16px Plex Sans .ctl on paper-deep (outlined on tile-2 when it sits on a raised surface), ▸ error line, live `status` line | Anatomy; aria-describedby/aria-invalid wiring; error paints the control |
| Filter chip / segmented | Selectable chips in a labelled set | FilterGroup + FilterLink/FilterButton — .fbtn mono micro-labels in a hairline outline, ink-ground selection; `fit` sets a short fixed set in one phone row | Single vs multi-select semantics (aria-current vs aria-pressed); axis grouping |
| Tabs | Tablist, roving tabindex, arrows | SheetTabs — .tabstrip: Sans labels on a ruled baseline, accent underline on the current tab, URL-backed; all tabs visible on a phone | Keyboard contract (arrows, Home/End); scroll selected into view |
| Dialog | Modal: scrim, trap, restore | Dialog — a native `<dialog>` on the modal stack, the .sheet plate over the scrim, animated in on mount with Motion (`springs.spatial`) | Trap/Esc/restore/body-lock via `showModal()` and the modal stack |
| Bottom sheet | Compact surface for dense controls | BottomSheet — the sheet plate flush to the bottom edge, safe-area padded; `inlineFrom="sm"` dissolves it ≥640px, `inlineFrom="lg"` ≥1024px, `align="center"` floats it as a centered dialog above compact | When to sheet; kept-mounted children; inline dissolution |
| Bottom bar / FAB region | Persistent primary action on compact | MobileActionBar — the .buybar: total block + one live action, no FAB | Persistence; safe-area; body clearance; retirement at real breakpoints |
| Search bar | Query field + refinements | Finder + SearchField — the .finder tile plate, GET form, ⌕ | Query/refinement separation; searches are shareable URLs |

## 4. Explicitly rejected

Pill geometry and expressive shape morphing · dynamic color · Roboto /
Google Sans · Material surface tints and elevation overlays · FABs ·
navigation rail/drawer/bottom-navigation replacing DRVN chrome · Material
chat bubbles (tails, pill shapes, tinted surfaces — DRVN's conversation
blocks are r16 plates in ink and tile) · generic Card in place of ListingCard / VehicleCard / Ledger rows /
build lines · bouncy expressive motion.

The test for any future borrow: if a normal DRVN user could tell Material
was involved, it went too far. Material disappears into the architecture;
Livesheet remains what people see.
