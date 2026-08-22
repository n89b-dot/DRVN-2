import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, MarketplaceNav } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";

import { OrderPipeline } from "./order-pipeline";
import {
  GROUP_LABELS,
  isRawStatus,
  isStateGroup,
  nextAction,
  STATE_GROUPS,
} from "./next-action";
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

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    page?: string;
    placed?: string;
    skipped?: string;
    offer?: string;
    state?: string;
    status?: string;
  }>;
}) {
  const {
    view: viewParam,
    page: pageParam,
    placed,
    skipped,
    offer: legacyOfferId,
    state: stateParam,
    status: statusParam,
  } = await searchParams;

  // Legacy deep link — anchors (`#offer-<id>`) can't be read server-side at
  // all, so only a query-param form of the old link can be redirected here.
  // The anchor-emitting link builders had to be fixed at the source instead.
  if (legacyOfferId) redirect(`/offers/${legacyOfferId}`);

  const view = viewParam === "sales" ? "sales" : "purchases";
  const state = isStateGroup(stateParam) ? stateParam : undefined;
  // A raw status is the operational escape hatch and wins over the group.
  const rawStatus = isRawStatus(statusParam) ? statusParam : undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const roleColumn = view === "purchases" ? "buyer_id" : "seller_id";

  let ordersQuery = supabase
    .from("orders")
    .select("*", { count: "exact" })
    .eq(roleColumn, user.id);
  if (rawStatus) ordersQuery = ordersQuery.eq("status", rawStatus);
  else if (state) ordersQuery = ordersQuery.in("status", [...STATE_GROUPS[state]]);

  const { data: orders, count, error: ordersError } = await ordersQuery
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  if (ordersError) reportError("[orders] failed to load orders", ordersError);

  const rows = orders ?? [];
  const orderIds = rows.map((o) => o.id);

  // The offers counts that fed the promo card are gone — the family nav puts
  // Offers one click away on every surface, so a card duplicating navigation
  // inside page content had nothing left to do. The attention count is still
  // read, but now only to badge the nav.
  const [{ data: items }, offersCount, { count: needsDispatchCount }] = await Promise.all([
    orderIds.length
      ? supabase.from("order_items").select("*").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    loadOffersNeedingAttention(supabase, user.id),
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
  const params = {
    view: viewParam,
    page: pageParam,
    state: stateParam,
    status: statusParam,
  };
  const isSale = view === "sales";

  const OrderRow = ({ order }: { order: (typeof rows)[number] }) => {
    const action = nextAction(order, isSale);
    // The one milestone worth a list row: the latest thing that happened.
    // The full stamp history belongs on the order, not on every line here.
    const stamps = milestones(order);
    const latest = stamps[stamps.length - 1];

    return (
      <Link
        href={`/orders/${order.id}`}
        className="jobrow block transition-colors hover:bg-[color:var(--paper-deep)]"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <OrderPipeline status={order.status} progressStatus={order.pre_dispute_status} />
          <span className="kv font-medium">
            {isSale
              ? `${formatPrice(order.total_cents - order.platform_fee_cents)} payout`
              : formatPrice(order.total_cents)}
          </span>
        </div>
        {/* What this order wants next LEADS the row (SYS — orders triage by
            next action, not by record): state, then the ask, then the item. */}
        {action && (
          <p className="ordernext !mt-2">
            <span className="ordernext__mark" aria-hidden="true" />
            {action}
          </p>
        )}
        <ul className="mt-2">
          {(items ?? [])
            .filter((i) => i.order_id === order.id)
            .map((i) => (
              <li key={i.id} className="flex justify-between gap-3 py-0.5">
                <span className="order__name min-w-0 truncate !text-body">
                  {i.title ?? listingTitle(i.listing_id)}
                </span>
                <span className="kv shrink-0 text-dim">{formatPrice(i.price_cents)}</span>
              </li>
            ))}
        </ul>
        <p className="order__meta mt-1">
          {isSale
            ? `Buyer — ${name(order.buyer_id, order.buyer_label)}`
            : `Seller — ${name(order.seller_id, order.seller_label)}`}
          {latest && ` · ${latest.label} ${latest.date}`}
        </p>
      </Link>
    );
  };

  return (
    <div className="wrap">
      <MarketplaceNav current="orders" offersCount={offersCount} />

      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          Transactions
          {(needsDispatchCount ?? 0) > 0 && (
            <>
              {" · "}
              <Link
                href={withParams("/orders", params, {
                  view: "sales",
                  status: "paid",
                  state: undefined,
                  page: undefined,
                })}
                className="microlabel--live underline decoration-dotted underline-offset-4"
              >
                {needsDispatchCount} to dispatch
              </Link>
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

      {/* The Offers promo card that used to sit here is gone: the family nav
          above already puts Offers one click away with its own attention
          badge, and duplicating navigation inside page content only made the
          two disagree. */}

      <div className="filters filters--stack filters--scroll" role="group" aria-label="Order view">
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

      <div
        className="filters filters--sub filters--scroll"
        role="group"
        aria-label="Filter orders by state"
      >
        <span className="microlabel filters__label">State</span>
        <Link
          href={withParams("/orders", params, {
            state: undefined,
            status: undefined,
            page: undefined,
          })}
          className={`fbtn ${!state && !rawStatus ? "is-on" : ""}`}
          aria-current={!state && !rawStatus ? "true" : undefined}
        >
          All
        </Link>
        {GROUP_LABELS.map((g) => (
          <Link
            key={g.key}
            href={withParams("/orders", params, {
              state: g.key,
              status: undefined,
              page: undefined,
            })}
            className={`fbtn ${state === g.key && !rawStatus ? "is-on" : ""}`}
            aria-current={state === g.key && !rawStatus ? "true" : undefined}
          >
            {g.label}
          </Link>
        ))}
        {/* The operational escape hatch: once you're in a group, its raw
            states are addressable individually rather than only from a URL
            you had to know to type. */}
        {state &&
          STATE_GROUPS[state].map((s) => (
            <Link
              key={s}
              href={withParams("/orders", params, { status: s, page: undefined })}
              className={`fbtn ${rawStatus === s ? "is-on" : ""}`}
              aria-current={rawStatus === s ? "true" : undefined}
            >
              {s.replace(/_/g, " ")}
            </Link>
          ))}
        {rawStatus && !state && (
          <span className="fbtn is-on" aria-current="true">
            {rawStatus.replace(/_/g, " ")}
          </span>
        )}
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
          <h3>
            {state || rawStatus
              ? "Nothing in this state"
              : view === "purchases"
                ? "No purchases yet"
                : "No sales yet"}
          </h3>
          <p>
            {state || rawStatus
              ? "No orders match this filter right now."
              : view === "purchases"
                ? "Buy now or have an offer accepted and it'll show up here."
                : "Buyers can't offer until you list a part."}
          </p>
          {state || rawStatus ? (
            <Link
              href={withParams("/orders", params, {
                state: undefined,
                status: undefined,
                page: undefined,
              })}
              className="btn btn--ghost"
            >
              Show all orders
            </Link>
          ) : (
            <Link href={view === "purchases" ? "/marketplace" : "/sell"} className="btn btn--ghost">
              {view === "purchases" ? "Browse the marketplace" : "List a part"}
            </Link>
          )}
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

      {/* Order-specific guidance. The old footer explained the 72-hour offer
          expiry, which is a rule about a surface this page no longer holds. */}
      <Foot
        left="DRVN — payouts release once delivery is confirmed"
        right={<Link href="/protection">How buyer protection works →</Link>}
      />
    </div>
  );
}
