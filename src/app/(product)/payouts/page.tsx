import Link from "next/link";
import { redirect } from "next/navigation";

import { Foot, PageHead, SellingNav } from "@/components/ui";
import { getConnectAccountId } from "@/lib/payments/connect";
import { getSellerLedger } from "@/lib/payments/ledger";
import { getPaymentProvider, paymentsAreLive } from "@/lib/payments/provider";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [ledger, offersCount, connectAccountId, { data: profile }] = await Promise.all([
    getSellerLedger(supabase, user.id),
    loadOffersNeedingAttention(supabase, user.id),
    // No client select grant on the Connect pointer — read server-side, the
    // same way Settings does.
    getConnectAccountId(user.id).catch(() => null),
    supabase.from("profiles").select("payouts_enabled").eq("id", user.id).maybeSingle(),
  ]);

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
          connect={{
            stripeConfigured: getPaymentProvider().name === "stripe",
            hasAccount: Boolean(connectAccountId),
            payoutsEnabled: profile?.payouts_enabled ?? false,
          }}
        />
        <PayoutsSection ledger={ledger} paymentsLive={paymentsAreLive()} />
      </section>

      <Foot left="DRVN — Payouts" right={<Link href="/selling">← Selling</Link>} />
    </div>
  );
}
