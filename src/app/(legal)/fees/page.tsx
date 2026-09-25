import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Alert, PageHead, TileHead } from "@/components/ui";
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
      <PageHead
        eyebrow="Fees · plainly"
        title={
          <>
            {percent}% of the sale. <span className="live-word">That&apos;s it.</span>
          </>
        }
        sub={
          <>
            Listing is free. DRVN takes {percent}% of the sale total — the item price plus any
            buyer-paid shipping — out of the seller&apos;s payout. There&apos;s no listing fee and
            no subscription.
          </>
        }
      />

      {/* Test mode is something a buyer needs before the maths, not in a
          tile at the bottom where it read like a bug report. */}
      {!paymentsAreLive() && (
        <Alert tone="live" className="mb-6" title="Payments are in test mode">
          DRVN currently runs on a test payment provider: orders are real records, but no money
          moves and no payouts are made yet. The fee maths below is already live in the code, so
          nothing about the numbers will change when real payments switch on.{" "}
          <Link href="/terms" className="jumplink">
            Read the terms
          </Link>
        </Alert>
      )}

      <section className="deck">
        {/* Three plain columns with visible heads. The old two-column
            `.spec` put "fee $5.80 → seller gets $52.20" in one right-aligned
            cell, which broke mid-phrase on phones; each number now has its
            own column, so the key figures scan down a line. */}
        <Rv className="tile">
          <TileHead label="Worked examples" />
          <table className="feetable">
            <thead>
              <tr>
                <th scope="col">Sale total</th>
                <th scope="col">DRVN fee</th>
                <th scope="col">Seller gets</th>
              </tr>
            </thead>
            <tbody>
              {EXAMPLES.map(([price, shipping]) => {
                const basis = price + shipping;
                const fee = platformFeeCents(basis);
                return (
                  <tr key={price}>
                    <th scope="row">
                      {formatPrice(basis)}
                      <span className="feetable__sub">
                        {shipping > 0
                          ? `${formatPrice(price)} + ${formatPrice(shipping)} shipping`
                          : "Item only, no shipping"}
                      </span>
                    </th>
                    <td>{formatPrice(fee)}</td>
                    <td className="feetable__net">{formatPrice(basis - fee)}</td>
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
          <TileHead label="What the buyer pays" />
          <p className="text-body leading-relaxed">
            The asking price plus the seller&apos;s shipping. Nothing is added at checkout — the
            number on the listing is the number you pay. The fee is invisible to buyers because it
            comes out of the seller&apos;s side.
          </p>
        </Rv>

        <Rv className="tile" stagger={2}>
          <TileHead label="Why charge from day one" />
          <p className="text-body leading-relaxed">
            Because introducing a fee later, once people have built their listings around free, is a
            bait and switch. The rate has been the same since the first line of checkout code.
          </p>
        </Rv>

        {paymentsAreLive() && (
          <Rv className="tile" stagger={3}>
            <TileHead label="Payments are live" />
            <p className="text-body leading-relaxed">
              Payments run live through Stripe: orders move real money and payouts are made on the
              schedule above. The fee maths hasn&apos;t changed — it&apos;s been the same since
              checkout shipped.
            </p>
            <div className="mt-4">
              <Link href="/terms" className="jumplink inline-flex">
                Read the terms
              </Link>
            </div>
          </Rv>
        )}
      </section>
    </>
  );
}
