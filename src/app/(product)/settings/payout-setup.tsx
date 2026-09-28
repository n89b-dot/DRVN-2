"use client";

import { useActionState } from "react";

import { Button, TileHead } from "@/components/ui";

import { startConnectOnboarding } from "./payouts-actions";
import { formatPrice } from "@/lib/payments/fee";

export type ConnectSummary = {
  stripeConfigured: boolean;
  hasAccount: boolean;
  payoutsEnabled: boolean;
};

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
  const [state, action, pending] = useActionState<{ error?: string }, FormData>(
    async () => (await startConnectOnboarding()) ?? {},
    {}
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

  return (
    <section className="tile" aria-labelledby="payout-account">
      <TileHead
        label={<span id="payout-account">Payout account</span>}
        end={
          connect.payoutsEnabled ? (
            <span className="chip chip--ok">Payouts enabled</span>
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
          : "Selling needs somewhere for the money to go. Stripe verifies your details and holds your bank account — DRVN never sees either. Until this is done, listings can't be published."}
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
