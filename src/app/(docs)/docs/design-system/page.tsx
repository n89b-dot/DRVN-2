import Link from "next/link";

import { DocsJumprow, DocsPagehead, Rule, Specimen } from "../../_components/docs-page";

export const metadata = { title: "Design system" };

const RADII = [
  { token: "--r", value: "16px", role: "tiles, sheets, hero media, dropzones, band" },
  { token: "--r-ctl", value: "10px", role: "buttons, controls, inner media, monograms" },
  { token: "--r-chip", value: "6px", role: "chips, badges, stamps" },
  { token: "--r-meter", value: "3px", role: "bars and tracks" },
];

const MOTION = [
  { token: "--spring", value: "cubic-bezier(0.32, 0.72, 0, 1)", role: "everything that moves" },
  { token: "--t-fast", value: "160ms", role: "color / background / press" },
  { token: "--t-move", value: "380ms", role: "tiles, sheets, orders, toast travel" },
  { token: "--t-draw", value: "650ms", role: "rules drawing themselves in" },
  { token: "stagger", value: "70ms / index", role: "reveal groups" },
  { token: "pulse", value: "2.2s infinite", role: "live dots" },
  { token: "count-up", value: "900ms ease-out", role: "[data-count] numerals" },
  { token: "toast dwell", value: "2600ms", role: ".toast" },
];

export default function DesignSystemPage() {
  return (
    <>
      <DocsPagehead
        index="02"
        liveWord="Livesheet"
        titleRest="— a drawing that knows what's happening"
        mdSlug="design-system"
        sub="Warm drafting-paper surfaces, ruled and precise, whose annotations are alive. How the system actually functions: tokens, theming, geometry, motion."
      />

      <DocsJumprow
        items={[
          { href: "#concept", label: "Concept" },
          { href: "#tokens", label: "Tokens" },
          { href: "#theming", label: "Theming" },
          { href: "#geometry", label: "Geometry" },
          { href: "#motion", label: "Motion" },
          { href: "#states", label: "States" },
          { href: "#files", label: "File map" },
        ]}
      />

      <section id="concept" className="mt-6 scroll-mt-24">
        <div className="deck deck--two">
          <Specimen
            name="The concept"
            note="Every page is a sheet — a drafting drawing of the user's world. Content sits on raised plates over a papery canvas with a faint 40px graticule. Mono microlabels annotate; the one accent marks what's happening right now."
          >
            <p className="text-[13.5px] leading-relaxed">
              The system&rsquo;s signature is the <strong>livedim</strong> — a value measured the
              way a draftsman dimensions a part: spine, ticks, microlabel, mono value. When the
              value is live it turns red and its dot pulses.
            </p>
          </Specimen>
          <Specimen name="The signature, live" klass=".livedim">
            <div className="flex flex-wrap gap-8 pt-1">
              <div className="livedim">
                <span className="microlabel">Watching now</span>
                <span className="val">214</span>
              </div>
              <div className="livedim livedim--live">
                <span className="microlabel">Offer expires</span>
                <span className="val">0:41:09</span>
              </div>
              <div className="livedim livedim--blank">
                <span className="microlabel">Top offer</span>
                <span className="val">—</span>
              </div>
            </div>
          </Specimen>
        </div>
      </section>

      <section id="tokens" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Token architecture</span>
          <span className="microlabel !mb-0">src/app/globals.css</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen
            name="Layer 1 — scale tokens"
            klass="@theme"
            note="Declared in Tailwind v4 @theme so they become utilities: bg-paper, text-ink, text-dim, bg-tile, rounded-r… Colors, the two font stacks, and the radius scale."
          >
            <div className="kv">
              paper · paper-deep · tile · tile-2 · ink · dim · live · ok · on-ink · img-fallback
            </div>
          </Specimen>
          <Specimen
            name="Layer 2 — alpha + state tokens"
            klass=":root vars"
            note="Plain custom properties used via var(...) in component CSS, remapped wholesale for night."
          >
            <div className="kv">
              dimline · grid-line · live-tint · ok-tint · warn · scrim · ink-hover · live-hover ·
              ghost-hover · rule-soft · rule-mid · ghost · ghost-strong · photo-filter
            </div>
          </Specimen>
        </div>
      </section>

      <section id="theming" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Theming — day and night</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen
            name="Night is a token remap"
            klass='[data-theme="dark"]'
            note="Same variable names, different values, declared once on <html>. No component rule is duplicated for dark — the only dark-specific rules are the photo filter and the theme-pip fill. Try the toggle in the bar above."
          >
            <table className="spec w-full">
              <tbody>
                <tr>
                  <td>Cookie</td>
                  <td>ls-theme = day | night</td>
                </tr>
                <tr>
                  <td>Stamped</td>
                  <td>pre-paint, inline script in root layout</td>
                </tr>
                <tr>
                  <td>Default</td>
                  <td>prefers-color-scheme, first visit only</td>
                </tr>
                <tr>
                  <td>Photos at night</td>
                  <td>brightness(0.86) contrast(1.05)</td>
                </tr>
              </tbody>
            </table>
          </Specimen>
          <Specimen
            name="Why an inline script"
            note="The script mirrors the cookie before any CSS paints, so there's no theme flash — without calling cookies() in the root layout, which would opt every static route into dynamic rendering."
          >
            <p className="text-[13.5px] leading-relaxed text-dim">
              Layouts that await nothing (legal, docs pages once cached) stay statically
              renderable; the toggle rewrites the DOM attribute and the cookie together.
            </p>
          </Specimen>
        </div>
      </section>

      <section id="geometry" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Geometry</span>
          <span className="microlabel !mb-0">radius descends with size — nothing is a pill</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="The radius scale" klass="--r / --r-ctl / --r-chip / --r-meter">
            <table className="spec w-full">
              <tbody>
                {RADII.map((radius) => (
                  <tr key={radius.token}>
                    <td>
                      {radius.token} · {radius.value}
                    </td>
                    <td>{radius.role}</td>
                  </tr>
                ))}
                <tr>
                  <td>50% circles</td>
                  <td>ONLY live dots, pips, thumb-remove badges</td>
                </tr>
              </tbody>
            </table>
          </Specimen>
          <Specimen
            name="Layout constants"
            note="Separation is tonal — no borders, shadows, glass or gradients. Hairlines rule rows inside plates."
          >
            <table className="spec w-full">
              <tbody>
                <tr>
                  <td>Max width</td>
                  <td>1200px (.wrap)</td>
                </tr>
                <tr>
                  <td>Grid gap</td>
                  <td>14px (.deck — the one gap)</td>
                </tr>
                <tr>
                  <td>Tile padding</td>
                  <td>18px</td>
                </tr>
                <tr>
                  <td>Section bottom</td>
                  <td>clamp(48px, 7vw, 80px)</td>
                </tr>
                <tr>
                  <td>Narrow column</td>
                  <td>540px (profile-type surfaces)</td>
                </tr>
              </tbody>
            </table>
          </Specimen>
        </div>
      </section>

      <section id="motion" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Motion</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Timing tokens" klass="--spring / --t-*">
            <table className="spec w-full">
              <tbody>
                {MOTION.map((motion) => (
                  <tr key={motion.token}>
                    <td>
                      {motion.token} · {motion.value}
                    </td>
                    <td>{motion.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Specimen>
          <Specimen
            name="Behavior components, hooks & reduced motion"
            note="prefers-reduced-motion: reveals render settled, pulses stop, count-ups print final values — countdowns keep running (information, not decoration)."
          >
            <table className="spec w-full">
              <tbody>
                <tr>
                  <td>Rv</td>
                  <td>IO reveal wrapper, 70ms stagger (livesheet.tsx)</td>
                </tr>
                <tr>
                  <td>LiveDim</td>
                  <td>measured value — live red + pulsing dot, blank dashed spine</td>
                </tr>
                <tr>
                  <td>Countdown</td>
                  <td>server-authoritative H:MM:SS from expiresAt</td>
                </tr>
                <tr>
                  <td>useFinePointer</td>
                  <td>pointer-precision gate (src/lib/hooks)</td>
                </tr>
                <tr>
                  <td>useReducedMotion</td>
                  <td>prefers-reduced-motion flag (src/lib/hooks)</td>
                </tr>
                <tr>
                  <td>useKonamiCode</td>
                  <td>easter-egg key sequence (src/lib/hooks)</td>
                </tr>
              </tbody>
            </table>
          </Specimen>
        </div>
      </section>

      <section id="states" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Empty, loading, edge</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen
            name="Undrawn, not absent"
            klass=".undrawn / .ghostrow"
            note="Empty regions keep the geometry of real content; loading is ghost rows with a drawing sweep — never spinners. Spent content desaturates, it does not disappear."
          >
            <div className="undrawn">
              <span className="undrawn__mark" aria-hidden="true" />
              <h3>No offers yet</h3>
              <p>Your listing is live. Offers land here as work orders.</p>
            </div>
          </Specimen>
          <Specimen
            name="Value rules"
            note="Empty values print an em dash; empty money prints $0.00 — factual, never cute."
          >
            <div className="flex flex-wrap gap-8 pt-1">
              <div className="livedim livedim--blank">
                <span className="microlabel">Watchers</span>
                <span className="val">—</span>
              </div>
              <div className="livedim">
                <span className="microlabel">Held</span>
                <span className="val">$0.00</span>
              </div>
              <div className="livedim">
                <span className="microlabel">Sold</span>
                <span className="val">
                  <span className="chip chip--spent">Spent</span>
                </span>
              </div>
            </div>
          </Specimen>
        </div>
      </section>

      <section id="files" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">File map</span>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <table className="spec w-full">
            <tbody>
              <tr>
                <td>Production tokens + component CSS</td>
                <td>src/app/globals.css</td>
              </tr>
              <tr>
                <td>Source contract</td>
                <td>
                  design-mockups/livesheet/design.md —{" "}
                  <Link className="jumplink" href="/docs/md/livesheet-design-md">
                    read ↗
                  </Link>
                </td>
              </tr>
              <tr>
                <td>Component inventory</td>
                <td>
                  docs/livesheet-inventory.md —{" "}
                  <Link className="jumplink" href="/docs/md/livesheet-inventory">
                    read ↗
                  </Link>
                </td>
              </tr>
              <tr>
                <td>React chrome + primitives</td>
                <td>src/components/ui/</td>
              </tr>
              <tr>
                <td>Theme bootstrap</td>
                <td>src/app/layout.tsx</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
