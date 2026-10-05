import Link from "next/link";

import { TileHead } from "@/components/ui";

import { formatPrice } from "@/lib/payments/fee";
import {
  CLEARING_HOLD_DAYS,
  LEDGER_FETCH_CAP,
  type SellerLedger,
  type LedgerState,
} from "@/lib/payments/ledger";

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
  /** Null when the ledger couldn't be read (R2-05) — shown as unavailable,
   *  never as $0. */
  ledger: SellerLedger | null;
  paymentsLive: boolean;
}) {
  if (!ledger) {
    return (
      <section id="payouts" className="tile tile--deep">
        <TileHead label="What you've earned" />
        <p role="status" className="field__hint max-w-[62ch]">
          We couldn&apos;t load your earnings just now, so there are no totals to show. Your
          sales and payouts are unaffected.
        </p>
        <a href="/payouts" className="jumplink mt-3 inline-block">
          Try again →
        </a>
      </section>
    );
  }
  // Payouts never go below zero; label costs a payout couldn't cover are
  // owed separately and come off the next one (20261005110100).
  const lifetimeCents =
    ledger.heldCents +
    ledger.clearingCents +
    ledger.availableCents +
    ledger.paidOutCents -
    ledger.owedCents;
  const lines = ledger.lines.slice(0, RECENT_LINES);

  return (
    <section id="payouts" className="tile tile--deep">
      <TileHead
        label="What you've earned"
        end={!paymentsLive ? <span className="chip whitespace-nowrap">Test mode</span> : undefined}
      />
      {/* The page head already says what this is; the tile states the rule. */}
      <p className="field__hint max-w-[62ch]">
        Clears {CLEARING_HOLD_DAYS} days after delivery.
        {!paymentsLive && " Test mode — no real money has moved."}
      </p>

      <div className="mt-3">
        <div className="sheet__row items-baseline">
          <span>Clearing</span>
          <b>{compactMoney(ledger.clearingCents)}</b>
        </div>
        <div className="sheet__row items-baseline">
          <span>Available</span>
          <b>{compactMoney(ledger.availableCents)}</b>
        </div>
        {ledger.owedCents > 0 && (
          <div className="sheet__row items-baseline">
            <span>Label costs owed — off your next payout</span>
            <b>−{compactMoney(ledger.owedCents)}</b>
          </div>
        )}
        {ledger.creditCents > 0 && (
          <div className="sheet__row items-baseline">
            <span>Label refund credit — sent to your Stripe balance within a day</span>
            <b>{compactMoney(ledger.creditCents)}</b>
          </div>
        )}
        <div className="sheet__row items-baseline">
          <span>{ledger.truncated ? `Net, latest ${LEDGER_FETCH_CAP} sales` : "Lifetime net"}</span>
          <b>{compactMoney(lifetimeCents)}</b>
        </div>
      </div>
      {ledger.truncated && (
        <p className="field__hint mt-2 max-w-[62ch]">
          These totals cover your latest {LEDGER_FETCH_CAP} sales only. Older sales keep their
          breakdown on each order.
        </p>
      )}

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
                  Payout
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
                    {line.refundedCents > 0 && (
                      <span className="order__meta block">
                        {formatPrice(line.refundedCents)} refunded to the buyer · −
                        {formatPrice(line.refundShareCents)} from your share,{" "}
                        {formatPrice(line.feeRefundShareCents)} from DRVN&apos;s fee
                      </span>
                    )}
                    {line.carriedCents < 0 && (
                      <span className="order__meta block">
                        {formatPrice(-line.carriedCents)} of label costs{" "}
                        {line.carrySettled ? "taken from a later payout" : "come off your next payout"}
                      </span>
                    )}
                    {line.carriedInCents > 0 && (
                      <span className="order__meta block">
                        −{formatPrice(line.carriedInCents)} kept back for earlier orders&apos; label costs
                      </span>
                    )}
                  </td>
                  <td className="ledger__num" data-label="Payout">
                    {formatPrice(line.payoutCents)}
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
