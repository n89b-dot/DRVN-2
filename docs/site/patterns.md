# Patterns

Page-level patterns: how components compose into the product's surfaces.

## Route map

| Surface | Route | Composition |
| --- | --- | --- |
| Public landing | `/` | car-led pagehead + two equal actions (Add your car · Shop parts), hero media, steps 01–03 (garage → community → market), builds strip before parts strip, band stats, buyer protection |
| Home | `/home` | two columns: the quick post box on top of the feed (Following · For you · Local), and a rail of the few things needing an answer. Seller KPIs live on `/selling`; empty tiles don't render |
| Explore | `/explore` | one uniform-footprint wall of car/part/update cells, segments (All · Builds · Updates · Parts — all public), breakers (trending models, builders) woven in at ≥3 results, search + filters |
| Marketplace | `/marketplace` (+ `[category]`/`[subcategory]`) | search + fitment switch + filter row + `.mkt` grid (3→2→1 cols) |
| Listing | `/listings/[id]` | measured spec table, buy box (capsule + buy/offer), off-this-car, keeper livedims, Q&A |
| Car sheet | `/cars/[slug]` (+ `/activity/[postId]`) | hero callouts, jumprow, KPI tiles, for-sale rowlist, build blines (fitted, then "Came off this car"), activity feed |
| Post without a car | `/posts/[postId]` | W-5. Its own route, not a second rendering of the car-sheet post page: no build to sit inside, no breadcrumb, and the tagged parts ARE the subject. A post that HAS a car redirects to its car URL — one canonical address per post |
| Garage | `/garage?car=` (+ add car, `[id]/edit`; updates at `[id]/update/new` and `[id]/update/[postId]/edit`) | car switcher → focused view: stat strip and tabs (Overview · Mods · Parts · Media) mounting the existing editors. Main car leads |
| Sell | `/sell` | draft autosave; photos → part → provenance → condition → price → review; live preview card + completeness rail |
| Seller listings | `/listings` (seller register) + `/listings/[id]/edit` | ledger of the seller's listings; edit reuses the sell form |
| Messages | `/messages` + `/messages/[orderId]` | per-order threads on the `.msg`/`.thread` idiom |
| Offers | `/offers` + `/offers/[id]` | open work orders, accept/counter/pass |
| Payouts | `/payouts` | payout history + Stripe Connect status |
| Orders (seller) | `/orders` job detail | pipe + dispatch form + payout math + past jobs |
| Orders (buyer) | `/orders` | KPI, transit pipe + countdown, tracking spec, inspection alert, past purchases |
| Cart | `/cart` | review surface only — see P20 |
| Checkout | `/checkout` (+ `/orders/[id]/checkout`) | 2-step stepper — see P21 |
| Watchlist | `/saved` | watched part tiles + saved searches + followed sheets |
| Notifications | `/notifications` | actionable rows, policy blines, mail previews |
| Profile | `/u/[username]` + `/profile` | full-width page: banner band with the avatar overlapping its foot, identity and followers · following · cars below it, actions on the right (Follow · Store · share; the owner gets Edit · Saved · share), trust strip (rating · sold · member since); tabs beside a rail of the garage and parts for sale (`.deck--aside`), rail following the panel below 1024px. Overview = featured build + latest updates as cards; Garage and Updates are card grids. **Parts is the member's store**, rendered exactly like the marketplace, with the statuses decided server-side by who is looking |
| Settings | `/settings` | rail + one section at a time (01–05 indices), signals matrix, savebar |
| Auth | `/login`, `/signup`, `/login/forgot`, `/login/reset`, `/onboarding` | 420px authwrap, field states (there is no verify route) |
| Legal | `/terms`, `/privacy`, `/fees`, `/protection` | `.prose` + `.toc` |
| Admin console | `/admin/*` — 11 routes: admin, audit, disputes, listings, orders, orders/[id], payments, reports, settings, users, users/[id] | gated (404 to non-admins); own nav; same tokens |
| This microsite | `/docs/*` | gated like the console; markdown twins at `/docs/md/*` |

### Navigation order

One register (`src/components/ui/nav-routes.ts`) feeds the desktop rail, the
mobile index and the Selling family subnav. Signed in, the top level is fixed:
**Home · Explore · Marketplace · Garage · Selling · Messages · Profile**, then
Settings. Garage sits above the Selling family because the car is the middle of
the product, while Selling is a workspace entered on purpose; the family's five
children stay expanded beneath their group heading so none costs a second
click. Signed out, the register advertises only Explore and Marketplace —
management surfaces have no signed-out reading.

## Commerce patterns (Mobbin-derived, exact values)

### P20 — Cart (`/cart`)

Cart is a **review surface only** — no address form, no payment fields.

- Two-column grid `2fr / 1fr`, gap 24px, stacks < 900px.
- Item rows grouped per seller under a microlabel header.
- Item row: thumbnail, title, price, Remove — nothing else.
- Summary card: items total, shipping, order total, ONE primary CTA
  ("Proceed to checkout" → `/checkout`, `btn--live`, full width).
- Legal line under the CTA. No coupon row, no cross-sell rail.

### P21 — Checkout (`/checkout`)

- Separate route, reduced chrome ("Secure checkout").
- Steps: **1 Shipping → 2 Payment** (no separate contact/review steps). A
  completed step collapses to a one-line summary with a Change link.
- Persistent order-summary rail right (same 2fr/1fr grid as cart).
- Payment: saved cards as radio rows (brand uppercase · •••• last4 · exp);
  "use a new card" opens the Stripe Payment Element; "Save this card"
  checkbox sets `setup_future_usage`.
- Primary CTA: "Pay {total}". Reserved orders reuse the same components at
  `/orders/[id]/checkout`.

### P22 — Payment methods (Settings section)

- A **section**, not a page: card rows (brand · •••• 4242 · 04/28 · Remove),
  "Add a card" opens a sheet with the Payment Element (SetupIntent).
- Reassurance line: card details held by Stripe, not DRVN.
- Remove is immediate + toast (reversible: re-add).

### P23 — Payment-mode notice

- Commerce surfaces render `PaymentModeNotice` (a `.spec-note` line): while
  Stripe runs on test rails it states "Test mode — no real money moves";
  once payments are live it renders nothing. One shared component, so the
  copy can never claim test mode after money is real.

## Empty states (the 14-rule digest)

1. Dashed `.undrawn` plates, same geometry as the content they stand for.
2. `—` for empty values; **`$0.00` for empty money** (factual, never cute).
3. Waiting copy states fact: "No offers yet. Your listing is live."
4. Loading = ghost rows with the drawing sweep; never spinners.
5. Reconnect freezes the sheet rather than blanking it.
6. Errors get an error tile, not a toast.
7. Expired/sold content desaturates; it does not disappear.
8. First-run: blank-sheet hero, KPI blanks, how-it-fills steps, ghost work
   orders.
9. Photoless listing covers use the undrawn plate (`.plate-undrawn`).
10. Empty pipelines render at reduced opacity — the shape of work to come.
11. Zero-count KPIs still render their livedim, blank variant.
12. Truncation is explicit: `.clamp2` / `.trunc`.
13. Free/zero money renders as money (`$0.00`), not as "free".
14. Every empty state names the action that fills it.

## Form states

The full ladder every form must handle: rest → filled → disabled → required →
hint/counter → inline error **after blur** → summary → async check →
cross-field → server reject → pending → fail → two-step confirm → undo →
unsaved-changes → draft restore → optimistic rollback. Controls keep a
transparent 1px border at rest so validation borders never shift layout.
Settings uses a dirty-flag + sticky `.savebar` + save toast.
