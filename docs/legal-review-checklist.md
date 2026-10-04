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
- [ ] **Holding funds.** Sellers are paid 7 days after delivery by default
      (the owner's `settlement_settings` hold, `docs/decisions/payout-hold.md`;
      the terms quote the live value). The old draft said DRVN "is not an
      escrow service"; that sentence was removed because funds are in fact
      held. Confirm wording.
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

## Product facts the drafts had to work around — fix or accept

These are code issues found while writing the drafts. The pages are worded
to stay true today; fixing them may let the wording get simpler.

- [ ] **VIN readable through the API.** The privacy page says a VIN "is not
      shown on its public pages". The `cars` read policy and column grants let
      anyone read `vin` on a public car through the Supabase API. Fix
      (column-level revoke or a view) before launch, or change the wording.
- [ ] **Message photo metadata.** Message photos under 1.5 MB that don't need
      resizing keep their EXIF (possibly GPS). The page discloses it; a
      server-side re-encode (as public photos get) would remove the caveat.
- [ ] **Pickup orders are never paid out.** Payout clearing starts only when
      the buyer marks an order received, which collection orders can't do;
      Pickup Pass redemption sets the order delivered without starting the
      7-day clock. The terms say "after the buyer confirms the order arrived".
- [ ] **No auto-complete.** A shipped order the buyer never confirms is never
      paid out. Decide the rule (e.g. auto-confirm N days after tracked
      delivery) and state it.
- [ ] **Connect `account.updated`.** Seller payout status changes made at
      Stripe after onboarding aren't picked up (single webhook secret; see
      `docs/production-runbook.md` §4).

## Before publishing

- [ ] Remove the test-mode paragraphs only by switching to a live Stripe key
      (they key off `paymentsAreLive()`), never by editing them out.
- [ ] Update `UPDATED` on both pages and announce material changes in the
      app, as both pages promise.
