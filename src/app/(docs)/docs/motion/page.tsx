import { DocsJumprow, DocsPagehead, Rule, Specimen } from "../../_components/docs-page";

import { ExpandDemo, PresenceDemo, PressDemo, RevealDemo, SpringComparison } from "./demos";

export const metadata = { title: "Motion" };

const TIMING = [
  { token: "--t-fast / durations.fast", value: "160ms", role: "color, press feedback, small opacity" },
  { token: "--t-standard / durations.standard", value: "240ms", role: "default fades, small state swaps" },
  { token: "--t-move / durations.move", value: "380ms", role: "spatial movement, sheets, reveals" },
  { token: "--t-draw / durations.draw", value: "650ms", role: "narrative drawing — rules, provenance" },
  { token: "--spring / ease", value: "cubic-bezier(0.32, 0.72, 0, 1)", role: "every duration-based transition" },
];

const DISTANCES = [
  { name: "micro", value: "~2px", role: "icon feedback, copied labels" },
  { name: "small", value: "~6px", role: "notes, chips rising in" },
  { name: "medium", value: "~12px", role: "reveals, review tiles" },
  { name: "large", value: "~24px", role: "bottom sheets" },
];

export default function MotionDocsPage() {
  return (
    <>
      <DocsPagehead
        index="07"
        liveWord="Motion"
        titleRest="— machinery, not theater"
        mdSlug="motion"
        sub="One timing language, two renderers: Motion for React drives behavioral and structural animation; CSS keeps the cosmetic transitions it is best at. Precise, mechanical, restrained."
      />

      <DocsJumprow
        items={[
          { href: "#architecture", label: "Architecture" },
          { href: "#timing", label: "Timing" },
          { href: "#springs", label: "Springs" },
          { href: "#recipes", label: "Recipes" },
          { href: "#reduced", label: "Reduced motion" },
          { href: "#rules", label: "When not to animate" },
        ]}
      />

      <section id="architecture" className="mt-6 scroll-mt-24">
        <div className="deck deck--two">
          <Specimen
            name="The boundary"
            note="src/lib/motion is the single source of semantic values. MotionPolicy (root layout) applies reducedMotion='user' globally."
          >
            <p className="text-micro leading-relaxed">
              <strong>Motion for React owns</strong> animation that represents application
              behavior: presence (Dialog, BottomSheet, Toast, ResultNote), expand/collapse,
              staggered orchestration, gesture feedback, layout reflow.
              <br />
              <br />
              <strong>CSS keeps</strong> transitions with no state machine behind them: hover
              and focus color, the skeleton shimmer, pulsing live dots, tooltips, and the
              <code> .is-in</code> draw cascade (dimline rules, the live-word underline). Same
              tokens, so it is one language, not two systems.
            </p>
          </Specimen>
          <Specimen
            name="Personality"
            note="Well-engineered machinery: no overshoot, no rubberiness, no constant motion, nothing that slows a frequent workflow."
          >
            <p className="text-micro leading-relaxed">
              Every animation must communicate hierarchy, continuity, causality, state,
              location, relationship, direct manipulation or progress. If it communicates none
              of those, it does not ship. Travel stays short; springs settle without visible
              oscillation; frequent commerce paths stay response-first.
            </p>
          </Specimen>
        </div>
      </section>

      <section id="timing" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Timing &amp; distance</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Duration classes" klass="src/lib/motion · globals.css --t-*">
            <table className="spec w-full">
              <tbody>
                {TIMING.map((t) => (
                  <tr key={t.token}>
                    <td>
                      {t.token} · {t.value}
                    </td>
                    <td>{t.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Specimen>
          <Specimen name="Travel distances" klass="distances.*" note="Motion suggests mechanism, not travel.">
            <table className="spec w-full">
              <tbody>
                {DISTANCES.map((d) => (
                  <tr key={d.name}>
                    <td>
                      {d.name} · {d.value}
                    </td>
                    <td>{d.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Specimen>
        </div>
      </section>

      <section id="springs" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Springs</span>
        </div>
        <Rule className="mb-4" />
        <Specimen
          name="The four temperaments"
          klass="springs.snappy / responsive / spatial / gentle"
          note="Same distance, four configurations — damping at or near critical, so nothing visibly bounces."
        >
          <SpringComparison />
        </Specimen>
      </section>

      <section id="recipes" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Recipes</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="reveal" klass="Rv / lib/motion reveal" note="Rise + fade at move timing, staggered 70ms per index. Rv adds the is-in class so the CSS draw cascade still fires.">
            <RevealDemo />
          </Specimen>
          <Specimen name="expand" klass="lib/motion expand" note="Height-auto disclosure: offer counter, ledger detail rows, publish checklist.">
            <ExpandDemo />
          </Specimen>
          <Specimen name="presence" klass="ResultNote / Toast / Dialog" note="Feedback enters tied to its cause and exits when cleared — never a pop.">
            <PresenceDemo />
          </Specimen>
          <Specimen name="press" klass="lib/motion press" note="whileTap scale 0.97, snappy spring — engagement row, save/follow.">
            <PressDemo />
          </Specimen>
        </div>
      </section>

      <section id="reduced" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Reduced motion</span>
        </div>
        <Rule className="mb-4" />
        <Specimen
          name="The contract"
          note="Reduced motion removes decoration, never data. Tested, not just implemented."
        >
          <ul className="list-disc pl-5 text-micro leading-relaxed">
            <li>
              <code>MotionPolicy</code> disables Motion-driven transform/layout animation
              app-wide; opacity still transitions so state stays communicated.
            </li>
            <li>
              <code>Rv</code> and narrative reveals render settled immediately, with a timing
              failsafe so content can never stay hidden if an observer never fires.
            </li>
            <li>CSS keeps its own guards for pulses, shimmer, draws and tooltips.</li>
            <li>Countdowns keep ticking — information, not decoration.</li>
          </ul>
        </Specimen>
      </section>

      <section id="rules" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">When not to animate</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Leave it alone">
            <ul className="list-disc pl-5 text-micro leading-relaxed">
              <li>Page navigation by default — object continuity beats page fades.</li>
              <li>Rapid filtering, typing, scrolling — response first, always.</li>
              <li>
                Server-driven status repaints with no client state change (OrderPipeline renders
                a fresh page; nothing “changes” on screen).
              </li>
              <li>Hover tints and focus rings — CSS already does this best.</li>
            </ul>
          </Specimen>
          <Specimen name="No animation debt" note="One-off duration/spring values in feature code are debt — promote recurring values into src/lib/motion.">
            <p className="text-micro leading-relaxed">
              Feature code spreads recipes (<code>press</code>, <code>expand</code>,
              <code> reveal</code>…) or composes <code>springs.*</code> +
              <code> transitions.*</code>. A bespoke value is acceptable only for a genuinely
              unique interaction, with a comment saying why.
            </p>
          </Specimen>
        </div>
      </section>
    </>
  );
}
