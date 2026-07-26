import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { PLATFORM_FEE_BPS, platformFeeCents } from "@/lib/payments/fee";
import { formatPrice } from "@/lib/marketplace/taxonomy";

export const metadata = {
  title: "Fees - DRVN",
  description: "What DRVN charges: 10% of the sale price, out of the seller's payout. Nothing else.",
  alternates: { canonical: "/fees" },
};

const EXAMPLES = [50_00, 250_00, 1_200_00];

/**
 * Fee transparency, computed from the same constant the checkout uses — so the
 * page cannot drift from what's actually charged. Fee opacity is a trust cost in
 * a marketplace, and this was only documented in code and the PRD.
 */
export default function FeesPage() {
  const percent = PLATFORM_FEE_BPS / 100;

  return (
    <>
      <Rv as="header" className="pagehead">
        <span className="microlabel">Fees · plainly</span>
        <h1>
          {percent}% of the sale. <span className="live-word">That&apos;s it.</span>
        </h1>
        <p className="sub">
          Listing is free. DRVN takes {percent}% of what a part sells for, out of the seller&apos;s
          payout. There&apos;s no fee on shipping, no listing fee, and no subscription.
        </p>
      </Rv>

      <section className="deck">
        <Rv className="tile tile--deep">
          <span className="microlabel microlabel--ink">Worked examples</span>
          <table className="spec mt-3">
            <thead className="sr-only">
              <tr>
                <th>Sale price</th>
                <th>DRVN fee</th>
                <th>Seller receives</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLES.map((price) => (
                <tr key={price}>
                  <td>Sells for {formatPrice(price)}</td>
                  <td>
                    fee {formatPrice(platformFeeCents(price))} → seller gets{" "}
                    <b>{formatPrice(price - platformFeeCents(price))}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="spec-note">
            Plus shipping, in full. If a seller charges {formatPrice(1_500)} postage, the buyer pays
            it and the seller keeps every penny of it.
          </p>
        </Rv>

        <Rv className="tile" stagger={1}>
          <span className="microlabel microlabel--ink">What the buyer pays</span>
          <p className="mt-2 text-[15px] leading-relaxed">
            The asking price plus the seller&apos;s shipping. Nothing is added at checkout — the
            number on the listing is the number you pay. The fee is invisible to buyers because it
            comes out of the seller&apos;s side.
          </p>
        </Rv>

        <Rv className="tile" stagger={2}>
          <span className="microlabel microlabel--ink">Why charge from day one</span>
          <p className="mt-2 text-[15px] leading-relaxed">
            Because introducing a fee later, once people have built their listings around free, is a
            bait and switch. The rate has been the same since the first line of checkout code.
          </p>
        </Rv>

        <Rv className="tile" stagger={3}>
          <span className="microlabel microlabel--ink">Payments are in test mode</span>
          <p className="mt-2 text-[15px] leading-relaxed">
            DRVN currently runs on a test payment provider: orders are real records, but no money
            moves and no payouts are made yet. The fee maths above is already live in the code, so
            nothing about the numbers will change when real payments switch on.
          </p>
          <div className="mt-4">
            <Link href="/terms" className="jumplink inline-flex">
              Read the terms
            </Link>
          </div>
        </Rv>
      </section>
    </>
  );
}
