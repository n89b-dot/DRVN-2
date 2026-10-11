import { Button } from "@/components/ui";
import { DocsPagehead, Rule, Specimen } from "../../_components/docs-page";

export const metadata = { title: "Typography" };

/** One specimen row: rendered sample + spec, ruled like everything else. */
function TypeRow({
  tier,
  spec,
  children,
}: {
  tier: string;
  spec: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 items-baseline gap-x-6 gap-y-1 border-t border-rule-soft py-4 first:border-t-0 first:pt-1 sm:grid-cols-[180px_1fr]">
      <div>
        <span className="microlabel !mb-0 block">{tier}</span>
        <span className="text-micro text-dim">{spec}</span>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function TypographyPage() {
  return (
    <>
      <DocsPagehead
        index="03"
        liveWord="Type"
        titleRest="— two faces, one split"
        mdSlug="typography"
        sub="IBM Plex Sans carries everything read or typed at reading size — prose, values, names, prices, inputs. IBM Plex Mono carries labels and data at 12px and under. Every number that ticks or aligns is tabular."
      />

      <div className="deck deck--two">
        <Specimen
          name="IBM Plex Sans"
          klass="--sans · 400 500 600 700"
          note="Loaded via next/font in src/app/layout.tsx. Prose, headings, values, prices, inputs, tabs and secondary buttons."
        >
          <p className="text-head font-semibold leading-tight tracking-tight">
            Parts off real builds
          </p>
          <p className="mt-1 text-body">
            The quick brown fox jumps over the lazy dog — 0123456789
          </p>
        </Specimen>
        <Specimen
          name="IBM Plex Mono"
          klass="--mono · 400 500"
          note="Labels and data at 12px and under: microlabels, chips, counts, timestamps, spec values, and the contained (ink / live) buttons."
        >
          <p className="font-mono text-micro tabular-nums">
            $1,240.00 · 0:41:09 · REF 88-D
          </p>
          <p className="mt-2 font-mono text-micro uppercase tracking-[0.14em] text-dim">
            The quick brown fox — 0123456789
          </p>
        </Specimen>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">The scale</span>
          <span className="microlabel !mb-0">rendered at true size</span>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <TypeRow tier="Display" spec="sans 600 · clamp(32–48) · -0.02em · .pagehead h1">
            <span className="block text-[clamp(32px,4vw,48px)] font-semibold leading-[1.05] tracking-[-0.02em]">
              Your sheet is <span style={{ color: "var(--live)" }}>moving</span>
            </span>
          </TypeRow>
          <TypeRow tier="Num-giant" spec="sans 600 · clamp(40–64) · tabular · .num-giant">
            <span className="num-giant">$4,180</span>
          </TypeRow>
          <TypeRow
            tier="Section head"
            spec="sans 600 · 20px · sentence case · .tile__head > .microlabel--ink"
          >
            <span className="text-section font-[600] leading-[1.3] tracking-[-0.01em]">
              Work orders
            </span>
          </TypeRow>
          <TypeRow tier="H2" spec="sans 600 · 20px · tile heads, prose h2">
            <span className="text-section font-semibold tracking-[-0.01em]">Work orders</span>
          </TypeRow>
          <TypeRow tier="Value" spec="sans 600 · 16px · .bline__val">
            <span className="text-body font-semibold tracking-[-0.01em]">
              KW V3 coilovers, 32k miles
            </span>
          </TypeRow>
          <TypeRow tier="Body" spec="sans 400 · 16px / 24px · body default">
            <span className="text-body">
              Search by part, category or car, and see the build each part came off.
            </span>
          </TypeRow>
          <TypeRow tier="Body-sm" spec="sans 400 · 16px · feed, reviews, spec cells">
            <span className="text-body">
              Offer accepted — payout releases when delivery confirms.
            </span>
          </TypeRow>
          <TypeRow tier="Microlabel" spec="mono 500 · 12px · 0.14em · uppercase · .microlabel">
            <span className="microlabel !mb-0">On this sheet</span>
          </TypeRow>
          <TypeRow tier="Label-nav" spec="mono 400 · 12px · 0.08–0.12em · uppercase · .bar__link / .jumplink / .fbtn">
            <span className="font-mono text-micro uppercase tracking-[0.12em]">
              Marketplace
            </span>
          </TypeRow>
          <TypeRow tier="Label-btn" spec="mono 500 · 12px · uppercase · .btn--live (the only bracketed button) / .btn">
            <span className="flex flex-wrap gap-2">
              <Button variant="live">Buy now</Button>
              <Button>Shop parts</Button>
            </span>
          </TypeRow>
          <TypeRow tier="Label-btn-secondary" spec="sans 500 · 14px · sentence case · .btn--ghost / .btn--destructive">
            <Button variant="ghost">Make an offer</Button>
          </TypeRow>
          <TypeRow tier="Tab" spec="sans 500 · 15px (14 ≤640) · accent underline · .tabstrip">
            <span className="text-[15px] font-medium">Overview · Garage 2 · Parts 1</span>
          </TypeRow>
          <TypeRow tier="Price" spec="sans 600 · 18–20px · tabular · ink — never green">
            <span className="text-[20px] font-semibold tabular-nums">$5,200</span>
          </TypeRow>
          <TypeRow tier="Mono-data" spec="mono 500 · 12px · tabular · .livedim .val (16 in .gsheet__dims) / .spec labels — .spec values are sans 16">
            <span className="font-mono text-micro font-medium tabular-nums">
              214 watching · $1,240.00 · 0:41:09
            </span>
          </TypeRow>
          <TypeRow tier="Mono-meta" spec="mono 400 · 12px · dim · order meta, feed times">
            <span className="font-mono text-micro text-dim">SEP 12 · 14:02 · REF 88-D</span>
          </TypeRow>
        </div>
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Rules</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Always">
            <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed">
              <li>One display heading per page, carrying exactly one live-word.</li>
              <li>Microlabels: 2–6 words, uppercase mono — regions, not sentences.</li>
              <li>Section headlines outweigh every button in their section.</li>
              <li>tabular-nums on every number that ticks or aligns.</li>
              <li>Tracking tightens as size grows; opens on small mono labels.</li>
            </ul>
          </Specimen>
          <Specimen name="Never">
            <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-dim">
              <li>Additional families or faux weights.</li>
              <li>Italics as a system voice.</li>
              <li>Mono above 12px, for prose, or for anything typed — inputs, names, figures.</li>
              <li>Green prices, or brackets on any button but the primary.</li>
              <li>Display type below the pagehead.</li>
            </ul>
          </Specimen>
        </div>
      </section>
    </>
  );
}
