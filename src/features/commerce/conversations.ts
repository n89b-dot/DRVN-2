import "server-only";

import type { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

import { messageDealKey, type TimelineMessage } from "./conversation-timeline";
import { dealEvents, enquiryDeal, offerDeal, orderDeal, sortDeals, type Deal, type DealEvent, type EnquiryDealRow, type OfferDealRow, type OrderDealRow } from "./deals";

/**
 * Reads behind /messages. A conversation is one pair of people
 * (20260928140000); the orders and offers between them are its deals, and
 * each message says which deal it is about.
 */

type Supabase = Awaited<ReturnType<typeof createClient>>;

export const INBOX_PAGE_SIZE = 20;
const THREAD_WINDOW = 100;
const PHOTO_URL_SECONDS = 60 * 60;

export type InboxFilter = "all" | "unread" | "buying" | "selling";
export const INBOX_FILTERS: InboxFilter[] = ["all", "unread", "buying", "selling"];

export type Person = {
  id: string;
  name: string;
  firstName: string;
  username: string | null;
  avatar: string | null;
};

export type InboxRow = {
  id: string;
  person: Person;
  lastAt: string | null;
  preview: string;
  unread: number;
  deals: Deal[];
};

export type OpenQuestion = { id: string; listingId: string; listingTitle: string; body: string; createdAt: string };

type ProfileRow = { id: string; display_name: string | null; username: string | null; avatar_url: string | null };

export function toPerson(profile: ProfileRow | null | undefined, id: string, fallback?: string | null): Person {
  const name = profile?.display_name || (profile?.username ? `@${profile.username}` : null) || fallback || "DRVN member";
  const firstName = profile?.display_name?.split(/\s+/)[0] || (profile?.username ? `@${profile.username}` : name);
  return { id, name, firstName, username: profile?.username ?? null, avatar: profile?.avatar_url ?? null };
}

async function loadPeople(supabase: Supabase, ids: string[]): Promise<Map<string, ProfileRow>> {
  if (!ids.length) return new Map();
  const { data } = await supabase.from("profiles").select("id, display_name, username, avatar_url").in("id", ids);
  return new Map((data ?? []).map((p) => [p.id, p]));
}

const ORDER_COLUMNS =
  "id, status, buyer_id, seller_id, total_cents, is_collection, pickup_ready_at, created_at, shipped_at, delivered_at, completed_at, cancelled_at, refunded_at, updated_at, order_items(id, title, listing_id)";
const OFFER_COLUMNS =
  "id, status, buyer_id, listing_id, amount_cents, counter_amount_cents, created_at, countered_at, responded_at, updated_at, expires_at, round_count, listings!inner(id, title, seller_id)";
const ENQUIRY_COLUMNS = "listing_id, sender_id, recipient_id, created_at, listings!inner(id, title, seller_id, status, price_cents)";

type DealRows = { orders: OrderDealRow[]; offers: OfferDealRow[]; enquiries: EnquiryDealRow[] };

/** A message about a listing with no offer or order (R-directcontact). */
export type EnquiryMessageRow = {
  listing_id: string | null;
  sender_id: string;
  recipient_id: string;
  created_at: string;
  listings:
    | { id: string; title: string; seller_id: string; status: string; price_cents: number }
    | { id: string; title: string; seller_id: string; status: string; price_cents: number }[]
    | null;
};

/**
 * The listings each of `others` and `me` have messaged about with no offer or
 * order yet, newest first, one per listing — the listing has to be one of
 * theirs. `rows` must be newest first.
 */
export function enquiriesByPerson(rows: EnquiryMessageRow[], me: string, others: string[]): Map<string, EnquiryDealRow[]> {
  const byPerson = new Map<string, EnquiryDealRow[]>(others.map((id) => [id, []]));
  const seen = new Set<string>();
  for (const m of rows) {
    const listing = Array.isArray(m.listings) ? m.listings[0] : m.listings;
    if (!m.listing_id || !listing) continue;
    const other = m.sender_id === me ? m.recipient_id : m.recipient_id === me ? m.sender_id : null;
    const bucket = other ? byPerson.get(other) : undefined;
    if (!other || !bucket) continue;
    if (listing.seller_id !== me && listing.seller_id !== other) continue;
    const key = `${other}:${m.listing_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bucket.push({
      listing_id: m.listing_id,
      seller_id: listing.seller_id,
      title: listing.title,
      status: listing.status,
      price_cents: listing.price_cents,
      at: m.created_at,
    });
  }
  return byPerson;
}

/**
 * Every order, offer and listing enquiry between `me` and each of `others`,
 * keyed by the other person. RLS already limits all three to deals the
 * reader is party to.
 */
export async function loadDealRows(
  supabase: Supabase,
  me: string,
  others: string[],
  { images = false }: { images?: boolean } = {},
): Promise<Map<string, DealRows>> {
  const byPerson = new Map<string, DealRows>(others.map((id) => [id, { orders: [], offers: [], enquiries: [] }]));
  if (!others.length) return byPerson;
  const list = others.join(",");

  const [ordersRes, offersBuyingRes, offersSellingRes, enquiriesRes] = await Promise.all([
    supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .or(`and(buyer_id.eq.${me},seller_id.in.(${list})),and(seller_id.eq.${me},buyer_id.in.(${list}))`)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("offers")
      .select(OFFER_COLUMNS)
      .eq("buyer_id", me)
      .in("listings.seller_id", others)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("offers")
      .select(OFFER_COLUMNS)
      .in("buyer_id", others)
      .eq("listings.seller_id", me)
      .order("created_at", { ascending: false })
      .limit(200),
    // R-directcontact: a listing asked about with no offer or order yet is a
    // deal too — in the inbox and its Buying/Selling filters, not only once
    // the thread is open.
    supabase
      .from("messages")
      .select(ENQUIRY_COLUMNS)
      .is("order_id", null)
      .is("offer_id", null)
      .not("listing_id", "is", null)
      .or(`and(sender_id.eq.${me},recipient_id.in.(${list})),and(recipient_id.eq.${me},sender_id.in.(${list}))`)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  for (const res of [ordersRes, offersBuyingRes, offersSellingRes, enquiriesRes]) {
    if (res.error) reportError("[messages] deal lookup failed", res.error);
  }

  const orders = ordersRes.data ?? [];
  const offers = [...(offersBuyingRes.data ?? []), ...(offersSellingRes.data ?? [])];
  const enquiries = enquiriesByPerson((enquiriesRes.data ?? []) as EnquiryMessageRow[], me, others);

  let orderImages = new Map<string, string>();
  let listingImages = new Map<string, string>();
  if (images) {
    const itemIds = orders.map((o) => o.order_items?.[0]?.id).filter((x): x is string => Boolean(x));
    const listingIds = [...new Set([...offers.map((f) => f.listing_id), ...[...enquiries.values()].flat().map((e) => e.listing_id)])];
    const [snapRes, listingRes] = await Promise.all([
      itemIds.length
        ? supabase.from("order_item_snapshot_images").select("order_item_id, url, position").in("order_item_id", itemIds).order("position")
        : Promise.resolve({ data: [] as { order_item_id: string; url: string; position: number }[] }),
      listingIds.length
        ? supabase.from("listing_images").select("listing_id, url, position").in("listing_id", listingIds).order("position")
        : Promise.resolve({ data: [] as { listing_id: string; url: string; position: number }[] }),
    ]);
    orderImages = new Map();
    for (const row of snapRes.data ?? []) if (!orderImages.has(row.order_item_id)) orderImages.set(row.order_item_id, row.url);
    listingImages = new Map();
    for (const row of listingRes.data ?? []) if (!listingImages.has(row.listing_id)) listingImages.set(row.listing_id, row.url);
  }

  for (const o of orders) {
    const other = o.buyer_id === me ? o.seller_id : o.buyer_id;
    const bucket = other ? byPerson.get(other) : undefined;
    if (!bucket) continue;
    const item = o.order_items?.[0];
    bucket.orders.push({
      id: o.id,
      status: o.status,
      buyer_id: o.buyer_id,
      seller_id: o.seller_id,
      total_cents: o.total_cents,
      is_collection: o.is_collection,
      pickup_ready_at: o.pickup_ready_at,
      created_at: o.created_at,
      shipped_at: o.shipped_at,
      delivered_at: o.delivered_at,
      completed_at: o.completed_at,
      cancelled_at: o.cancelled_at,
      refunded_at: o.refunded_at,
      updated_at: o.updated_at,
      title: item?.title ?? "Order",
      image: item ? orderImages.get(item.id) ?? null : null,
    });
  }

  for (const f of offers) {
    const listing = Array.isArray(f.listings) ? f.listings[0] : f.listings;
    if (!listing) continue;
    const other = f.buyer_id === me ? listing.seller_id : f.buyer_id;
    const bucket = byPerson.get(other);
    if (!bucket) continue;
    bucket.offers.push({
      id: f.id,
      status: f.status,
      buyer_id: f.buyer_id,
      seller_id: listing.seller_id,
      listing_id: f.listing_id,
      amount_cents: f.amount_cents,
      counter_amount_cents: f.counter_amount_cents,
      created_at: f.created_at,
      countered_at: f.countered_at,
      responded_at: f.responded_at,
      updated_at: f.updated_at,
      expires_at: f.expires_at,
      round_count: f.round_count,
      title: listing.title,
      image: listingImages.get(f.listing_id) ?? null,
    });
  }

  for (const [other, rows] of enquiries) {
    const bucket = byPerson.get(other);
    if (!bucket) continue;
    bucket.enquiries = rows.map((e) => ({ ...e, image: listingImages.get(e.listing_id) ?? null }));
  }

  return byPerson;
}

export function dealsFrom(rows: DealRows | undefined, me: string): Deal[] {
  if (!rows) return [];
  return sortDeals([
    ...rows.orders.map((o) => orderDeal(o, me)),
    ...rows.offers.map((f) => offerDeal(f, me)),
    ...(rows.enquiries ?? []).map((e) => enquiryDeal(e, me)),
  ]);
}

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export async function loadInbox(
  supabase: Supabase,
  me: string,
  { filter, query, page }: { filter: InboxFilter; query: string; page: number },
): Promise<{ rows: InboxRow[]; total: number; page: number; hasMore: boolean; failed: boolean }> {
  const offset = (page - 1) * INBOX_PAGE_SIZE;
  const { data, error } = await supabase.rpc("list_conversations", {
    p_filter: filter,
    p_query: query || undefined,
    p_limit: INBOX_PAGE_SIZE,
    p_offset: offset,
  });
  if (error) {
    reportError("[messages] list_conversations failed", error);
    return { rows: [], total: 0, page, hasMore: false, failed: true };
  }
  const list = data ?? [];
  const total = Number(list[0]?.total_count ?? 0);
  const others = [...new Set(list.map((c) => c.counterparty_id))];
  const lastIds = list.map((c) => c.last_message_id).filter(Boolean);

  const [people, lastRes, dealRows] = await Promise.all([
    loadPeople(supabase, others),
    lastIds.length
      ? supabase.from("messages").select("id, sender_id, kind").in("id", lastIds)
      : Promise.resolve({ data: [] as { id: string; sender_id: string; kind: string }[] }),
    loadDealRows(supabase, me, others),
  ]);
  const lastById = new Map((lastRes.data ?? []).map((m) => [m.id, m]));

  const rows: InboxRow[] = list.map((c) => {
    const last = lastById.get(c.last_message_id);
    const preview = c.last_message_preview ?? "";
    return {
      id: c.id,
      person: toPerson(people.get(c.counterparty_id), c.counterparty_id),
      lastAt: c.last_message_at,
      preview: last?.sender_id === me && last.kind === "message" ? `You: ${preview}` : preview,
      unread: c.unread_count,
      deals: dealsFrom(dealRows.get(c.counterparty_id), me),
    };
  });

  return { rows, total, page, hasMore: offset + list.length < total, failed: false };
}

export async function loadOpenQuestions(supabase: Supabase): Promise<OpenQuestion[]> {
  const { data, error } = await supabase.rpc("seller_open_question_list", { p_limit: 5 });
  if (error) {
    reportError("[messages] seller_open_question_list failed", error);
    return [];
  }
  return (data ?? []).map((q) => ({ id: q.id, listingId: q.listing_id, listingTitle: q.listing_title, body: q.body, createdAt: q.created_at }));
}

// ---------------------------------------------------------------------------
// Thread
// ---------------------------------------------------------------------------

export type ThreadTarget = {
  /** Null until the first message between the two exists. */
  conversationId: string | null;
  otherId: string;
  /** When the route id was an order/offer: the deal to default the composer to. */
  dealKey: string | null;
};

/**
 * `/messages/[id]` accepts a conversation id — or, for old links and "Message
 * the seller" buttons, the order or offer id the conversation is about.
 */
export async function resolveThreadTarget(supabase: Supabase, me: string, id: string): Promise<ThreadTarget | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, participant_a, participant_b")
    .eq("id", id)
    .maybeSingle();
  if (conversation) {
    const otherId = conversation.participant_a === me ? conversation.participant_b : conversation.participant_a;
    return { conversationId: conversation.id, otherId, dealKey: null };
  }

  let otherId: string | null = null;
  let dealKey: string | null = null;
  const { data: order } = await supabase.from("orders").select("id, buyer_id, seller_id").eq("id", id).maybeSingle();
  if (order && (order.buyer_id === me || order.seller_id === me)) {
    otherId = order.buyer_id === me ? order.seller_id : order.buyer_id;
    dealKey = `order:${order.id}`;
  } else {
    const { data: offer } = await supabase
      .from("offers")
      .select("id, buyer_id, listings!inner(seller_id)")
      .eq("id", id)
      .maybeSingle();
    const listing = offer ? (Array.isArray(offer.listings) ? offer.listings[0] : offer.listings) : null;
    if (offer && listing && (offer.buyer_id === me || listing.seller_id === me)) {
      otherId = offer.buyer_id === me ? listing.seller_id : offer.buyer_id;
      dealKey = `offer:${offer.id}`;
    }
  }
  if (!otherId || otherId === me) return null;

  const [a, b] = [me, otherId].sort();
  const { data: pair } = await supabase
    .from("conversations")
    .select("id")
    .eq("participant_a", a)
    .eq("participant_b", b)
    .maybeSingle();
  return { conversationId: pair?.id ?? null, otherId, dealKey };
}

export type ThreadData = {
  person: Person;
  deals: Deal[];
  events: DealEvent[];
  messages: TimelineMessage[];
  hasEarlier: boolean;
  earliest: string | null;
  lastMessageDealKey: string | null;
  /** Raw offer rows, for the in-thread decision cards. */
  offers: OfferDealRow[];
};

export async function loadThread(
  supabase: Supabase,
  me: string,
  target: ThreadTarget,
  before?: string,
): Promise<ThreadData> {
  let messagesQuery = target.conversationId
    ? supabase
        .from("messages")
        .select("id, sender_id, body, created_at, kind, attachments, order_id, offer_id, listing_id, read_at")
        .eq("conversation_id", target.conversationId)
        .order("created_at", { ascending: false })
        .limit(THREAD_WINDOW)
    : null;
  if (messagesQuery && before) messagesQuery = messagesQuery.lt("created_at", before);

  const [people, dealRowsMap, messagesRes] = await Promise.all([
    loadPeople(supabase, [target.otherId]),
    loadDealRows(supabase, me, [target.otherId], { images: true }),
    messagesQuery ?? Promise.resolve({ data: [] as never[], error: null }),
  ]);
  if (messagesRes.error) reportError("[messages] thread load failed", messagesRes.error);

  const rowsDesc = (messagesRes.data ?? []) as {
    id: string;
    sender_id: string;
    body: string;
    created_at: string;
    kind: string;
    attachments: string[];
    order_id: string | null;
    offer_id: string | null;
    listing_id: string | null;
    read_at: string | null;
  }[];

  // Private photos → short-lived signed URLs, one call for the window.
  const paths = [...new Set(rowsDesc.flatMap((m) => m.attachments ?? []))];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data, error } = await supabase.storage.from("message-photos").createSignedUrls(paths, PHOTO_URL_SECONDS);
    if (error) reportError("[messages] photo signing failed", error);
    for (const entry of data ?? []) if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
  }

  const messages: TimelineMessage[] = [...rowsDesc].reverse().map((m) => ({
    id: m.id,
    sender_id: m.sender_id,
    body: m.body,
    created_at: m.created_at,
    kind: m.kind === "event" ? "event" : "message",
    dealKey: messageDealKey(m),
    photos: (m.attachments ?? []).map((p) => signed.get(p)).filter((u): u is string => Boolean(u)),
    read_at: m.read_at,
  }));

  const person = toPerson(people.get(target.otherId), target.otherId);
  const rows = dealRowsMap.get(target.otherId);
  // Listing enquiries come with the deal rows (loadDealRows), across the
  // whole history, so the seller can answer in the same conversation.
  const deals = dealsFrom(rows, me);
  const events = dealEvents(rows?.orders ?? [], rows?.offers ?? [], me, person.firstName);
  // Only events inside the loaded window (or all, when the whole history is here).
  const hasEarlier = rowsDesc.length === THREAD_WINDOW;
  const earliest = messages[0]?.created_at ?? null;
  const windowStart = hasEarlier ? earliest : null;
  const latestEnd = before ?? null;
  const visibleEvents = events.filter(
    (e) => (!windowStart || e.at >= windowStart) && (!latestEnd || e.at < latestEnd),
  );

  return {
    person,
    deals,
    events: visibleEvents,
    messages,
    hasEarlier,
    earliest,
    lastMessageDealKey: [...messages].reverse().find((m) => m.kind === "message")?.dealKey ?? null,
    offers: rows?.offers ?? [],
  };
}

/** Opening a conversation is the read receipt for everything in it. */
export async function markConversationRead(supabase: Supabase, me: string, conversationId: string): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .update({ read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("recipient_id", me)
    .is("read_at", null);
  if (error) reportError("[messages] mark read failed", { conversationId, error });
}
