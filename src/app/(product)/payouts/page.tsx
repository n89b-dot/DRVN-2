import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { formatPrice } from "@/lib/payments/fee";
import { CLEARING_HOLD_DAYS, getSellerLedger, type LedgerState } from "@/lib/payments/ledger";
import { paymentsAreLive } from "@/lib/payments/provider";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Payouts - DRVN" };

const PAGE_SIZE = 25;

const STATE_LABEL: Record<LedgerState, string> = {
  held: "On hold",
  clearing: "Clearing",
  available: "Available",
  paid_out: "Paid out",
};

const STATE_CHIP: Record<LedgerState, string> = {
  held: "chip chip--spent",
  clearing: "chip chip--live",
  available: "chip chip--ok",
  paid_out: "chip chip--spent",
};

function compactMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * The seller's balance and payout ledger (Werkbank C4/C1, same idioms as the
 * KPI deck and the listings ledger). Everything here is derived from
 * `orders` at request time — there is no `payouts` table, no provider
 * balance to poll, and nothing to reconcile. See
 * `src/lib/payments/ledger.ts` for exactly how each line's numbers and
 * state are computed.
 */
export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = Math.max(1, Number.parseInt(pageParam ?? "1", 10) || 1);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const ledger = await getSellerLedger(supabase, user.id);
  const live = paymentsAreLive();

  const totalPages = Math.max(1, Math.ceil(ledger.lines.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const pageLines = ledger.lines.slice(start, start + PAGE_SIZE);

  const lifetimeCents =
    ledger.heldCents + ledger.clearingCents + ledger.availableCents + ledger.paidOutCents;

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">Payouts · ledger</span>
        <h1>
          What you&apos;ve <span className="live-word">earned.</span>
        </h1>
        <p className="sub">
          Every delivered sale, with the fee already taken out — clearing after delivery, then
          available. {!live && "Payments are in test mode, so nothing here has moved any money."}
        </p>
      </Rv>

      {!live && (
        <div className="alert alert--live mb-6">
          <span className="alert__ico" aria-hidden="true">
            ●
          </span>
          <h4>Payments are in test mode</h4>
          <p>
            DRVN runs on a test payment provider — see{" "}
            <Link href="/fees" className="jumplink !inline-flex">
              the fee schedule
            </Link>
            . These figures are real arithmetic on real orders, but no money has actually moved and
            no payout has actually been sent. &quot;Available&quot; below means the holding window
            has passed, not that funds have landed anywhere.
          </p>
        </div>
      )}

      <section className="deck deck--three">
        <Rv className="tile" stagger={0}>
          <span className="microlabel microlabel--live">Clearing</span>
          <p className={`num-giant mt-1 ${ledger.clearingCents ? "" : "num-giant--blank"}`}>
            {compactMoney(ledger.clearingCents)}
          </p>
          <p className="spec-note mt-2">
            Shipped or delivered less than {CLEARING_HOLD_DAYS} days ago.
          </p>
        </Rv>

        <Rv className="tile" stagger={1}>
          <span className="microlabel microlabel--ink">Available</span>
          <p className={`num-giant mt-1 ${ledger.availableCents ? "" : "num-giant--blank"}`}>
            {compactMoney(ledger.availableCents)}
          </p>
          <p className="spec-note mt-2">
            Past the {CLEARING_HOLD_DAYS}-day hold. Withdrawable once a payout provider is live.
          </p>
        </Rv>

        <Rv className="tile" stagger={2}>
          <span className="microlabel">Lifetime net</span>
          <p className={`num-giant mt-1 ${lifetimeCents ? "" : "num-giant--blank"}`}>
            {compactMoney(lifetimeCents)}
          </p>
          <p className="spec-note mt-2">
            {ledger.lines.length} sale{ledger.lines.length === 1 ? "" : "s"} total, after DRVN&apos;s
            fee.{ledger.truncated ? " Showing the most recent 500." : ""}
          </p>
        </Rv>
      </section>

      {ledger.lines.length === 0 ? (
        <Rv className="undrawn undrawn--hero">
          <span className="undrawn__mark" aria-hidden="true">
            ⎓
          </span>
          <h3>Nothing to pay out yet</h3>
          <p>
            Once a buyer&apos;s order is paid and delivered, it lands here with the fee already
            worked out — clearing first, then available.
          </p>
          <Link href="/listings" className="btn btn--live">
            Manage your listings
          </Link>
        </Rv>
      ) : (
        <section className="deck">
          <Rv className="tile">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">
                Payout ledger · {ledger.lines.length} order{ledger.lines.length === 1 ? "" : "s"}
              </span>
            </div>

            <table className="ledger mt-2">
              <thead>
                <tr>
                  <th scope="col">Order</th>
                  <th scope="col">Date</th>
                  <th scope="col" className="text-right">
                    Gross
                  </th>
                  <th scope="col" className="text-right">
                    Fee
                  </th>
                  <th scope="col" className="text-right">
                    Shipping
                  </th>
                  <th scope="col" className="text-right">
                    Net
                  </th>
                  <th scope="col">State</th>
                </tr>
              </thead>
              <tbody>
                {pageLines.map((line) => (
                  <tr key={line.orderId}>
                    <td>
                      <Link href={`/orders/${line.orderId}`} className="order__name block hover:text-live">
                        {line.title}
                      </Link>
                      <span className="order__meta block">
                        {line.deliveredAt
                          ? `Delivered ${new Date(line.deliveredAt).toLocaleDateString()}`
                          : "Awaiting delivery confirmation"}
                      </span>
                    </td>
                    <td className="order__meta whitespace-nowrap">
                      {new Date(line.createdAt).toLocaleDateString()}
                    </td>
                    <td className="ledger__num" data-label="Gross">
                      {formatPrice(line.grossCents)}
                    </td>
                    <td className="ledger__num" data-label="Fee">
                      −{formatPrice(line.feeCents)}
                    </td>
                    <td className="ledger__num" data-label="Shipping">
                      {line.shippingCents > 0 ? formatPrice(line.shippingCents) : "—"}
                    </td>
                    <td className="ledger__num" data-label="Net">
                      {formatPrice(line.netCents)}
                    </td>
                    <td>
                      <span className={STATE_CHIP[line.state]}>{STATE_LABEL[line.state]}</span>
                      {line.state === "clearing" && line.availableAt && (
                        <span className="order__meta mt-1 block">
                          Clears {new Date(line.availableAt).toLocaleDateString()}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <nav className="mt-6 flex items-center justify-between gap-3" aria-label="Pagination">
                {current > 1 ? (
                  <Link
                    href={current - 1 === 1 ? "/payouts" : `/payouts?page=${current - 1}`}
                    className="btn btn--ghost"
                    rel="prev"
                  >
                    ← Previous
                  </Link>
                ) : (
                  <span />
                )}
                <span className="microlabel">
                  Page {current} of {totalPages}
                </span>
                {current < totalPages ? (
                  <Link href={`/payouts?page=${current + 1}`} className="btn btn--ghost" rel="next">
                    Next →
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
            )}
          </Rv>
        </section>
      )}

      <Foot left="DRVN — payouts" right={<Link href="/fees">Fee schedule →</Link>} />
    </div>
  );
}
