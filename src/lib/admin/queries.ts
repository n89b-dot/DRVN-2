import "server-only";

import type {
  AdminAuditLogEntry,
  DisputeCategory,
  Listing,
  Order,
  OrderStatus,
  Payment,
  PaymentRecovery,
  Report,
  TransferIntent,
} from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

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
  suspendedSellers: number;
  removedListings: number;
};

export async function getOverview(): Promise<AdminOverview> {
  const a = admin();
  const since7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const slaCutoff = new Date(Date.now() - DISPUTE_SLA_DAYS * 86_400_000).toISOString();

  const [disputes, overSla, oldest, reports, recoveries, stuck, orders7, refunds7, suspended, removed] =
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
      a
        .from("orders")
        .select("total_cents")
        .gte("created_at", since7d)
        .in("status", ["paid", "shipped", "delivered", "completed", "disputed", "refunded"]),
      a.from("orders").select("refunded_cents").gt("refunded_cents", 0).gte("refunded_at", since7d),
      a.from("profiles").select("id", { count: "exact", head: true }).not("suspended_at", "is", null),
      a.from("listings").select("id", { count: "exact", head: true }).eq("status", "removed"),
    ]);

  const oldestDisputeDays = oldest.data?.disputed_at
    ? Math.floor((Date.now() - new Date(oldest.data.disputed_at).getTime()) / 86_400_000)
    : null;

  return {
    openDisputes: disputes.count ?? 0,
    disputesOverSla: overSla.count ?? 0,
    oldestDisputeDays,
    openReports: reports.count ?? 0,
    openRecoveries: recoveries.count ?? 0,
    stuckTransfers: stuck.count ?? 0,
    orders7d: orders7.data?.length ?? 0,
    gmv7dCents: (orders7.data ?? []).reduce((s, o) => s + o.total_cents, 0),
    refunds7dCents: (refunds7.data ?? []).reduce((s, o) => s + o.refunded_cents, 0),
    suspendedSellers: suspended.count ?? 0,
    removedListings: removed.count ?? 0,
  };
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
  category: DisputeCategory | null;
  reason: string | null;
  totalCents: number;
  currency: string;
  refundOfferCents: number | null;
  buyer: PartyRef | null;
  seller: PartyRef | null;
  title: string;
  transferred: boolean;
};

export async function getDisputeQueue(scope: "open" | "resolved"): Promise<DisputeQueueRow[]> {
  const a = admin();
  const base = a
    .from("orders")
    .select(
      "id, buyer_id, seller_id, disputed_at, dispute_category, dispute_reason, dispute_resolved_at, total_cents, currency, refund_offer_cents, transfer_reference, status"
    )
    .limit(200);

  const { data: orders } =
    scope === "open"
      ? await base.eq("status", "disputed").order("disputed_at", { ascending: true })
      : await base.not("dispute_resolved_at", "is", null).order("dispute_resolved_at", { ascending: false });

  const rows = orders ?? [];
  const parties = await partiesFor(a, rows.flatMap((o) => [o.buyer_id, o.seller_id]));
  const titles = await titlesFor(a, rows.map((o) => o.id));

  return rows.map((o) => {
    const ageDays = o.disputed_at
      ? Math.floor((Date.now() - new Date(o.disputed_at).getTime()) / 86_400_000)
      : 0;
    return {
      orderId: o.id,
      disputedAt: o.disputed_at,
      ageDays,
      overSla: ageDays >= DISPUTE_SLA_DAYS && o.status === "disputed",
      category: o.dispute_category,
      reason: o.dispute_reason,
      totalCents: o.total_cents,
      currency: o.currency,
      refundOfferCents: o.refund_offer_cents,
      buyer: o.buyer_id ? (parties.get(o.buyer_id) ?? null) : null,
      seller: o.seller_id ? (parties.get(o.seller_id) ?? null) : null,
      title: titles.get(o.id) ?? "Order",
      transferred: Boolean(o.transfer_reference),
    };
  });
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

export type AdminOrderDetail = {
  order: Order;
  items: { id: string; title: string | null; priceCents: number; listingId: string | null }[];
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
  audit: AdminAuditLogEntry[];
};

export async function getOrderDetail(orderId: string): Promise<AdminOrderDetail | null> {
  const a = admin();
  const { data: order } = await a.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return null;

  const [items, payment, intent, messages, audit] = await Promise.all([
    a.from("order_items").select("id, title, price_cents, listing_id").eq("order_id", orderId),
    a.from("payments").select("*").eq("order_id", orderId).maybeSingle(),
    a.from("transfer_intents").select("*").eq("order_id", orderId).maybeSingle(),
    a
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .limit(100),
    a
      .from("admin_audit_log")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: false })
      .limit(50),
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

  const [buyer, seller] = await Promise.all([
    loadParty(order.buyer_id, "buyer"),
    loadParty(order.seller_id, "seller"),
  ]);

  return {
    order,
    items: (items.data ?? []).map((i) => ({
      id: i.id,
      title: i.title,
      priceCents: i.price_cents,
      listingId: i.listing_id,
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
    audit: audit.data ?? [],
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

export async function searchOrders(opts: {
  query?: string;
  status?: OrderStatus;
}): Promise<AdminOrderRow[]> {
  const a = admin();
  let builder = a
    .from("orders")
    .select("id, status, created_at, total_cents, refunded_cents, currency, buyer_id, seller_id, transfer_reference")
    .order("created_at", { ascending: false })
    .limit(100);
  if (opts.status) builder = builder.eq("status", opts.status);

  const query = opts.query?.trim();
  if (query) {
    // Order-id prefix, payment-intent reference, or a party's username.
    if (/^[0-9a-f-]{8,}$/i.test(query)) {
      const { data: byPayment } = await a
        .from("payments")
        .select("order_id")
        .ilike("provider_reference", `${query}%`);
      const orderIds = (byPayment ?? []).map((p) => p.order_id);
      builder = orderIds.length ? builder.in("id", orderIds) : builder.ilike("id::text" as never, `${query}%`);
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
        .or(`username.ilike.%${query}%,display_name.ilike.%${query}%`)
        .limit(20);
      const ids = (users ?? []).map((u) => u.id);
      if (!ids.length) return [];
      builder = builder.or(
        `buyer_id.in.(${ids.join(",")}),seller_id.in.(${ids.join(",")})`
      );
    }
  }

  const { data: orders } = await builder;
  const rows = orders ?? [];
  const parties = await partiesFor(a, rows.flatMap((o) => [o.buyer_id, o.seller_id]));
  const titles = await titlesFor(a, rows.map((o) => o.id));

  return rows.map((o) => ({
    id: o.id,
    status: o.status,
    createdAt: o.created_at,
    totalCents: o.total_cents,
    refundedCents: o.refunded_cents,
    currency: o.currency,
    title: titles.get(o.id) ?? "Order",
    buyer: o.buyer_id ? (parties.get(o.buyer_id) ?? null) : null,
    seller: o.seller_id ? (parties.get(o.seller_id) ?? null) : null,
    transferred: Boolean(o.transfer_reference),
  }));
}

// ---------- Listings ----------

export type AdminListingRow = Pick<
  Listing,
  "id" | "title" | "category" | "price_cents" | "currency" | "status" | "created_at" | "removed_reason"
> & { seller: PartyRef | null };

export async function searchListings(opts: {
  query?: string;
  status?: Listing["status"];
}): Promise<AdminListingRow[]> {
  const a = admin();
  let builder = a
    .from("listings")
    .select("id, seller_id, title, category, price_cents, currency, status, created_at, removed_reason")
    .order("created_at", { ascending: false })
    .limit(100);
  if (opts.status) builder = builder.eq("status", opts.status);
  if (opts.query?.trim()) builder = builder.ilike("title", `%${opts.query.trim()}%`);

  const { data: listings } = await builder;
  const rows = listings ?? [];
  const parties = await partiesFor(a, rows.map((l) => l.seller_id));
  return rows.map((l) => ({ ...l, seller: parties.get(l.seller_id) ?? null }));
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

export async function searchUsers(query?: string): Promise<AdminUserRow[]> {
  const a = admin();
  let builder = a
    .from("profiles")
    .select("id, username, display_name, profile_type, created_at, suspended_at, suspended_reason, payouts_enabled")
    .order("created_at", { ascending: false })
    .limit(50);
  if (query?.trim()) {
    builder = builder.or(`username.ilike.%${query.trim()}%,display_name.ilike.%${query.trim()}%`);
  }
  const { data: profiles } = await builder;
  const rows = profiles ?? [];
  if (!rows.length) return [];

  const ids = rows.map((p) => p.id);
  const [listings, sales, disputes, admins] = await Promise.all([
    a.from("listings").select("seller_id").in("seller_id", ids),
    a.from("orders").select("seller_id").in("seller_id", ids),
    a.from("orders").select("seller_id, buyer_id").not("disputed_at", "is", null),
    a.from("admin_users").select("user_id").in("user_id", ids),
  ]);

  const count = (list: (string | null)[] | undefined, id: string) =>
    (list ?? []).filter((x) => x === id).length;
  const adminSet = new Set((admins.data ?? []).map((r) => r.user_id));

  return rows.map((p) => ({
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
  }));
}

// ---------- Reports ----------

export type AdminReportRow = Report & {
  reporter: PartyRef | null;
  subjectLabel: string;
};

export async function getReports(scope: "open" | "closed"): Promise<AdminReportRow[]> {
  const a = admin();
  const { data: reports } = await a
    .from("reports")
    .select("*")
    .order("created_at", { ascending: scope === "open" })
    .limit(200)
    .then((res) =>
      scope === "open"
        ? { data: (res.data ?? []).filter((r) => r.status === "open") }
        : { data: (res.data ?? []).filter((r) => r.status !== "open") }
    );

  const rows = reports ?? [];
  const parties = await partiesFor(a, rows.map((r) => r.reporter_id));

  const listingIds = rows.filter((r) => r.subject_type === "listing").map((r) => r.subject_id);
  const userIds = rows.filter((r) => r.subject_type === "user").map((r) => r.subject_id);
  const [{ data: listings }, users] = await Promise.all([
    listingIds.length
      ? a.from("listings").select("id, title").in("id", listingIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
    partiesFor(a, userIds),
  ]);
  const listingTitles = new Map((listings ?? []).map((l) => [l.id, l.title]));

  return rows.map((r) => ({
    ...r,
    reporter: r.reporter_id ? (parties.get(r.reporter_id) ?? null) : null,
    subjectLabel:
      r.subject_type === "listing"
        ? (listingTitles.get(r.subject_id) ?? "Listing (deleted)")
        : (users.get(r.subject_id)?.username ?? users.get(r.subject_id)?.displayName ?? "User"),
  }));
}

// ---------- Payments ops ----------

export type PaymentsOps = {
  recoveries: (PaymentRecovery & { orderTitle: string })[];
  stuckIntents: (TransferIntent & { seller: PartyRef | null; orderTitle: string })[];
  recentEvents: { id: string; type: string; receivedAt: string; processedAt: string | null }[];
};

export async function getPaymentsOps(): Promise<PaymentsOps> {
  const a = admin();
  const [recoveries, intents, events] = await Promise.all([
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
  ]);

  const recoveryRows = recoveries.data ?? [];
  const intentRows = intents.data ?? [];
  const titles = await titlesFor(a, [
    ...recoveryRows.map((r) => r.order_id).filter((id): id is string => Boolean(id)),
    ...intentRows.map((i) => i.order_id),
  ]);
  const parties = await partiesFor(a, intentRows.map((i) => i.seller_id));

  return {
    recoveries: recoveryRows.map((r) => ({
      ...r,
      orderTitle: r.order_id ? (titles.get(r.order_id) ?? "Order") : "—",
    })),
    stuckIntents: intentRows.map((i) => ({
      ...i,
      seller: i.seller_id ? (parties.get(i.seller_id) ?? null) : null,
      orderTitle: titles.get(i.order_id) ?? "Order",
    })),
    recentEvents: (events.data ?? []).map((e) => ({
      id: e.id,
      type: e.type,
      receivedAt: e.received_at,
      processedAt: e.processed_at,
    })),
  };
}

// ---------- Audit log ----------

export type AuditRow = AdminAuditLogEntry & { actor: PartyRef | null };

export async function getAuditLog(opts: { action?: string; actorId?: string } = {}): Promise<AuditRow[]> {
  const a = admin();
  let builder = a
    .from("admin_audit_log")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);
  if (opts.action) builder = builder.ilike("action", `${opts.action}%`);
  if (opts.actorId) builder = builder.eq("actor_id", opts.actorId);
  const { data } = await builder;
  const rows = data ?? [];
  const parties = await partiesFor(a, rows.map((r) => r.actor_id));
  return rows.map((r) => ({ ...r, actor: parties.get(r.actor_id) ?? null }));
}
