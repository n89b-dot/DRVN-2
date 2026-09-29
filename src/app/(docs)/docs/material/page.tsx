import { DocsJumprow, DocsPagehead, Rule } from "../../_components/docs-page";

export const metadata = { title: "Material reference" };

/**
 * Why this page exists: the component library borrows Material 3's behavioral
 * architecture, and without this page written down, a future contributor
 * could read that as permission to import Google's styling. This is the
 * contract that says exactly what was borrowed and what never will be.
 */

const COMPARISONS: {
  concept: string;
  material: string;
  livesheet: string;
  borrowed: string;
}[] = [
  {
    concept: "Filled button",
    material: "Primary contained action",
    livesheet: "[ BUY NOW ] — Button variant=\"live\": mono brackets (the only variant that wears them), live fill, one per surface; ghost/quiet actions are Plex Sans",
    borrowed: "Action hierarchy, disabled/loading states, 44px floor, aria-busy narration",
  },
  {
    concept: "Text field",
    material: "Label, supporting text, error state, prefix",
    livesheet: "TextField — microlabel + 16px Plex Sans .ctl on paper-deep (outlined on tile-2 on a raised surface), ▸ error line, live status line",
    borrowed: "Anatomy and aria-describedby/aria-invalid wiring; error paints the control",
  },
  {
    concept: "Filter chip / segmented button",
    material: "Selectable chips in a labelled set",
    livesheet: "FilterGroup + FilterLink/FilterButton — .fbtn mono micro-labels in a hairline outline, ink-ground selection; fit sets a short fixed set in one phone row",
    borrowed: "Single vs multi-select semantics (aria-current vs aria-pressed), axis grouping",
  },
  {
    concept: "Tabs",
    material: "Tablist, roving tabindex, arrow keys",
    livesheet: "SheetTabs — .tabstrip: Sans labels on a ruled baseline, accent underline on the current tab, URL-backed; all tabs visible on a phone",
    borrowed: "Full keyboard contract (arrows, Home/End), scroll-selected-into-view",
  },
  {
    concept: "Dialog",
    material: "Modal with scrim, focus trap, restore",
    livesheet: "Dialog — the .sheet plate risen over the scrim",
    borrowed: "Trap/Esc/restore/body-lock; @starting-style mount",
  },
  {
    concept: "Bottom sheet",
    material: "Compact-screen surface for dense controls",
    livesheet: "BottomSheet — the same sheet plate, flush to the bottom edge, safe-area padded",
    borrowed: "When to sheet (compact density), kept-mounted children, inline dissolution",
  },
  {
    concept: "Bottom app bar / FAB region",
    material: "Persistent primary action on compact",
    livesheet: "MobileActionBar — the .buybar: total block + one live action, no FAB",
    borrowed: "Persistence, safe-area handling, body clearance, retirement at real breakpoints",
  },
  {
    concept: "Search bar",
    material: "Query field + refinements",
    livesheet: "Finder + SearchField — the .finder tile plate, GET form, ⌕ glyph",
    borrowed: "Query/refinement separation; searches are shareable URLs",
  },
];

export default function MaterialPage() {
  return (
    <>
      <DocsPagehead
        index="07"
        liveWord="Material 3"
        titleRest="as a behavioral reference"
        mdSlug="material"
        sub="Material determines what a component does. Livesheet determines what it looks like. DRVN determines when it is used."
      />

      <DocsJumprow
        items={[
          { href: "#contract", label: "01 The contract" },
          { href: "#adaptive", label: "02 Adaptive model" },
          { href: "#comparisons", label: "03 Comparisons" },
          { href: "#rejected", label: "04 Never borrowed" },
        ]}
      />

      <section id="contract" className="scroll-mt-24 pb-8">
        <div className="mb-3 mt-8 flex items-baseline gap-3">
          <span className="microlabel microlabel--ink !mb-0">01</span>
          <h2 className="text-section font-[600]">The contract</h2>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <div className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">What Material informs</span>
            </div>
            <p className="text-body">
              Component anatomy and taxonomy · interaction states · accessibility behavior ·
              sizing philosophy and touch targets · adaptive composition (compact / medium /
              expanded) · action hierarchy · selection semantics · focus and keyboard contracts ·
              motion relationships.
            </p>
            <p className="field__hint mt-3">
              In short: the invisible architecture. Material&apos;s component library is the most
              thoroughly specified behavioral reference in the industry — we use it the way an
              engineer uses a standards body.
            </p>
          </div>
          <div className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">What Material never defines</span>
            </div>
            <p className="text-body">
              DRVN color · IBM Plex typography · Livesheet geometry (16/10/6/3 — nothing is a
              pill) · navigation (LivesheetBar, Register Rail, Index, marketplace family) ·
              cards and ledgers · surface aesthetics · iconography · the technical-drawing
              metaphor · the one-live-accent philosophy.
            </p>
            <p className="field__hint mt-3">
              This page is a boundary marker: borrowing Material&apos;s behavior is architecture;
              importing its styling would be a different product. @material/web is not a
              dependency and must not become one.
            </p>
          </div>
        </div>
      </section>

      <section id="adaptive" className="scroll-mt-24 pb-8">
        <div className="mb-3 mt-8 flex items-baseline gap-3">
          <span className="microlabel microlabel--ink !mb-0">02</span>
          <h2 className="text-section font-[600]">The adaptive model</h2>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <table className="spec w-full">
            <tbody>
              <tr>
                <td>Compact — ≤640px</td>
                <td>
                  Phones. Full-width controls and commits (44px floor), filter rails scroll in
                  the gutter, saverows stack deliberately, the buybar exists, modrows recompose
                  into labelled records, dense refinements sheet (BottomSheet).
                </td>
              </tr>
              <tr>
                <td>Medium — 641–1080px</td>
                <td>
                  Tablets and narrow windows. Top bar without the rail; tabstrips and filter
                  rails still scroll to 760px; ledgers linearize at 860px; the wide buybar
                  carries cart/checkout to 1023px.
                </td>
              </tr>
              <tr>
                <td>Expanded — ≥1081px</td>
                <td>
                  The register rail exists; list-detail and supporting-pane compositions run
                  (checkout summary rail, PDP purchase rail); finders render refinements inline.
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-3 text-micro leading-relaxed text-dim">
            These are semantic modes mapped onto the breakpoints the stylesheet already uses —
            Material&apos;s window-size classes informed the model, not the numbers. A component
            answers &quot;how do I behave in each mode&quot; once, in its own contract, instead of
            every page re-deciding with flex-wrap.
          </p>
        </div>
      </section>

      <section id="comparisons" className="scroll-mt-24 pb-8">
        <div className="mb-3 mt-8 flex items-baseline gap-3">
          <span className="microlabel microlabel--ink !mb-0">03</span>
          <h2 className="text-section font-[600]">Concept → contract → Livesheet</h2>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <div className="overflow-x-auto">
            <table className="spec w-full min-w-[720px]">
              <thead>
                <tr>
                  <th className="microlabel pb-2 text-left font-normal">Material concept</th>
                  <th className="microlabel pb-2 text-left font-normal">Behavioral contract</th>
                  <th className="microlabel pb-2 text-left font-normal">Livesheet implementation</th>
                  <th className="microlabel pb-2 text-left font-normal">What was borrowed</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISONS.map((row) => (
                  <tr key={row.concept}>
                    <td className="align-top">{row.concept}</td>
                    <td className="align-top">{row.material}</td>
                    <td className="align-top">{row.livesheet}</td>
                    <td className="align-top">{row.borrowed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="rejected" className="scroll-mt-24 pb-8">
        <div className="mb-3 mt-8 flex items-baseline gap-3">
          <span className="microlabel microlabel--ink !mb-0">04</span>
          <h2 className="text-section font-[600]">Explicitly rejected</h2>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <p className="text-body">
            Pill geometry and expressive shape morphing · dynamic color · Roboto / Google Sans ·
            Material surface tints and elevation overlays · FABs · navigation rail/drawer/bottom
            navigation as replacements for DRVN&apos;s own chrome · Material chat bubbles (tails, pill shapes, tinted surfaces) ·
            generic Card in place of ListingCard, VehicleCard, Ledger rows and build lines ·
            bouncy expressive motion.
          </p>
          <p className="field__hint mt-3">
            The test for any future borrow: if a normal DRVN user could tell Material was
            involved, it went too far. Material should disappear into the architecture;
            Livesheet remains what people see.
          </p>
        </div>
      </section>
    </>
  );
}
