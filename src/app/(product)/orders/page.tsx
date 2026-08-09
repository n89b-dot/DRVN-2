import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { OrderPipeline } from "./order-pipeline";
import { ReceivedButton } from "./[id]/fulfilment";
import { reportError } from "@/lib/monitoring";

export const metadata = { title: "Orders - DRVN" };

const PAGE_SIZE = 25;

function withParams(
  base: string,
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/** Milestone dates shown per row — every one that's actually set. There is
 *  no separate "paid at" column on orders (only the status transition), so
 *  "Placed" doubles as the paid milestone once the order is past pending. */
function milestones(order: {
  status: string;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
}) {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const stamps: { label: string; date: string }[] = [{ label: "Placed", date: fmt(order.created_at) }];
  if (order.shipped_at) stamps.push({ label: "Shipped", date: fmt(order.shipped_at) });
  if (order.delivered_at) stamps.push({ label: "Delivered", date: fmt(order.delivered_at) });
  if (order.completed_at) stamps.push({ label: "Completed", date: fmt(order.completed_at) });
  return stamps;
}

/**
 * Orders, on their own now that offers have moved to /offers.
 *
 * This used to render every offer inline (two 25-row queries, merged) on
 * top of a single unpaginated list of every order the user had ever placed
 * or sold. Orders are now tabbed (purchases/sales) and paginated 25 at a
 * time; offers get a compact summary card pointing at their own surface.
 */
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string; placed?: string; skipped?: string; offer?: string }>;
}) {
  const { view: viewParam, page: pageParam, placed, skipped, offer: legacyOfferId } = await searchParams;

  // Legacy deep link — anchors (`#offer-<id>`) can't be read server-side at
  // all, so only a query-param form of the old link can be redirected here.
  // The anchor-emitting link builders had to be fixed at the source instead.
  if (legacyOfferId) redirect(`/offers/${legacyOfferId}`);

  const view = viewParam === "sales" ? "sales" : "purchases";
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const roleColumn = view === "purchases" ? "buyer_id" : "seller_id";

  const [{ data: orders, count, error: ordersError }, { data: myListings }] = await Promise.all([
    supabase
      .from("orders")
      .select("*", { count: "exact" })
      .eq(roleColumn, user.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    supabase.from("listings").select("id").eq("seller_id", user.id).limit(2000),
  ]);

  if (ordersError) reportError("[orders] failed to load orders", ordersError);

  const rows = orders ?? [];
  const orderIds = rows.map((o) => o.id);
  const myListingIds = (myListings ?? []).map((l) => l.id);

  const [{ data: items }, { count: receivedOpenCount }, { count: madeCounteredCount }, { count: needsDispatchCount }] =
    await Promise.all([
      orderIds.length
        ? supabase.from("order_items").select("*").in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
      myListingIds.length
        ? supabase
            .from("offers")
            .select("id", { count: "exact", head: true })
            .in("listing_id", myListingIds)
            .eq("status", "open")
        : Promise.resolve({ count: 0 }),
      supabase
        .from("offers")
        .select("id", { count: "exact", head: true })
        .eq("buyer_id", user.id)
        .eq("status", "countered"),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("seller_id", user.id)
        .eq("status", "paid"),
    ]);

  const listingIds = [...new Set((items ?? []).map((i) => i.listing_id).filter((x): x is string => Boolean(x)))];
  const counterpartyIds = [
    ...new Set(rows.flatMap((o) => [o.buyer_id, o.seller_id])),
  ].filter((x): x is string => Boolean(x) && x !== user.id);

  const [{ data: people }, { data: listingTitles }] = await Promise.all([
    counterpartyIds.length
      ? supabase.from("profiles").select("id, display_name, username").in("id", counterpartyIds)
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? supabase.from("listings").select("id, title").in("id", listingIds)
      : Promise.resolve({ data: [] }),
  ]);

  const name = (pid: string | null, fallback?: string | null) => {
    if (!pid) return fallback ?? "DRVN member";
    if (pid === user.id) return "You";
    const p = (people ?? []).find((x) => x.id === pid);
    return p?.display_name ?? (p?.username ? `@${p.username}` : fallback ?? "DRVN member");
  };
  const listingTitle = (lid: string | null) =>
    (listingTitles ?? []).find((l) => l.id === lid)?.title ?? "Listing";

  const total = count ?? 0;
  const hasMore = from + PAGE_SIZE < total;
  const firstOnPage = total === 0 ? 0 : from + 1;
  const lastOnPage = from + rows.length;
  const params = { view: viewParam, page: pageParam };
  const openOffersTotal = (receivedOpenCount ?? 0) + (madeCounteredCount ?? 0);

  const OrderRow = ({ order }: { order: (typeof rows)[number] }) => (
    <Link href={`/orders/${order.id}`} className="jobrow block transition-colors hover:bg-[color:var(--paper-deep)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <OrderPipeline status={order.status} progressStatus={order.pre_dispute_status} />
        <span className="kv font-medium">{formatPrice(order.total_cents)}</span>
      </div>
      <ul className="mt-2">
        {(items ?? [])
          .filter((i) => i.order_id === order.id)
          .map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-0.5">
              <span className="order__name min-w-0 truncate !text-[14.5px]">
                {i.title ?? listingTitle(i.listing_id)}
              </span>
              <span className="kv shrink-0 text-dim">{formatPrice(i.price_cents)}</span>
            </li>
          ))}
      </ul>
      <p className="order__meta mt-1">
        {view === "purchases"
          ? `Seller — ${name(order.seller_id, order.seller_label)}`
          : `Buyer — ${name(order.buyer_id, order.buyer_label)} · payout ${formatPrice(
              order.total_cents - order.platform_fee_cents
            )}`}
      </p>
      <p className="order__meta mt-0.5 flex flex-wrap gap-x-3">
        {milestones(order).map((m) => (
          <span key={m.label}>
            {m.label} {m.date}
          </span>
        ))}
      </p>
    </Link>
  );

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Orders
          {(needsDispatchCount ?? 0) > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">{needsDispatchCount} to dispatch</span>
            </>
          )}
        </span>
        <h1>
          Track what&apos;s <span className="live-word">in flight.</span>
        </h1>
        <p className="sub">Purchases and sales, with dispatch and delivery dates as they land.</p>
      </Rv>

      {placed && (
        <div className="alert alert--ok mb-6">
          <span className="alert__ico" aria-hidden="true">
            ✓
          </span>
          <h4>Order placed</h4>
          <p>
            {skipped
              ? `Some parts couldn't be included: ${skipped}.`
              : "Open it to follow dispatch and delivery."}
          </p>
        </div>
      )}

      <Rv className="tile tile--deep mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="microlabel microlabel--ink">Offers</span>
            <p className="order__meta mt-1">
              {openOffersTotal > 0
                ? `${openOffersTotal} offer${openOffersTotal === 1 ? "" : "s"} waiting on you`
                : "Nothing waiting on you right now"}
            </p>
          </div>
          <Link href="/offers" className="btn btn--ghost">
            Open offers →
          </Link>
        </div>
      </Rv>

      <div className="mb-4 filters !my-0" role="group" aria-label="Order view">
        <span className="microlabel filters__label">Show</span>
        <Link
          href={withParams("/orders", params, { view: undefined, page: undefined })}
          className={`fbtn ${view === "purchases" ? "is-on" : ""}`}
          aria-current={view === "purchases" ? "true" : undefined}
        >
          Purchases
        </Link>
        <Link
          href={withParams("/orders", params, { view: "sales", page: undefined })}
          className={`fbtn ${view === "sales" ? "is-on" : ""}`}
          aria-current={view === "sales" ? "true" : undefined}
        >
          Sales
        </Link>
      </div>

      {rows.length > 0 ? (
        <Rv className="tile tile--deep" stagger={1}>
          <div className="tile__head">
            <span className="microlabel microlabel--ink">
              {total === 1 ? "1 order" : `${total} orders`}
              {total > PAGE_SIZE && (
                <>
                  {" · "}
                  showing {firstOnPage}–{lastOnPage}
                </>
              )}
            </span>
          </div>
          <div className="rowlist">
            {rows.map((o) => (
              <div key={o.id}>
                <OrderRow order={o} />
                {view === "purchases" && o.status === "shipped" && (
                  <div className="flex items-center justify-between gap-3 border-t border-[color:var(--rule-soft)] px-1 py-2">
                    <span className="order__meta">Has this arrived?</span>
                    <ReceivedButton orderId={o.id} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Rv>
      ) : (
        <Rv className="undrawn" stagger={1}>
          <span className="undrawn__mark" aria-hidden="true">
            ⏱
          </span>
          <h3>{view === "purchases" ? "No purchases yet" : "No sales yet"}</h3>
          <p>
            {view === "purchases"
              ? "Buy now or have an offer accepted and it'll show up here."
              : "Buyers can't offer until you list a part."}
          </p>
          <Link href={view === "purchases" ? "/marketplace" : "/sell"} className="btn btn--ghost">
            {view === "purchases" ? "Browse the marketplace" : "List a part"}
          </Link>
        </Rv>
      )}

      {(page > 1 || hasMore) && (
        <nav className="mt-8 flex items-center justify-between gap-3" aria-label="Pagination">
          {page > 1 ? (
            <Link
              href={withParams("/orders", params, { page: page - 1 === 1 ? undefined : String(page - 1) })}
              className="btn btn--ghost"
              rel="prev"
            >
              ← Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="microlabel">Page {page}</span>
          {hasMore ? (
            <Link
              href={withParams("/orders", params, { page: String(page + 1) })}
              className="btn btn--ghost"
              rel="next"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}

      <Foot
        left="DRVN — offers expire 72 hours after they're made"
        right={<Link href="/sell">List a part →</Link>}
      />
    </div>
  );
}
