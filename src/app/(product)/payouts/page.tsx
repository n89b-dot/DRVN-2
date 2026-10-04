import Link from "next/link";
import { redirect } from "next/navigation";

import { Foot, PageHead, SellingNav } from "@/components/ui";
import { getConnectAccountId } from "@/lib/payments/connect";
import { getSellerLedger } from "@/lib/payments/ledger";
import { getPaymentProvider, paymentsAreLive } from "@/lib/payments/provider";
import { reportError } from "@/lib/monitoring";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

import { PayoutSetup } from "../settings/payout-setup";
import { PayoutsSection } from "../settings/payouts-section";

export const metadata = { title: "Payouts - DRVN" };

/**
 * Payouts as a Selling-family surface (brief §J) — the one home for a
 * seller's money: whether the payout account is connected (and the action
 * that connects it), then the ledger. Settings links here rather than
 * embedding a second copy.
 */
export default async function PayoutsPage() {
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const [ledgerRead, offersCount, connectAccount, profileRead] = await Promise.all([
    getSellerLedger(supabase, user.id),
    loadOffersNeedingAttention(supabase, user.id),
    // No client select grant on the Connect pointer — read server-side, the
    // same way Settings does. A failed read is "unavailable", never "no
    // account" (R2-05): that would offer to set up payouts a second time.
    getConnectAccountId(user.id).then(
      (id) => ({ ok: true as const, id }),
      (error) => {
        reportError("[payouts] connect lookup failed", { error });
        return { ok: false as const };
      }
    ),
    supabase.from("profiles").select("payouts_enabled").eq("id", user.id).maybeSingle(),
  ]);
  if (profileRead.error) reportError("[payouts] payout status read failed", { error: profileRead.error });
  const connectKnown = connectAccount.ok && !profileRead.error && Boolean(profileRead.data);
  const ledger = ledgerRead.status === "ok" ? ledgerRead.ledger : null;

  return (
    <div className="wrap">
      <SellingNav current="payouts" offersCount={offersCount} />

      <PageHead
        eyebrow="Selling — payouts"
        className="pagehead--task"
        title={
          <>
            Where the money <span className="live-word">stands.</span>
          </>
        }
        sub="Where your sale money goes, and where each sale stands on its way there."
      />

      <section className="deck">
        <PayoutSetup
          connect={
            connectKnown
              ? {
                  stripeConfigured: getPaymentProvider().name === "stripe",
                  hasAccount: Boolean(connectAccount.ok && connectAccount.id),
                  payoutsEnabled: profileRead.data?.payouts_enabled ?? false,
                }
              : { stripeConfigured: getPaymentProvider().name === "stripe", unavailable: true }
          }
          waitingCents={ledger ? ledger.heldCents + ledger.clearingCents + ledger.availableCents : 0}
        />
        <PayoutsSection ledger={ledger} paymentsLive={paymentsAreLive()} />
      </section>

      <Foot left="DRVN — Payouts" right={<Link href="/selling">← Selling</Link>} />
    </div>
  );
}
