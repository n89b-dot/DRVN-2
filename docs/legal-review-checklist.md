# Legal review checklist — terms and privacy drafts

`/terms` and `/privacy` (`src/app/(legal)/terms/page.tsx`,
`src/app/(legal)/privacy/page.tsx`) were rewritten on 3 October 2026 to
describe what the code does. They are still working drafts, not legal advice.
Every item below is a decision counsel or the owner must make before real
payments or public launch; none of them has been decided in code.

## Identity and jurisdiction

- [ ] **Legal entity.** Name, company number, registered address of the
      operator. Neither page names one; both say "DRVN". Data-controller
      identity in the privacy policy follows from this.
- [ ] **Governing law and courts.** No clause exists. `src/lib/geo/countries.ts`
      says DRVN launched UK-first, but prices are in **US dollars** and
      checkout accepts any country with the US first. Decide the
      jurisdiction(s) the terms are written for.
- [ ] **Contact routes.** `hello@drvn.app` (terms) and `privacy@drvn.app`
      (privacy) are used; confirm both mailboxes exist and are monitored. Is
      a postal address or a data-protection representative/DPO needed?
- [ ] **Supervisory authority** to name for complaints (e.g. ICO), if any.

## Who may use DRVN

- [ ] **Age limit.** Both pages say 18+. Nothing in signup checks age (no
      date of birth, no checkbox). Decide whether a declaration at signup is
      required.
- [ ] **Invited beta.** Terms describe the invitation gate generically.
      Decide whether beta-specific terms (no guarantees, feature changes,
      data from the beta) are needed.
- [ ] **Business sellers.** Shops are self-declared; there are no
      business/VAT fields. Decide whether traders must identify as such and
      what consumer-law information shops must give buyers.

## Money

- [ ] **Merchant-of-record / payment role.** Code uses Stripe *separate
      charges and transfers*: DRVN's Stripe account charges the buyer and later
      transfers the seller's share. Terms say "payments go through DRVN's
      payment processor". Counsel to confirm how DRVN's role is described
      (commercial agent? payment collection on the seller's behalf?) and any
      regulatory consequence.
- [ ] **Holding funds.** Sellers are paid 2 days after delivery, or at once
      when the buyer confirms a parcel that plausibly arrived, or at the
      untracked auto-confirm (the owner's `settlement_settings`,
      `docs/decisions/payout-hold.md`; the terms quote the live values). The
      buyer's 30-day problem window runs on after the payout. The old draft
      said DRVN "is not an escrow service"; that sentence was removed because
      funds are in fact held. Confirm wording.
- [ ] **Taking money back from a paid seller.** Terms §6 now says that if a
      seller's Stripe balance can't cover a refund, Stripe may take the
      shortfall from their payout bank account (`debit_negative_balances`).
      Confirm this is adequately disclosed alongside Stripe's Connected
      Account Agreement.
- [ ] **Card verification threshold.** Terms §1 says larger card payments
      ask the buyer to verify with their bank. The sentence shows only while
      the control is on, and doesn't name the amount: it is a fraud control,
      kept private since 20261107210000 (N26), so nobody can price just under
      it. Confirm the wording without a number is enough. (The $1,000
      tracking rule in §7 was removed on 7 November 2026, N110: dispatch has
      no amount limit, eBay-style.)
- [ ] **Tax.** No sales tax / VAT is calculated or collected anywhere
      (no Stripe Tax). Listing copy says tax is "confirmed at checkout".
      Decide the tax position and who is responsible.
- [ ] **Stripe and chargeback fees.** Not modelled; under this charge model
      DRVN absorbs them. Decide whether terms should pass any on.
- [ ] **Losses DRVN absorbs.** A failed transfer reversal can be "written
      off" by an admin. Decide whether sellers owe DRVN such amounts and how
      that is stated.
- [ ] **Offers.** Code does not charge on acceptance; an accepted offer holds
      the part 24 hours for checkout. Terms now say this; confirm no stronger
      "binding offer" language is wanted.
- [ ] **Connect services agreement.** Sellers must accept Stripe's Connected
      Account Agreement during onboarding — decide whether the terms
      reference it explicitly.

## Liability and disputes

- [ ] **Liability cap.** Section 12 disclaims warranties but sets no cap.
      Decide a cap (if any) and exclusions, checked against consumer law.
- [ ] **DRVN's dispute decisions.** Terms say DRVN's decision settles how
      money moves on the order but doesn't remove legal rights. Confirm.
- [ ] **Consumer cancellation rights** for business sellers (distance
      selling). Terms preserve statutory rights generically; confirm what
      shops must offer beyond the optional change-of-mind window (14/30/60
      days).
- [ ] **Indemnity, termination, notices, severability, entire agreement** —
      none exist yet.
- [ ] **Content licence scope** (section 9) and DMCA/notice-and-takedown
      procedure for third-party IP, including listings imported from other
      sites.

## Privacy

- [ ] **Retention periods.** `docs/remediation-data-inventory.md` marks every
      data class "unapproved" except the 7-day export package. The privacy
      page says the periods are "still being set". Approve durations for:
      auth identity, profile, vehicles/build content, listings, social,
      conversations, offers/reviews, orders and snapshots, payments/payouts/
      refunds, returns/disputes/evidence, delivery/pickup, reports, analytics
      consent evidence, admin audit and logs, raw webhook payloads
      (`webhook_events`, never purged today), and **backup expiry**. Then
      replace the "still being set" sentence with the numbers.
- [ ] **Lawful bases** per purpose (contract, legitimate interest, consent,
      legal obligation) — the page states them in outline; confirm.
- [ ] **International transfers.** Supabase region, hosting region, Stripe,
      EasyPost, Anthropic, Sentry, PostHog (default host `us.i.posthog.com`),
      NHTSA (US). Decide the transfer mechanism wording.
- [ ] **Name the remaining processors** once chosen: hosting provider
      ("our hosting provider"), email delivery/SMTP provider ("our email
      delivery provider"), search provider if Typesense is enabled, and the
      operator alert destination (receives order ids and amounts).
- [ ] **Processor agreements (DPAs)** signed with each processor.
- [ ] **Provider erasure.** Deleting an account deletes the Stripe Customer;
      EasyPost, PostHog and Sentry copies are not erased by the app. Decide
      the procedure and what the page promises.
- [ ] **Staff access to messages.** Admins can read any conversation (RLS
      `is_admin()`). The page discloses this; decide the internal access
      policy it implies.
- [ ] **Analytics consent model.** Opt-in in Settings only, no banner,
      consent lapses after 180 days. Confirm this satisfies the cookie rules
      for the chosen jurisdiction.

## The agent (before A3a; the model part before A3c)

Drafts and rules: [`decisions/agent-data-rules.md`](decisions/agent-data-rules.md). Nothing is
on the live pages yet: the wording goes in with the release that turns the agent on.

- [ ] **Binding counters.** When a seller lets the agent handle offers, its counters bind the
      seller, and a buyer's agent accepts a counter within the buyer's ceiling. Confirm the
      terms clause and the one-time acknowledgement are enough, and that "via agent" on the offer
      is enough notice for the other party.
- [x] **Retention periods** for agent chat, records, tasks and limits: 12 months; jobs 30 days
      (Neil, 17 Oct).
- [ ] **Model provider.** The privacy page names Anthropic for agent chat. Confirm the
      no-training statement against the commercial terms. Zero data retention is decided
      (Neil, 17 Oct); arrange it with the provider before the privacy page claims it.
- [x] **Operator access** to a member's agent chat: only for an abuse or dispute case, written
      to the admin audit log (Neil, 17 Oct).

## Product facts the drafts had to work around — fix or accept

These are code issues found while writing the drafts. The pages are worded
to stay true today; fixing them may let the wording get simpler.

- [x] **VIN readable through the API.** Fixed in round three
      (`20261004160000_car_vin_private.sql`): the VIN column is no longer
      readable by clients; only the owner reads it, through `my_car_vin()`.
- [x] **Message photo metadata.** Fixed in round four
      (`20261005100000_message_photos_server_normalized.sql`): new message
      photos are re-encoded on the server. Photos sent before that keep
      whatever metadata they had — none exist in production; confirm before
      relying on the privacy page's wording for an environment with history.
- [x] **Pickup orders are never paid out.** Fixed in round three
      (`20261004120000`, `20261004140000`): a pickup handover and a carrier
      delivery scan both start the payout clock. The terms now say "after the
      order is delivered" and name the three ways that happens.
- [x] **No auto-complete.** Decided 4 October 2026
      (`docs/decisions/untracked-auto-confirm.md`): an untracked shipment the
      buyer never confirms is treated as delivered after 21 days, with a
      warning first. Terms §6 states it from the live setting. **For counsel:
      confirm the wording and that an in-app warning is sufficient notice.**
- [x] **Connect `account.updated`.** Fixed in round three: the Connect
      webhook has its own secret and updates payout status
      (`docs/production-runbook.md` §4).

## Before publishing

- [ ] Remove the test-mode paragraphs only by switching to a live Stripe key
      (they key off `paymentsAreLive()`), never by editing them out.
- [ ] Update `UPDATED` on both pages and announce material changes in the
      app, as both pages promise.
