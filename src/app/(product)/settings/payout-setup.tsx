"use client";

import { Button, TileHead } from "@/components/ui";
import { useRecoverableAction } from "@/features/commerce/use-recoverable-action";

import { startConnectOnboarding } from "./payouts-actions";
import { formatPrice } from "@/lib/payments/fee";
import { PAYOUT_SETUP_DEADLINE_DAYS } from "@/lib/payments/payout-readiness";

export type ConnectSummary =
  | {
      stripeConfigured: boolean;
      hasAccount: boolean;
      payoutsEnabled: boolean;
      /** Details sent to Stripe: listings can go live while it verifies. */
      detailsSubmitted?: boolean;
      /** The payout deadline passed with payouts off: listings are paused. */
      restricted?: boolean;
      unavailable?: never;
    }
  /** The account state couldn't be read (R2-05). Not "not set up": that
   *  would offer to create a payout account the seller may already have. */
  | { stripeConfigured: boolean; unavailable: true };

/**
 * The payout account's state and its one action — whether money has
 * somewhere to go. Leads /payouts, the family's money surface; Settings no
 * longer carries a second copy (it links here).
 *
 * In test mode there is no account to connect, and the row says so rather
 * than disappearing: an absent status read as "unknown", not "not needed".
 */
export function PayoutSetup({
  connect,
  waitingCents = 0,
}: {
  connect: ConnectSummary;
  /** Sale money that can't be paid out until payouts are set up. */
  waitingCents?: number;
}) {
  // Safe to retry after a lost response: an existing payout account is
  // reused, and the worst case is a second Stripe link.
  const [state, action, pending] = useRecoverableAction<{ error?: string }>(
    async () => (await startConnectOnboarding()) ?? {},
    "Couldn't open Stripe just now. Try again."
  );

  if (!connect.stripeConfigured) {
    return (
      <section className="tile" aria-labelledby="payout-account">
        <TileHead
          label={<span id="payout-account">Payout account</span>}
          end={<span className="chip">Test mode</span>}
        />
        <p className="max-w-[62ch] text-dim">
          Payments run through a test provider, so there&apos;s no payout account to connect and
          no money moves. Live payouts go through Stripe once payments are switched on.
        </p>
      </section>
    );
  }

  if (connect.unavailable) {
    return (
      <section className="tile" aria-labelledby="payout-account">
        <TileHead
          label={<span id="payout-account">Payout account</span>}
          end={<span className="chip">Unavailable</span>}
        />
        <p role="status" className="max-w-[62ch] text-dim">
          We couldn&apos;t check your payout account just now. Nothing has changed with it.
        </p>
        <a href="/payouts" className="jumplink mt-3 inline-block">
          Try again →
        </a>
      </section>
    );
  }

  return (
    <section className="tile" aria-labelledby="payout-account">
      <TileHead
        label={<span id="payout-account">Payout account</span>}
        end={
          connect.payoutsEnabled ? (
            <span className="chip chip--ok">Payouts enabled</span>
          ) : connect.restricted ? (
            <span className="chip chip--live">Listings paused</span>
          ) : connect.hasAccount && connect.detailsSubmitted ? (
            <span className="chip">Stripe is checking</span>
          ) : connect.hasAccount ? (
            <span className="chip chip--live">Setup incomplete</span>
          ) : (
            <span className="chip chip--live">Not set up</span>
          )
        }
      />
      <p className="max-w-[62ch] text-dim">
        {connect.payoutsEnabled
          ? "Your Stripe account can receive payouts. Sale proceeds transfer automatically when a buyer's payment settles."
          : connect.restricted
            ? `A sale passed ${PAYOUT_SETUP_DEADLINE_DAYS} days without payouts switched on, so your listings are paused and orders you hadn't dispatched were cancelled and refunded. Finish setup with Stripe and your listings come back on their own.`
            : connect.hasAccount && connect.detailsSubmitted
              ? `Stripe has your details and is verifying them. Your listings can go live and sell meanwhile; the money is paid out once Stripe switches payouts on. If that hasn't happened ${PAYOUT_SETUP_DEADLINE_DAYS} days after a sale, an order you haven't dispatched is cancelled and the buyer refunded, and your listings come down until it has.`
              : "Selling needs somewhere for the money to go. Stripe verifies your details and holds your bank account — DRVN never sees either. Until you've sent Stripe your details, listings can't be published."}
      </p>
      {!connect.payoutsEnabled && waitingCents > 0 && (
        <p className="mt-2 max-w-[62ch] font-medium">
          {`You have ${formatPrice(waitingCents)} from sales waiting. It's paid out once this is set up.`}
        </p>
      )}
      <form action={action} className="mt-4">
        <Button
          type="submit"
          variant={connect.payoutsEnabled ? "ghost" : "live"}
          loading={pending}
          pendingLabel="Opening Stripe…"
        >
          {connect.payoutsEnabled
            ? "Update payout details"
            : connect.hasAccount
              ? "Finish payout setup"
              : "Set up payouts"}
        </Button>
      </form>
      {state.error && (
        <p role="alert" aria-live="polite" className="field__err mt-3">
          {state.error}
        </p>
      )}
    </section>
  );
}
