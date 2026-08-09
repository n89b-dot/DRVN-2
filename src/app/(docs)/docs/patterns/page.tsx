import { DocsJumprow, DocsPagehead, Rule, Specimen } from "../../_components/docs-page";

export const metadata = { title: "Patterns" };

const ROUTES = [
  ["Public landing", "/", "band stats, hero callouts, steps 01–03, sheets/parts strips"],
  ["Home (Sheet 01)", "/home", "KPI deck + livedims, work orders, garage tile, feed, week strip"],
  ["Explore", "/explore", "mixed car/part/fresh-entry tiles, filters"],
  ["Marketplace", "/marketplace", "search + fitment switch + filter row + market grid (3→2→1)"],
  ["Listing", "/listings/[id]", "spec table, buy box, off-this-car, keeper livedims, Q&A"],
  ["Car sheet", "/cars/[slug]", "hero callouts, jumprow, KPI tiles, build blines, activity"],
  ["Garage", "/garage", "owner callouts, release-a-part flow, blines --own, documents"],
  ["Sell", "/sell", "draft autosave; photos → part → provenance → condition → price → review"],
  ["Orders", "/orders", "job cards: pipe, dispatch form, payout math; buyer: transit + countdown"],
  ["Cart", "/cart", "review surface only — P20"],
  ["Checkout", "/checkout", "2-step stepper + summary rail — P21"],
  ["Watchlist", "/saved", "watched parts, saved searches, followed sheets"],
  ["Notifications", "/notifications", "actionable rows, policy blines, mail previews"],
  ["Profile", "/u/[username]", "keeper record, grade blines, cars, live listings, reviews"],
  ["Settings", "/settings", "rail + one section at a time (01–05), signals matrix, savebar"],
  ["Auth", "/login · /signup", "420px authwrap, field states, verify capsule"],
  ["Legal", "/terms · /privacy · /fees", "prose + toc"],
  ["Admin console", "/admin/*", "gated — 404 to non-admins; own nav, same tokens"],
  ["This microsite", "/docs/*", "gated like the console; markdown twins at /docs/md/*"],
];

export default function PatternsPage() {
  return (
    <>
      <DocsPagehead
        index="05"
        liveWord="Patterns"
        titleRest="— how sheets compose"
        mdSlug="patterns"
        sub="The route map, the commerce flows lifted from convergent marketplace patterns, and the state ladders every surface follows."
      />

      <DocsJumprow
        items={[
          { href: "#routes", label: "Route map" },
          { href: "#commerce", label: "Commerce" },
          { href: "#empty", label: "Empty states" },
          { href: "#forms", label: "Form states" },
        ]}
      />

      <section id="routes" className="mt-6 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Route map</span>
          <span className="microlabel !mb-0">{ROUTES.length} surfaces</span>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <table className="spec w-full">
            <tbody>
              {ROUTES.map(([name, route, composition]) => (
                <tr key={route}>
                  <td>
                    {name}
                    <span className="mt-0.5 block font-mono text-[10.5px] normal-case tracking-normal">
                      {route}
                    </span>
                  </td>
                  <td className="!text-left !text-[13.5px] text-dim">{composition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="commerce" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Commerce patterns</span>
          <span className="microlabel !mb-0">Mobbin-derived · exact values, copy don&rsquo;t approximate</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--three">
          <Specimen
            name="P20 — Cart"
            klass="/cart"
            note="Etsy + lululemon + Faire convergence. Deliberate divergences: no coupon row, no cross-sell rail."
          >
            <table className="spec w-full">
              <tbody>
                <tr>
                  <td>Surface</td>
                  <td>review only</td>
                </tr>
                <tr>
                  <td>Layout</td>
                  <td>2fr/1fr · gap 24 · stacks &lt;900</td>
                </tr>
                <tr>
                  <td>Rows</td>
                  <td>grouped per seller; Remove only</td>
                </tr>
                <tr>
                  <td>CTA</td>
                  <td>one — &ldquo;Proceed to checkout&rdquo;</td>
                </tr>
                <tr>
                  <td>Address / payment</td>
                  <td>absent — moved to /checkout</td>
                </tr>
              </tbody>
            </table>
          </Specimen>
          <Specimen
            name="P21 — Checkout"
            klass="/checkout"
            note="2 steps, not 4 — email is the account; review lives in the summary rail. Reserved orders reuse the same components."
          >
            <table className="spec w-full">
              <tbody>
                <tr>
                  <td>Steps</td>
                  <td>1 Shipping → 2 Payment</td>
                </tr>
                <tr>
                  <td>Done step</td>
                  <td>collapses to summary + Change</td>
                </tr>
                <tr>
                  <td>Saved cards</td>
                  <td>radio rows · brand · •••• last4</td>
                </tr>
                <tr>
                  <td>New card</td>
                  <td>Stripe Payment Element</td>
                </tr>
                <tr>
                  <td>CTA</td>
                  <td>&ldquo;Pay {"{total}"}&rdquo;</td>
                </tr>
              </tbody>
            </table>
          </Specimen>
          <Specimen
            name="P22 — Payment methods"
            klass="/settings section"
            note="A section, not a page. Remove is immediate + toast — reversible by re-adding."
          >
            <table className="spec w-full">
              <tbody>
                <tr>
                  <td>Row</td>
                  <td>brand · •••• 4242 · 04/28 · Remove</td>
                </tr>
                <tr>
                  <td>Add</td>
                  <td>sheet → Payment Element (SetupIntent)</td>
                </tr>
                <tr>
                  <td>Reassurance</td>
                  <td>cards held by Stripe, not DRVN</td>
                </tr>
              </tbody>
            </table>
          </Specimen>
        </div>
      </section>

      <section id="empty" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">Empty states — the 14-rule digest</span>
        </div>
        <Rule className="mb-4" />
        <div className="deck deck--two">
          <Specimen name="Geometry & values">
            <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed">
              <li>Dashed undrawn plates keep the geometry of the content they stand for.</li>
              <li>
                <span className="kv">—</span> for empty values; <span className="kv">$0.00</span>{" "}
                for empty money.
              </li>
              <li>Waiting copy states fact: &ldquo;No offers yet. Your listing is live.&rdquo;</li>
              <li>Loading is ghost rows with the drawing sweep — never spinners.</li>
              <li>Reconnect freezes the sheet rather than blanking it.</li>
              <li>Errors get an error tile, not a toast.</li>
              <li>Expired/sold desaturates; it does not disappear.</li>
            </ol>
          </Specimen>
          <Specimen name="First-run & edges">
            <ol className="list-decimal space-y-1.5 pl-5 text-[13.5px] leading-relaxed" start={8}>
              <li>First-run: blank-sheet hero, KPI blanks, how-it-fills steps, ghost orders.</li>
              <li>Photoless covers use the undrawn plate language.</li>
              <li>Empty pipelines render at reduced opacity — the shape of work to come.</li>
              <li>Zero-count KPIs still render their livedim, blank variant.</li>
              <li>
                Truncation is explicit: <span className="kv">.clamp2</span> /{" "}
                <span className="kv">.trunc</span>.
              </li>
              <li>Free/zero money renders as money, not as &ldquo;free&rdquo;.</li>
              <li>Every empty state names the action that fills it.</li>
            </ol>
          </Specimen>
        </div>
      </section>

      <section id="forms" className="mt-8 scroll-mt-24">
        <div className="mb-3 flex items-baseline gap-3">
          <span className="microlabel !mb-0">The form-state ladder</span>
        </div>
        <Rule className="mb-4" />
        <div className="tile">
          <p className="text-[13.5px] leading-relaxed">
            Every form handles the full ladder — rest → filled → disabled → required →
            hint/counter → inline error <b>after blur</b> → error summary → async check →
            cross-field → server reject → pending → fail → two-step confirm → undo →
            unsaved-changes → draft restore → optimistic rollback.
          </p>
          <p className="mt-3 text-[13.5px] leading-relaxed text-dim">
            Controls keep a transparent 1px border at rest so validation borders never shift
            layout. Settings uses a dirty-flag + sticky savebar + save toast. Countdowns and
            expiries are server-authoritative.
          </p>
        </div>
      </section>
    </>
  );
}
