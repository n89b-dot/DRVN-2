import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, MarketplaceNav, Media } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";
import { markThreadMessagesRead } from "@/features/commerce/actions";

import { StatusChip } from "../../orders/order-pipeline";
import { CheckoutLink, OfferThread, type ThreadMessage } from "./offer-thread";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Offer ${id.slice(0, 8)} - DRVN` };
}

type HistoryEntry = { label: string; at: string; amount?: number };

/**
 * One offer's full thread: listing context, the complete action history
 * (made → countered → accepted/declined/withdrawn/expired), the message
 * thread, and whichever actions the viewer's role and the offer's status
 * allow. Replaces the inline conversation that used to render on /orders.
 */
export default async function OfferThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/offers/${id}`)}`);

  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (offerError) reportError("[offers] failed to load offer", { id, offerError });
  if (!offer) notFound();

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, price_cents, seller_id, status")
    .eq("id", offer.listing_id)
    .maybeSingle();
  if (!listing) notFound();

  // Only the buyer who made the offer, or the seller of the listing it was
  // made on, may see this thread.
  const incoming = listing.seller_id === user.id;
  const isBuyer = offer.buyer_id === user.id;
  if (!incoming && !isBuyer) notFound();

  const counterpartyId = incoming ? offer.buyer_id : listing.seller_id;

  const [{ data: image }, { data: counterparty }, { data: rawMessages }] = await Promise.all([
    supabase
      .from("listing_images")
      .select("url")
      .eq("listing_id", listing.id)
      .order("position")
      .limit(1)
      .maybeSingle(),
    counterpartyId
      ? supabase.from("profiles").select("id, display_name, username").eq("id", counterpartyId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("messages")
      .select("id, sender_id, body, created_at")
      .eq("offer_id", id)
      .order("created_at", { ascending: true }),
  ]);

  // This viewer's read receipt for the thread — scoped to messages
  // addressed to them, safe to call unconditionally on every render.
  await markThreadMessagesRead(supabase, user.id, { offerId: id });

  // The order an acceptance produced, by the canonical relation (migration
  // 0034). This used to be a guess — every order_item for the listing, then
  // the buyer's most recent matching order — which only held while a listing
  // sold exactly once. `origin_offer_id` is written inside offer_accept_begin
  // in the same transaction that creates the order, and is unique, so an
  // offer can never resolve to somebody else's transaction.
  //
  // Null on offers accepted before 0034 was applied: those rows were left
  // unlinked rather than backfilled from a heuristic, so the thread simply
  // doesn't offer a checkout link for them.
  let acceptedOrderId: string | null = null;
  let acceptedOrderStatus: string | null = null;
  if (offer.status === "accepted") {
    const { data: order } = await supabase
      .from("orders")
      .select("id, status")
      .eq("origin_offer_id", offer.id)
      .maybeSingle();
    acceptedOrderId = order?.id ?? null;
    acceptedOrderStatus = order?.status ?? null;
  }

  const offersCount = await loadOffersNeedingAttention(supabase, user.id);

  const counterpartyName =
    counterparty?.display_name ?? (counterparty?.username ? `@${counterparty.username}` : "DRVN member");

  const messages: ThreadMessage[] = (rawMessages ?? []).map((m) => ({
    id: m.id,
    sender_id: m.sender_id,
    sender_name: m.sender_id === user.id ? "You" : counterpartyName,
    body: m.body,
    created_at: m.created_at,
  }));

  // Derived history, oldest first — every column already on the offer row
  // is a timestamped state change, just never assembled into a timeline.
  const history: HistoryEntry[] = [
    { label: incoming ? `${counterpartyName} made an offer` : "You made an offer", at: offer.created_at, amount: offer.amount_cents },
  ];
  if (offer.countered_at && offer.counter_amount_cents) {
    history.push({
      label: incoming ? "You countered" : `${counterpartyName} countered`,
      at: offer.countered_at,
      amount: offer.counter_amount_cents,
    });
  }
  if (offer.status === "accepted" && offer.responded_at) {
    history.push({ label: incoming ? "You accepted" : `${counterpartyName} accepted`, at: offer.responded_at });
  }
  if (offer.status === "declined" && offer.responded_at) {
    history.push({ label: incoming ? "You declined" : `${counterpartyName} declined`, at: offer.responded_at });
  }
  if (offer.status === "expired" && offer.responded_at) {
    history.push({ label: "Offer expired unanswered", at: offer.responded_at });
  }
  if (offer.status === "withdrawn") {
    history.push({ label: isBuyer ? "You withdrew the offer" : `${counterpartyName} withdrew the offer`, at: offer.updated_at });
  }

  const live = offer.status === "open" || offer.status === "countered";
  const expiresLabel = offer.expires_at
    ? `${live ? "Expires" : "Expired"} ${new Date(offer.expires_at).toLocaleString(undefined, {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })}`
    : null;

  return (
    <div className="wrap">
      {/* A thread is still inside the Offers surface — the family nav keeps
          saying so, and the breadcrumb underneath names the way back. */}
      <MarketplaceNav current="offers" offersCount={offersCount} />

      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          <Link href="/offers" className="jumplink">
            Offers
          </Link>{" "}
          / {listing.title}
        </span>
        <h1>
          {incoming ? "Offer on your listing" : "Your offer"} <span className="live-word">{formatPrice(offer.amount_cents)}</span>
        </h1>
      </Rv>

      <Rv className="tile mb-4">
        <Link href={`/listings/${listing.id}`} className="flex items-center gap-3">
          <span className="tile__img block h-16 w-16 shrink-0 overflow-hidden rounded-[2px]">
            <Media
              src={image?.url ?? undefined}
              alt={listing.title}
              className="h-full w-full"
              fallbackClassName="plate-undrawn"
              role="row"
            />
          </span>
          <span className="min-w-0">
            <span className="order__name block truncate">{listing.title}</span>
            <span className="order__meta">{formatPrice(listing.price_cents)} asking</span>
          </span>
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[color:var(--rule-soft)] pt-3">
          <StatusChip status={offer.status} />
          <span className="order__meta">
            {incoming ? `From ${counterpartyName}` : `To ${counterpartyName}`}
            {expiresLabel && <> · {expiresLabel}</>}
          </span>
        </div>

        {/* Accepted offers name the order they became — by the canonical
            relation (0034), not by guessing at the buyer's recent orders. */}
        {acceptedOrderId && (
          <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-[color:var(--rule-soft)] pt-3">
            {acceptedOrderStatus === "pending" && isBuyer ? (
              <CheckoutLink orderId={acceptedOrderId} />
            ) : null}
            <Link href={`/orders/${acceptedOrderId}`} className="jumplink">
              Order {acceptedOrderId.slice(0, 8).toUpperCase()} →
            </Link>
          </div>
        )}
        {offer.status === "accepted" && !acceptedOrderId && (
          <p className="spec-note mt-3 border-t border-[color:var(--rule-soft)] pt-3">
            This offer was accepted before orders recorded which offer they came
            from — find it in{" "}
            <Link href="/orders" className="jumplink">
              Orders
            </Link>
            .
          </p>
        )}
      </Rv>

      <Rv className="tile mb-4" stagger={1}>
        <div className="tile__head">
          <span className="microlabel microlabel--ink">History</span>
        </div>
        <ol className="rowlist">
          {history.map((entry, i) => (
            <li key={i} className="jobrow flex items-center justify-between gap-3 !py-2">
              <span className="order__name !text-body">{entry.label}</span>
              <span className="kv shrink-0 text-dim">
                {entry.amount != null && `${formatPrice(entry.amount)} · `}
                {new Date(entry.at).toLocaleString(undefined, {
                  day: "numeric",
                  month: "short",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </li>
          ))}
        </ol>
      </Rv>

      <Rv className="tile" stagger={2}>
        <div className="tile__head">
          <span className="microlabel microlabel--ink">Conversation</span>
        </div>
        <OfferThread
          offerId={offer.id}
          amountCents={offer.amount_cents}
          counterAmountCents={offer.counter_amount_cents}
          status={offer.status}
          incoming={incoming}
          currentUserId={user.id}
          messages={messages}
        />
      </Rv>

      <Foot
        left="DRVN — offers expire 72 hours after they're made"
        right={<Link href="/offers">All offers →</Link>}
      />
    </div>
  );
}
