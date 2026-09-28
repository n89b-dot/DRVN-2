import Link from "next/link";
import { redirect } from "next/navigation";

import {
  Alert,
  ButtonLink,
  Foot,
  MetricCard,
  PageHead,
  SellingNav,
  TileHead,
} from "@/components/ui";
import { ListingRow } from "@/components/commerce";
import { formatPrice } from "@/lib/payments/fee";
import { getSellerLedger } from "@/lib/payments/ledger";
import { sellerCanPublish } from "@/lib/payments/connect";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";
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
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  const [offersCount, tallyRes, questionsRes, toShipRes, ledger, canPublish, soonestRes, viewRes, recentRes] = await Promise.all([
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
    // The parts themselves, so the hub isn't four numbers about stock the
    // seller never sees: the most recent working listings, cover first.
    supabase
      .from("listings")
      .select("id, title, price_cents, status, listing_images(url, position)")
      .eq("seller_id", user.id)
      .in("status", ["active", "draft", "paused", "reserved"])
      .order("created_at", { ascending: false })
      .limit(4),
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
  if (recentRes.error) reportError("[selling] recent listings failed", recentRes.error);
  const recent = (recentRes.data ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    price: formatPrice(l.price_cents),
    status: l.status,
    cover:
      [...(l.listing_images ?? [])].sort((a, b) => a.position - b.position)[0]?.url ?? null,
  }));

  const waitingCents = ledger.heldCents + ledger.clearingCents + ledger.availableCents;

  const attention: { label: string; href: string; count: number }[] = [
    { label: "Offers waiting on you", href: "/offers", count: offersCount },
    { label: "Questions to answer", href: "/listings", count: openQuestions },
    { label: "Orders to dispatch", href: "/orders?view=sales&status=paid", count: toShip },
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

      {/* Shown whenever publishing is blocked — test mode included, where
          the gate is just as real — and it names money already waiting. */}
      {!canPublish && (
        <Alert tone="live" title="Payouts aren't set up yet">
          {waitingCents > 0
            ? `You have ${money(waitingCents)} from sales waiting, and new listings can't go live until `
            : "Publishing needs somewhere to send your money — "}
          <Link href="/payouts" className="underline">
            {waitingCents > 0 ? "payouts are set up" : "set up payouts"}
          </Link>
          . Drafts still save.
        </Alert>
      )}

      <section className="deck deck--kpi !pb-4">
        <MetricCard
          label="Needs you"
          live={attention.length > 0}
          value={attention.reduce((sum, item) => sum + item.count, 0)}
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
          value={live}
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
          value={sold}
          blank={sold === 0}
          footer={
            <Link href="/orders?view=sales" className="jumplink">
              Sales →
            </Link>
          }
        />
        <MetricCard
          label="Available to pay out"
          value={money(ledger.availableCents)}
          blank={ledger.availableCents === 0}
          footer={
            <Link href="/payouts" className="jumplink">
              {ledger.clearingCents > 0 ? `${money(ledger.clearingCents)} clearing · ` : ""}
              Payouts →
            </Link>
          }
        />
      </section>

      {/* The parts and the way to add another, side by side at desktop —
          stacked decks each carried their own 80px floor, which left a dead
          band under the KPIs and a page that ended after one short tile. */}
      <section className={recent.length > 0 ? "deck deck--two" : "deck"}>
        {recent.length > 0 && (
          <div className="tile">
            <TileHead
              label="Your parts"
              end={
                <Link href="/listings" className="jumplink">
                  All listings →
                </Link>
              }
            />
            <div className="rowlist">
              {recent.map((listing) => (
                <ListingRow key={listing.id} listing={listing} />
              ))}
            </div>
          </div>
        )}
        <div className="tile flex flex-col">
          <TileHead label="List something" />
          <p className="max-w-[62ch] text-dim">
            Parts off a car in your garage carry the build&apos;s context automatically — open a
            car&apos;s build sheet and use &ldquo;Sell it&rdquo; on the line, or start from
            scratch.
          </p>
          <div className="mt-auto flex flex-wrap items-center gap-x-5 gap-y-3 pt-5">
            <ButtonLink variant="live" href="/sell">
              New listing
            </ButtonLink>
            <Link href="/sell/import" className="jumplink">
              Import an existing listing →
            </Link>
          </div>
        </div>
      </section>

      <Foot left="DRVN — Selling" right={<Link href="/marketplace">Browse the marketplace →</Link>} />
    </div>
  );
}
