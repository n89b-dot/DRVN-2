import Link from "next/link";

import { Rv } from "@/components/livesheet";

export const metadata = {
  title: "Terms of Service - DRVN",
  description: "The rules for buying and selling parts on DRVN.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "26 July 2026";

/**
 * Plain-language terms covering what DRVN actually does today.
 *
 * NOT LEGAL ADVICE — this is a working draft written to be honest about the
 * current product, not a lawyer-reviewed document. Have a solicitor review it
 * before taking real payments, and revisit it when Stripe Connect lands, since
 * payment processing, chargebacks and payouts all need explicit terms.
 */
export default function TermsPage() {
  return (
    <>
      <Rv as="header" className="pagehead">
        <span className="microlabel">Terms of Service · updated {UPDATED}</span>
        <h1>The rules of the sheet.</h1>
        <p className="sub">
          DRVN is a marketplace for parts off modified cars. These terms cover what you can expect
          from us, and what we expect from you.
        </p>
      </Rv>

      <div className="prose">
        <h2>1. What DRVN is</h2>
        <p>
          DRVN is a marketplace. We provide the platform where enthusiasts list parts and buyers
          find them. <strong>We are not the seller.</strong> Every part is sold by the member who
          listed it, and the contract of sale is between buyer and seller.
        </p>

        <h2>2. Your account</h2>
        <p>
          You need an account to buy, sell or post. You must be at least 18, provide accurate
          information, and keep your credentials to yourself. One person, one account. You&apos;re
          responsible for activity under your account.
        </p>
        <p>
          You can delete your account at any time from{" "}
          <Link href="/settings">Settings</Link>. Orders you&apos;ve already traded remain on the
          other party&apos;s record with your name removed — they need their own receipts.
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
            them and buyers should confirm fitment themselves.
          </li>
        </ul>

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
        <p>We may remove any listing and suspend accounts that break these rules.</p>

        <h2>5. Buying</h2>
        <p>
          Placing an order is a commitment to pay. Making an offer is a commitment to pay if the
          seller accepts it — so only offer what you intend to honour. Sellers set their own
          shipping charges, shown before you pay.
        </p>

        <h2>6. Fees and payouts</h2>
        <p>
          Listing is free. DRVN charges <strong>10% of the sale price</strong>, deducted from the
          seller&apos;s payout. We do not take a fee on shipping. The buyer pays the asking price
          plus shipping — the number on the listing is the number they pay. See{" "}
          <Link href="/fees">the fee schedule</Link>.
        </p>
        <p>
          <strong>Payments are in test mode.</strong> While DRVN runs on a test payment provider, no
          money changes hands and no payouts are made. Do not treat an order as a completed sale
          until we announce live payments.
        </p>

        <h2>7. Dispatch, delivery and cancellation</h2>
        <p>
          Sellers should dispatch within a reasonable time of an order and must add tracking for
          posted items. Buyers confirm receipt in the app, which closes the order and opens reviews.
        </p>
        <p>
          Either party may cancel an order before it&apos;s dispatched, and the payment is reversed.
          After dispatch, work it out in the order&apos;s message thread first. Consumer-law rights
          — including any statutory right to cancel a distance purchase — are unaffected by these
          terms.
        </p>

        <h2>8. Disputes</h2>
        <p>
          Disputes are between buyer and seller. Use the order thread; it keeps a record. Where we
          can help we will, but DRVN is not an arbitrator or an escrow service and does not
          guarantee any transaction.
        </p>

        <h2>9. Your content</h2>
        <p>
          Your photos, descriptions and build posts stay yours. By posting them you grant DRVN a
          licence to display and distribute them on the platform and in links shared elsewhere. You
          confirm you have the right to post them.
        </p>

        <h2>10. Reviews</h2>
        <p>
          Reviews must describe a real transaction you took part in and become available once an
          order is marked received. Fake, retaliatory or paid reviews may be removed.
        </p>

        <h2>11. Liability</h2>
        <p>
          DRVN is provided as-is. We don&apos;t warrant that any part is fit for a purpose, that it
          fits your car, or that a member will perform their side of a deal. Nothing here limits
          liability that cannot lawfully be limited, including for death, personal injury or fraud.
        </p>

        <h2>12. Changes</h2>
        <p>
          We may update these terms. Material changes will be announced in the app before they take
          effect, and continuing to use DRVN afterwards means you accept them.
        </p>

        <h2>13. Contact</h2>
        <p>
          Questions about these terms: <a href="mailto:hello@drvn.app">hello@drvn.app</a>.
        </p>
      </div>
    </>
  );
}
