import Link from "next/link";

import { formatPrice } from "@/lib/payments/fee";
import { CLEARING_HOLD_DAYS, type SellerLedger, type LedgerState } from "@/lib/payments/ledger";

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

/** Whole units — the exact figure lives on each order line below. */
function compactMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/** The latest N ledger lines shown inside settings — the full history is on
 *  each order; this section is about where the money stands, not archaeology. */
const RECENT_LINES = 25;

/**
 * Settings → Payouts: what you've earned and where it stands. Everything is
 * derived from `orders` at request time (see src/lib/payments/ledger.ts) —
 * there is no payouts table and nothing to reconcile. Server-rendered and
 * passed into the client SettingsPanel as a slot.
 */
export function PayoutsSection({
  ledger,
  paymentsLive,
}: {
  ledger: SellerLedger;
  paymentsLive: boolean;
}) {
  const lifetimeCents =
    ledger.heldCents + ledger.clearingCents + ledger.availableCents + ledger.paidOutCents;
  const lines = ledger.lines.slice(0, RECENT_LINES);

  return (
    <section id="payouts" className="tile tile--deep">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">Payouts — what you&apos;ve earned</span>
        {!paymentsLive && <span className="chip">Test mode</span>}
      </div>
      <p className="field__hint max-w-[62ch]">
        Every delivered sale, with the fee already taken out — clearing for {CLEARING_HOLD_DAYS}{" "}
        days after delivery, then available.
        {!paymentsLive && " Payments are in test mode, so nothing here has moved any money."}
      </p>

      <div className="mt-3">
        <div className="sheet__row">
          <span>Clearing</span>
          <b>{compactMoney(ledger.clearingCents)}</b>
        </div>
        <div className="sheet__row">
          <span>Available</span>
          <b>{compactMoney(ledger.availableCents)}</b>
        </div>
        <div className="sheet__row">
          <span>Lifetime net</span>
          <b>{compactMoney(lifetimeCents)}</b>
        </div>
      </div>

      {lines.length === 0 ? (
        <p className="field__hint mt-4 max-w-[62ch]">
          Nothing to pay out yet. Once a buyer&apos;s order is paid and delivered, it lands here
          with the fee already worked out.
        </p>
      ) : (
        <>
          <table className="ledger mt-4">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col" className="text-right">
                  Net
                </th>
                <th scope="col">State</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.orderId}>
                  <td>
                    <Link
                      href={`/orders/${line.orderId}`}
                      className="order__name block hover:text-live"
                    >
                      {line.title}
                    </Link>
                    <span className="order__meta block">
                      {line.deliveredAt
                        ? `Delivered ${new Date(line.deliveredAt).toLocaleDateString()}`
                        : "Awaiting delivery confirmation"}
                    </span>
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
          {ledger.lines.length > RECENT_LINES && (
            <p className="field__hint mt-3">
              Showing the latest {RECENT_LINES} of {ledger.lines.length} — every sale keeps its
              full breakdown on the order itself.
            </p>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap gap-4">
        <Link href="/orders?view=sales" className="jumplink">
          Sales history →
        </Link>
        <Link href="/fees" className="jumplink">
          Fee schedule →
        </Link>
      </div>
    </section>
  );
}
