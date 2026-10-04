import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, Foot, PageHead, SellingNav } from "@/components/ui";
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
export default async function PayoutsPage({
  searchParams,
}: {
  /** `?onboarding=` — set by the Stripe return route (settings/payouts/return). */
  searchParams: Promise<{ onboarding?: string }>;
}) {
  const { onboarding: onboardingParam } = await searchParams;
  const onboarding =
    onboardingParam === "returned" || onboardingParam === "expired" ? onboardingParam : null;
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const [ledgerRead, offersCount, connectAccount, profileRead, { count: draftCount }] = await Promise.all([
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
    // Back from Stripe: the drafts that setup was blocking are the way on.
    onboarding
      ? supabase
          .from("listings")
          .select("id", { count: "exact", head: true })
          .eq("seller_id", user.id)
          .eq("status", "draft")
      : Promise.resolve({ count: null }),
  ]);
  if (profileRead.error) reportError("[payouts] payout status read failed", { error: profileRead.error });
  const connectKnown = connectAccount.ok && !profileRead.error && Boolean(profileRead.data);
  const ledger = ledgerRead.status === "ok" ? ledgerRead.ledger : null;
  const payoutsEnabled = connectKnown && (profileRead.data?.payouts_enabled ?? false);
  const draftsLink =
    (draftCount ?? 0) > 0 ? (
      <Link href="/listings?register=draft" className="jumplink">
        {draftCount === 1 ? "Back to your draft →" : `Back to your ${draftCount} drafts →`}
      </Link>
    ) : (
      <Link href="/listings" className="jumplink">
        Back to your listings →
      </Link>
    );

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

      {onboarding === "expired" ? (
        <Alert tone="live" ico="!" title="Your Stripe setup link expired" role="alert">
          We couldn&apos;t open a fresh one just now. Use Finish payout setup below to pick up
          where you left off — nothing you entered is lost. {draftsLink}
        </Alert>
      ) : onboarding === "returned" && payoutsEnabled ? (
        <Alert tone="ok" ico="✓" title="Payouts are set up" role="status">
          Your listings can go live now. {draftsLink}
        </Alert>
      ) : onboarding === "returned" && connectKnown ? (
        <Alert tone="live" ico="!" title="Payout setup isn't finished yet" role="status">
          Stripe hasn&apos;t switched payouts on yet. If it still needs details, Finish payout setup
          below picks up where you left off; if it&apos;s checking them, this updates once it&apos;s
          done. {draftsLink}
        </Alert>
      ) : null}

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
