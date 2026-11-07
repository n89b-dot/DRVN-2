import "server-only";

import type {
  AdminAuditLogEntry,
  Database,
  DisputeCategory,
  Json,
  Listing,
  Order,
  OrderStatus,
  Payment,
  PaymentRecovery,
  OpsCase,
  Report,
  TransferIntent,
  WebhookEvent,
} from "@/lib/database.types";

import { buildOrderTimeline, type TimelineEvent } from "./diagnostics";
import { countOpenIdentityReviews } from "./product-identity";
import { signEvidenceUrls } from "@/lib/evidence-urls";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";
import { postHeadline } from "@/lib/activity/headline";

/**
 * Admin console read layer. Server-only, service-role.
 *
 * Why service-role rather than the admin's RLS session: the 0017/0018 column
 * grants deliberately hide profiles' payment/suspension columns from EVERY
 * client role — admins included — so a console that shows Connect status or
 * suspension state cannot read via PostgREST grants. The RLS `is_admin()`
 * policies still exist and are CI-verified (admin_guard.sql); they are the
 * database-level twin for any future direct-PostgREST surface. Access control
 * for these queries is `getAdminContext()` at the layout AND per-action
 * re-checks — never assume colocation with the product app.
 */

type Admin = ReturnType<typeof createAdminClient>;

const admin = (): Admin => createAdminClient();

/** Days of silence after which a dispute is flagged as over SLA. */
/**
 * An order-id search as a uuid range. Uuids order like their hex text, so a
 * prefix ("5ef01246", or a whole id) is every id between the prefix padded
 * with 0s and with fs — a plain range filter, where `id::text ilike` isn't
 * possible through PostgREST at all (it errored and read as "no results").
 */
export function uuidPrefixRange(text: string): [string, string] | null {
  const hex = text.trim().toLowerCase().replace(/-/g, "");
  if (!/^[0-9a-f]{1,32}$/.test(hex)) return null;
  const shape = (h: string) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  return [shape(hex.padEnd(32, "0")), shape(hex.padEnd(32, "f"))];
}

/** Free text made safe inside a PostgREST `.or()` filter, where commas and
 *  brackets are syntax (a search for "Vega, Marisol" broke the query). */
function orText(text: string): string {
  return text.replace(/[,()*%\\]/g, " ").replace(/\s+/g, " ").trim();
}

/** A failed console read must not look like an empty result. */
function unlessFailed(label: string, error: { message: string } | null) {
  if (!error) return;
  reportError(`[admin] ${label} failed`, error);
  throw new Error(`Couldn't load ${label}. Try again.`);
}

export const DISPUTE_SLA_DAYS = 4;

// ---------- Overview ----------

export type AdminOverview = {
  openDisputes: number;
  disputesOverSla: number;
  oldestDisputeDays: number | null;
  openReports: number;
  openRecoveries: number;
  stuckTransfers: number;
  orders7d: number;
  gmv7dCents: number;
  refunds7dCents: number;
  /** DRVN's own take: platform fees on the period's orders, net of the fee
   *  share handed back on refunds. */
  fees7dCents: number;
  /** The 7 days before the last 7 — "is this getting worse?" without a click. */
  orders7dPrev: number;
  gmv7dPrevCents: number;
  refunds7dPrevCents: number;
  fees7dPrevCents: number;
  suspendedSellers: number;
  removedListings: number;
};

type MoneyWindow = {
  orders: number;
  gmv_cents: number;
  fee_cents: number;
  refunded_cents: number;
  fee_refunded_cents: number;
};

/** One window's order count and money, summed in the database
 *  (admin_order_money_window): summing PostgREST rows here was capped at
 *  max_rows and under-reported a busy week without saying so. */
async function moneyWindow(a: Admin, from: string, to: string): Promise<MoneyWindow> {
  const { data, error } = await a.rpc("admin_order_money_window", { p_from: from, p_to: to });
  unlessFailed("the money totals", error);
  const w = data as Partial<MoneyWindow> | null;
  const keys = ["orders", "gmv_cents", "fee_cents", "refunded_cents", "fee_refunded_cents"] as const;
  if (!w || keys.some((k) => typeof w[k] !== "number")) {
    unlessFailed("the money totals", { message: "malformed money window" });
  }
  return w as MoneyWindow;
}

/** Every overview read is checked: a failed count must not render as 0. */
export async function getOverview(): Promise<AdminOverview> {
  const a = admin();
  const now = new Date().toISOString();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const since14d = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const slaCutoff = new Date(Date.now() - DISPUTE_SLA_DAYS * 86_400_000).toISOString();

  const [disputes, overSla, oldest, reports, recoveries, stuck, week, prevWeek, suspended, removed] =
    await Promise.all([
      a.from("orders").select("id", { count: "exact", head: true }).eq("status", "disputed"),
      a
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "disputed")
        .lt("disputed_at", slaCutoff),
      a
        .from("orders")
        .select("disputed_at")
        .eq("status", "disputed")
        .order("disputed_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      a.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
      a.from("payment_recoveries").select("id", { count: "exact", head: true }).eq("status", "open"),
      a
        .from("transfer_intents")
        .select("order_id", { count: "exact", head: true })
        .in("status", ["blocked_unpayable", "failed"]),
      // The current window runs to now, so it can't double-count with the
      // previous one at the boundary.
      moneyWindow(a, since7d, now),
      moneyWindow(a, since14d, since7d),
      a.from("profiles").select("id", { count: "exact", head: true }).not("suspended_at", "is", null),
      a.from("listings").select("id", { count: "exact", head: true }).eq("status", "removed"),
    ]);

  unlessFailed("open disputes", disputes.error);
  unlessFailed("disputes over SLA", overSla.error);
  unlessFailed("the oldest dispute", oldest.error);
  unlessFailed("open reports", reports.error);
  unlessFailed("open payment recoveries", recoveries.error);
  unlessFailed("stuck transfers", stuck.error);
  unlessFailed("suspended members", suspended.error);
  unlessFailed("removed listings", removed.error);

  const oldestDisputeDays = oldest.data?.disputed_at
    ? Math.floor((Date.now() - new Date(oldest.data.disputed_at).getTime()) / 86_400_000)
    : null;

  return {
    openDisputes: counted(disputes.count),
    disputesOverSla: counted(overSla.count),
    oldestDisputeDays,
    openReports: counted(reports.count),
    openRecoveries: counted(recoveries.count),
    stuckTransfers: counted(stuck.count),
    orders7d: week.orders,
    gmv7dCents: week.gmv_cents,
    refunds7dCents: week.refunded_cents,
    fees7dCents: week.fee_cents - week.fee_refunded_cents,
    orders7dPrev: prevWeek.orders,
    gmv7dPrevCents: prevWeek.gmv_cents,
    refunds7dPrevCents: prevWeek.refunded_cents,
    fees7dPrevCents: prevWeek.fee_cents - prevWeek.fee_refunded_cents,
    suspendedSellers: counted(suspended.count),
    removedListings: counted(removed.count),
  };
}

/** An exact count PostgREST answered without one is a failure, not zero. */
function counted(count: number | null): number {
  if (count == null) unlessFailed("a queue count", { message: "count missing" });
  return count as number;
}

// ---------- Shared party shape ----------

export type PartyRef = {
  id: string | null;
  username: string | null;
  displayName: string | null;
};

async function partiesFor(a: Admin, ids: (string | null)[]): Promise<Map<string, PartyRef>> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (!unique.length) return new Map();
  const { data } = await a.from("profiles").select("id, username, display_name").in("id", unique);
  return new Map(
    (data ?? []).map((p) => [p.id, { id: p.id, username: p.username, displayName: p.display_name }])
  );
}

// ---------- Disputes ----------

export type DisputeQueueRow = {
  orderId: string;
  disputedAt: string | null;
  ageDays: number;
  overSla: boolean;
  /** Escalated — by the buyer's "step in" (0024) or the day-4 cron (0021). */
  escalated: boolean;
  /** True when the buyer explicitly escalated, not just the cron. */
  buyerEscalated: boolean;
  category: DisputeCategory | null;
  reason: string | null;
  totalCents: number;
  currency: string;
  refundOfferCents: number | null;
  buyer: PartyRef | null;
  seller: PartyRef | null;
  title: string;
  transferred: boolean;
  /** The purchased grade, frozen at sale (0024) — the first item's, when the
   *  order has several. Batched alongside titlesFor, no N+1. */
  purchasedGrade: string | null;
};

export const DISPUTES_PAGE_SIZE = 50;

export type DisputeQueueResult = {
  rows: DisputeQueueRow[];
  /** Before search/category filtering — "N open · M shown". */
  total: number;
  page: number;
  hasMore: boolean;
};

/**
 * Search and filters run in the database, not over a capped fetch — a dispute
 * beyond any page boundary is still findable, so the backlog can never hide.
 */
export async function getDisputeQueue(
  scope: "open" | "resolved",
  opts: {
    query?: string;
    category?: DisputeCategory;
    /** Only rows already past the SLA window — the escalation view. */
    overSlaOnly?: boolean;
    page?: number;
    pageSize?: number;
  } = {}
): Promise<DisputeQueueResult> {
  const a = admin();
  const page = Math.max(0, opts.page ?? 0);
  const size = Math.min(Math.max(1, opts.pageSize ?? DISPUTES_PAGE_SIZE), 5000);
  const q = opts.query?.trim();

  // Resolve free-text search to id sets first: parties by name, orders by
  // item title. An id-shaped query is an order-id prefix instead.
  const idPrefix = q && /^[0-9a-f-]{8,}$/i.test(q) ? q : undefined;
  let partyIds: string[] = [];
  let itemOrderIds: string[] = [];
  if (q && !idPrefix) {
    const [profiles, items] = await Promise.all([
      a
        .from("profiles")
        .select("id")
        .or(`username.ilike.%${orText(q)}%,display_name.ilike.%${orText(q)}%`)
        .limit(20),
      a.from("order_items").select("order_id").ilike("title", `%${q}%`).limit(200),
    ]);
    partyIds = (profiles.data ?? []).map((p) => p.id);
    itemOrderIds = [...new Set((items.data ?? []).map((i) => i.order_id))];
  }

  const selected = a
    .from("orders")
    .select(
      "id, buyer_id, seller_id, disputed_at, dispute_category, dispute_reason, dispute_resolved_at, dispute_escalated_at, dispute_escalated_by, total_cents, currency, refund_offer_cents, transfer_reference, status"
    );
  let builder = (
    scope === "open"
      ? selected.eq("status", "disputed")
      : selected.not("dispute_resolved_at", "is", null)
  ).order(scope === "open" ? "disputed_at" : "dispute_resolved_at", {
    ascending: scope === "open",
  });

  if (opts.category) builder = builder.eq("dispute_category", opts.category);
  if (opts.overSlaOnly && scope === "open") {
    builder = builder.lt(
      "disputed_at",
      new Date(Date.now() - DISPUTE_SLA_DAYS * 86_400_000).toISOString()
    );
  }
  if (idPrefix) {
    const range = uuidPrefixRange(idPrefix);
    if (range) builder = builder.gte("id", range[0]).lte("id", range[1]);
  } else if (q) {
    const clauses = [
      ...(partyIds.length
        ? [`buyer_id.in.(${partyIds.join(",")})`, `seller_id.in.(${partyIds.join(",")})`]
        : []),
      ...(itemOrderIds.length ? [`id.in.(${itemOrderIds.join(",")})`] : []),
    ];
    if (!clauses.length) {
      const total = await countDisputes(a, scope);
      return { rows: [], total, page, hasMore: false };
    }
    builder = builder.or(clauses.join(","));
  }

  const { data: orders, error: disputesError } = await builder.range(page * size, page * size + size);
  unlessFailed("disputes", disputesError);

  const fetched = orders ?? [];
  const hasMore = fetched.length > size;
  const rows = fetched.slice(0, size);
  const [parties, titles, grades, total] = await Promise.all([
    partiesFor(a, rows.flatMap((o) => [o.buyer_id, o.seller_id])),
    titlesFor(a, rows.map((o) => o.id)),
    gradesFor(a, rows.map((o) => o.id)),
    countDisputes(a, scope),
  ]);

  return {
    page,
    hasMore,
    total,
    rows: rows.map((o) => {
      const ageDays = o.disputed_at
        ? Math.floor((Date.now() - new Date(o.disputed_at).getTime()) / 86_400_000)
        : 0;
      return {
        orderId: o.id,
        disputedAt: o.disputed_at,
        ageDays,
        overSla: ageDays >= DISPUTE_SLA_DAYS && o.status === "disputed",
        escalated: Boolean(o.dispute_escalated_at) && o.status === "disputed",
        buyerEscalated: Boolean(o.dispute_escalated_by),
        category: o.dispute_category,
        reason: o.dispute_reason,
        totalCents: o.total_cents,
        currency: o.currency,
        refundOfferCents: o.refund_offer_cents,
        buyer: o.buyer_id ? (parties.get(o.buyer_id) ?? null) : null,
        seller: o.seller_id ? (parties.get(o.seller_id) ?? null) : null,
        title: titles.get(o.id) ?? `Order ${o.id.slice(0, 8)}`,
        transferred: Boolean(o.transfer_reference),
        purchasedGrade: grades.get(o.id) ?? null,
      };
    }),
  };
}

/** First item's purchased grade per order — one batched query alongside
 *  titlesFor, so the queue's grade column doesn't cost an N+1. */
async function gradesFor(a: Admin, orderIds: string[]): Promise<Map<string, string | null>> {
  if (!orderIds.length) return new Map();
  const { data: items } = await a
    .from("order_items")
    .select("order_id, condition_snapshot")
    .in("order_id", orderIds);
  const map = new Map<string, string | null>();
  for (const item of items ?? []) {
    if (map.has(item.order_id)) continue;
    const snapshot = item.condition_snapshot as { grade?: string | null } | null;
    map.set(item.order_id, snapshot?.grade ?? null);
  }
  return map;
}

async function countDisputes(a: Admin, scope: "open" | "resolved"): Promise<number> {
  const base = a.from("orders").select("id", { count: "exact", head: true });
  const { count } =
    scope === "open"
      ? await base.eq("status", "disputed")
      : await base.not("dispute_resolved_at", "is", null);
  return count ?? 0;
}

async function titlesFor(a: Admin, orderIds: string[]): Promise<Map<string, string>> {
  if (!orderIds.length) return new Map();
  const { data: items } = await a
    .from("order_items")
    .select("order_id, title")
    .in("order_id", orderIds);
  const map = new Map<string, string[]>();
  for (const item of items ?? []) {
    const list = map.get(item.order_id) ?? [];
    list.push(item.title ?? "Part");
    map.set(item.order_id, list);
  }
  return new Map(
    [...map.entries()].map(([id, titles]) => [
      id,
      titles.length > 1 ? `${titles[0]} +${titles.length - 1} more` : (titles[0] ?? "Order"),
    ])
  );
}

// ---------- Order detail ----------

/** A listing's condition fields, current as of the read — the "as it reads
 *  today" half of the purchased-vs-current comparison (0024 follow-up). */
export type AdminCurrentListingCondition = {
  status: Listing["status"];
  category: string;
  subcategory: string | null;
  condition: string | null;
  grade: string | null;
  checklist: Json | null;
  compatibilityNotes: string | null;
};

export type AdminOrderDetail = {
  order: Order;
  items: {
    id: string;
    title: string | null;
    priceCents: number;
    listingId: string | null;
    /** Frozen at purchase (0024 trigger) — the contract a dispute is judged
     *  against, whatever the listing looks like today. */
    conditionSnapshot: Json | null;
    /** Null when the listing was hard-deleted (rare) or never had one. */
    currentListing: AdminCurrentListingCondition | null;
  }[];
  payment: Payment | null;
  transferIntent: TransferIntent | null;
  buyer: (PartyRef & { suspendedAt: string | null; disputeCount: number; orderCount: number }) | null;
  seller:
    | (PartyRef & {
        suspendedAt: string | null;
        payoutsEnabled: boolean;
        stripeAccountId: string | null;
        disputeCount: number;
        salesCount: number;
      })
    | null;
  messages: { id: string; senderId: string; body: string; createdAt: string }[];
  /** Photos attached to the dispute by either party (0024). */
  evidence: { id: string; uploaderId: string | null; url: string; note: string | null; createdAt: string }[];
  audit: AdminAuditLogEntry[];
  /** One chronological view of the transaction (§AF) — see lib/admin/diagnostics.ts. */
  timeline: TimelineEvent[];
};

export async function getOrderDetail(orderId: string): Promise<AdminOrderDetail | null> {
  const a = admin();
  const { data: order, error: orderError } = await a.from("orders").select("*").eq("id", orderId).maybeSingle();
  unlessFailed("the order", orderError);
  if (!order) return null;

  const [items, payment, intent, messages, evidence, audit] = await Promise.all([
    a
      .from("order_items")
      .select("id, title, price_cents, listing_id, condition_snapshot")
      .eq("order_id", orderId),
    a.from("payments").select("*").eq("order_id", orderId).maybeSingle(),
    a.from("transfer_intents").select("*").eq("order_id", orderId).maybeSingle(),
    a
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(100),
    a
      .from("dispute_evidence")
      .select("id, uploader_id, url, storage_path, note, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    a
      .from("admin_audit_log")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // The money panel reads these two: unread must not show as "not charged"
  // or "not transferred".
  unlessFailed("the order's payment", payment.error);
  unlessFailed("the order's transfer", intent.error);

  // Diagnostics feed (§AF): refund operations by order id; retained webhook
  // events matched on the payment-intent reference (either the event object
  // itself or its payment_intent pointer, covering charges and disputes).
  const paymentRef = payment.data?.provider_reference ?? null;
  const [refundOps, webhookEvents] = await Promise.all([
    a
      .from("refund_operations")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true }),
    paymentRef
      ? a
          .from("webhook_events")
          .select("id, type, received_at, processed_at, payload, failed_attempts, last_failed_at, last_failure_kind, last_failure_detail")
          .or(
            `payload->data->object->>id.eq.${paymentRef},payload->data->object->>payment_intent.eq.${paymentRef}`,
          )
          .order("received_at", { ascending: true })
          .limit(50)
      : Promise.resolve({ data: [] as WebhookEvent[] }),
  ]);

  const loadParty = async (id: string | null, role: "buyer" | "seller") => {
    if (!id) return null;
    const [{ data: profile }, disputes, orders] = await Promise.all([
      a
        .from("profiles")
        .select("id, username, display_name, suspended_at, payouts_enabled, stripe_account_id")
        .eq("id", id)
        .maybeSingle(),
      a
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq(role === "buyer" ? "buyer_id" : "seller_id", id)
        .not("disputed_at", "is", null),
      a
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq(role === "buyer" ? "buyer_id" : "seller_id", id),
    ]);
    if (!profile) return null;
    return {
      id: profile.id,
      username: profile.username,
      displayName: profile.display_name,
      suspendedAt: profile.suspended_at,
      payoutsEnabled: profile.payouts_enabled,
      stripeAccountId: profile.stripe_account_id,
      disputeCount: disputes.count ?? 0,
      orderCount: orders.count ?? 0,
      salesCount: orders.count ?? 0,
    };
  };

  const itemRows = items.data ?? [];
  const listingIds = itemRows
    .map((i) => i.listing_id)
    .filter((id): id is string => Boolean(id));

  const [{ data: currentListings }, buyer, seller] = await Promise.all([
    listingIds.length
      ? a
          .from("listings")
          .select("id, status, category, subcategory, condition, grade, condition_checklist, compatibility_notes")
          .in("id", listingIds)
      : Promise.resolve({ data: [] as never[] }),
    loadParty(order.buyer_id, "buyer"),
    loadParty(order.seller_id, "seller"),
  ]);
  const currentByListingId = new Map(
    (currentListings ?? []).map((l) => [
      l.id,
      {
        status: l.status,
        category: l.category,
        subcategory: l.subcategory,
        condition: l.condition,
        grade: l.grade,
        checklist: l.condition_checklist,
        compatibilityNotes: l.compatibility_notes,
      } satisfies AdminCurrentListingCondition,
    ])
  );

  return {
    order,
    items: itemRows.map((i) => ({
      id: i.id,
      title: i.title,
      priceCents: i.price_cents,
      listingId: i.listing_id,
      conditionSnapshot: i.condition_snapshot,
      currentListing: i.listing_id ? (currentByListingId.get(i.listing_id) ?? null) : null,
    })),
    payment: payment.data ?? null,
    transferIntent: intent.data ?? null,
    buyer,
    seller,
    messages: (messages.data ?? []).map((m) => ({
      id: m.id,
      senderId: m.sender_id,
      body: m.body,
      createdAt: m.created_at,
    })),
    evidence: (await signEvidenceUrls(a, evidence.data ?? [])).map((e) => ({
      id: e.id,
      uploaderId: e.uploader_id,
      url: e.url,
      note: e.note,
      createdAt: e.created_at,
    })),
    audit: audit.data ?? [],
    timeline: buildOrderTimeline({
      order,
      payment: payment.data ?? null,
      transferIntent: intent.data ?? null,
      refundOps: refundOps.data ?? [],
      webhookEvents: (webhookEvents.data ?? []) as WebhookEvent[],
      audit: audit.data ?? [],
    }),
  };
}

// ---------- Orders search ----------

export type AdminOrderRow = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  refundedCents: number;
  currency: string;
  title: string;
  buyer: PartyRef | null;
  seller: PartyRef | null;
  transferred: boolean;
};

export const ORDERS_PAGE_SIZE = 50;

export type AdminOrdersResult = {
  rows: AdminOrderRow[];
  page: number;
  hasMore: boolean;
};

export type OrdersSearchOpts = {
  query?: string;
  status?: OrderStatus;
  page?: number;
  /** ISO timestamps — inclusive start, exclusive end. */
  from?: string;
  to?: string;
  /** Inclusive order-total bounds, in cents. */
  minCents?: number;
  maxCents?: number;
  /** Export path: rows per page (defaults to ORDERS_PAGE_SIZE, capped at 5000). */
  pageSize?: number;
};

export async function searchOrders(opts: OrdersSearchOpts): Promise<AdminOrdersResult> {
  const a = admin();
  const page = Math.max(0, opts.page ?? 0);
  const size = Math.min(Math.max(1, opts.pageSize ?? ORDERS_PAGE_SIZE), 5000);
  let builder = a
    .from("orders")
    .select("id, status, created_at, total_cents, refunded_cents, currency, buyer_id, seller_id, transfer_reference")
    .order("created_at", { ascending: false })
    // One extra row = a cheap hasMore signal without a second count query.
    .range(page * size, page * size + size);
  if (opts.status) builder = builder.eq("status", opts.status);
  if (opts.from) builder = builder.gte("created_at", opts.from);
  if (opts.to) builder = builder.lt("created_at", opts.to);
  if (opts.minCents != null) builder = builder.gte("total_cents", opts.minCents);
  if (opts.maxCents != null) builder = builder.lte("total_cents", opts.maxCents);

  const query = opts.query?.trim();
  if (query) {
    // Order-id prefix, payment-intent reference, or a party's username.
    if (/^[0-9a-f-]{8,}$/i.test(query)) {
      const { data: byPayment } = await a
        .from("payments")
        .select("order_id")
        .ilike("provider_reference", `${query}%`);
      const orderIds = (byPayment ?? []).map((p) => p.order_id);
      const range = uuidPrefixRange(query);
      builder = orderIds.length
        ? builder.in("id", orderIds)
        : range
          ? builder.gte("id", range[0]).lte("id", range[1])
          : builder.in("id", []);
    } else if (query.startsWith("pi_")) {
      const { data: byPayment } = await a
        .from("payments")
        .select("order_id")
        .ilike("provider_reference", `${query}%`);
      builder = builder.in("id", (byPayment ?? []).map((p) => p.order_id));
    } else {
      const { data: users } = await a
        .from("profiles")
        .select("id")
        .or(`username.ilike.%${orText(query)}%,display_name.ilike.%${orText(query)}%`)
        .limit(20);
      const ids = (users ?? []).map((u) => u.id);
      if (!ids.length) return { rows: [], page, hasMore: false };
      builder = builder.or(
        `buyer_id.in.(${ids.join(",")}),seller_id.in.(${ids.join(",")})`
      );
    }
  }

  const { data: orders, error: ordersError } = await builder;
  unlessFailed("orders", ordersError);
  const fetched = orders ?? [];
  const hasMore = fetched.length > size;
  const rows = fetched.slice(0, size);
  const parties = await partiesFor(a, rows.flatMap((o) => [o.buyer_id, o.seller_id]));
  const titles = await titlesFor(a, rows.map((o) => o.id));

  return {
    page,
    hasMore,
    rows: rows.map((o) => ({
      id: o.id,
      status: o.status,
      createdAt: o.created_at,
      totalCents: o.total_cents,
      refundedCents: o.refunded_cents,
      currency: o.currency,
      title: titles.get(o.id) ?? `Order ${o.id.slice(0, 8)}`,
      buyer: o.buyer_id ? (parties.get(o.buyer_id) ?? null) : null,
      seller: o.seller_id ? (parties.get(o.seller_id) ?? null) : null,
      transferred: Boolean(o.transfer_reference),
    })),
  };
}

/**
 * Status → count for the segmented filter chips over the orders table
 * (the Stripe idiom: the filter states their own size). Respects the active
 * date range; free-text search is intentionally not applied — the chips
 * describe the period, the search narrows the rows.
 */
export async function getOrderStatusCounts(opts: {
  statuses: OrderStatus[];
  from?: string;
  to?: string;
}): Promise<Record<string, number>> {
  const a = admin();
  const counts = await Promise.all(
    opts.statuses.map(async (status) => {
      let b = a.from("orders").select("id", { count: "exact", head: true }).eq("status", status);
      if (opts.from) b = b.gte("created_at", opts.from);
      if (opts.to) b = b.lt("created_at", opts.to);
      const { count } = await b;
      return [status, count ?? 0] as const;
    })
  );
  return Object.fromEntries(counts);
}

// ---------- Listings ----------

export type AdminListingRow = Pick<
  Listing,
  | "id"
  | "title"
  | "description"
  | "category"
  | "condition"
  | "price_cents"
  | "currency"
  | "status"
  | "created_at"
  | "removed_reason"
> & { seller: PartyRef | null; imageUrl: string | null };

export const LISTINGS_PAGE_SIZE = 50;

export type AdminListingsResult = {
  rows: AdminListingRow[];
  /** Exact match count for the active search/status — not a fetch cap. */
  total: number;
  page: number;
  hasMore: boolean;
};

export async function searchListings(opts: {
  query?: string;
  status?: Listing["status"];
  category?: string;
  page?: number;
}): Promise<AdminListingsResult> {
  const a = admin();
  const page = Math.max(0, opts.page ?? 0);
  let builder = a
    .from("listings")
    .select(
      "id, seller_id, title, description, category, condition, price_cents, currency, status, created_at, removed_reason",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(page * LISTINGS_PAGE_SIZE, page * LISTINGS_PAGE_SIZE + LISTINGS_PAGE_SIZE - 1);
  if (opts.status) builder = builder.eq("status", opts.status);
  if (opts.category) builder = builder.eq("category", opts.category);
  if (opts.query?.trim()) builder = builder.ilike("title", `%${opts.query.trim()}%`);

  const { data: listings, count, error: listingsError } = await builder;
  unlessFailed("listings", listingsError);
  const rows = listings ?? [];
  const total = count ?? rows.length;
  const [parties, images] = await Promise.all([
    partiesFor(a, rows.map((l) => l.seller_id)),
    rows.length
      ? a
          .from("listing_images")
          .select("listing_id, url, position")
          .in("listing_id", rows.map((l) => l.id))
          .order("position", { ascending: true })
      : Promise.resolve({ data: [] as { listing_id: string; url: string; position: number }[] }),
  ]);
  const firstImage = new Map<string, string>();
  for (const img of images.data ?? []) {
    if (!firstImage.has(img.listing_id)) firstImage.set(img.listing_id, img.url);
  }
  return {
    page,
    total,
    hasMore: (page + 1) * LISTINGS_PAGE_SIZE < total,
    rows: rows.map((l) => ({
      ...l,
      seller: parties.get(l.seller_id) ?? null,
      imageUrl: firstImage.get(l.id) ?? null,
    })),
  };
}

// ---------- Users ----------

export type AdminUserRow = {
  id: string;
  username: string | null;
  displayName: string | null;
  profileType: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  payoutsEnabled: boolean;
  listingCount: number;
  saleCount: number;
  disputeCount: number;
  isAdmin: boolean;
};

export type UserStateFilter = "all" | "suspended" | "sellers" | "no_payouts" | "admins";

export const USER_STATE_FILTERS: { key: UserStateFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "suspended", label: "Suspended" },
  { key: "sellers", label: "Sellers" },
  { key: "no_payouts", label: "Sellers w/o payouts" },
  { key: "admins", label: "Admins" },
];

export const USERS_PAGE_SIZE = 50;

export type AdminUsersResult = {
  rows: AdminUserRow[];
  /** Exact match count for the active search/state — not a fetch cap. */
  total: number;
  page: number;
  hasMore: boolean;
};

/**
 * Derived states (sellers, console membership) resolve to id sets BEFORE the
 * profiles query, so state filters and pagination compose in the database — a
 * suspended seller past any fetch cap still shows under its filter.
 */
export async function searchUsers(
  query?: string,
  state: UserStateFilter = "all",
  page = 0
): Promise<AdminUsersResult> {
  const a = admin();
  page = Math.max(0, page);

  let constrainIds: string[] | null = null;
  if (state === "sellers" || state === "no_payouts") {
    const [listings, sales] = await Promise.all([
      a.from("listings").select("seller_id").limit(10_000),
      a.from("orders").select("seller_id").limit(10_000),
    ]);
    constrainIds = [
      ...new Set(
        [...(listings.data ?? []), ...(sales.data ?? [])]
          .map((r) => r.seller_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
  } else if (state === "admins") {
    const { data } = await a.from("admin_users").select("user_id");
    constrainIds = (data ?? []).map((r) => r.user_id);
  }
  if (constrainIds && !constrainIds.length) return { rows: [], total: 0, page, hasMore: false };

  let builder = a
    .from("profiles")
    .select(
      "id, username, display_name, profile_type, created_at, suspended_at, suspended_reason, payouts_enabled",
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(page * USERS_PAGE_SIZE, page * USERS_PAGE_SIZE + USERS_PAGE_SIZE - 1);
  const text = query?.trim() ?? "";
  if (text.includes("@")) {
    // Support mail arrives by email address: match the account's email.
    const { data: byEmail, error: emailError } = await a
      .from("account_emails")
      .select("user_id")
      .ilike("email", `%${text.replace(/[%_\\]/g, "")}%`)
      .limit(50);
    unlessFailed("users", emailError);
    builder = builder.in("id", (byEmail ?? []).map((row) => row.user_id));
  } else if (text) {
    builder = builder.or(`username.ilike.%${orText(text)}%,display_name.ilike.%${orText(text)}%`);
  }
  if (state === "suspended") builder = builder.not("suspended_at", "is", null);
  if (state === "no_payouts") builder = builder.eq("payouts_enabled", false);
  if (constrainIds) builder = builder.in("id", constrainIds);

  const { data: profiles, count: total, error: usersError } = await builder;
  unlessFailed("users", usersError);
  const rows = profiles ?? [];
  if (!rows.length) return { rows: [], total: total ?? 0, page, hasMore: false };

  const ids = rows.map((p) => p.id);
  const partyClause = `seller_id.in.(${ids.join(",")}),buyer_id.in.(${ids.join(",")})`;
  const [listings, sales, disputes, admins] = await Promise.all([
    a.from("listings").select("seller_id").in("seller_id", ids),
    // A sale is an order that was paid — cancelled and abandoned ones aren't.
    a.from("orders").select("seller_id").in("seller_id", ids).in("status", ["paid", "shipped", "delivered", "completed", "disputed"]),
    // Only this page's parties — never the whole orders table.
    a.from("orders").select("seller_id, buyer_id").not("disputed_at", "is", null).or(partyClause),
    a.from("admin_users").select("user_id").in("user_id", ids),
  ]);

  const count = (list: (string | null)[] | undefined, id: string) =>
    (list ?? []).filter((x) => x === id).length;
  const adminSet = new Set((admins.data ?? []).map((r) => r.user_id));

  return {
    page,
    total: total ?? rows.length,
    hasMore: (page + 1) * USERS_PAGE_SIZE < (total ?? 0),
    rows: rows.map((p) => ({
      id: p.id,
      username: p.username,
      displayName: p.display_name,
      profileType: p.profile_type,
      createdAt: p.created_at,
      suspendedAt: p.suspended_at,
      suspendedReason: p.suspended_reason,
      payoutsEnabled: p.payouts_enabled,
      listingCount: count(listings.data?.map((l) => l.seller_id), p.id),
      saleCount: count(sales.data?.map((o) => o.seller_id), p.id),
      disputeCount:
        count(disputes.data?.map((o) => o.seller_id), p.id) +
        count(disputes.data?.map((o) => o.buyer_id), p.id),
      isAdmin: adminSet.has(p.id),
    })),
  };
}

// ---------- User detail ----------

export type AdminUserOrderRow = {
  id: string;
  status: OrderStatus;
  createdAt: string;
  totalCents: number;
  refundedCents: number;
  title: string;
  counterparty: PartyRef | null;
  disputed: boolean;
};

export type AdminUserDetail = {
  id: string;
  username: string | null;
  displayName: string | null;
  profileType: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  payoutsEnabled: boolean;
  stripeAccountId: string | null;
  isAdmin: boolean;
  /** Lifetime counts — not capped by the recent lists below. */
  totals: {
    purchases: number;
    sales: number;
    listings: number;
    disputes: number;
    /** Disputes this user (as seller) lost money on — refund accepted, admin
     *  or SLA refund, chargeback (dispute_outcome, 0024). The defect ledger. */
    disputesLost: number;
    reportsAgainst: number;
  };
  purchases: AdminUserOrderRow[];
  sales: AdminUserOrderRow[];
  listings: Pick<Listing, "id" | "title" | "status" | "price_cents" | "created_at" | "removed_reason">[];
  reportsAgainst: (Report & { reporter: PartyRef | null })[];
  adminHistory: AdminAuditLogEntry[];
};

const USER_DETAIL_LIST_LIMIT = 20;

/**
 * Everything a suspend/refund decision needs about one person, on one sheet:
 * both sides of their order history, their stock, the reports naming them,
 * and every admin action that ever touched them.
 */
export async function getUserDetail(userId: string): Promise<AdminUserDetail | null> {
  const a = admin();
  const { data: profile } = await a
    .from("profiles")
    .select(
      "id, username, display_name, profile_type, created_at, suspended_at, suspended_reason, payouts_enabled, stripe_account_id"
    )
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return null;

  const orderCols =
    "id, status, created_at, total_cents, refunded_cents, buyer_id, seller_id, disputed_at";
  const [
    purchases,
    sales,
    listings,
    reports,
    auditRows,
    adminRow,
    purchaseCount,
    saleCount,
    listingCount,
    disputeCount,
    disputesLostCount,
    reportCount,
  ] = await Promise.all([
    a
      .from("orders")
      .select(orderCols)
      .eq("buyer_id", userId)
      .order("created_at", { ascending: false })
      .limit(USER_DETAIL_LIST_LIMIT),
    a
      .from("orders")
      .select(orderCols)
      .eq("seller_id", userId)
      .order("created_at", { ascending: false })
      .limit(USER_DETAIL_LIST_LIMIT),
    a
      .from("listings")
      .select("id, title, status, price_cents, created_at, removed_reason")
      .eq("seller_id", userId)
      .order("created_at", { ascending: false })
      .limit(USER_DETAIL_LIST_LIMIT),
    a
      .from("reports")
      .select("*")
      .eq("subject_type", "user")
      .eq("subject_id", userId)
      .order("created_at", { ascending: false })
      .limit(USER_DETAIL_LIST_LIMIT),
    a
      .from("admin_audit_log")
      .select("*")
      .eq("subject_type", "user")
      .eq("subject_id", userId)
      .order("created_at", { ascending: false })
      .limit(USER_DETAIL_LIST_LIMIT),
    a.from("admin_users").select("user_id").eq("user_id", userId).maybeSingle(),
    a.from("orders").select("id", { count: "exact", head: true }).eq("buyer_id", userId),
    a.from("orders").select("id", { count: "exact", head: true }).eq("seller_id", userId),
    a.from("listings").select("id", { count: "exact", head: true }).eq("seller_id", userId),
    a
      .from("orders")
      .select("id", { count: "exact", head: true })
      .not("disputed_at", "is", null)
      .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`),
    a
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", userId)
      .in("dispute_outcome", ["refund_accepted", "auto_refunded", "admin_refunded", "chargeback_lost"]),
    a
      .from("reports")
      .select("id", { count: "exact", head: true })
      .eq("subject_type", "user")
      .eq("subject_id", userId),
  ]);

  const purchaseRows = purchases.data ?? [];
  const saleRows = sales.data ?? [];
  const reportRows = reports.data ?? [];
  const [parties, titles] = await Promise.all([
    partiesFor(a, [
      ...purchaseRows.map((o) => o.seller_id),
      ...saleRows.map((o) => o.buyer_id),
      ...reportRows.map((r) => r.reporter_id),
    ]),
    titlesFor(a, [...purchaseRows, ...saleRows].map((o) => o.id)),
  ]);

  const toRow = (o: (typeof purchaseRows)[number], counterpartyId: string | null): AdminUserOrderRow => ({
    id: o.id,
    status: o.status,
    createdAt: o.created_at,
    totalCents: o.total_cents,
    refundedCents: o.refunded_cents,
    title: titles.get(o.id) ?? `Order ${o.id.slice(0, 8)}`,
    counterparty: counterpartyId ? (parties.get(counterpartyId) ?? null) : null,
    disputed: Boolean(o.disputed_at),
  });

  return {
    id: profile.id,
    username: profile.username,
    displayName: profile.display_name,
    profileType: profile.profile_type,
    createdAt: profile.created_at,
    suspendedAt: profile.suspended_at,
    suspendedReason: profile.suspended_reason,
    payoutsEnabled: profile.payouts_enabled,
    stripeAccountId: profile.stripe_account_id,
    isAdmin: Boolean(adminRow.data),
    totals: {
      purchases: purchaseCount.count ?? 0,
      sales: saleCount.count ?? 0,
      listings: listingCount.count ?? 0,
      disputes: disputeCount.count ?? 0,
      disputesLost: disputesLostCount.count ?? 0,
      reportsAgainst: reportCount.count ?? 0,
    },
    purchases: purchaseRows.map((o) => toRow(o, o.seller_id)),
    sales: saleRows.map((o) => toRow(o, o.buyer_id)),
    listings: listings.data ?? [],
    reportsAgainst: reportRows.map((r) => ({
      ...r,
      reporter: r.reporter_id ? (parties.get(r.reporter_id) ?? null) : null,
    })),
    adminHistory: auditRows.data ?? [],
  };
}

// ---------- Reports ----------

export type AdminReportRow = Report & {
  reporter: PartyRef | null;
  subjectLabel: string;
  /** "Listing" · "User" · "Post" · "Reply" — what the row names. */
  subjectKind: string;
  /** Where the reviewer looks at it: the console search for a listing or a
   *  member, the public post for a post or a reply, the build page for a car. */
  subjectHref: string;
  /** A reported build under a moderation hold (N53), so the row offers to lift it. */
  carHidden?: boolean;
};

export const REPORTS_PAGE_SIZE = 50;

export type AdminReportsResult = {
  rows: AdminReportRow[];
  total: number;
  page: number;
  hasMore: boolean;
};

export async function getReports(
  scope: "open" | "closed",
  opts: { reason?: Report["reason"]; page?: number } = {}
): Promise<AdminReportsResult> {
  const a = admin();
  const page = Math.max(0, opts.page ?? 0);
  // Status, reason and paging all belong to the database — the old capped
  // fetch-then-filter could hide open reports beyond the cap.
  let builder = a
    .from("reports")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: scope === "open" })
    .range(page * REPORTS_PAGE_SIZE, page * REPORTS_PAGE_SIZE + REPORTS_PAGE_SIZE - 1);
  builder = scope === "open" ? builder.eq("status", "open") : builder.neq("status", "open");
  if (opts.reason) builder = builder.eq("reason", opts.reason);

  const { data: reports, count } = await builder;
  const rows = reports ?? [];
  const total = count ?? rows.length;
  const parties = await partiesFor(a, rows.map((r) => r.reporter_id));

  const listingIds = rows.filter((r) => r.subject_type === "listing").map((r) => r.subject_id);
  const userIds = rows.filter((r) => r.subject_type === "user").map((r) => r.subject_id);
  const postIds = rows.filter((r) => r.subject_type === "post").map((r) => r.subject_id);
  const commentIds = rows.filter((r) => r.subject_type === "comment").map((r) => r.subject_id);
  const carIds = rows.filter((r) => r.subject_type === "car").map((r) => r.subject_id);
  const [{ data: listings }, users, { data: posts }, { data: comments }, { data: cars }] = await Promise.all([
    listingIds.length
      ? a.from("listings").select("id, title").in("id", listingIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    partiesFor(a, userIds),
    postIds.length
      ? a.from("activity_posts").select("id, title, intro, body").in("id", postIds)
      : Promise.resolve({ data: [] }),
    commentIds.length
      ? a.from("activity_comments").select("id, post_id, body").in("id", commentIds)
      : Promise.resolve({ data: [] }),
    carIds.length
      ? a.from("cars").select("id, slug, name, car_moderation_holds(car_id)").in("id", carIds)
      : Promise.resolve({ data: [] as { id: string; slug: string; name: string; car_moderation_holds: { car_id: string } | null }[] }),
  ]);
  const carById = new Map((cars ?? []).map((c) => [c.id, c]));
  const listingTitles = new Map((listings ?? []).map((l) => [l.id, l.title]));
  const postById = new Map((posts ?? []).map((p) => [p.id, p]));
  const commentById = new Map((comments ?? []).map((c) => [c.id, c]));
  const clip = (text: string) => (text.length > 80 ? `${text.slice(0, 79)}…` : text);
  function subject(r: Report): { subjectLabel: string; subjectKind: string; subjectHref: string; carHidden?: boolean } {
    if (r.subject_type === "car") {
      const car = carById.get(r.subject_id);
      return {
        subjectLabel: car ? clip(car.name) : "Build (deleted)",
        subjectKind: "Build",
        subjectHref: car ? `/cars/${car.slug}` : "/admin/reports",
        carHidden: Boolean(car?.car_moderation_holds),
      };
    }
    if (r.subject_type === "listing") {
      const label = listingTitles.get(r.subject_id) ?? "Listing (deleted)";
      return { subjectLabel: label, subjectKind: "Listing", subjectHref: `/admin/listings?q=${encodeURIComponent(label)}` };
    }
    if (r.subject_type === "post") {
      const post = postById.get(r.subject_id);
      return {
        subjectLabel: post ? clip(postHeadline(post)) : "Post (deleted)",
        subjectKind: "Post",
        subjectHref: `/posts/${r.subject_id}`,
      };
    }
    if (r.subject_type === "comment") {
      const comment = commentById.get(r.subject_id);
      return {
        subjectLabel: comment ? clip(comment.body) : "Reply (deleted)",
        subjectKind: "Reply",
        subjectHref: comment ? `/posts/${comment.post_id}` : "/admin/reports",
      };
    }
    const label = users.get(r.subject_id)?.username ?? users.get(r.subject_id)?.displayName ?? "User";
    return { subjectLabel: label, subjectKind: "User", subjectHref: `/admin/users?q=${encodeURIComponent(label)}` };
  }

  return {
    page,
    total,
    hasMore: (page + 1) * REPORTS_PAGE_SIZE < total,
    rows: rows.map((r) => ({
      ...r,
      reporter: r.reporter_id ? (parties.get(r.reporter_id) ?? null) : null,
      ...subject(r),
    })),
  };
}

// ---------- Payments ops ----------

/** A seller credit payout the worker has given up on (20261008100100):
 *  status failed with no next attempt — exhausted, or set aside for an
 *  operator ("no destination on record", an untrusted Stripe lookup). */
export type StuckCarryPayout = Pick<
  Database["public"]["Tables"]["seller_carry_payouts"]["Row"],
  "id" | "seller_id" | "amount_cents" | "currency" | "status" | "attempts" | "last_error" | "provider_call_may_have_occurred" | "created_at" | "updated_at"
> & { seller: PartyRef | null };

export type PaymentsOps = {
  recoveries: (PaymentRecovery & { orderTitle: string })[];
  stuckIntents: (TransferIntent & { seller: PartyRef | null; orderTitle: string })[];
  /** Seller credit payouts needing an operator's retry or cancel (readiness 21). */
  stuckCarryPayouts: StuckCarryPayout[];
  /** In-flight, failed, and recovery-required refund operations (0026). */
  refundOps: (import("@/lib/database.types").RefundOperation & { orderTitle: string })[];
  /** Undelivered admin alerts: pending retries, exhausted, or no destination. */
  alertBacklog: import("@/lib/database.types").AdminAlertOutboxRow[];
  recentEvents: {
    id: string;
    type: string;
    receivedAt: string;
    processedAt: string | null;
    /** Pretty-printed payload for the drill-in; null for pre-0023 events. */
    payload: string | null;
    /** Failed deliveries of a still-unprocessed event (20261107191000). */
    failedAttempts: number;
    lastFailedAt: string | null;
    /** "retry" or "error", with the handler's reason when it threw. */
    lastFailure: string | null;
  }[];
};

export async function getPaymentsOps(opts: { query?: string } = {}): Promise<PaymentsOps> {
  const a = admin();
  const [recoveries, intents, events, refundOps, alerts, carryPayouts] = await Promise.all([
    a
      .from("payment_recoveries")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    a
      .from("transfer_intents")
      .select("*")
      .in("status", ["blocked_unpayable", "failed", "holding", "ready"])
      .order("created_at", { ascending: true })
      .limit(100),
    a.from("webhook_events").select("*").order("received_at", { ascending: false }).limit(25),
    a
      .from("refund_operations")
      .select("*")
      .in("status", [
        "requested",
        "provider_pending",
        "provider_succeeded",
        "effects_pending",
        "reversal_pending",
        "failed",
        "recovery_required",
      ])
      .order("created_at", { ascending: false })
      .limit(100),
    a
      .from("admin_alert_outbox")
      .select("*")
      .in("status", ["pending", "failed", "disabled"])
      .order("created_at", { ascending: false })
      .limit(50),
    // The worker leaves a payout it has given up on as failed with no next
    // attempt (carry-payout-worker.ts); retrying rows carry a time and are
    // not an operator's business yet.
    a
      .from("seller_carry_payouts")
      .select("id, seller_id, amount_cents, currency, status, attempts, last_error, provider_call_may_have_occurred, created_at, updated_at")
      .eq("status", "failed")
      .is("next_attempt_at", null)
      .order("created_at", { ascending: true })
      .limit(100),
  ]);

  // Each panel is a queue an operator acts on; an unread one must not look
  // empty.
  unlessFailed("payment recoveries", recoveries.error);
  unlessFailed("transfer intents", intents.error);
  unlessFailed("webhook events", events.error);
  unlessFailed("refund operations", refundOps.error);
  unlessFailed("the admin alert backlog", alerts.error);
  unlessFailed("stuck seller credit payouts", carryPayouts.error);

  const recoveryRows = recoveries.data ?? [];
  const intentRows = intents.data ?? [];
  const refundOpRows = refundOps.data ?? [];
  const carryRows = carryPayouts.data ?? [];
  const titles = await titlesFor(a, [
    ...recoveryRows.map((r) => r.order_id).filter((id): id is string => Boolean(id)),
    ...intentRows.map((i) => i.order_id),
    ...refundOpRows.map((r) => r.order_id),
  ]);
  const parties = await partiesFor(a, [...intentRows.map((i) => i.seller_id), ...carryRows.map((p) => p.seller_id)]);

  const q = opts.query?.trim().toLowerCase();
  const filteredRecoveries = recoveryRows
    .map((r) => ({
      ...r,
      orderTitle: r.order_id ? (titles.get(r.order_id) ?? "Order") : "—",
    }))
    .filter(
      (r) =>
        !q ||
        (r.order_id ?? "").toLowerCase().startsWith(q) ||
        r.orderTitle.toLowerCase().includes(q) ||
        (r.detail ?? "").toLowerCase().includes(q)
    );
  const filteredIntents = intentRows
    .map((i) => ({
      ...i,
      seller: i.seller_id ? (parties.get(i.seller_id) ?? null) : null,
      orderTitle: titles.get(i.order_id) ?? "Order",
    }))
    .filter(
      (i) =>
        !q ||
        i.order_id.toLowerCase().startsWith(q) ||
        i.orderTitle.toLowerCase().includes(q) ||
        (i.seller?.username ?? "").toLowerCase().includes(q)
    );

  const stuckCarryPayouts: StuckCarryPayout[] = carryRows
    .map((p) => ({ ...p, seller: p.seller_id ? (parties.get(p.seller_id) ?? null) : null }))
    .filter(
      (p) =>
        !q ||
        p.id.toLowerCase().startsWith(q) ||
        (p.seller?.username ?? "").toLowerCase().includes(q) ||
        (p.seller?.displayName ?? "").toLowerCase().includes(q) ||
        (p.last_error ?? "").toLowerCase().includes(q)
    );

  return {
    recoveries: filteredRecoveries,
    stuckIntents: filteredIntents,
    stuckCarryPayouts,
    refundOps: refundOpRows
      .map((r) => ({ ...r, orderTitle: titles.get(r.order_id) ?? "Order" }))
      .filter(
        (r) =>
          !q ||
          r.order_id.toLowerCase().startsWith(q) ||
          r.orderTitle.toLowerCase().includes(q) ||
          r.status.includes(q)
      ),
    alertBacklog: alerts.data ?? [],
    recentEvents: (await withUnprocessedEvents(a, (events.data ?? []) as WebhookEvent[])).map((e) => ({
      id: e.id,
      type: e.type,
      receivedAt: e.received_at,
      processedAt: e.processed_at,
      payload: e.payload ? JSON.stringify(e.payload, null, 2) : null,
      failedAttempts: e.failed_attempts,
      lastFailedAt: e.last_failed_at,
      lastFailure: e.last_failure_kind
        ? `${e.last_failure_kind}${e.last_failure_detail ? ` — ${e.last_failure_detail}` : ""}`
        : null,
    })),
  };
}

/**
 * Events not yet applied, oldest first, then the recent ones (N109). An event
 * Stripe keeps redelivering used to scroll out of the last 25 while it was
 * still owed; it now stays at the top, with its attempts and last failure, and
 * the same Replay (idempotent handlers, applied only on a confirmed outcome).
 */
async function withUnprocessedEvents(a: ReturnType<typeof admin>, recent: WebhookEvent[]): Promise<WebhookEvent[]> {
  const { data, error } = await a
    .from("webhook_events")
    .select("*")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(25);
  unlessFailed("unprocessed webhook events", error);
  const owed = (data ?? []) as WebhookEvent[];
  const seen = new Set(owed.map((e) => e.id));
  return [...owed, ...recent.filter((e) => !seen.has(e.id))];
}

// ---------- Audit log ----------

export type AuditRow = AdminAuditLogEntry & { actor: PartyRef | null };

export const AUDIT_PAGE_SIZE = 50;

export type AuditLogResult = { rows: AuditRow[]; page: number; hasMore: boolean };

export async function getAuditLog(
  opts: {
    action?: string;
    /** Actor by username/display name — resolved to ids here. */
    actorQuery?: string;
    subjectType?: AdminAuditLogEntry["subject_type"];
    page?: number;
    /** ISO timestamps — inclusive start, exclusive end. */
    from?: string;
    to?: string;
    /** Export path: rows per page (defaults to AUDIT_PAGE_SIZE, capped at 5000). */
    pageSize?: number;
  } = {}
): Promise<AuditLogResult> {
  const a = admin();
  const page = Math.max(0, opts.page ?? 0);
  const size = Math.min(Math.max(1, opts.pageSize ?? AUDIT_PAGE_SIZE), 5000);
  let builder = a
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .range(page * size, page * size + size);
  if (opts.action) builder = builder.ilike("action", `${opts.action}%`);
  if (opts.subjectType) builder = builder.eq("subject_type", opts.subjectType);
  if (opts.from) builder = builder.gte("created_at", opts.from);
  if (opts.to) builder = builder.lt("created_at", opts.to);
  if (opts.actorQuery?.trim()) {
    const q = opts.actorQuery.trim();
    const { data: actors } = await a
      .from("profiles")
      .select("id")
      .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
      .limit(20);
    const ids = (actors ?? []).map((u) => u.id);
    if (!ids.length) return { rows: [], page, hasMore: false };
    builder = builder.in("actor_id", ids);
  }
  const { data } = await builder;
  const fetched = data ?? [];
  const hasMore = fetched.length > size;
  const rows = fetched.slice(0, size);
  const parties = await partiesFor(a, rows.map((r) => r.actor_id));
  return { rows: rows.map((r) => ({ ...r, actor: parties.get(r.actor_id) ?? null })), page, hasMore };
}

// ---------- Nav counts ----------

/** null = the count couldn't be read. The nav shows that, rather than a
 *  missing badge that would read as "nothing waiting". */
export type NavCounts = { disputes: number | null; reports: number | null; money: number | null; products: number | null };

/** Live queue badges for the console nav — the backlog visible from anywhere.
 *  This runs in the console layout, so a failed count degrades its badge
 *  instead of throwing the whole console into the error page. */
export async function getNavCounts(): Promise<NavCounts> {
  const a = admin();
  const [disputes, reports, recoveries, stuck, products] = await Promise.all([
    a.from("orders").select("id", { count: "exact", head: true }).eq("status", "disputed"),
    a.from("reports").select("id", { count: "exact", head: true }).eq("status", "open"),
    a.from("payment_recoveries").select("id", { count: "exact", head: true }).eq("status", "open"),
    a
      .from("transfer_intents")
      .select("order_id", { count: "exact", head: true })
      .in("status", ["blocked_unpayable", "failed"]),
    countOpenIdentityReviews(),
  ]);
  const read = (label: string, result: { count: number | null; error: { message: string } | null }) => {
    if (!result.error && result.count != null) return result.count;
    reportError(`[admin] nav count ${label} failed`, result.error ?? { message: "count missing" });
    return null;
  };
  const recoveryCount = read("recoveries", recoveries);
  const stuckCount = read("stuck transfers", stuck);
  return {
    disputes: read("disputes", disputes),
    reports: read("reports", reports),
    money: recoveryCount == null || stuckCount == null ? null : recoveryCount + stuckCount,
    products,
  };
}

// ---------- Console settings ----------

export type AdminRosterRow = {
  userId: string;
  username: string | null;
  displayName: string | null;
  role: "admin" | "viewer";
  note: string | null;
  addedAt: string;
};

/**
 * The console roster, for the Settings page — read-only by design: membership
 * and roles live in SQL (0018/0023), so this surface shows who holds a key
 * without ever becoming a place to mint one.
 */
export type AdminIdentity = {
  username: string | null;
  displayName: string | null;
};

/**
 * The signed-in admin's own profile fields, for the console header. Service
 * role, same as every other read here — profiles columns relevant to display
 * (username/display_name) are public elsewhere in the app, but going through
 * the admin client keeps this consistent with the rest of the file rather
 * than depending on the caller's RLS session shape.
 */
export async function getAdminIdentity(userId: string): Promise<AdminIdentity> {
  const a = admin();
  const { data } = await a
    .from("profiles")
    .select("username, display_name")
    .eq("id", userId)
    .maybeSingle();
  return { username: data?.username ?? null, displayName: data?.display_name ?? null };
}

export async function getAdminRoster(): Promise<AdminRosterRow[]> {
  const a = admin();
  const { data: rows } = await a
    .from("admin_users")
    .select("user_id, role, note, created_at")
    .order("created_at", { ascending: true });
  const ids = (rows ?? []).map((r) => r.user_id);
  const { data: profiles } = ids.length
    ? await a.from("profiles").select("id, username, display_name").in("id", ids)
    : { data: [] as { id: string; username: string | null; display_name: string | null }[] };
  const byId = new Map((profiles ?? []).map((p) => [p.id, p]));
  return (rows ?? []).map((r) => ({
    userId: r.user_id,
    username: byId.get(r.user_id)?.username ?? null,
    displayName: byId.get(r.user_id)?.display_name ?? null,
    role: r.role ?? "admin",
    note: r.note,
    addedAt: r.created_at,
  }));
}

// ---------- Background jobs ----------

export type WorkerJobRow = {
  family: string;
  lastSuccess: string | null;
  lastFailure: string | null;
  stale: boolean;
  /** Switched off in this environment (search without Typesense, analytics without PostHog). */
  disabled: boolean;
};

/**
 * When each background job last ran, from worker_health_snapshot() — the
 * same data /api/health/workers serves an external monitor. Null when the
 * snapshot can't be read, so the console says so instead of looking healthy.
 */
export async function getWorkerJobs(): Promise<WorkerJobRow[] | null> {
  const { data, error } = await admin().rpc("worker_health_snapshot", {});
  if (error || !data) return null;
  const snapshot = data as {
    families?: { family: string; stale: boolean; last_success: string | null; last_failure: string | null }[];
  };
  if (!Array.isArray(snapshot.families)) return null;
  const off = new Set<string>();
  if (!(process.env.TYPESENSE_URL && process.env.TYPESENSE_API_KEY)) off.add("search");
  if (!process.env.POSTHOG_KEY) off.add("analytics");
  return snapshot.families.map((f) => ({
    family: f.family,
    lastSuccess: f.last_success,
    lastFailure: f.last_failure,
    stale: off.has(f.family) ? false : f.stale,
    disabled: off.has(f.family),
  }));
}

// ---------- Operations cases (0046) ----------

export type OpsCaseRow = {
  id: string;
  kind: OpsCase["kind"];
  status: OpsCase["status"];
  priority: OpsCase["priority"];
  assignedTo: string | null;
  assignedName: string | null;
  orderId: string | null;
  reportId: string | null;
  summary: string;
  labels: string[];
  openedAt: string;
  /** The underlying object's headline (order item title / reported subject). */
  subject: string;
  href: string;
};

/**
 * The case queue (§K1): claimable work over disputes and reports. Filters are
 * plain columns; the row links straight to the surface where the work happens
 * (the order sheet's dossier, or the reports queue).
 */
export async function listOpsCases(opts: {
  status?: "open" | "claimed" | "resolved";
  kind?: OpsCase["kind"];
  assignee?: string;
} = {}): Promise<OpsCaseRow[]> {
  const a = admin();
  let query = a
    .from("ops_cases")
    .select("*")
    .order("priority", { ascending: false })
    .order("opened_at", { ascending: true })
    .limit(100);
  if (opts.status) query = query.eq("status", opts.status);
  else query = query.neq("status", "resolved");
  if (opts.kind) query = query.eq("kind", opts.kind);
  if (opts.assignee) query = query.eq("assigned_to", opts.assignee);
  const { data: cases, error: casesError } = await query;
  unlessFailed("the case queue", casesError);

  const orderIds = (cases ?? []).flatMap((c) => (c.order_id ? [c.order_id] : []));
  const reportIds = (cases ?? []).flatMap((c) => (c.report_id ? [c.report_id] : []));
  const assigneeIds = [...new Set((cases ?? []).flatMap((c) => (c.assigned_to ? [c.assigned_to] : [])))];
  const none = { error: null };
  const [
    { data: items, error: itemsError },
    { data: reports, error: reportsError },
    { data: assignees, error: assigneesError },
  ] = await Promise.all([
    orderIds.length
      ? a.from("order_items").select("order_id, title").in("order_id", orderIds)
      : Promise.resolve({ ...none, data: [] as { order_id: string; title: string | null }[] }),
    reportIds.length
      ? a.from("reports").select("id, subject_type, reason").in("id", reportIds)
      : Promise.resolve({ ...none, data: [] as { id: string; subject_type: string; reason: string }[] }),
    assigneeIds.length
      ? a.from("profiles").select("id, username, display_name").in("id", assigneeIds)
      : Promise.resolve({ ...none, data: [] as { id: string; username: string | null; display_name: string | null }[] }),
  ]);
  unlessFailed("case subjects", itemsError);
  unlessFailed("case reports", reportsError);
  unlessFailed("case assignees", assigneesError);

  return (cases ?? []).map((c) => {
    const orderTitle = (items ?? []).find((i) => i.order_id === c.order_id)?.title;
    const report = (reports ?? []).find((r) => r.id === c.report_id);
    const assignee = (assignees ?? []).find((p) => p.id === c.assigned_to);
    return {
      id: c.id,
      kind: c.kind,
      status: c.status,
      priority: c.priority,
      assignedTo: c.assigned_to,
      assignedName: assignee?.display_name ?? assignee?.username ?? null,
      orderId: c.order_id,
      reportId: c.report_id,
      summary: c.summary,
      labels: c.labels,
      openedAt: c.opened_at,
      subject:
        c.kind === "dispute"
          ? (orderTitle ?? "Order")
          : `${report?.subject_type ?? "report"} · ${report?.reason?.replaceAll("_", " ") ?? ""}`,
      href: c.kind === "dispute" && c.order_id ? `/admin/orders/${c.order_id}` : "/admin/reports",
    };
  });
}

/**
 * External operations still awaiting an outcome (RR-15, R2-02). A
 * provider-facing admin action (a refund, a transfer) writes
 * `phase: "requested"` before it calls out — which records the intent, not
 * that a provider call happened. `completed` or `reconciled` closes it; an
 * `escalated` record (outcome unknown) keeps it open. Until it closes, the
 * operation fence refuses the same action on the same subject.
 *
 * For refunds, the durable refund records this request created say where
 * the money actually is, so the console can show that instead of a guess.
 */
export type OpenOperation = {
  operationId: string;
  action: string;
  subjectType: AdminAuditLogEntry["subject_type"];
  subjectId: string;
  orderId: string | null;
  reason: string;
  requestedAt: string;
  /** The newest audit id for this operation — the version an answer is
   *  recorded against, so a stale view can't close it. */
  seenThrough: number;
  /** What is known: only the request; the call errored; an operator marked
   *  it unknown; or (refunds) what the refund records show. */
  state: "requested" | "errored" | "escalated" | "refund_running" | "refund_completed" | "refund_failed";
};

export async function getOpenOperations(limit = 50): Promise<OpenOperation[]> {
  const a = admin();
  const { data: requested, error } = await a
    .from("admin_audit_log")
    .select("id, action, subject_type, subject_id, order_id, reason, created_at, actor_id, metadata")
    .eq("metadata->>phase", "requested")
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(`Could not load pending operations: ${error.message}`);
  const opId = (m: unknown) =>
    m && typeof m === "object" && "operationId" in m ? String((m as { operationId: unknown }).operationId) : null;
  const ids = (requested ?? []).map((r) => opId(r.metadata)).filter((id): id is string => Boolean(id));
  if (!ids.length) return [];
  const { data: later, error: laterError } = await a
    .from("admin_audit_log")
    .select("id, metadata")
    .in("metadata->>operationId", ids)
    .neq("metadata->>phase", "requested");
  if (laterError) throw new Error(`Could not load pending operations: ${laterError.message}`);
  const phases = new Map<string, Set<string>>();
  const latest = new Map<string, number>();
  for (const row of later ?? []) {
    const id = opId(row.metadata);
    const phase = (row.metadata as { phase?: string } | null)?.phase;
    if (!id || !phase) continue;
    phases.set(id, (phases.get(id) ?? new Set()).add(phase));
    latest.set(id, Math.max(latest.get(id) ?? 0, row.id));
  }
  const open = (requested ?? [])
    .map((r) => ({ r, id: opId(r.metadata) }))
    .filter(({ id }) => id && !phases.get(id)?.has("completed") && !phases.get(id)?.has("reconciled"))
    .slice(0, limit);

  // Refund records created by these requests (same rule as the database's
  // reconciliation: this admin's refunds on the order since the request).
  const refundOrders = open.filter(({ r }) => r.action === "order.force_refund").map(({ r }) => r.subject_id);
  const refunds = new Map<string, { status: string; created_at: string; requested_by: string }[]>();
  if (refundOrders.length) {
    const { data: ops, error: opsError } = await a
      .from("refund_operations")
      .select("order_id, status, created_at, requested_by")
      .in("order_id", refundOrders);
    if (opsError) throw new Error(`Could not load pending operations: ${opsError.message}`);
    for (const op of ops ?? []) refunds.set(op.order_id, [...(refunds.get(op.order_id) ?? []), op]);
  }

  return open.map(({ r, id }) => {
    const seen = phases.get(id as string);
    let state: OpenOperation["state"] = seen?.has("escalated")
      ? "escalated"
      : seen?.has("failed_or_requires_reconciliation")
        ? "errored"
        : "requested";
    if (r.action === "order.force_refund") {
      const mine = (refunds.get(r.subject_id) ?? []).filter(
        (op) => op.created_at >= r.created_at && op.requested_by === `admin:${r.actor_id}`
      );
      if (mine.some((op) => !["completed", "reversal_pending", "failed"].includes(op.status))) state = "refund_running";
      else if (mine.some((op) => ["completed", "reversal_pending"].includes(op.status))) state = "refund_completed";
      else if (mine.length) state = "refund_failed";
    }
    return {
      operationId: id as string,
      action: r.action,
      subjectType: r.subject_type,
      subjectId: r.subject_id,
      orderId: r.order_id,
      reason: r.reason,
      requestedAt: r.created_at,
      seenThrough: Math.max(r.id, latest.get(id as string) ?? 0),
      state,
    };
  });
}
