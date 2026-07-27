import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { Countdown, LiveDim, Rv } from "@/components/livesheet";
import type { Database } from "@/lib/database.types";
import { formatPrice } from "@/lib/payments/fee";

const DAYS = 30;

/**
 * KPI money is rounded to whole units. A num-giant is 40–64px, and
 * "$1,499.60" simply does not fit a quarter-width tile — the cents are noise
 * at this scale anyway. The exact figure lives on the order and the ledger.
 */
function compactMoney(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

/**
 * A 30-day sales sparkline drawn as an inline SVG polyline.
 *
 * Deliberately not a chart library: this is one series of daily totals with no
 * axes, no tooltip and no legend — a dimension line that happens to wander.
 * Rendered server-side from real orders; if there are no sales the caller shows
 * the blank state rather than a flat line pretending to be data.
 */
function Sparkline({ series, label }: { series: number[]; label: string }) {
  const w = 132;
  const h = 30;
  const max = Math.max(...series, 1);
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const points = series
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");
  const lastX = ((series.length - 1) * step).toFixed(1);
  const lastY = (h - (series[series.length - 1] / max) * h).toFixed(1);

  return (
    <svg
      viewBox={`0 0 ${w} ${h + 4}`}
      className="mt-2 h-[34px] w-full"
      role="img"
      aria-label={label}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--dimline)"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {/* the head of the line is the only live thing on it */}
      <circle cx={lastX} cy={lastY} r="2.5" fill="var(--live)" />
    </svg>
  );
}

/**
 * The seller's KPI deck (Werkbank C4). Four measured facts with a live
 * dimension line under each: what's listed, what needs an answer, what sold,
 * and how many buyers' garages your parts actually fit.
 *
 * Renders nothing at all for someone who has never listed — an empty dashboard
 * of zeroes is worse than no dashboard.
 */
export async function SellerKpis({
  supabase,
  userId,
}: {
  supabase: SupabaseClient<Database>;
  userId: string;
}) {
  // Read the clock once, through `new Date()` — the purity lint rightly flags
  // bare `Date.now()` calls in a render path.
  const nowMs = new Date().getTime();
  const since = new Date(nowMs - DAYS * 24 * 3600 * 1000);

  const { data: listings } = await supabase
    .from("listings")
    .select("id, status, source_car_id")
    .eq("seller_id", userId);

  const mine = listings ?? [];
  if (!mine.length) return null;

  const listingIds = mine.map((l) => l.id);
  const activeIds = mine.filter((l) => l.status === "active").map((l) => l.id);

  const [{ data: offers }, { data: orders }] = await Promise.all([
    listingIds.length
      ? supabase
          .from("offers")
          .select("id, expires_at, status")
          .in("listing_id", listingIds)
          .in("status", ["open", "countered"])
      : Promise.resolve({ data: [] }),
    supabase
      .from("orders")
      .select("total_cents, platform_fee_cents, created_at, status")
      .eq("seller_id", userId)
      .gte("created_at", since.toISOString()),
  ]);

  // Sales that actually happened — a cancelled order is not revenue.
  const sales = (orders ?? []).filter(
    (o) => !["cancelled", "refunded", "payment_failed", "pending"].includes(o.status)
  );
  const salesTotal = sales.reduce((sum, o) => sum + (o.total_cents - o.platform_fee_cents), 0);

  const series = Array.from({ length: DAYS }, () => 0);
  for (const order of sales) {
    const dayIndex =
      DAYS - 1 - Math.floor((nowMs - new Date(order.created_at).getTime()) / 86_400_000);
    if (dayIndex >= 0 && dayIndex < DAYS) {
      series[dayIndex] += order.total_cents - order.platform_fee_cents;
    }
  }

  const openOffers = offers ?? [];
  const soonest = openOffers
    .map((o) => o.expires_at)
    .filter(Boolean)
    .sort()[0] as string | undefined;

  // Fitment matches: buyers whose garage shares make+model with a source car
  // behind one of your live parts. Metadata only — never seller notes.
  let fitmentMatches = 0;
  const sourceCarIds = mine
    .filter((l) => activeIds.includes(l.id))
    .map((l) => l.source_car_id)
    .filter(Boolean) as string[];

  if (sourceCarIds.length) {
    const { data: sourceCars } = await supabase
      .from("cars")
      .select("make, model")
      .in("id", [...new Set(sourceCarIds)]);

    const keys = new Set(
      (sourceCars ?? [])
        .filter((c) => c.make && c.model)
        .map((c) => `${c.make!.toLowerCase()}|${c.model!.toLowerCase()}`)
    );

    if (keys.size) {
      const makes = [...new Set((sourceCars ?? []).map((c) => c.make).filter(Boolean))] as string[];
      const { data: theirCars } = await supabase
        .from("cars")
        .select("owner_id, make, model")
        .in("make", makes)
        .neq("owner_id", userId);

      const owners = new Set(
        (theirCars ?? [])
          .filter(
            (c) => c.make && c.model && keys.has(`${c.make.toLowerCase()}|${c.model.toLowerCase()}`)
          )
          .map((c) => c.owner_id)
      );
      fitmentMatches = owners.size;
    }
  }

  const underOffer = openOffers.length;

  return (
    <section className="deck deck--kpi">
      <Rv className="tile" stagger={0}>
        <span className="microlabel">Active listings</span>
        <p className="num-giant mt-1">{activeIds.length}</p>
        <LiveDim
          label="On the market"
          value={`${activeIds.length} live · ${mine.length} total`}
        />
      </Rv>

      <Rv className="tile" stagger={1}>
        <span className={`microlabel ${underOffer ? "microlabel--live" : ""}`}>
          Offers awaiting reply
        </span>
        <p className={`num-giant mt-1 ${underOffer ? "text-live" : "num-giant--blank"}`}>
          {underOffer || "—"}
        </p>
        {underOffer > 0 ? (
          <LiveDim
            label="Oldest lapses in"
            value={soonest ? <Countdown expiresAt={soonest} /> : "No window set"}
            live
          />
        ) : (
          <LiveDim label="Nothing waiting on you" value="—" blank />
        )}
      </Rv>

      <Rv className="tile" stagger={2}>
        <span className="microlabel">30-day takings</span>
        <p className={`num-giant mt-1 ${salesTotal ? "" : "num-giant--blank"}`}>
          {compactMoney(salesTotal)}
        </p>
        {salesTotal > 0 ? (
          <>
            <Sparkline
              series={series}
              label={`Daily payouts over the last ${DAYS} days, totalling ${formatPrice(salesTotal)}`}
            />
            <LiveDim
              label="After fees"
              value={`${sales.length} sale${sales.length === 1 ? "" : "s"} · ${DAYS} days`}
            />
          </>
        ) : (
          <LiveDim label="First payout lands here" value="—" blank />
        )}
      </Rv>

      <Rv className="tile" stagger={3}>
        <span className="microlabel">Garage fitment matches</span>
        <p className={`num-giant mt-1 ${fitmentMatches ? "" : "num-giant--blank"}`}>
          {fitmentMatches || "—"}
        </p>
        <LiveDim
          label={fitmentMatches ? "Keepers whose cars fit your parts" : "No matching garages yet"}
          value={fitmentMatches ? `${fitmentMatches} keeper${fitmentMatches === 1 ? "" : "s"}` : "—"}
          blank={!fitmentMatches}
        />
      </Rv>

      <div className="col-span-full -mt-1">
        <Link href="/listings" className="jumplink">
          Open the listings ledger →
        </Link>
      </div>
    </section>
  );
}
