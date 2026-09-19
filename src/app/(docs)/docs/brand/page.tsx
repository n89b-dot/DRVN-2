import { DocsJumprow, DocsPagehead, Rule, Specimen } from "../../_components/docs-page";

export const metadata = { title: "Brand" };

const DAY_SWATCHES = [
  { name: "paper", hex: "#EFEDE6", role: "canvas" },
  { name: "paper-deep", hex: "#E5E2D8", role: "recessed" },
  { name: "tile", hex: "#F8F6F0", role: "raised plate" },
  { name: "tile-2", hex: "#F1EFE8", role: "secondary plate" },
  { name: "ink", hex: "#20232A", role: "text / inverted" },
  { name: "dim", hex: "#565963", role: "secondary text" },
  { name: "live", hex: "#C02C14", role: "THE signal" },
  { name: "ok", hex: "#256B42", role: "settled / verified" },
  { name: "warn", hex: "#8A5A00", role: "held / due" },
  { name: "img-fallback", hex: "#E2DFD5", role: "media fallback" },
];

// Cooler paper since September 2026 (PRD 2026-09 §3); the accent and the
// status hues are unchanged.
const NIGHT_SWATCHES = [
  { name: "paper", hex: "#121418", role: "canvas" },
  { name: "paper-deep", hex: "#0C0E11", role: "recessed" },
  { name: "tile", hex: "#1C1F25", role: "raised plate" },
  { name: "tile-2", hex: "#171A1F", role: "secondary plate" },
  { name: "ink", hex: "#ECEEF2", role: "text / inverted" },
  { name: "dim", hex: "#8A909B", role: "secondary text" },
  { name: "live", hex: "#FF4530", role: "THE signal" },
  { name: "ok", hex: "#57B983", role: "settled / verified" },
  { name: "warn", hex: "#D9A13C", role: "held / due" },
  { name: "img-fallback", hex: "#22262D", role: "media fallback" },
];

function SwatchGrid({ swatches, onDark }: { swatches: typeof DAY_SWATCHES; onDark?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
      {swatches.map((swatch) => (
        <div key={swatch.name}>
          <div
            className="h-14 rounded-ctl"
            style={{
              background: swatch.hex,
              boxShadow: onDark
                ? "inset 0 0 0 1px rgba(236,238,242,0.12)"
                : "inset 0 0 0 1px rgba(32,35,42,0.09)",
            }}
          />
          <div className="kv mt-1.5 block">{swatch.name}</div>
          <div className="text-micro text-dim">
            {swatch.hex} · {swatch.role}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BrandPage() {
  return (
    <>
      <DocsPagehead
        index="01"
        liveWord="Brand"
        titleRest="— the mark, the voice, the palette"
        mdSlug="brand"
        sub="DRVN is typography, not a drawn logo: an uppercase wordmark with one live full stop, speaking in workshop-quiet annotations."
      />

      <DocsJumprow
        items={[
          { href: "#mark", label: "Wordmark" },
          { href: "#voice", label: "Voice" },
          { href: "#palette", label: "Palette" },
          { href: "#surfaces", label: "Surfaces" },
          { href: "#photography", label: "Photography" },
        ]}
      />

      <div id="mark" className="deck deck--two mt-6 scroll-mt-24">
        <Specimen
          name="The wordmark"
          klass=".bar__logo idiom"
          note="Always uppercase, IBM Plex Sans 600, tight tracking. The terminal dot is set in the live color — the recording light on the sheet. Beside it, chrome may carry a mono microlabel."
        >
          <div className="flex items-end gap-6">
            <span className="text-display font-semibold leading-none tracking-tight">
              DRVN<em className="not-italic" style={{ color: "var(--live)" }}>.</em>
            </span>
            <span className="microlabel !mb-1">Builds and parts</span>
          </div>
        </Specimen>
        <Specimen
          name="Compact mark"
          klass=".monogram"
          note="No separate icon mark exists. In tight spaces (favicon, avatar fallback) use a D on an ink plate, radius 10px."
        >
          <div className="flex items-center gap-4">
            <span className="monogram">D</span>
            <span className="monogram monogram--sm">D</span>
          </div>
        </Specimen>
      </div>

      <section id="voice" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Voice</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen
            name="Say"
            note="Factual, workshop-adjacent, quiet. Copy reads like annotations on a drawing."
          >
            <ul className="space-y-2 text-micro leading-relaxed">
              <li>&ldquo;3 offers open&rdquo;</li>
              <li>&ldquo;No offers yet. Your listing is live.&rdquo;</li>
              <li>
                &ldquo;$0.00&rdquo; <span className="text-dim">— zero money is still money</span>
              </li>
              <li>
                <span className="microlabel !mb-0">Work orders</span>{" "}
                <span className="text-dim">— microlabels name regions, 2–6 words</span>
              </li>
            </ul>
          </Specimen>
          <Specimen name="Never say" note="No exclamation marks, no apology, no fake liveness.">
            <ul className="space-y-2 text-micro leading-relaxed text-dim">
              <li className="line-through">&ldquo;You&rsquo;ve got offers!&rdquo;</li>
              <li className="line-through">&ldquo;Oops, nothing here!&rdquo;</li>
              <li className="line-through">&ldquo;Free!!&rdquo;</li>
              <li className="line-through">Decorative pulsing on things that aren&rsquo;t live</li>
            </ul>
          </Specimen>
        </div>
      </section>

      <section id="palette" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Palette</span>
          <span className="microlabel !mb-0">Night is a token remap, never a second stylesheet</span>
        </div>
        <Rule className="mb-4" />
        <div className="stack space-y-4">
          <Specimen name="Day — paper" klass=":root">
            <SwatchGrid swatches={DAY_SWATCHES} />
          </Specimen>
          <section className="tile" style={{ background: "#121418" }}>
            <div className="tile__head">
              <span className="microlabel !mb-0" style={{ color: "#8A909B" }}>
                Night — the drawing office after hours
              </span>
              <span className="kv" style={{ color: "#ECEEF2" }}>
                [data-theme=&quot;dark&quot;]
              </span>
            </div>
            <div style={{ color: "#8A909B" }}>
              <SwatchGrid swatches={NIGHT_SWATCHES} onDark />
            </div>
          </section>
          <Specimen
            name="The one-accent contract"
            note="Live red is earned only by things happening right now — plus at most one primary CTA per surface and one live-word per h1. A second accent is banned; status colors are never navigation."
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="chip chip--live">Live</span>
              <span className="chip chip--ok">Settled</span>
              <span className="chip chip--warn">Held</span>
              <span className="chip chip--ink">Ink</span>
              <span className="chip chip--spent">Spent</span>
            </div>
          </Specimen>
        </div>
      </section>

      <section id="surfaces" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Surfaces</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen
            name="Tonal separation"
            note="Plates separate by tone, never borders or shadows. The body carries a faint 40px graticule — the drafting sheet itself."
          >
            <div className="flex gap-3">
              <div className="grid h-20 flex-1 place-items-center rounded-r bg-paper text-micro text-dim">
                paper
              </div>
              <div className="grid h-20 flex-1 place-items-center rounded-r bg-paper-deep text-micro text-dim">
                paper-deep
              </div>
              <div className="grid h-20 flex-1 place-items-center rounded-r bg-tile text-micro text-dim">
                tile
              </div>
            </div>
          </Specimen>
          <Specimen
            name="Hairlines"
            note="rule-soft and rule-mid rule rows inside plates; dimline is reserved for dimension and leader lines — never card borders."
          >
            <div className="space-y-4 pt-2">
              <div style={{ borderTop: "1px solid var(--rule-soft)" }} className="pt-1 text-micro text-dim">
                rule-soft — ruled rows
              </div>
              <div style={{ borderTop: "1px solid var(--rule-mid)" }} className="pt-1 text-micro text-dim">
                rule-mid — footers, mail frames
              </div>
              <div style={{ borderTop: "1px dashed var(--dimline)" }} className="pt-1 text-micro text-dim">
                dimline — dimension &amp; leader lines only
              </div>
            </div>
          </Specimen>
        </div>
      </section>

      <section id="photography" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Photography</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen
            name="Documentary, framed"
            note="Real cars, real parts, garage light — no studio gradients, no lifestyle stock. Media sits in rounded frames (16px outer, 10px inner) on the img-fallback tone while loading. In night, photos take brightness(0.86) contrast(1.05) so they sit into the sheet."
          >
            <div className="tile__img aspect-[3/2]" />
          </Specimen>
          <Specimen
            name="The undrawn plate"
            klass=".plate-undrawn"
            note="A listing without a photo is not an error — it renders as a plate nobody has drawn yet: dashed construction rule, cross-hair mark."
          >
            <div className="plate-undrawn aspect-[3/2] rounded-ctl" />
          </Specimen>
        </div>
      </section>
    </>
  );
}
