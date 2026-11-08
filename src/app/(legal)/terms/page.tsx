import Link from "next/link";

import { Rv } from "@/components/livesheet";
import {
  AUTO_REFUND_AFTER_DAYS,
  DISPUTE_WINDOW_DAYS,
  ESCALATION_CLOSES_DAYS,
  REFUND_OFFER_HOURS,
  SELLER_RESPONSE_DAYS,
} from "@/features/commerce/disputes";
import { RETURN_SHIP_DAYS, SELLER_INSPECT_HOURS } from "@/lib/domain/return-policy";
import { PLATFORM_FEE_BPS } from "@/lib/payments/fee";
import {
  payoutHoldPhrase,
  readAutoConfirmDays,
  readPayoutHoldPolicy,
  readPublicRiskControls,
} from "@/lib/payments/payout-hold";
import { deliveryLabel } from "@/lib/marketplace/delivery";
import { paymentsAreLive } from "@/lib/payments/provider";
import { createPublicClient } from "@/lib/supabase/public";

export const metadata = {
  title: "Terms of Service - DRVN",
  description: "The rules for buying and selling parts on DRVN.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "7 November 2026";

/**
 * Plain-language terms covering what DRVN actually does today.
 *
 * NOT LEGAL ADVICE — this is a working draft written to be honest about the
 * current product, not a lawyer-reviewed document. Have a solicitor review it
 * before taking real payments. The decisions it still needs (legal entity,
 * governing law, liability caps, tax, retention) are listed in
 * docs/legal-review-checklist.md.
 *
 * Every number below is imported from the constant the code enforces — fee
 * (src/lib/payments/fee.ts), dispute clocks (src/features/commerce/disputes.ts),
 * return clocks (src/lib/domain/return-policy.ts) — or read from the setting
 * the database applies: the payout hold (settlement_settings, see
 * src/lib/payments/payout-hold.ts) — so the terms cannot drift from what
 * actually happens. Durations that live only in SQL are noted where used.
 */
export default async function TermsPage() {
  const feePercent = PLATFORM_FEE_BPS / 100;
  // Cached like the landing page's reads; an owner's change shows within
  // five minutes. If the setting can't be read the sentence names no number
  // rather than a possibly wrong one.
  const settings = createPublicClient({ maxAge: 300, tags: ["settlement-settings"] });
  const [hold, autoConfirmDays, risk] = await Promise.all([
    readPayoutHoldPolicy(settings),
    readAutoConfirmDays(settings),
    readPublicRiskControls(settings),
  ]);
  const holdText = hold ? payoutHoldPhrase(hold) : "a clearing period";
  // Off (null) says nothing; unreadable still states the rule, without a number.
  const autoConfirmText =
    autoConfirmDays === null ? null : autoConfirmDays === undefined ? "a set period" : `${autoConfirmDays} days`;
  // Early release on the buyer's confirmation exists only in fixed mode
  // (payout_release_at, 20261009100000).
  const releasesOnReceipt = hold?.mode === "fixed";
  const receiptDays = risk ? `${risk.receiptReleaseAfterDays} days` : "a few days";
  // Whether card verification is on, never the amount it starts at: that
  // would tell a fraudster what to price under (N26, 20261107210000).
  const verifiesCards = risk?.cardVerificationOn === true;

  return (
    <>
      <Rv as="header" className="pagehead">
        <span className="microlabel">Terms of Service · updated {UPDATED}</span>
        <h1>The ground rules.</h1>
        <p className="sub">
          DRVN is a home for modified cars and a marketplace for the parts that come off them.
          These terms cover what you can expect from us, and what we expect from you.
        </p>
      </Rv>

      <div className="prose">
        <h2>1. What DRVN is</h2>
        <p>
          DRVN is a platform. Members show their cars and builds, and list parts for other members
          to buy. <strong>We are not the seller.</strong> Every part is sold by the member who
          listed it, and the contract of sale is between buyer and seller.
        </p>
        <p>
          Payments go through DRVN&apos;s payment processor, Stripe: the buyer pays at checkout,
          and the seller&apos;s share is paid out to the seller&apos;s own Stripe account, as
          described in section 6.
          {verifiesCards && (
            <>
              {" "}
              Larger card payments ask the buyer to verify the payment with their card&apos;s bank.
            </>
          )}
        </p>

        <h2>2. Your account</h2>
        <p>
          You need an account to sell or post. You must be at least 18, provide accurate
          information, and keep your sign-in details to yourself. One person, one account.
          You&apos;re responsible for activity under your account. You can sign in with an email
          and password, or with Google where it&apos;s offered.
        </p>
        <p>
          DRVN is in an invited beta. While invitations are switched on, joining — and buying and
          selling — is open only to members with an invitation sent to their email address.
          Browsing needs no account.
        </p>
        <p>
          You can delete your account at any time from{" "}
          <Link href="/settings#danger">Settings → Danger zone</Link>. If you have an order,
          payment, refund or payout still in progress, deletion waits until it&apos;s finished.
          Orders you&apos;ve already traded stay on the other party&apos;s record with your name
          removed — they need their own receipts. See the{" "}
          <Link href="/privacy">privacy policy</Link> for what is kept.
        </p>

        <h2>3. Listing parts</h2>
        <p>When you list a part you confirm that:</p>
        <ul>
          <li>you own it and have the right to sell it;</li>
          <li>your description and photos are accurate and of the actual item;</li>
          <li>
            any car you attach as the source is a car in your own garage — falsely claiming
            provenance is grounds for removal;
          </li>
          <li>
            fitment notes are <em>your</em> statement, offered as information. DRVN does not verify
            them and buyers should confirm fitment themselves;
          </li>
          <li>
            the condition grade and checklist answers you give are true. They are frozen onto every
            order, and disputes are judged against them.
          </li>
        </ul>
        <p>
          If you import a listing from another site, DRVN fetches that public page and uses an AI
          service to draft the listing from its text. Only import listings you wrote or have the
          right to reuse, and check the draft — once you publish it, it&apos;s your listing and
          your statement.
        </p>
        <p>
          While live payments are on, you must finish setting up payouts with Stripe before a
          listing can go live.
        </p>

        <h2>4. Prohibited items</h2>
        <p>You may not list:</p>
        <ul>
          <li>counterfeit, replica or trademark-infringing parts presented as genuine;</li>
          <li>stolen goods, or parts with removed or altered identifying marks;</li>
          <li>safety-critical parts known to be damaged, without saying so plainly;</li>
          <li>
            items whose sale or road use is unlawful where the buyer is — including emissions-defeat
            devices sold as road-legal;
          </li>
          <li>anything that isn&apos;t a vehicle part, tool or related accessory.</li>
        </ul>

        <h2>5. Buying</h2>
        <p>
          Placing an order is a commitment to pay. Prices are in US dollars. The buyer pays the
          asking price plus shipping. When the seller sets the shipping, the listing shows it;
          when the listing says &ldquo;{deliveryLabel({ shipping_mode: "drvn" })}&rdquo;, checkout
          shows the rates once you&apos;ve entered your address. Either way you see the total
          before you pay, and DRVN&apos;s fee is never added to it. Starting checkout holds the
          part for you for 15 minutes.
        </p>
        <p>
          An offer is a promise you intend to keep, so only offer what you would pay. Offers lapse
          after 72 hours. An accepted offer doesn&apos;t charge you: it holds the part for you for
          24 hours to complete checkout at the agreed price, after which it&apos;s released.
        </p>
        <p>
          If you turn on your agent for a listing or an offer, it makes offers and counters for
          you within the limits you set, and those offers and counters are yours, as if you had
          made them. It never goes past your limits, never pays and never messages anyone, and
          the other side can see that an agent made the move. Selling, it asks you before
          accepting an offer. Buying, it can accept a seller&apos;s counter within your maximum,
          which holds the part for you to pay for as with any accepted offer.
          When it answers you in chat or suggests a change to your build, it can be wrong: check
          what it says, and nothing it drafts is saved until you confirm it.
        </p>
        <p>
          Where checkout without an account is available, buying with just an email address
          creates a DRVN account for that address, and we email you a link to open your orders.
          Anything after the purchase — confirming delivery, reporting a problem — happens from
          that account.
        </p>

        <h2>6. Fees and payouts</h2>
        <p>
          Listing is free. DRVN charges <strong>{feePercent}% of the sale total</strong> — the
          item price plus any shipping the buyer pays — deducted from the seller&apos;s payout.
          There is no other DRVN fee. Postage a seller buys through DRVN (a shipping label, or a
          return label for a problem they caused) also comes out of that seller&apos;s payout.
          See <Link href="/fees">the fee schedule</Link> for worked examples.
        </p>
        <p>
          Sellers are paid through Stripe Connect, into a Stripe account the seller sets up and
          verifies with Stripe. A sale is paid out {holdText} after the order
          is delivered — when the buyer confirms it arrived, when the carrier reports it
          delivered, or when it is handed over in person — unless a problem has been reported on
          it; then it waits for the outcome. Stripe then pays the seller&apos;s bank on its own
          schedule.
          {releasesOnReceipt && (
            <>
              {" "}
              When the buyer confirms a posted order arrived, it is paid out straight away instead,
              as long as the carrier has reported it delivered or it was dispatched at least{" "}
              {receiptDays} earlier.
            </>
          )}
        </p>
        {autoConfirmText && (
          <p>
            A parcel sent without carrier tracking can&apos;t be reported delivered by a carrier.
            If the buyer has neither confirmed it arrived nor reported a problem, it is treated as
            delivered {autoConfirmText} after dispatch
            {releasesOnReceipt && " and paid out then"}. DRVN tells the buyer before that happens,
            and the buyer can still report a problem afterwards in the usual window.
          </p>
        )}
        <p>
          When an order is refunded, in whole or part, DRVN&apos;s fee on it is refunded in the
          same proportion, and so is the seller&apos;s share. If the seller has already been
          paid, their share of the refund is taken back from their Stripe account. If that
          account&apos;s balance can&apos;t cover it, Stripe may take the shortfall from the bank
          account the seller set up for payouts.
        </p>
        {!paymentsAreLive() && (
          <p>
            <strong>Payments are in test mode.</strong> While DRVN runs on a test payment
            provider, no money changes hands and no payouts are made. Do not treat an order as a
            completed sale until we announce live payments.
          </p>
        )}

        <h2>7. Dispatch, collection and cancellation</h2>
        <p>
          Sellers should dispatch within a reasonable time of an order and must add tracking for
          posted items. Where DRVN Shipping is available, sellers can buy a tracked label through
          DRVN. Buyers confirm the order arrived in the app.
        </p>
        <p>
          For collection, the buyer shows a single-use Pickup Pass at handover and the seller
          scans it (or enters its code). That scan is the record that the part was collected.
        </p>
        <p>
          A seller can cancel an order before it&apos;s dispatched, and the buyer is refunded in
          full. A buyer who needs to cancel should message the seller first. Consumer-law rights —
          including any statutory right to cancel a distance purchase — are unaffected by these
          terms.
        </p>

        <h2>8. When something goes wrong</h2>
        <p>
          The full process, in plain language, is on{" "}
          <Link href="/protection">buyer &amp; seller protection</Link>. In short:
        </p>
        <ul>
          <li>
            A buyer can report a problem within {DISPUTE_WINDOW_DAYS} days of delivery if the item
            arrived damaged, is significantly not as described, is counterfeit, doesn&apos;t fit
            as listed, or is the wrong item. An item that never arrived can be reported from the
            latest delivery date shown on the order until {DISPUTE_WINDOW_DAYS} days after it,
            whether or not it was dispatched. Changing your mind isn&apos;t covered unless the
            seller is a shop that offers change-of-mind returns.
          </li>
          <li>
            The seller has {SELLER_RESPONSE_DAYS} business days to respond — with tracking, a
            partial or full refund, or a return. A refund offer stands for {REFUND_OFFER_HOURS}{" "}
            hours. After that either side can ask DRVN to step in, up to {ESCALATION_CLOSES_DAYS}{" "}
            business days after the report, and DRVN reviews the order record and both
            sides&apos; evidence and decides how the money on the order moves. An item that never
            arrived, with no valid tracking, is refunded in full. A problem the seller ignores is
            refunded automatically on day {AUTO_REFUND_AFTER_DAYS}. A resolved dispute is final.
            Business days are Monday to Friday.
          </li>
          <li>
            An agreed return must be posted with tracking within {RETURN_SHIP_DAYS} days. The seller
            then has {SELLER_INSPECT_HOURS} hours after it&apos;s delivered to raise a genuine
            problem with what came back; otherwise the agreed refund is released.
          </li>
          <li>
            Refunds go back to the original payment method. If a buyer disputes the payment with
            their card issuer instead, the order is frozen until that dispute closes; if the
            buyer wins it, the refund comes out of the seller&apos;s share as above.
          </li>
        </ul>
        <p>
          DRVN&apos;s decision settles how money moves on the order. It doesn&apos;t take away any
          legal rights buyer and seller have against each other.
        </p>

        <h2>9. Your content</h2>
        <p>
          Your photos, descriptions and build posts stay yours. By posting them you grant DRVN a
          licence to display and distribute them on the platform and in links shared elsewhere. You
          confirm you have the right to post them. A listing you sell is frozen onto the order —
          photos included — as the record of the sale, even if you later edit or delete it.
        </p>

        <h2>10. Reviews</h2>
        <p>
          Reviews must describe a real transaction you took part in and become available once an
          order is complete. Fake, retaliatory or paid reviews may be removed.
        </p>

        <h2>11. Reports, removal and suspension</h2>
        <p>
          Members can report a listing, member, post or comment. DRVN may remove listings, posts or
          comments that break these terms and may suspend accounts. A suspended member can&apos;t
          post, comment, make offers or send messages, and their listings are paused. Messages are
          not end-to-end encrypted: DRVN staff can read a conversation when handling a report, an
          order or a dispute.
        </p>

        <h2>12. Liability</h2>
        <p>
          DRVN is provided as-is. We don&apos;t warrant that any part is fit for a purpose, that it
          fits your car, or that a member will perform their side of a deal. Nothing here limits
          liability that cannot lawfully be limited, including for death, personal injury or fraud.
        </p>

        <h2>13. Changes</h2>
        <p>
          We may update these terms. Material changes will be announced in the app before they take
          effect, and continuing to use DRVN afterwards means you accept them.
        </p>

        <h2>14. Contact</h2>
        <p>
          Questions about these terms: <a href="mailto:hello@drvn.app">hello@drvn.app</a>.
        </p>
      </div>
    </>
  );
}
