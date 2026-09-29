# Patterns

Page-level patterns: how components compose into the product's surfaces.

## Route map

| Surface | Route | Composition |
| --- | --- | --- |
| Public landing | `/` | car-led pagehead + two equal actions (Add your car → `/signup?next=/garage` · Shop parts; while joining is invite-only the first is Explore builds → `/explore`, since sign-up would end at the invitation notice), hero media capped at 56vh, steps 01–03 (garage → community → market) with working links, builds strip before a four-across parts strip with photos, band stats only once there are 100+ cars and parts, buyer protection, a closing "two ways in" block; the footer links Terms · Privacy · Fees · Protection |
| Home | `/home` | one-line head with Following · For you (· Local) beside it; the quick post box on top of a photo-first feed (`FeedList variant="cards"`, the viewer's own posts left out of For you), and a rail — Your garage, Parts people are watching, Builders to follow — that folds into the feed on a phone, only its last tile sticky. Seller KPIs live on `/selling`; empty tiles don't render |
| Explore | `/explore` | one uniform wall (every photo one frame — 4:3, 3:2 on a phone-width wall — `KindBadge` on each card) of car/part/update cells; segments All · Builds · Updates · Parts · Builders that all fit a phone (`FilterGroup fit`); breakers (trending models, builders with Follow) woven in at ≥3 results; a visitor gets a "Put your car on DRVN" row; search + filters (the page's own scoped search, below the same top bar as everywhere else) |
| Marketplace | `/marketplace` (+ `[category]`/`[subcategory]`, slug aliases; an unknown slug shows the marketplace with a notice) | ≥1024px: a left panel (categories with counts, labelled filters) beside four-across `ListingCard variant="shopping"` cells, vehicle picker on the results row. Phone: search, then one row of Filters · Category · Sort; the first part on the first screen |
| Listing | `/listings/[id]` | item-sized title (`.pagehead--item`) over the gallery (full-screen lightbox); price panel with one primary action, "Came off this car", the seller as a person with a track record; measured spec table, Q&A. The owner sees an owner panel (Edit listing, Offers, views, watching) instead of buyer CTAs. A part a buyer is paying for stays up with a **Reserved** badge and a line explaining the hold (it goes back on sale if the payment doesn't complete). A buyer with a live offer sees "You offered $X — view offer" (or the seller's counter) in place of Make an offer |
| Car sheet | `/cars/[slug]` (+ `/activity/[postId]`) | hero callouts, jumprow, KPI tiles, for-sale rowlist, build blines (fitted, then "Came off this car"), activity feed |
| Post without a car | `/posts/[postId]` | W-5. Its own route, not a second rendering of the car-sheet post page: no build to sit inside, no breadcrumb, and the tagged parts ARE the subject. A post that HAS a car redirects to its car URL — one canonical address per post |
| Garage | `/garage?car=` (+ add car, `[id]/edit`; updates at `[id]/update/new` and `[id]/update/[postId]/edit`) | car switcher → focused view: stat strip and tabs (Overview · Mods · Parts · Media) mounting the existing editors. Main car leads. A part line shows its listing's real state (Draft · For sale · Reserved · Sold); drafts get their own group in Parts with Finish listing |
| Sell | `/sell` | draft autosave; Photos is step 01 (large cover slot, drop area) → part → provenance → condition → price → review; publishing needs a photo (drafts don't); on phones the price and Publish stay pinned. Invite-only accounts get the shared `SellerAccessNotice` (Request seller access · Manage your listings) on `/sell` and `/sell/import` |
| Seller listings | `/listings` (seller register) + `/listings/[id]/edit` | ledger of the seller's listings — below 860px one compact card per listing (photo, title, car, status, then Views · Watch · Asking · Top offer); Pause/Archive/Delete live in the opened row; stacked, a title wraps to two lines. Edit names the listing (title, photo, price) and reuses the sell form; a draft, paused or archived listing gets Publish / Relist there, and a sold or reserved one offers no Delete |
| Messages | `/messages` + `/messages/[orderId]` | per-order threads on the `.msg`/`.thread` idiom |
| Offers | `/offers` + `/offers/[id]` | open work orders, Received · Made (someone who has never listed a part opens on Made); accept/counter/pass. Once the seller counters it's the buyer's turn: the seller can only pass. One live offer per buyer per part — a second attempt is pointed at the first |
| Payouts | `/payouts` | whether a payout account is connected (and the button to set it up), payout history, clearing → available |
| Orders (seller) | `/orders` job detail | opens on Sales for anyone who has listed a part; Sales leaves out checkouts that were never paid (`?status=` still shows everything) and a cancelled sale says "No payout"; rows lead with the part's photo; pipe + dispatch form + payout math + past jobs |
| Orders (buyer) | `/orders` | KPI, transit pipe + countdown, tracking spec, inspection alert, past purchases. An unpaid order says "To pay" and carries Finish checkout (→ `/orders/[id]/checkout`); back from Stripe before the webhook it says "Confirming your payment"; a cancelled unpaid order says "Cancelled — nothing charged". After the 30-day window the report form is gone and the order says when it closed |
| Cart | `/cart` | review surface only — see P20 |
| Checkout | `/checkout` (+ `/orders/[id]/checkout`) | 2-step stepper — see P21 |
| Watchlist | `/saved` | watched part tiles + saved searches + followed sheets |
| Notifications | `/notifications` | actionable rows, policy blines, mail previews |
| Profile | `/u/[username]` + `/profile` | full-width page: banner band with the avatar overlapping its foot, identity and followers · following · cars below it, actions on the right (Follow · Store · share; the owner gets Edit · Saved · share), trust strip (rating · sold · member since); tabs beside a rail of the garage and parts for sale (`.deck--aside`), rail following the panel below 1024px. Overview = featured build + latest updates as cards; Garage and Updates are card grids. **Parts is the member's store**, rendered exactly like the marketplace, with the statuses decided server-side by who is looking |
| Settings | `/settings` | rail + one section at a time (a section picker on phones), Account · Profile · Notifications · Privacy (analytics consent) · Payments · Shipping · Shop · Danger zone, signals matrix, per-section Save; payouts live on `/payouts` |
| Auth | `/login`, `/signup`, `/login/forgot`, `/login/reset`, `/onboarding`, `/logout` | 420px authwrap, field states (there is no verify route). Members-only pages (including `/messages`, `/selling`, `/offers`, `/payouts`, `/listings` and `/listings/[id]/edit`) send a guest to `/login?next=` with the query kept, so signing in returns to the same view; a member already signed in who opens a `/login?next=` link goes straight to that page. Continue with Google shows only while Google is enabled in Supabase (`lib/auth-providers.ts`). Sign-up errors sit under the field they're about and keep the typed email. `/onboarding` (choosing a username) has no Close and can't be skipped — an account without one is sent back to it. `/login/reset` without a live link says it expired and offers Send a new link. `/logout` is POST only |
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
click on selling pages — elsewhere the group stays folded to one row with a count. Signed out, the register advertises only Explore and Marketplace —
management surfaces have no signed-out reading. The cart icon (with its
count) shows to guests too, because guests can check out; notifications and
saved stay member-only. Signed in, the menu (desktop and phone) ends with
Log out.

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
  checkbox sets `setup_future_usage` — members only; a guest has no account
  to keep a card on and isn't offered it.
- Shipping country starts on the United States (listed first, then the UK).
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

## Empty states (the 15-rule digest)

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
14. Every empty state names the action that fills it — ONE message and ONE
    next step. No filter bars, sort controls or search boxes over nothing;
    they appear once there is something to filter.
15. A seller's empty page points at selling, not shopping ("List a part",
    not "Browse the marketplace").

## Form states

The full ladder every form must handle: rest → filled → disabled → required →
hint/counter → inline error **after blur** → summary → async check →
cross-field → server reject → pending → fail → two-step confirm → undo →
unsaved-changes → draft restore → optimistic rollback. Controls keep a
transparent 1px border at rest so validation borders never shift layout.
Settings sections each commit with their own form's Save (an `ActionFooter` row) and a result note; the sticky `.savebar` recipe is currently unused in the product.
