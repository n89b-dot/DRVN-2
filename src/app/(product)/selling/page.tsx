import Link from "next/link";
import { redirect } from "next/navigation";

import { Alert, Foot, MetricCard, PageHead, SellingNav, TileHead } from "@/components/ui";
import { getSellerLedger } from "@/lib/payments/ledger";
import { paymentsAreLive } from "@/lib/payments/provider";
import { sellerCanPublish } from "@/lib/payments/connect";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";
import { Countdown, LiveDim } from "@/components/livesheet";

export const metadata = { title: "Selling - DRVN" };

const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

/**
 * The Selling overview (brief §J) — a seller's shop at a glance, composed
 * entirely from surfaces that already exist: what needs you first (offers,
 * questions, orders to ship), how the stock stands, and where the money is.
 * Deliberately NOT a browse surface: Marketplace is where people buy; this is
 * where sellers operate.
 */
export default async function SellingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [offersCount, tallyRes, questionsRes, toShipRes, ledger, canPublish, soonestRes, viewRes] = await Promise.all([
    loadOffersNeedingAttention(supabase, user.id),
    supabase.rpc("seller_register_tally", { p_seller: user.id }),
    supabase.rpc("seller_open_questions", { p_seller: user.id }),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "paid"),
    getSellerLedger(supabase, user.id),
    sellerCanPublish(user.id).catch(() => true),
    // H-6: the two figures that were only on Home. They ride in the same
    // round as everything else rather than waiting behind it.
    supabase
      .from("offers")
      .select("expires_at, listings!inner(seller_id)")
      .eq("listings.seller_id", user.id)
      .eq("status", "open")
      .not("expires_at", "is", null)
      .order("expires_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("listings").select("view_count").eq("seller_id", user.id).eq("status", "active"),
  ]);

  // "Three offers waiting" is a number; "the oldest lapses in four hours" is
  // the reason to act on it.
  const soonestOffer = offersCount > 0 ? soonestRes.data : null;
  // Eyes on your parts: how many times the parts you have live were opened.
  const views = (viewRes.data ?? []).reduce((sum, l) => sum + (l.view_count ?? 0), 0);
  if (tallyRes.error) reportError("[selling] seller_register_tally failed", tallyRes.error);
  const tally = Array.isArray(tallyRes.data) ? tallyRes.data[0] : tallyRes.data;
  const openQuestions = questionsRes.data ?? 0;
  const toShip = toShipRes.count ?? 0;
  const live = tally?.live_count ?? 0;
  const sold = tally?.sold_count ?? 0;
  const drafts = tally?.draft_count ?? 0;

  const attention: { label: string; href: string; count: number }[] = [
    { label: "Offers waiting on you", href: "/offers", count: offersCount },
    { label: "Questions to answer", href: "/listings", count: openQuestions },
    { label: "Orders to dispatch", href: "/orders?tab=sales", count: toShip },
  ].filter((item) => item.count > 0);

  return (
    <div className="wrap">
      <SellingNav current="selling" offersCount={offersCount} />

      <PageHead
        eyebrow="Selling — your shop"
        className="pagehead--task"
        title={
          <>
            Run the <span className="live-word">stall.</span>
          </>
        }
        sub="Everything selling-related in one place: what needs you first, how the stock stands, and where the money is."
      />

      {!canPublish && paymentsAreLive() && (
        <Alert tone="live" title="Payouts aren't set up yet">
          Publishing needs somewhere to send your money —{" "}
          <Link href="/settings#payouts" className="underline">
            set up payouts in Settings → Payments
          </Link>
          . Drafts still save.
        </Alert>
      )}

      <section className="deck deck--kpi">
        <MetricCard
          label="Needs you"
          live={attention.length > 0}
          value={attention.reduce((sum, item) => sum + item.count, 0) || "—"}
          blank={attention.length === 0}
          footer={
            attention.length > 0 ? (
              <span className="flex flex-col gap-1">
                {attention.map((item) => (
                  <Link key={item.href} href={item.href} className="jumplink">
                    {item.count} {item.label.toLowerCase()} →
                  </Link>
                ))}
              </span>
            ) : (
              <span className="text-micro text-dim">Nothing waiting — nice.</span>
            )
          }
        >
          {soonestOffer?.expires_at && (
            <LiveDim
              label="Oldest offer lapses in"
              value={<Countdown expiresAt={soonestOffer.expires_at} />}
              live
            />
          )}
        </MetricCard>
        <MetricCard
          label="Live listings"
          value={live || "—"}
          blank={live === 0}
          footer={
            <Link href="/listings" className="jumplink">
              {drafts > 0 ? `${drafts} draft${drafts === 1 ? "" : "s"} · ` : ""}Manage stock →
            </Link>
          }
        >
          {live > 0 && (
            <LiveDim
              label="Eyes on your parts"
              value={views > 0 ? `${views.toLocaleString("en-US")} view${views === 1 ? "" : "s"}` : "None yet"}
            />
          )}
        </MetricCard>
        <MetricCard
          label="Sold"
          value={sold || "—"}
          blank={sold === 0}
          footer={
            <Link href="/orders?tab=sales" className="jumplink">
              Sales →
            </Link>
          }
        />
        <MetricCard
          label="Available to pay out"
          value={ledger.availableCents > 0 ? money(ledger.availableCents) : "—"}
          blank={ledger.availableCents === 0}
          footer={
            <Link href="/payouts" className="jumplink">
              {ledger.clearingCents > 0 ? `${money(ledger.clearingCents)} clearing · ` : ""}
              Payouts →
            </Link>
          }
        />
      </section>

      <section className="deck">
        <div className="tile">
          <TileHead
            label="List something"
            end={
              <Link href="/sell" className="jumplink">
                New listing →
              </Link>
            }
          />
          <p className="field__hint max-w-[62ch]">
            Parts off a car in your garage carry the build&apos;s context automatically — open a
            car&apos;s build sheet and use &ldquo;Sell it&rdquo; on the line, or start from
            scratch on the sell sheet. Already posted it on Facebook or a forum?{" "}
            <Link href="/sell/import" className="jumplink">
              Import the existing listing →
            </Link>
          </p>
        </div>
      </section>

      <Foot left="DRVN — Selling" right={<Link href="/marketplace">Browse the marketplace →</Link>} />
    </div>
  );
}
