import Link from "next/link";
import { redirect } from "next/navigation";

import { Foot, PageHead, SellingNav } from "@/components/ui";
import { getSellerLedger } from "@/lib/payments/ledger";
import { paymentsAreLive } from "@/lib/payments/provider";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

import { PayoutsSection } from "../settings/payouts-section";

export const metadata = { title: "Payouts - DRVN" };

/**
 * Payouts as a Selling-family surface (brief §J). The ledger section is the
 * same component Settings embeds — one source of truth for the money view;
 * onboarding and payment configuration stay in Settings → Payments.
 */
export default async function PayoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [ledger, offersCount] = await Promise.all([
    getSellerLedger(supabase, user.id),
    loadOffersNeedingAttention(supabase, user.id),
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
        sub={
          <>
            Every delivered sale, fee already taken out — clearing, then available.{" "}
            <Link href="/settings#payouts" className="underline">
              Payment configuration lives in Settings
            </Link>
            .
          </>
        }
      />

      <section className="deck">
        <PayoutsSection ledger={ledger} paymentsLive={paymentsAreLive()} />
      </section>

      <Foot left="DRVN — Payouts" right={<Link href="/selling">← Selling</Link>} />
    </div>
  );
}
