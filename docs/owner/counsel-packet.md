# DRVN: briefing for counsel

Prepared 4 October 2026 from the code and the project's own records, for a
lawyer reading it cold. It describes what the product does today, not what it
should do. Every section ends with where it lives, so an engineer can confirm
any statement. The questions we need answered are in §12.

Two companion documents:

- `docs/legal-review-checklist.md`: the original list of open legal points.
- `docs/owner/retention-proposal.md`: a proposed retention schedule for your
  review.

The draft terms and privacy policy are at `/terms` and `/privacy` on the site
(source: `src/app/(legal)/terms/page.tsx`, `src/app/(legal)/privacy/page.tsx`).

---

## 1. What DRVN is

A website for people who modify cars. Members show their cars and build
projects, post about them, follow each other, and buy and sell parts. The
marketplace is peer-to-peer: individual members and self-declared "shops"
list parts; DRVN never owns stock. The terms state that DRVN is not the
seller and that the contract of sale is between buyer and seller.

- **Stage:** pre-launch. The next step is an **invited beta with real
  money**: only people with an invitation can sign up, buy or sell. Browsing
  is public.
- **Market:** described internally as UK-first, but every price is in **US
  dollars** (the database accepts only USD), and checkout accepts addresses in
  any country, listing the US first. Which jurisdiction(s) the terms target
  is undecided (§12, Q1).
- **Operator:** no legal entity is named anywhere yet. The pages say "DRVN".

Where: product definition `docs/DRVN-PRD-2026-09.md`; currency
`src/lib/geo/countries.ts`, listing/order currency constraint (migration
`20261004130000_checkout_charge_bounds.sql`).

## 2. The parties

| Party | Role |
|---|---|
| DRVN (operator, entity TBD) | Runs the platform, holds the Stripe platform account, buys postage, decides disputes it is asked to step into |
| Member | Account holder: email + password, or Google sign-in. Must be 18+ per the terms (not checked at signup) |
| Seller | A member who lists parts. Must set up a Stripe Express connected account before a listing can go live while live payments are on |
| Shop | A seller who switched their profile to "shop" (self-declared). A separate "verified" badge is granted by hand. No business or VAT details are collected |
| Buyer | A member, or a **guest** who checks out with an email address (§7) |
| Admin | DRVN staff in the admin console. Membership is set in the database only; admins must use two-factor sign-in. Admins can read any conversation |
| Processors | Listed in §5 |

Where: shops `docs/production-runbook.md` §11; admins `src/lib/admin/`,
migration `0018_admin.sql`; seller payout requirement in the terms §3.

## 3. Money

### 3.1 Who takes the money

DRVN uses Stripe Connect with **separate charges and transfers**:

1. The buyer pays **DRVN's Stripe platform account**. One payment can cover
   orders from several sellers.
2. Later, DRVN **transfers** each seller's share to that seller's Stripe
   Express account. Stripe then pays the seller's bank on its own schedule.

So DRVN's Stripe account is the account that charges the card, and DRVN holds
the funds between charge and transfer. The terms currently say "payments go
through DRVN's payment processor, Stripe". How DRVN's role should be described
(and whether that has regulatory consequences) is §12, Q4.

Card details go straight from the browser to Stripe; DRVN never sees them. A
saved card is stored at Stripe and DRVN keeps only Stripe's reference.

Where: `src/lib/payments/stripe.ts` (PaymentIntent creation),
`src/lib/payments/settlement.ts` (webhook handling), transfers worker
`src/app/api/jobs/transfers/`.

### 3.2 What the buyer pays

Item price plus the seller's shipping, both shown before payment. Nothing is
added at checkout. **No sales tax or VAT** is calculated or collected anywhere
(no Stripe Tax). A charge must be between $0.50 and $999,999.99.

Starting checkout holds the part for 15 minutes. An offer lapses after 72
hours; an accepted offer doesn't charge anything, it holds the part for 24
hours for the buyer to check out at the agreed price.

### 3.3 Fees

DRVN charges **10% of the sale total, including shipping**, deducted from the
seller's payout. There is no other DRVN fee. Stripe's processing fees and
chargeback fees are **not** passed on: under this charge model DRVN bears them.

Where: `PLATFORM_FEE_BPS = 1000` in `src/lib/payments/fee.ts`; fee page
`/fees`.

### 3.4 Postage bought through DRVN

If DRVN Shipping is on, a seller can buy a tracked label through DRVN. DRVN's
EasyPost account pays for it, and the cost is recorded against the seller and
taken out of that seller's payout. If the payout is too small (or was already
made), the amount owed is **carried forward** and kept back from the seller's
next payouts, in an append-only ledger (`seller_carry_entries`, added 5
October 2026). A refunded label is credited back. A return label for a
problem the seller caused is also charged to the seller.

Two gaps: a carry-forward balance in the seller's **favour** is never paid
out today, and the ledger isn't yet in the member's data export.

Where: `src/lib/shipping/`, migration `20261005110100_seller_carry_forward.sql`,
`docs/production-runbook.md` §10.

### 3.5 Holding and paying out

A sale is paid out a set time **after delivery**. Delivery is set by the buyer
confirming arrival, by a carrier "delivered" scan, or by the seller scanning
the buyer's Pickup Pass at collection. If a problem is open on the order, the
payout waits for the outcome.

The hold is an owner setting, **7 days by default**. It can be a fixed number
of days (0–30), or "window-based": paid only once the 30-day problem window
and the shop's own return window have both closed. The owner has not chosen
yet; the engineer's recommendation is window-based at launch. The terms read
the live value, so the sentence in terms §6 changes with it.

Note the timing with the default: a buyer can report a problem for **30
days** after delivery, and a shop may offer change-of-mind returns for 14, 30
or 60 days, but the seller is paid on **day 7**. A later refund is then
recovered from the seller's Stripe account (§3.6).

A posted parcel with no DRVN-tracked number never gets a carrier scan. If the
buyer never confirms, it is never delivered and the seller never paid. A rule
that marks such orders delivered N days after dispatch (with an in-app warning
to the buyer 3 days before) is built but **off**; the owner picks N or leaves
it off. If turned on, the terms need to say so.

Where: `public.settlement_settings` and `src/lib/payments/payout-hold.ts`
(migration `20261006100000`); auto-confirm migration `20261006100100`;
decision records `docs/decisions/payout-hold.md`,
`docs/decisions/untracked-auto-confirm.md`; payout clock migrations
`20261004120000`, `20261004140000`.

### 3.6 Refunds

Refunds go back to the original payment method from DRVN's platform account.
DRVN's fee is refunded in the same proportion as the sale. The seller's share
is refunded in proportion too: if the seller was already paid, that amount is
**reversed** from the seller's Stripe account. If a reversal fails (for
example the seller's balance is empty), the shortfall is carried forward
(§3.4) and an operator case opens; an admin can write a loss off. Whether
sellers owe DRVN such amounts, and how the terms say so, is §12, Q6.

A seller can cancel before dispatch (full refund). Every refund belongs to a
recorded business request, so retries can't pay twice.

Where: `src/lib/payments/`, migrations `0026_money_durability.sql`,
`20261004110000_refund_request_keys.sql`; `docs/remediation-refund-recovery.md`.

### 3.7 Problems, DRVN's decisions and chargebacks

- A buyer reports a problem (not arrived, damaged, not as described, wrong
  item) within 30 days of delivery, or any time if it never arrived.
- The seller has 3 days to respond (partial refund, full refund, or return).
  After that the buyer can ask DRVN to step in. DRVN reviews the order record
  and both sides' evidence and **decides how the money on the order moves**.
  If the seller ignores the problem, the buyer is refunded automatically on
  day 10.
- Returns are posted with tracking within 7 days; the seller has 48 hours
  after delivery to raise a problem with what came back.
- **Chargebacks:** if the buyer disputes the payment with their card issuer,
  the dispute is against DRVN's platform account. The order is frozen until
  it closes. If the buyer wins, the refund comes out of the seller's share as
  in §3.6. The automatic day-10 refund skips orders under a chargeback.

The terms say DRVN's decision settles how money moves but doesn't remove
anyone's legal rights.

Where: `src/features/commerce/disputes.ts` (30 / 3 / 10 days),
`src/lib/domain/return-policy.ts` (7 days / 48 hours), dispute handling in
`src/lib/payments/settlement.ts`; buyer-facing explanation at `/protection`.

## 4. Data held

In short: account (email, username, display name, sign-in method), optional
profile (bio, free-text location, country, region, links, avatar), cars
(including VIN if added), photos, posts, comments, follows, listings, reviews,
reports, messages (including photos), orders (name, delivery address, phone
given at checkout; seller ship-from and return address and phone), offers,
refunds, returns, disputes and evidence photos, payout status, and listing
imports (the page text fetched from another site and the draft made from it).

Points to note:

- **VIN** is private to the owner (database column privileges, since 4 October).
- **Photos**: public photos and message photos are re-encoded on the server,
  which strips embedded location data. **Dispute evidence** is kept exactly
  as uploaded, on purpose.
- **Staff access**: admins can read any conversation and see orders and
  evidence. Messages are not end-to-end encrypted. The policy says so.
- **Abuse limits** use a keyed one-way hash of the network address, never the
  raw address.

Field-by-field inventory: `docs/remediation-data-inventory.md`; export
contract `src/lib/account-export-contract.ts`.

## 5. Processors and other recipients

Derived from the code. "Status" says whether it is in use for the beta.

| Recipient | What it gets | Why | Status | Where |
|---|---|---|---|---|
| Supabase | Everything above (database, sign-in, file storage); sends the auth emails via the SMTP provider | Core platform | In use. Region of the production project not yet chosen | `src/lib/supabase/` |
| Hosting provider (Vercel assumed) | All requests; request logs | Runs the app | To be set up | `docs/staging-setup.md` §4 |
| Email delivery provider (not chosen) | Recipient email, the email content (sign-in and order-access links) | Auth emails | To be chosen | `docs/owner/email-provider.md` |
| Stripe | Buyer email and DRVN account reference, card data (direct from browser), order references; sellers give identity and bank details to Stripe directly | Payments, saved cards, payouts (Connect) | In use (test mode) | `src/lib/payments/` |
| EasyPost | Sender and recipient names, addresses, phones, parcel details (not emails) | Labels and tracking | Optional | `src/lib/shipping/easypost.ts` |
| Anthropic | Text of a public web page a seller imports (not photos, not account data) | Draft a listing | Optional | `src/lib/listing-import/` |
| Sentry | Server error reports, which can include an account id; email, address, phone and credential fields stripped | Error monitoring | Required in live mode | `src/lib/monitoring.ts` (`scrubTelemetry`) |
| PostHog (default host `us.i.posthog.com`) | Opt-in only: feature-use counts linked to account id; never message text, addresses, payment details or search text; no session recording | Product analytics | Optional | `src/lib/analytics.ts` |
| Search provider (Typesense) | Public listings, cars and profile names | Search | Optional | `src/lib/search/` |
| NHTSA vPIC (US government) | A VIN the member enters | Decode the car | In use | `src/lib/vehicles/vpic.ts` |
| Google | Only for members who choose Google sign-in | Sign-in | Optional | `src/app/(auth)/oauth-button.tsx` |
| YouTube (`youtube-nocookie.com`) | The visitor's browser loads an embedded video when a post contains one, so the visitor's IP reaches Google | Video embeds in posts | In use | `src/features/activity/blocks-view.tsx` |
| Operator alert destination (e.g. Slack webhook) | Order ids and amounts in alerts | Operations | Required in live mode | `src/lib/admin/alerts.ts`, `ADMIN_ALERT_WEBHOOK_URL` |
| Other members | Public profile content; for a transaction, the seller sees the buyer's delivery details; both sides see the order, messages and evidence | The service | In use | RLS policies in `supabase/migrations/` |
| Third-party websites | The listing importer fetches the public page a seller links to (e.g. a Facebook Marketplace or forum page) | Listing import | Optional | `src/lib/listing-import/fetch/` |

The YouTube embed is not mentioned in the privacy policy today (§12, Q13).

## 6. Cookies and consent

Cookies set by DRVN: sign-in (`sb-…`, essential), cart (`drvn_cart`, 30
days), guest checkout (`drvn_guest_orders` 6 hours, `drvn_checkout_identity`
24 hours, both signed), analytics choice (`drvn_analytics_consent`, 180
days), display preferences (`ls-theme`, `ls-rail`, `ls-mkt`, one year), time
zone (`drvn-tz`, one year). The browser also stores an unsent post draft and
a short note of which listings were viewed (to count views once).

Analytics is **off unless the member opts in** under Settings → Privacy. The
opt-in lapses after 180 days. There is **no consent banner**, on the basis
that nothing optional runs without the opt-in. No advertising trackers. The
YouTube embed (§5) is the one third-party load that happens without a choice.

Where: `src/lib/cart.ts`, `src/lib/guest-checkout.ts`,
`src/app/(product)/settings/analytics-consent-actions.ts`; policy section
"Cookies and storage".

## 7. Guest checkout

A visitor can buy with just an email address. That creates an **unconfirmed,
passwordless account** for the address (orders must belong to an account).
The visitor is **not** signed in by typing the address; they get an emailed
single-use link, and opening it proves the address, signs them in, and lets
them pick a username. Until then the order is a "guest order", and the seller
can't review the buyer on it.

If the typed address already belongs to a member who has confirmed it,
checkout refuses and asks them to sign in. This tells the visitor the address
is registered; the owner accepted that on 4 October 2026 because signup
already reveals it and checkout is rate-limited.

Where: `src/features/commerce/guest-buyer.ts`,
`src/features/commerce/checkout-actions.ts`, migration
`20261005101000_guest_orders_unproven_buyers.sql`; the link route
`src/app/(auth)/confirm/route.ts`.

## 8. Invited beta

An admin creates an invitation for an email address with "buyer", "seller"
or both, valid 1–90 days. The app shows a one-time link; the admin sends it by
hand. Signing up with that link and the same email grants the roles. While
the gate is on, uninvited accounts can browse but can't buy or sell, and new
signups without an invitation get no membership. The terms describe the beta
generically.

Where: `src/lib/beta-access.ts`, `src/app/(admin)/admin/invitations/`,
migration `20260905190032_invited_beta_boundaries.sql`.

## 9. Accounts: deletion and export

- **Export:** Settings → Danger zone → "Request my data". A background job
  builds a package of the member's data (field list in
  `src/lib/account-export-contract.ts`); the download link appears in Settings
  and works for 10 minutes at a time; the package is deleted after 7 days.
  Not yet included: message photos and the carry-forward ledger.
- **Deletion:** Settings → Danger zone. The member is signed out everywhere at
  once. If an order, payment, refund or payout is in progress, deletion waits
  until it finishes. Then the profile is cleared ("Deleted member"), cars,
  posts, listings and their photos are removed, saved cards are deleted at
  Stripe, and the sign-in is deleted. Orders and payment records stay on the
  other party's record with the name removed; where a record must be kept, a
  minimal disabled identity stays with it. Copies at EasyPost, PostHog and
  Sentry are not erased by the app.
- **Retention after deletion:** not decided; see the proposal.

Where: `src/lib/account-deletion-worker.ts`, `src/lib/account-deletion-policy.ts`.

## 10. The current terms and privacy policy

- Both were rewritten on **3 October 2026** to match the code. Both are
  marked in the source as working drafts, not legal advice.
- Numbers in the terms (fee, payout hold, dispute and return clocks) are read
  from the same constants the code enforces, so they can't drift.
- A **test-mode paragraph** shows while Stripe test keys are in use and
  disappears automatically with a live key. It must not be edited out by hand.
- Missing today: legal entity, governing law and courts, liability cap,
  indemnity, termination, notices, severability, entire agreement, a
  notice-and-takedown procedure, named hosting and email providers, retention
  periods, a backup period.
- Contact addresses used: `hello@drvn.app` (terms) and `privacy@drvn.app`
  (privacy). Whether these mailboxes exist and are monitored is unconfirmed.

## 11. What has changed since the legal checklist was written

`docs/legal-review-checklist.md` lists some product problems under "Product
facts the drafts had to work around". Several were fixed on 3–5 October:

- VIN readable through the API: **fixed** (column privileges).
- Message photo location data: **fixed** (server re-encode).
- Collected (pickup) orders never paid out: **fixed**.
- Orders never auto-completed: **partly fixed** (a carrier delivery scan now
  starts the payout clock; an auto-confirm rule for untracked shipments is
  built but off, pending the owner's choice).
- Payout hold: now an owner setting rather than a fixed 7 days (§3.5).
- Connect `account.updated` not received: **fixed** (second webhook endpoint).

The privacy policy already reflects the photo change; check the other wording
still matches.

## 12. Questions for counsel

Each points to where it lives. Q1–Q11 come from
`docs/legal-review-checklist.md`; Q12–Q16 are new.

| # | Question | Where |
|---|---|---|
| Q1 | Which legal entity operates DRVN, and which jurisdiction(s) should the terms and policy be written for, given USD pricing and worldwide checkout? Governing law, courts, supervisory authority (e.g. ICO) | §1; `src/lib/geo/countries.ts` |
| Q2 | Age: is a declaration at signup needed for 18+? | §2; signup `src/app/(auth)/signup/` |
| Q3 | Beta-specific terms (no guarantees, changes, beta data)? | §8 |
| Q4 | How to describe DRVN's payment role under separate charges and transfers (agent collecting for sellers? other?), and any regulatory consequence (payment services, safeguarding of held funds) | §3.1, §3.5 |
| Q5 | Holding funds after delivery (7 days by default, possibly 30–60 under the window-based option): wording, and whether the old "not an escrow service" line should come back in another form. Check the terms §6 sentence for whichever hold the owner picks | §3.5 |
| Q6 | Losses: do sellers owe DRVN unrecovered refund reversals and label costs, and how is that stated? Should Stripe or chargeback fees be passed on? | §3.3, §3.4, §3.6 |
| Q7 | Tax: who accounts for sales tax / VAT? None is collected today | §3.2 |
| Q8 | Business sellers: must shops identify as traders and give consumer-law information (cancellation rights for distance sales)? | §2; terms §7 |
| Q9 | Liability cap and exclusions, indemnity, termination, notices, severability, entire agreement | §10 |
| Q10 | Content licence scope; notice-and-takedown for third-party IP, including imported listings | terms §9; §5 importer |
| Q11 | Privacy: lawful bases per purpose; international transfer mechanism (US processors); DPAs; provider erasure; internal policy on staff reading messages; whether opt-in-in-Settings without a banner is enough for analytics | §5, §6, §9 |
| Q12 | Retention: approve or change `docs/owner/retention-proposal.md`, in particular financial records (6 years proposed), personal details on orders (2 years), dispute evidence (2 years), raw webhook payloads (90 days), and the backup statement (30 days) | proposal §3–4 |
| Q13 | YouTube embeds load from Google without a choice. Disclose, or switch to click-to-load? | §5, §6 |
| Q14 | If the owner keeps a short hold: paying sellers on day 7 while buyers can report problems for 30 days (and change-of-mind returns run to 60), given recovery depends on the seller's Stripe balance. If auto-confirm is turned on: the wording for "marked delivered after N days without a reported problem", and whether an in-app-only warning is enough notice | §3.5, §3.6 |
| Q15 | Guest checkout: is creating an account from a typed email, and telling a visitor that an address is already registered, acceptable? What should the guest's email say? | §7 |
| Q16 | Offers: the terms call an offer "a promise you intend to keep" but nothing binds the buyer. Is that the wording you want? | §3.2 |
