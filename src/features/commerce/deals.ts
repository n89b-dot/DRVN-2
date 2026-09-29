import { formatPrice } from "@/lib/marketplace/taxonomy";

/**
 * Deals between two people — the orders and offers a conversation is about.
 *
 * Since 20260928140000 a conversation is one person, and each message carries
 * the order or offer it concerns. This module turns those order/offer rows
 * into what the inbox and the thread show: which side you're on, where it
 * stands, whether it's your move, and the lifecycle events that belong in the
 * timeline. Pure — no I/O — so the rules are unit-tested.
 */

export type DealSide = "buying" | "selling";
/** move = it's your turn · ok = going well · quiet = nothing for you to do */
export type DealTone = "move" | "ok" | "quiet";

export type OrderDealRow = {
  id: string;
  status: string;
  buyer_id: string | null;
  seller_id: string | null;
  total_cents: number;
  is_collection: boolean;
  pickup_ready_at: string | null;
  created_at: string;
  shipped_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  refunded_at: string | null;
  updated_at: string;
  title: string;
  image?: string | null;
};

export type OfferDealRow = {
  id: string;
  status: string;
  buyer_id: string;
  seller_id: string;
  listing_id: string;
  amount_cents: number;
  counter_amount_cents: number | null;
  created_at: string;
  countered_at: string | null;
  responded_at: string | null;
  updated_at: string;
  expires_at: string | null;
  title: string;
  image?: string | null;
};

export type Deal = {
  /** `order:<id>` / `offer:<id>` — also the composer's "about" value. */
  key: string;
  kind: "order" | "offer";
  id: string;
  side: DealSide;
  title: string;
  image: string | null;
  amountCents: number;
  status: string;
  /** Where it stands, from your side: "Ship it", "Countered $6,200". */
  label: string;
  tone: DealTone;
  /** Still in progress (open offer, unfinished order). */
  active: boolean;
  href: string;
  /** The one thing to do about it, when there is one. */
  action: { label: string; href: string } | null;
  /** Last time anything happened to it. */
  at: string;
};

export type DealEvent = {
  key: string;
  at: string;
  dealKey: string;
  /** Rendered as: <b>{actor}</b> {text} — actor null for impersonal facts. */
  actor: string | null;
  text: string;
  /** Asks for your move (a counter waiting on you). */
  live: boolean;
};

const ACTIVE_ORDER = new Set(["pending", "requires_action", "paid", "shipped", "disputed"]);

function latest(...dates: (string | null | undefined)[]): string {
  return dates.filter((d): d is string => Boolean(d)).sort().at(-1) ?? "";
}

export function orderDeal(order: OrderDealRow, me: string): Deal {
  const side: DealSide = order.buyer_id === me ? "buying" : "selling";
  const buying = side === "buying";
  const href = `/orders/${order.id}`;
  let label: string;
  let tone: DealTone = "quiet";
  let action: Deal["action"] = { label: "View order", href };

  switch (order.status) {
    case "pending":
    case "requires_action":
      label = buying ? "Pay now" : "Awaiting payment";
      tone = buying ? "move" : "quiet";
      if (buying) action = { label: "Pay now", href: `/orders/${order.id}/checkout` };
      break;
    case "payment_failed":
      label = "Payment failed";
      break;
    case "paid":
      if (order.is_collection) {
        if (buying) {
          label = order.pickup_ready_at ? "Ready to collect" : "Paid";
          tone = order.pickup_ready_at ? "move" : "ok";
        } else {
          label = order.pickup_ready_at ? "Ready for pickup" : "Get it ready";
          tone = order.pickup_ready_at ? "quiet" : "move";
          if (!order.pickup_ready_at) action = { label: "Mark ready", href };
        }
      } else if (buying) {
        label = "Paid";
        tone = "ok";
      } else {
        label = "Ship it";
        tone = "move";
        action = { label: "Mark shipped", href };
      }
      break;
    case "shipped":
      label = buying ? "On its way" : "Shipped";
      tone = buying ? "ok" : "quiet";
      if (buying) action = { label: "Track", href };
      break;
    case "delivered":
      label = "Delivered";
      tone = "ok";
      break;
    case "completed":
      label = "Completed";
      tone = "ok";
      break;
    case "cancelled":
      label = "Cancelled";
      break;
    case "refunded":
      label = "Refunded";
      break;
    case "disputed":
      label = "In dispute";
      tone = "move";
      action = { label: "View dispute", href };
      break;
    default:
      label = order.status;
  }

  return {
    key: `order:${order.id}`,
    kind: "order",
    id: order.id,
    side,
    title: order.title,
    image: order.image ?? null,
    amountCents: order.total_cents,
    status: order.status,
    label,
    tone,
    active: ACTIVE_ORDER.has(order.status),
    href,
    action,
    at: latest(
      order.created_at,
      order.shipped_at,
      order.delivered_at,
      order.completed_at,
      order.cancelled_at,
      order.refunded_at,
      order.pickup_ready_at,
    ),
  };
}

/** Open/countered offers past their expiry read as expired even before the
 *  expiry worker catches up. */
export function effectiveOfferStatus(offer: Pick<OfferDealRow, "status" | "expires_at">, now = Date.now()): string {
  if ((offer.status === "open" || offer.status === "countered") && offer.expires_at && new Date(offer.expires_at).getTime() <= now) {
    return "expired";
  }
  return offer.status;
}

export function offerDeal(offer: OfferDealRow, me: string, now = Date.now()): Deal {
  const side: DealSide = offer.buyer_id === me ? "buying" : "selling";
  const buying = side === "buying";
  const status = effectiveOfferStatus(offer, now);
  const href = `/offers/${offer.id}`;
  const counter = offer.counter_amount_cents;
  let label: string;
  let tone: DealTone = "quiet";

  switch (status) {
    case "open":
      label = buying ? `You offered ${formatPrice(offer.amount_cents)}` : `Offer ${formatPrice(offer.amount_cents)}`;
      tone = buying ? "quiet" : "move";
      break;
    case "countered":
      label = buying ? `Countered ${formatPrice(counter ?? offer.amount_cents)}` : `You countered ${formatPrice(counter ?? offer.amount_cents)}`;
      tone = buying ? "move" : "quiet";
      break;
    case "accepted":
      label = "Offer accepted";
      tone = "ok";
      break;
    case "declined":
      label = "Offer declined";
      break;
    case "withdrawn":
      label = "Offer withdrawn";
      break;
    case "expired":
      label = "Offer expired";
      break;
    default:
      label = status;
  }

  return {
    key: `offer:${offer.id}`,
    kind: "offer",
    id: offer.id,
    side,
    title: offer.title,
    image: offer.image ?? null,
    amountCents: counter ?? offer.amount_cents,
    status,
    label,
    tone,
    active: status === "open" || status === "countered",
    href,
    action: { label: "View offer", href },
    at: latest(offer.created_at, offer.countered_at, offer.responded_at, status === "withdrawn" ? offer.updated_at : null),
  };
}

const TONE_RANK: Record<DealTone, number> = { move: 0, ok: 1, quiet: 2 };

/** Your move first, then anything still in progress, then newest. */
export function sortDeals(deals: Deal[]): Deal[] {
  return [...deals].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    if (a.tone !== b.tone) return TONE_RANK[a.tone] - TONE_RANK[b.tone];
    return b.at.localeCompare(a.at);
  });
}

/**
 * The deals worth showing as chips on an inbox row: everything in progress,
 * or — when nothing is — the most recent one, so every row says what the
 * relationship is about. Capped so a row stays one or two lines.
 */
export function inboxDeals(deals: Deal[], max = 2): Deal[] {
  const sorted = sortDeals(deals);
  const active = sorted.filter((d) => d.active);
  return (active.length ? active : sorted).slice(0, max);
}

/** The deal a new message should default to being about. */
export function defaultDealKey(deals: Deal[], lastMessageDealKey: string | null): string | null {
  if (lastMessageDealKey) {
    const last = deals.find((d) => d.key === lastMessageDealKey);
    if (last?.active) return last.key;
  }
  return sortDeals(deals)[0]?.key ?? lastMessageDealKey;
}

/** Short name for a part — the words before the first comma or dash. */
export function shortTitle(title: string): string {
  const head = title.split(/\s[—–-]\s|,/)[0]?.trim() || title;
  return head.length > 42 ? `${head.slice(0, 40).trimEnd()}…` : head;
}

/**
 * Lifecycle facts from the order and offer rows, for the timeline. Derived
 * rather than stored so every existing deal has a history. Notes the server
 * writes into the thread (disputes, pickup, returns) arrive separately as
 * `kind = 'event'` messages; nothing here duplicates them.
 */
export function dealEvents(
  orders: OrderDealRow[],
  offers: OfferDealRow[],
  me: string,
  otherName: string,
  now = Date.now(),
): DealEvent[] {
  const events: DealEvent[] = [];
  const who = (id: string | null) => (id === me ? "You" : otherName);

  for (const o of orders) {
    const dealKey = `order:${o.id}`;
    const part = shortTitle(o.title);
    const buyer = who(o.buyer_id);
    events.push({
      key: `${dealKey}:placed`,
      at: o.created_at,
      dealKey,
      actor: buyer,
      text: `${buyer === "You" ? "bought" : "bought your"} ${part} · ${formatPrice(o.total_cents)}`,
      live: false,
    });
    if (o.shipped_at) {
      const seller = who(o.seller_id);
      events.push({ key: `${dealKey}:shipped`, at: o.shipped_at, dealKey, actor: seller, text: `shipped the ${part}`, live: false });
    }
    if (o.delivered_at) {
      events.push({ key: `${dealKey}:delivered`, at: o.delivered_at, dealKey, actor: null, text: `${part} delivered`, live: false });
    }
    if (o.cancelled_at) {
      events.push({ key: `${dealKey}:cancelled`, at: o.cancelled_at, dealKey, actor: null, text: `Order for the ${part} cancelled`, live: false });
    }
    if (o.refunded_at) {
      events.push({ key: `${dealKey}:refunded`, at: o.refunded_at, dealKey, actor: null, text: `${part} refunded`, live: false });
    }
  }

  for (const f of offers) {
    const dealKey = `offer:${f.id}`;
    const part = shortTitle(f.title);
    const buyer = who(f.buyer_id);
    const seller = who(f.seller_id);
    const status = effectiveOfferStatus(f, now);
    events.push({
      key: `${dealKey}:made`,
      at: f.created_at,
      dealKey,
      actor: buyer,
      text: `offered ${formatPrice(f.amount_cents)} on the ${part}`,
      live: false,
    });
    if (f.countered_at && f.counter_amount_cents != null) {
      events.push({
        key: `${dealKey}:countered`,
        at: f.countered_at,
        dealKey,
        actor: seller,
        text: `countered ${formatPrice(f.counter_amount_cents)}`,
        live: status === "countered" && f.buyer_id === me,
      });
    }
    if (status === "accepted" && f.responded_at) {
      // A countered offer is closed by the buyer taking the counter.
      const acceptedCounter = Boolean(f.countered_at && f.counter_amount_cents != null);
      events.push({
        key: `${dealKey}:accepted`,
        at: f.responded_at,
        dealKey,
        actor: acceptedCounter ? buyer : seller,
        text: acceptedCounter
          ? `accepted the ${formatPrice(f.counter_amount_cents!)} counter`
          : `accepted ${formatPrice(f.amount_cents)}`,
        live: false,
      });
    }
    if (status === "declined" && f.responded_at) {
      events.push({ key: `${dealKey}:declined`, at: f.responded_at, dealKey, actor: null, text: `Offer on the ${part} declined`, live: false });
    }
    if (status === "withdrawn") {
      events.push({ key: `${dealKey}:withdrawn`, at: f.updated_at, dealKey, actor: buyer, text: "withdrew the offer", live: false });
    }
    if (status === "expired") {
      const at = f.responded_at ?? f.expires_at ?? f.updated_at;
      events.push({ key: `${dealKey}:expired`, at, dealKey, actor: null, text: `Offer on the ${part} expired`, live: false });
    }
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
