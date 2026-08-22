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
| Compact | ≤640px | Full-width controls and commits (44px floor); filter rails scroll in the gutter; saverows stack deliberately; buybar exists; modrows recompose into labelled records; dense refinements sheet (BottomSheet). |
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

**Documented route exceptions** (legitimate, component-owned):

- **PDP split + buybar** — the listing page splits media/rail at **981px**,
  and the buybar retires at the same width; the split is gated on both
  columns having workable minimums, not on a shell breakpoint.
- **Cart/checkout wide buybar** — the summary rail returns at Tailwind `lg`
  (**1024px**), so `.buybar--wide` carries the checkout action through
  981–1023px where the one-column layout persists.
- **Ledgers** — tables linearize into labelled records at **860px**
  (`.ledger`) because that is where the column set stops fitting, not at a
  shell threshold.
- **Register rail** — exists only ≥**1081px**; measured ("the last width
  that fits the full register"), not themed.

Bottom-surface contract: `--bottom-surface-h` (76px) is the one clearance
number; every fixed bottom bar pads `env(safe-area-inset-bottom)` and only
one surface may own the bottom edge of a route at a time (buybar, savebar,
or the thread composer — never two).

## 3. Concept → contract → Livesheet

| Material concept | Behavioral contract | Livesheet implementation | Borrowed |
| --- | --- | --- | --- |
| Filled button | Primary contained action | `[ BUY NOW ]` — Button variant="live": mono brackets, live fill, one per surface | Action hierarchy; disabled/loading states; 44px floor; aria-busy narration |
| Text field | Label, supporting text, error, prefix | TextField — microlabel + 16px mono .ctl on paper-deep, ▸ error line | Anatomy; aria-describedby/aria-invalid wiring; error paints the control |
| Filter chip / segmented | Selectable chips in a labelled set | FilterGroup + FilterLink/FilterButton — .fbtn, ink-ground selection | Single vs multi-select semantics (aria-current vs aria-pressed); axis grouping |
| Tabs | Tablist, roving tabindex, arrows | SheetTabs — .tabstrip in the fbtn vocabulary, URL-backed | Keyboard contract (arrows, Home/End); scroll selected into view |
| Dialog | Modal: scrim, trap, restore | Dialog — the .sheet plate over the scrim | Trap/Esc/restore/body-lock; @starting-style mount |
| Bottom sheet | Compact surface for dense controls | BottomSheet — the sheet plate flush to the bottom edge, safe-area padded | When to sheet; kept-mounted children; inline dissolution ≥640px |
| Bottom bar / FAB region | Persistent primary action on compact | MobileActionBar — the .buybar: total block + one live action, no FAB | Persistence; safe-area; body clearance; retirement at real breakpoints |
| Search bar | Query field + refinements | Finder + SearchField — the .finder tile plate, GET form, ⌕ | Query/refinement separation; searches are shareable URLs |

## 4. Explicitly rejected

Pill geometry and expressive shape morphing · dynamic color · Roboto /
Google Sans · Material surface tints and elevation overlays · FABs ·
navigation rail/drawer/bottom-navigation replacing DRVN chrome · chat
bubbles · generic Card in place of ListingCard / VehicleCard / Ledger rows /
build lines · bouncy expressive motion.

The test for any future borrow: if a normal DRVN user could tell Material
was involved, it went too far. Material disappears into the architecture;
Livesheet remains what people see.
