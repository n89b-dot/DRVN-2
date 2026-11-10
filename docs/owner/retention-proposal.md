# Data retention: a proposal

**Status: PROPOSAL for the owner and counsel to approve, change or reject.**
Nothing here is in force, and none of it is legal advice. The numbers are
starting points chosen to be defensible, not statements of what the law
requires. Where a period depends on a decision not yet made, the row says
which one.

Today the code keeps almost everything for as long as the account exists and,
for shared records, indefinitely. The privacy policy says the post-deletion
periods are "still being set" (`src/app/(legal)/privacy/page.tsx`). Once this
is approved, the engineer replaces that sentence with the agreed periods and
builds the purge jobs (§6).

The family list follows `docs/remediation-data-inventory.md`, plus what rounds
three and four added (`docs/plans/2026-10-release-r3-record.md`,
`-r4-record.md`) and two families the inventory doesn't list (beta
invitations, unclaimed guest accounts).

## 1. Decisions this depends on

| Ref | Decision | Who | Why it matters here |
|---|---|---|---|
| D1 | Legal entity and the jurisdiction(s) the terms are written for (`docs/legal-review-checklist.md`, "Identity and jurisdiction") | Owner + counsel | Sets the record-keeping period for financial and tax records and the limitation period for claims |
| D2 | Tax position: does DRVN or the seller account for sales tax / VAT? | Owner + counsel/accountant | Tax records often have their own, longer periods |
| D3 | How DRVN's payment role is described (agent collecting for sellers, or other) | Counsel | May bring payment-services record duties |
| D4 | Supabase plan and its backup / point-in-time recovery window | Owner | Sets how long deleted data survives in backups |

Reference clocks, to check against D1, not to rely on:

- **Financial records.** UK: HMRC generally expects business records for 6
  years; the Companies Act minimum for a private company's accounting records
  is shorter. US: the IRS period is generally 3 years and longer in some
  cases. EU member states vary, often 5–10 years.
- **Claims.** In England and Wales the limitation period for contract claims
  is generally 6 years.
- **Card disputes.** Card networks usually allow a chargeback up to about 120
  days after the transaction or expected delivery, and longer for some reason
  codes (up to about 540 days).
- **DRVN's own clocks** (from the code): a problem can be reported up to 30
  days after delivery, sellers have 3 days to respond, auto-refund on day 10,
  returns posted within 7 days, change-of-mind windows up to 60 days, payout
  2 days after delivery, or sooner on the buyer's confirmation (an owner setting,
  `docs/decisions/payout-hold.md`).

This proposal uses **"6 years after the end of the financial year"** (written
**6y FY**) for financial records and **2 years** for the personal details
attached to a transaction. Two years covers every dispute and chargeback
window above with margin. Both numbers move with D1.

## 2. Principles

1. While an account exists, its own content stays, unless the member deletes it.
2. After account deletion, keep only what has a named purpose, and only the
   fields that purpose needs.
3. Where the other party needs the record (a buyer's receipt, a seller's
   sales history), **anonymise** the deleted member rather than delete the
   row.
4. Split long-lived records: money fields can outlive the name, address and
   phone attached to them.
5. Coordination data (retry journals, idempotency keys) lives only as long as
   a retry could still happen, unless it is also a financial record.

## 3. Proposed schedule

"At expiry": **delete** removes the row and any stored files. **Anonymise**
keeps the row but removes or replaces every field that identifies a person.
**Keep** means no automatic expiry. "Counsel" marks rows counsel must
confirm.

| # | Family (tables / storage) | Proposed period | Rationale | At expiry | Counsel |
|---|---|---|---|---|---|
| 1 | **Auth identity**: `auth.users`, `account_emails` | Life of the account. After deletion: removed, unless financial rows still reference the person; then a disabled identity with no email until the last of those rows reaches its expiry | Sign-in. The minimal identity keeps financial references intact without keeping contact data | Delete (email first, row when unreferenced) | Yes: confirm a reference-only identity is acceptable |
| 2 | **Profile and shop**: `profiles`, `shop_profiles`, avatars | Life of the account. Scrubbed at deletion (implemented); "Deleted member" placeholder kept while referenced | User expectation; public identity | Anonymise at deletion; delete placeholder when unreferenced | No |
| 3 | **Vehicles and build content**: `cars` (incl. VIN), `car_images`, `car_hotspots`, `mod_items`, `activity_posts`, `activity_images`, public buckets | Life of the account, or until the member deletes it | Member content; nothing else needs it | Delete (implemented at account deletion). CDN copies age out on their own | No |
| 4 | **Listings and imports**: `listings`, `listing_images`, `listing_fitments`, `listing_part_numbers` | Until the seller deletes the listing or the account | Member content. A sold listing lives on as the order snapshot (row 8) | Delete | No |
| 4a | `listing_imports` (fetched page text, AI draft) | 7 days after the import finishes (implemented) | Only needed to finish the draft | Delete | No |
| 4b | `staged_uploads` (photos uploaded to a form never saved) | 48 hours (implemented) | Abandoned uploads | Delete | No |
| 4d | `private.photo_signatures` (new, 10 Nov: the signed link each member photo is shown through in one hour-long window; the path names the owner's id) | Two hours (implemented: pruned as links are minted and daily by `drvn-cron-history-prune`; a member's rows go when their deletion scrub runs) | Lets every server show one link per photo per hour | Delete | No |
| 4c | `private.listing_edit_requests` (new, round 3: edit retry identities and result) | 7 days (implemented, but only pruned when the same seller edits again) | Retry protection for a lost response; useless after minutes | Delete. Needs a scheduled sweep so sellers who never edit again are pruned | No |
| 5 | **Social and preferences**: `activity_comments`, `activity_reactions`, `listing_questions`, `saves`, `follows`, `likes`, `saved_searches` | Life of the author's account | Member content and relationships | Delete at account deletion (implemented) | No |
| 5a | `notifications` | 12 months after creation | In-app alerts have no value after that | Delete | No |
| 6 | **Conversations**: `messages` | While either participant's account exists. Messages on an order, offer or dispute follow row 8 | The other participant expects to keep the thread; order messages are dispute evidence | When the last participant's account is gone: delete. Order-linked: anonymise the deleted participant, keep text until row 8 expiry | Yes: staff can read messages, so the purpose and limit need stating |
| 6a | **Message photos** (private `message-photos` bucket; paths in `messages.attachments`). Re-encoded without metadata since round 4 | Same as the message | Same as above | Delete with the message. Note: the account export omits `attachments` today, so members can't export their message photos | Yes (with 6) |
| 7 | **Offers**: `offers` | Declined, withdrawn or lapsed: 12 months. Accepted: follows the order (row 8) | Negotiation history has short-term support value only | Delete | No |
| 7a | **Reviews**: `reviews` | While the reviewee's account exists | Public reputation the community relies on | Reviewer deleted: anonymise ("Deleted member"). Reviewee deleted: delete | No |
| 8 | **Orders and snapshots**: `orders`, `order_items`, `order_snapshot_images`, plus `private.unproven_buyer_orders` (new, round 4) | Money fields: 6y FY after the order closes. Name, address, phone on the order: 2 years after the order closes (delivery, or the last case on it) | Tax and accounting records (D1, D2); disputes, chargebacks and claims | At 2 years: anonymise personal fields. At 6y FY: delete snapshot images; delete or fully anonymise the row. `unproven_buyer_orders` is a flag on the order and goes with it (cascade) | **Yes**: period depends on D1/D2 |
| 8a | `purchase_attempts` (frozen checkout context incl. delivery address) | 90 days after the attempt ends | Restores an interrupted checkout; the order is the lasting record | Delete (or anonymise if referenced by a payment request) | No |
| 9 | **Payments, payouts, refunds**: `payments`, `transfers`, `transfer_intents`, `refunds`, `refund_operations` (incl. `request_key`, new in round 3), `refund_adjustments`, `refund_recredit_proofs`, `seller_adjustments` | 6y FY after the order closes | Financial records, reconciliation with Stripe, evidence in disputes | Delete or keep anonymised aggregates. `request_key` values (`return:<id>`, `offer:<order>:<time>`) hold no personal data and go with their operation | **Yes**: D1, D2, D3 |
| 9a | `seller_carry_entries` (new, round 4: append-only ledger of label costs owed and recovered) | 6y FY after the entry, and not before the seller's carry balance is zero | Financial record of money owed between DRVN and a seller | Delete. Note: a positive balance is never paid out today, and the table is not in the account export | **Yes** (with 9) |
| 10 | **Returns and disputes**: `returns`, `return_items`, dispute records | Case facts: follow row 8 | Outcome record for money moved | As row 8 | Yes |
| 10a | **Dispute evidence** (private `dispute-evidence` bucket, kept exactly as uploaded) | 2 years after the case closes | Covers card chargebacks and any challenge to the outcome | Delete the files; keep the outcome on the case | **Yes** |
| 11 | **Delivery and pickup**: `shipments`, `shipment_items`, `shipment_events`, `shipping_quotes`, `pickup_confirmations`, `delivery_auto_confirmations` (new: warning and auto-confirm dates per order) | 2 years after delivery | Lost-parcel claims, disputes | Anonymise addresses and phone; keep carrier, tracking number and dates with the order until row 8 expiry | No |
| 11a | Label journals: `outbound_label_requests`, `outbound_label_void_requests`, `return_label_requests` | Amounts and provider references: as row 9. Addresses: 2 years | Postage is charged to the seller's payout (financial) | As rows 9 and 11 | With 9 |
| 11b | `fulfillment_profile` (seller's reusable ship-from address and phone) | Life of the account | Needed to ship | Delete at account deletion (implemented when eligible) | No |
| 12 | **Reports**: reports filed, moderation outcomes | 2 years after resolution. If it led to a suspension or ban: 6 years | Safety record; repeat-offender checks | Delete; for bans keep a minimal record (account id, reason, date) | Yes |
| 13 | **Analytics consent**: `analytics_consent` | Current state while the account exists (opt-in lapses after 180 days, implemented) | Proof of consent | Proposal: keep a minimal record (version, granted/withdrawn times) for 2 years after withdrawal or lapse, instead of deleting it at account deletion as the code does now | Yes: depends on the consent rules of D1 |
| 13a | Analytics events at PostHog (only if enabled and opted in) | 12 months, set in PostHog | Product analytics | PostHog deletes them. Account deletion should also delete the PostHog person; not implemented | Yes (with 13) |
| 14 | **Admin audit**: `admin_audit_log` | 6 years | Accountability for staff actions, many of which move money | Delete | Yes |
| 14a | **Recovery cases**: `payment_recoveries` | As row 9 | Financial | As row 9 | With 9 |
| 14b | **Raw Stripe webhook payloads**: `webhook_events` (never purged today; payloads include buyer names, emails, billing details) | Payload: 90 days after processing. Event id, type and processed time: 1 year | Replay and debugging need the payload only briefly; Stripe keeps its own copy; ids guard against reprocessing | Null the payload at 90 days; delete the row at 1 year | **Yes** |
| 14c | `admin_alert_outbox` (alerts carry order ids and amounts) | Delivered: 90 days. Failed or disabled: 1 year | Operations | Delete | No |
| 14d | `remediation_jobs` (receipt, search, deletion and other job rows) | Finished jobs: 90 days | Operations; the work they record lives elsewhere | Delete | No |
| 14e | `rate_limits` (hashed network identity, hashed email) | 1 day (implemented) | Abuse limits | Delete | No |
| 14f | Request logs (hosting provider), database and Auth logs (Supabase), error reports (Sentry) | The shortest the plan allows; Sentry 90 days | Debugging and security | Provider deletes | No |
| 15 | **Account export package**: `account_export_requests`, private `account-exports` bucket | Package files: 7 days (implemented). The request record (who asked, when, outcome): 3 years | The package is for download only; the request record shows the request was handled | Delete files at 7 days; delete record at 3 years | Yes (request record) |
| 15a | Account deletion requests and their outcome | 3 years after completion | Shows the deletion was handled | Delete | Yes |
| 16 | **Beta invitations**: `beta_invitations` (email, token hash, roles), `beta_signup_claims` | Unused: 90 days after expiry. Used: life of the account, or until the beta ends | Access control during the beta | Delete | No |
| 17 | **Unclaimed guest accounts** (checkout without an account; unconfirmed, `drvn_guest`) | No orders: 30 days after creation. With orders: as row 1, with personal fields as row 8 (2 years) | The account exists only to hold the order | Delete, or reduce to a disabled identity | Yes |

## 4. Backups

- Proposal: database backups and point-in-time recovery kept for **no more
  than 30 days**, and the privacy policy states that number. The actual window
  is whatever the Supabase plan provides (D4); check it in the dashboard
  rather than the plan name (runbook §6 says the same).
- Separately archived Storage objects (runbook §6): the same 30 days.
- Deleted data can come back only inside that window, and only through a
  restore. After any restore, re-apply deletions and retention purges before
  reopening the site (runbook §6, step 3). The account-deletion worker's
  records are what make that possible, which is one reason to keep row 15a.
- Counsel: confirm the policy can say "deleted from backups within 30 days".

## 5. Copies held by other companies

DRVN can't shorten these, but the privacy policy should say they exist.

| Provider | What it holds | Proposed DRVN action |
|---|---|---|
| Stripe | Payments, customers, connected accounts, disputes | None beyond deleting the Stripe Customer at account deletion (implemented). Stripe keeps records under its own legal duties |
| EasyPost | Addresses and parcels for labels | Ask EasyPost about deletion for a closed account; note the answer |
| Email provider | Delivery logs and, for some providers, message content | Set content retention to the minimum in its dashboard (`docs/owner/email-provider.md`) |
| Sentry | Error reports (account id; contact fields stripped) | 90-day retention in project settings |
| PostHog (if enabled) | Opt-in usage events | 12-month retention; delete person on account deletion (to build) |
| Anthropic (listing import) | Imported page text | Check the API data-retention terms in force; note them in the policy |
| Hosting provider | Request logs | Plan default; note it |

## 6. What building this would take (for the engineer, after approval)

Not started. Roughly: one scheduled purge job per row with a period (the
existing `media-gc` and `listing-imports` sweeps are the pattern), a sweep
for `listing_edit_requests`, the anonymisation steps in rows 8, 11 and 14b,
adding `seller_carry_entries` and message photos to the account export, and
the PostHog person deletion. Each purge needs a guard test and an entry in
the worker health page. Then the privacy policy states the periods.

## 7. Sign-off

| | Name | Date | Notes |
|---|---|---|---|
| D1–D4 decided | | | |
| Counsel reviewed rows marked "Yes" | | | |
| Owner approved the schedule | | | |
| Privacy policy updated | | | |
