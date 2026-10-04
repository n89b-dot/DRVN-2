import Link from "next/link";
import { redirect } from "next/navigation";
import { Fragment } from "react";

import { Rv } from "@/components/livesheet";
import {
  Alert,
  ButtonLink,
  EmptyState,
  Foot,
  ObjectRow,
  SellingNav,
  Pagination,
  TileHead,
} from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

import { OrderPipeline } from "@/components/commerce";
import {
  GROUP_LABELS,
  isRawStatus,
  isStateGroup,
  nextAction,
  STATE_GROUPS,
} from "./next-action";
import { ReceivedButton } from "./[id]/fulfilment";
import { reportError } from "@/lib/monitoring";
import { adjustmentsByOrder } from "@/lib/payments/adjustments";
import { sellerProceeds } from "@/lib/payments/proceeds";

export const metadata = { title: "Orders - DRVN" };

const PAGE_SIZE = 25;

function withParams(
  base: string,
  params: Record<string, string | undefined>,
  overrides: Record<string, string | undefined>,
) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) search.set(key, value);
  }
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/** Drops checkouts that were never paid for: still at the payment step,
 *  failed, or cancelled because checkout ran out of time (0012's sweep). */
function hideUnpaidCheckouts<Q extends { not(column: "status", operator: "in", value: string): Q; or(filters: string): Q }>(query: Q): Q {
  return query
    .not("status", "in", "(pending,requires_action,payment_failed)")
    .or('status.neq.cancelled,cancel_reason.is.null,cancel_reason.neq."checkout not completed in time"');
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
    new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
  const stamps: { label: string; date: string }[] = [
    { label: "Placed", date: fmt(order.created_at) },
  ];
  if (order.shipped_at)
    stamps.push({ label: "Shipped", date: fmt(order.shipped_at) });
  if (order.delivered_at)
    stamps.push({ label: "Delivered", date: fmt(order.delivered_at) });
  if (order.completed_at)
    stamps.push({ label: "Completed", date: fmt(order.completed_at) });
  return stamps;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    page?: string;
    placed?: string;
    processing?: string;
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
    processing,
    skipped,
    offer: legacyOfferId,
    state: stateParam,
    status: statusParam,
  } = await searchParams;

  // Legacy deep link — anchors (`#offer-<id>`) can't be read server-side at
  // all, so only a query-param form of the old link can be redirected here.
  // The anchor-emitting link builders had to be fixed at the source instead.
  if (legacyOfferId) redirect(`/offers/${legacyOfferId}`);

  const state = isStateGroup(stateParam) ? stateParam : undefined;
  // A raw status is the operational escape hatch and wins over the group.
  const rawStatus = isRawStatus(statusParam) ? statusParam : undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const from = (page - 1) * PAGE_SIZE;

  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect("/login");

  // Orders sits in the Selling family, so with no explicit view a seller
  // lands on their sales — reached from the Selling nav or the rail, the
  // buyer's view was the wrong half of the page. Members who have never
  // listed a part keep purchases as the default. An explicit ?view= always
  // wins, and both chips carry one.
  let view: "sales" | "purchases";
  if (viewParam === "sales" || viewParam === "purchases") view = viewParam;
  else {
    const { count: listingCount } = await supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .limit(1);
    view = (listingCount ?? 0) > 0 ? "sales" : "purchases";
  }

  const roleColumn = view === "purchases" ? "buyer_id" : "seller_id";

  // Line items ride along on each order via a join, and the two badge counts
  // don't depend on the page rows at all — so the whole first read is one
  // parallel round instead of orders → items → counts in series.
  let ordersQuery = supabase
    .from("orders")
    // Counterparty names, listing titles and each item's frozen photo ride
    // along as embeds — they were a second, dependent round.
    .select(
      "*, buyer:profiles!orders_buyer_id_fkey(id, display_name, username), seller:profiles!orders_seller_id_fkey(id, display_name, username), order_items(*, listings(id, title), order_item_snapshot_images(url, position))",
      { count: "exact" }
    )
    .eq(roleColumn, user.id);
  if (rawStatus) ordersQuery = ordersQuery.eq("status", rawStatus);
  else if (state)
    ordersQuery = ordersQuery.in("status", [...STATE_GROUPS[state]]);
  // A checkout that was never paid for isn't a sale: anyone who reaches the
  // payment step reserves the part, and walking away used to leave the
  // seller a "Waiting on the buyer to pay" order. Sellers see paid orders;
  // an explicit ?status= still shows everything (the operational escape hatch).
  if (view === "sales" && !rawStatus) ordersQuery = hideUnpaidCheckouts(ordersQuery);

  // The offers counts that fed the promo card are gone — the family nav puts
  // Offers one click away on every surface, so a card duplicating navigation
  // inside page content had nothing left to do. The attention count is still
  // read, but now only to badge the nav.
  const [
    { data: orders, count, error: ordersError },
    offersCount,
    { count: needsDispatchCount },
    { count: viewTotal },
  ] = await Promise.all([
    ordersQuery
      .order("created_at", { ascending: false })
      .order("position", { referencedTable: "order_items.order_item_snapshot_images" })
      .range(from, from + PAGE_SIZE - 1),
    loadOffersNeedingAttention(supabase, user.id),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", user.id)
      .eq("status", "paid"),
    // Everything in this view, unfiltered: with none at all, the state
    // filters have nothing to refine and stay off the page.
    (() => {
      const all = supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq(roleColumn, user.id);
      return view === "sales" ? hideUnpaidCheckouts(all) : all;
    })(),
  ]);

  if (ordersError) reportError("[orders] failed to load orders", ordersError);

  const rows = orders ?? [];
  const isSale = view === "sales";
  // R2-04: a sale's payout is the same projection the order page and the
  // Payouts ledger use — refunds take back their share and label costs come
  // off. One batched read for the page; null (unreadable) shows the payout
  // as unavailable rather than higher than it is (R2-05).
  const adjustments = isSale
    ? await adjustmentsByOrder(supabase, rows.map((o) => o.id))
    : new Map<string, number>();
  const items = rows.flatMap((o) => o.order_items ?? []);

  // The embedded rows, keyed the way the row renderer looks them up.
  const people = rows.flatMap((o) => [o.buyer, o.seller]).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const listingTitles = items.flatMap((i) => (i.listings ? [i.listings] : []));
  // The part's photo as it was bought (0049's frozen gallery) — a seller
  // picking the right part off the shelf goes by the picture.
  const coverByItem = new Map<string, string>();
  for (const item of items) {
    const first = item.order_item_snapshot_images?.[0];
    if (first) coverByItem.set(item.id, first.url);
  }

  const name = (pid: string | null, fallback?: string | null) => {
    if (!pid) return fallback ?? "DRVN member";
    if (pid === user.id) return "You";
    const p = (people ?? []).find((x) => x.id === pid);
    return (
      p?.display_name ??
      (p?.username ? `@${p.username}` : (fallback ?? "DRVN member"))
    );
  };
  const listingTitle = (lid: string | null) =>
    (listingTitles ?? []).find((l) => l.id === lid)?.title ?? "Listing";

  const total = count ?? 0;
  const hasMore = from + PAGE_SIZE < total;
  const firstOnPage = total === 0 ? 0 : from + 1;
  const lastOnPage = from + rows.length;
  const params = {
    view,
    page: pageParam,
    state: stateParam,
    status: statusParam,
  };

  const payoutLabel = (order: (typeof rows)[number]) => {
    if (["cancelled", "payment_failed"].includes(order.status)) return "No payout";
    if (!adjustments) return "Payout unavailable";
    const { netCents } = sellerProceeds({
      totalCents: order.total_cents,
      feeCents: order.platform_fee_cents,
      refundedCents: order.refunded_cents ?? 0,
      adjustmentsCents: adjustments.get(order.id) ?? 0,
    });
    return `${formatPrice(netCents)} payout`;
  };

  const OrderRow = ({ order }: { order: (typeof rows)[number] }) => {
    const action = nextAction(order, isSale);
    // The one milestone worth a list row: the latest thing that happened.
    // The full stamp history belongs on the order, not on every line here.
    const stamps = milestones(order);
    const latest = stamps[stamps.length - 1];

    const lines = (items ?? []).filter((i) => i.order_id === order.id);
    const lead = lines[0];
    const leadTitle = lead ? (lead.title ?? listingTitle(lead.listing_id)) : "Order";
    const cover = lines.map((i) => coverByItem.get(i.id)).find(Boolean);

    // The shared dense row: the part's photo leads, then what the order
    // wants next, the part, who and when, and the pipeline as a strip.
    return (
      <ObjectRow
        // An unpaid purchase has one thing to do — pay — so its row goes
        // straight to checkout (which sends a paid order back here).
        href={!isSale && order.status === "pending" ? `/orders/${order.id}/checkout` : `/orders/${order.id}`}
        media={{ src: cover, alt: leadTitle }}
        className="order--under"
        actions={
          <span className="kv font-medium">
            {isSale ? payoutLabel(order) : formatPrice(order.total_cents)}
          </span>
        }
      >
        <span className="min-w-0">
          {/* What this order wants next LEADS the row (SYS — orders triage by
              next action, not by record): the ask, then the item. */}
          {action && (
            <span className="ordernext !mt-0">
              <span className="ordernext__mark" aria-hidden="true" />
              {action}
            </span>
          )}
          <span className="order__name mt-1 block truncate">
            {leadTitle}
            {lines.length > 1 && (
              <span className="text-dim"> + {lines.length - 1} more</span>
            )}
          </span>
          <span className="order__meta block">
            {isSale
              ? `Buyer — ${name(order.buyer_id, order.buyer_label)}`
              : `Seller — ${name(order.seller_id, order.seller_label)}`}
            {latest && ` · ${latest.label} ${latest.date}`}
          </span>
          <span className="mt-2 block">
            <OrderPipeline status={order.status} progressStatus={order.pre_dispute_status} />
          </span>
        </span>
      </ObjectRow>
    );
  };

  return (
    <div className="wrap">
      <SellingNav current="orders" offersCount={offersCount} />
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
        <p className="sub">
          Purchases and sales, with dispatch and delivery dates as they land.
        </p>
      </Rv>
      {processing && !placed && (
        <Alert tone="ok" ico="✓" title="Payment received" className="mb-6">
          The bank is confirming it. There&apos;s nothing else to do — your orders update once it
          clears.
        </Alert>
      )}
      {placed && (
        <Alert tone="ok" ico="✓" title="Order placed" className="mb-6">
          {skipped
            ? `Some parts couldn't be included: ${skipped}.`
            : "Open it to follow dispatch and delivery."}
        </Alert>
      )}

      {/* The Offers promo card that used to sit here is gone: the family nav
          above already puts Offers one click away with its own attention
          badge, and duplicating navigation inside page content only made the
          two disagree. */}

      <div
        className="filters filters--stack filters--scroll"
        role="group"
        aria-label="Order view"
      >
        <span className="microlabel filters__label">Show</span>
        {(["sales", "purchases"] as const).map((v) => (
          <Link
            key={v}
            href={withParams("/orders", params, { view: v, page: undefined })}
            className={`fbtn ${view === v ? "is-on" : ""}`}
            aria-current={view === v ? "true" : undefined}
          >
            {v === "sales" ? "Sales" : "Purchases"}
          </Link>
        ))}
      </div>

      {((viewTotal ?? 0) > 0 || state || rawStatus) && (
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
              href={withParams("/orders", params, {
                status: s,
                page: undefined,
              })}
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
      )}

      {rows.length > 0 ? (
        <Rv className="tile tile--deep" stagger={1}>
          <TileHead
            label={
              <>
                {total === 1 ? "1 order" : `${total} orders`}
                {total > PAGE_SIZE && (
                  <>
                    {" · "}
                    showing {firstOnPage}–{lastOnPage}
                  </>
                )}
              </>
            }
          />
          <div className="rowlist">
            {rows.map((o) => (
              <Fragment key={o.id}>
                <OrderRow order={o} />
                {view === "purchases" && o.status === "shipped" && (
                  <div className="flex items-center justify-between gap-3 border-t border-[color:var(--rule-soft)] px-1 py-2">
                    <span className="order__meta">Has this arrived?</span>
                    <ReceivedButton orderId={o.id} />
                  </div>
                )}
              </Fragment>
            ))}
          </div>
        </Rv>
      ) : (
        <EmptyState
          mark="⇄"
          title={
            state || rawStatus
              ? "Nothing in this state"
              : view === "purchases"
                ? "No purchases yet"
                : "No sales yet"
          }
          action={
            state || rawStatus ? (
              <ButtonLink
                variant="ghost"
                href={withParams("/orders", params, {
                  state: undefined,
                  status: undefined,
                  page: undefined,
                })}
              >
                Show all orders
              </ButtonLink>
            ) : view === "purchases" ? (
              <ButtonLink variant="ghost" href="/marketplace">
                Browse the marketplace
              </ButtonLink>
            ) : (
              <ButtonLink variant="ghost" href="/listings">
                My listings
              </ButtonLink>
            )
          }
        >
          {state || rawStatus
            ? "No orders match this filter right now."
            : view === "purchases"
              ? "Buy a part or have an offer accepted and it'll show up here."
              : "When a buyer checks out one of your parts, the order lands here with what to do next."}
        </EmptyState>
      )}

      <Pagination
        page={page}
        hasMore={hasMore}
        hrefFor={(p) =>
          withParams("/orders", params, {
            page: p === 1 ? undefined : String(p),
          })
        }
        className="!mt-8"
      />

      {/* Order-specific guidance. The old footer explained the 72-hour offer
          expiry, which is a rule about a surface this page no longer holds. */}
      <Foot
        left="DRVN — payouts release once delivery is confirmed"
        right={<Link href="/protection">How buyer protection works →</Link>}
      />
    </div>
  );
}
