import { DocsJumprow, DocsPagehead, Rule, Specimen } from "../../_components/docs-page";

export const metadata = { title: "Rules" };

export default function RulesPage() {
  return (
    <>
      <DocsPagehead
        index="06"
        liveWord="Rules"
        titleRest="— the contract"
        mdSlug="rules"
        sub="When a change violates one of these, the change is wrong. Design, accessibility, content and engineering — the whole do/don't distillation."
      />

      <DocsJumprow
        items={[
          { href: "#design", label: "Design" },
          { href: "#a11y", label: "Accessibility" },
          { href: "#content", label: "Content" },
          { href: "#engineering", label: "Engineering" },
        ]}
      />

      <section id="design" className="mt-6 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Design</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Do">
            <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed">
              <li>Separate surfaces by tone — paper, paper-deep, tile, tile-2.</li>
              <li>Rule every list inside a tile (1px rule-soft tops).</li>
              <li>
                Reserve live red for what is happening <i>right now</i>, plus one primary CTA per
                surface — the one red fill, and the only bracketed button — and one live-word per
                page.
              </li>
              <li>ok for terminal good states only — never a price; warn for held money and due work.</li>
              <li>Mono for labels and data at 12px and under; anything read or typed at reading size is Plex Sans.</li>
              <li>Radius descends with size: 16 / 10 / 6 / 3. Circles only for live dots, pips, thumb-x.</li>
              <li>tabular-nums on every number that ticks or aligns.</li>
              <li>Empty states keep the geometry of the content they replace.</li>
              <li>— for empty values; $0.00 for empty money.</li>
              <li>Spent desaturates; it never disappears.</li>
              <li>Panels switch with underline tabs (SheetTabs), all visible on a phone; in-page references use the jumprow (&ldquo;On this sheet&rdquo;).</li>
            </ul>
          </Specimen>
          <Specimen name="Don't">
            <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed text-dim">
              <li>No pills. No shadows. No gradients. No glass.</li>
              <li>
                No borders as edges — the mail frame is the sole exception (it depicts an
                external artifact); dimline is for dimension/leader lines only.
              </li>
              <li>No second accent. No status color as navigation.</li>
              <li>No spinners — ghost rows with the drawing sweep.</li>
              <li>No fake data, fake liveness or decorative pulsing.</li>
              <li>No tile-in-tile; never nest decks.</li>
              <li>Provenance never leads the story; the product does.</li>
            </ul>
          </Specimen>
        </div>
      </section>

      <section id="a11y" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Accessibility</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Non-negotiable">
            <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed">
              <li>
                Every text/ground pair clears WCAG AA 4.5:1 in <b>both</b> lightings — re-measure
                whenever a token moves.
              </li>
              <li>Touch targets ≥ 40px for primary controls — chips, card Save/cart squares and dialog Close included.</li>
              <li>:focus-visible — 2px live outline, offset 3px. Never removed.</li>
              <li>Dialogs and sheets trap focus, close on Escape, lock body scroll.</li>
            </ul>
          </Specimen>
          <Specimen name="Behavior">
            <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed">
              <li>
                prefers-reduced-motion: draws render settled, pulses stop, count-ups print final
                values — countdowns keep running (information, not decoration).
              </li>
              <li>Toasts are role=status; icon-only controls carry aria-label.</li>
              <li>Pressed states use aria-pressed; current nav uses aria-current.</li>
              <li>Inline validation appears after blur, announced beside the control.</li>
            </ul>
          </Specimen>
        </div>
      </section>

      <section id="content" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Content</span>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed">
            <li>Microlabels: 2–6 words, uppercase mono — they name regions, not sentences.</li>
            <li>
              Copy is factual and quiet — annotations on a drawing. State what happened and what
              fills the space next. No exclamation marks, no apology.
            </li>
            <li>Money is exact and mono; fees and payouts show their math.</li>
            <li>Dates, countdowns and expiries are server-authoritative — never fake a tick.</li>
          </ul>
        </div>
      </section>

      <section id="engineering" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Engineering</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Tokens & theming">
            <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed">
              <li>
                Tokens only — never hardcode a hex, radius or duration that has one. New values
                require a token in globals.css <b>and</b> a contract update in the Livesheet
                design.md.
              </li>
              <li>
                Night is a token remap — never write a dark-specific component rule beyond the
                photo filter.
              </li>
              <li>
                Theme is the ls-theme cookie stamped pre-paint by the root layout script; don&rsquo;t
                read cookies in layouts that could stay static.
              </li>
            </ul>
          </Specimen>
          <Specimen name="Structure & safety">
            <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed">
              <li>
                Reusable UI lives in src/components/ui and exports through its index.ts — product
                pages and this board import the same source.
              </li>
              <li>
                Server actions re-verify auth themselves; layouts are convenience gates. Admin and
                this microsite 404 — never 403 — to non-members.
              </li>
              <li>Keep the layout primitives (NarrowColumn 720px, .wrap 1200px (semantic: wrap--narrow 720 / wrap--medium 900 / wrap--wide 1060)) — no magic numbers.</li>
            </ul>
          </Specimen>
          <Specimen name="Build gotchas">
            <ul className="list-disc space-y-1.5 pl-5 text-micro leading-relaxed">
              <li>
                Rules added inside @layer components get tree-shaken if unreferenced — declare
                app-global component classes unlayered (see .plate-undrawn).
              </li>
              <li>
                Turbopack dev can serve stale CSS after a globals.css edit — rm -rf .next and
                restart.
              </li>
            </ul>
          </Specimen>
          <Specimen name="Adding a component">
            <ol className="list-decimal space-y-1.5 pl-5 text-micro leading-relaxed">
              <li>Class in globals.css (tokens only).</li>
              <li>React wrapper in src/components/ui if it carries behavior.</li>
              <li>Document it in docs/site/components.md.</li>
              <li>Render a specimen on /docs/components.</li>
            </ol>
          </Specimen>
        </div>
      </section>
    </>
  );
}
