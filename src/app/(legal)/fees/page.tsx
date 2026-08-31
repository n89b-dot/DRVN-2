import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { PLATFORM_FEE_BPS, platformFeeCents } from "@/lib/payments/fee";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { paymentsAreLive } from "@/lib/payments/provider";

export const metadata = {
  title: "Fees - DRVN",
  description:
    "What DRVN charges: 10% of the sale total (item + shipping), out of the seller's payout. Nothing else.",
  alternates: { canonical: "/fees" },
};

/** [price, buyer-paid shipping] pairs — the middle one is the brief's worked example. */
const EXAMPLES: [number, number][] = [
  [50_00, 8_00],
  [300_00, 23_00],
  [1_200_00, 0],
];

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
          Listing is free. DRVN takes {percent}% of the sale total — the item price plus any
          buyer-paid shipping — out of the seller&apos;s payout. There&apos;s no listing fee and no
          subscription.
        </p>
      </Rv>

      <section className="deck">
        <Rv className="tile tile--deep">
          <span className="microlabel microlabel--ink">Worked examples</span>
          <table className="spec mt-3">
            <thead className="sr-only">
              <tr>
                <th>Sale total</th>
                <th>DRVN fee</th>
                <th>Seller receives</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLES.map(([price, shipping]) => {
                const basis = price + shipping;
                return (
                  <tr key={price}>
                    <td>
                      {formatPrice(price)}
                      {shipping > 0 ? <> + {formatPrice(shipping)} shipping</> : null}
                    </td>
                    <td>
                      fee {formatPrice(platformFeeCents(basis))} → seller gets{" "}
                      <b>{formatPrice(basis - platformFeeCents(basis))}</b>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="spec-note">
            The fee applies to the whole amount the buyer pays — item and shipping together — so
            the split between price and postage never changes what DRVN charges. Out of the seller
            side, actual postage costs (like a label bought through DRVN) then come out of the
            shipping the buyer already paid.
          </p>
        </Rv>

        <Rv className="tile" stagger={1}>
          <span className="microlabel microlabel--ink">What the buyer pays</span>
          <p className="mt-2 text-body leading-relaxed">
            The asking price plus the seller&apos;s shipping. Nothing is added at checkout — the
            number on the listing is the number you pay. The fee is invisible to buyers because it
            comes out of the seller&apos;s side.
          </p>
        </Rv>

        <Rv className="tile" stagger={2}>
          <span className="microlabel microlabel--ink">Why charge from day one</span>
          <p className="mt-2 text-body leading-relaxed">
            Because introducing a fee later, once people have built their listings around free, is a
            bait and switch. The rate has been the same since the first line of checkout code.
          </p>
        </Rv>

        <Rv className="tile" stagger={3}>
          <span className="microlabel microlabel--ink">
            {paymentsAreLive() ? "Payments are live" : "Payments are in test mode"}
          </span>
          <p className="mt-2 text-body leading-relaxed">
            {paymentsAreLive()
              ? "Payments run live through Stripe: orders move real money and payouts are made on the schedule above. The fee maths hasn't changed — it's been the same since checkout shipped."
              : "DRVN currently runs on a test payment provider: orders are real records, but no money moves and no payouts are made yet. The fee maths above is already live in the code, so nothing about the numbers will change when real payments switch on."}
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
