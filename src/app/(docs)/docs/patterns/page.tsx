import { DocsJumprow, DocsPagehead, Rule, Specimen } from "../../_components/docs-page";

export const metadata = { title: "Patterns" };

const ROUTES = [
  ["Public landing", "/", "car-led head, two equal actions (Add your car · Shop parts), steps 01–03, builds before a 4-up parts strip, closing “two ways in”"],
  ["Home", "/home", "one-line head + Following / For you, quick post, photo-first feed, rail folding into the feed on a phone"],
  ["Explore", "/explore", "one uniform wall (4:3 photos, KindBadge), segments that fit a phone, trending + builder breakers"],
  ["Marketplace", "/marketplace", "≥1024px: filter panel beside four-across shopping cards; phone: search, then Filters · Category · Sort"],
  ["Listing", "/listings/[id]", "item-sized title over the gallery, one primary action, came-off-this-car, seller as a person; owner panel for the seller"],
  ["Car sheet", "/cars/[slug]", "capped hero, tabs on the first screen, one row shape per build line, for-sale parts"],
  ["Garage", "/garage", "switcher → focused car (dark caption fade), stat strip, tabs: Overview · Mods · Parts · Media"],
  ["Sell", "/sell", "photos first (required to publish) → part → provenance → condition → price; pinned Publish on phones"],
  ["Selling", "/selling", "the seller's workspace: what needs you first, stock and money at a glance; Selling family subnav"],
  ["Import a listing", "/sell/import", "paste a link or the post; review every field before anything publishes"],
  ["Seller listings", "/listings", "nav label My Listings; ledger; one compact card per listing below 860px"],
  ["Orders", "/orders", "Sales first for sellers; rows lead with the part photo; pipe, dispatch, payout math"],
  ["Order detail", "/orders/[id] · /orders/[id]/pickup", "one order, buyer or seller reading; shipping, pickup and return controls; pickup confirmation task page"],
  ["Order placed", "/order-placed", "post-checkout landing — “That's yours.” or “Payment confirming.” before the webhook"],
  ["Cart", "/cart · /cart/complete", "review surface only — P20; /cart/complete is Stripe's return handler (verifies, clears, lands on the order)"],
  ["Checkout", "/checkout", "2-step stepper + summary rail — P21"],
  ["Saved", "/saved", "saved parts, searches and followed sheets; one empty state"],
  ["Notifications", "/notifications", "actionable rows; filters only when there is something to filter"],
  ["Profile", "/u/[username] · /profile", "banner + overlapping avatar, stats (zeros dim), Follow · Store · Share, tabs + rail, store four-across"],
  ["Settings", "/settings · /settings/payouts/return", "one section at a time (picker on phones), Privacy section, per-section Save; payouts on /payouts; the Connect return handler"],
  ["Auth", "/login · /signup · /confirm · /callback · /admin-verify", "420px authwrap on a paper plate, inline field errors, intent carried through; /confirm lands every emailed link, /callback the OAuth return, /admin-verify the admin second factor"],
  ["Legal", "/terms · /privacy · /fees", "prose + toc"],
  ["Not found", "any unknown URL", "shell, page head, search and the two doors"],
  ["Admin console", "/admin/*", "13 pages (incl. cases, invitations) + the export route handler; gated — 404 to non-admins; own nav, same tokens"],
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
                    <span className="mt-0.5 block font-mono text-micro normal-case tracking-normal">
                      {route}
                    </span>
                  </td>
                  <td className="!text-left !text-micro text-dim">{composition}</td>
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
                  <td>2fr/1fr · gap 24 · stacks below lg (1024)</td>
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
            <ol className="list-decimal space-y-1.5 pl-5 text-micro leading-relaxed">
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
            <ol className="list-decimal space-y-1.5 pl-5 text-micro leading-relaxed" start={8}>
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
          <p className="text-micro leading-relaxed">
            Every form handles the full ladder — rest → filled → disabled → required →
            hint/counter → inline error <b>after blur</b> → error summary → async check →
            cross-field → server reject → pending → fail → two-step confirm → undo →
            unsaved-changes → draft restore → optimistic rollback.
          </p>
          <p className="mt-3 text-micro leading-relaxed text-dim">
            Controls keep a transparent 1px border at rest so validation borders never shift
            layout. Settings sections each commit with their own form&apos;s Save (an
            ActionFooter row) and a result note — the sticky .savebar recipe is unused in the
            product. Countdowns and expiries are server-authoritative.
          </p>
        </div>
      </section>
    </>
  );
}
