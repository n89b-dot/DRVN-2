import Link from "next/link";

import { NarrowColumn, SectionLabel } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { respondToOffer, sendOfferMessage } from "@/features/commerce/actions";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Orders - DRVN" };

function statusPill(status: string) {
  const tone =
    status === "paid" || status === "completed" || status === "accepted"
      ? "bg-success/15 text-success"
      : status === "pending" || status === "open"
        ? "bg-accent/15 text-accent"
        : "bg-raised text-text-muted";
  return (
    <span className={`rounded-pill px-2.5 py-0.5 text-[11px] font-semibold uppercase ${tone}`}>
      {status}
    </span>
  );
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ placed?: string }>;
}) {
  const { placed } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: orders }, { data: myListings }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .or(`buyer_id.eq.${user!.id},seller_id.eq.${user!.id}`)
      .order("created_at", { ascending: false }),
    supabase.from("listings").select("id, title").eq("seller_id", user!.id),
  ]);

  const orderIds = (orders ?? []).map((o) => o.id);
  const myListingIds = (myListings ?? []).map((l) => l.id);

  const [{ data: items }, { data: incomingOffers }, { data: myOffers }, { data: myReviews }] =
    await Promise.all([
      orderIds.length
        ? supabase.from("order_items").select("*").in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
      myListingIds.length
        ? supabase
            .from("offers")
            .select("*")
            .in("listing_id", myListingIds)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] }),
      supabase
        .from("offers")
        .select("*")
        .eq("buyer_id", user!.id)
        .order("created_at", { ascending: false }),
      orderIds.length
        ? supabase.from("reviews").select("order_id, reviewer_id").in("order_id", orderIds)
        : Promise.resolve({ data: [] }),
    ]);

  // Names for counterparties + listing titles for offers/items.
  const counterpartyIds = [
    ...new Set([
      ...(orders ?? []).flatMap((o) => [o.buyer_id, o.seller_id]),
      ...(incomingOffers ?? []).map((o) => o.buyer_id),
    ]),
  ].filter((x) => x !== user!.id);
  const itemListingIds = [
    ...new Set([
      ...(items ?? []).map((i) => i.listing_id),
      ...(myOffers ?? []).map((o) => o.listing_id),
    ]),
  ];
  const allOfferIds = [...(incomingOffers ?? []), ...(myOffers ?? [])].map((o) => o.id);

  const [{ data: people }, { data: offerListings }, { data: offerMessages }] = await Promise.all([
    counterpartyIds.length
      ? supabase.from("profiles").select("id, display_name, username").in("id", counterpartyIds)
      : Promise.resolve({ data: [] }),
    itemListingIds.length
      ? supabase.from("listings").select("id, title").in("id", itemListingIds)
      : Promise.resolve({ data: [] }),
    allOfferIds.length
      ? supabase
          .from("messages")
          .select("*")
          .in("offer_id", allOfferIds)
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const name = (pid: string) => {
    if (pid === user!.id) return "You";
    const p = (people ?? []).find((x) => x.id === pid);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "User");
  };
  const listingTitle = (lid: string) =>
    (offerListings ?? []).find((l) => l.id === lid)?.title ??
    (myListings ?? []).find((l) => l.id === lid)?.title ??
    "Listing";
  const messagesFor = (offerId: string) =>
    (offerMessages ?? []).filter((m) => m.offer_id === offerId);
  const reviewedByMe = new Set(
    (myReviews ?? []).filter((r) => r.reviewer_id === user!.id).map((r) => r.order_id)
  );

  const purchases = (orders ?? []).filter((o) => o.buyer_id === user!.id);
  const sales = (orders ?? []).filter((o) => o.seller_id === user!.id);

  const OrderCard = ({ order, role }: { order: NonNullable<typeof orders>[number]; role: "buyer" | "seller" }) => (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {statusPill(order.status)}
          <span className="text-xs text-text-muted">
            {new Date(order.created_at).toLocaleDateString()}
          </span>
        </div>
        <span className="text-sm font-bold text-text-primary">{formatPrice(order.total_cents)}</span>
      </div>
      <ul className="mt-3 flex flex-col gap-1">
        {(items ?? [])
          .filter((i) => i.order_id === order.id)
          .map((i) => (
            <li key={i.id} className="flex justify-between gap-3 text-sm">
              <Link
                href={`/listings/${i.listing_id}`}
                className="min-w-0 truncate text-text-secondary transition hover:text-accent"
              >
                {listingTitle(i.listing_id)}
              </Link>
              <span className="shrink-0 text-text-muted">{formatPrice(i.price_cents)}</span>
            </li>
          ))}
      </ul>
      <p className="mt-2 text-xs text-text-muted">
        {role === "buyer"
          ? `Seller: ${name(order.seller_id)}`
          : `Buyer: ${name(order.buyer_id)} · fee ${formatPrice(order.platform_fee_cents)} · you receive ${formatPrice(order.total_cents - order.platform_fee_cents)}`}
      </p>
      {["paid", "shipped", "completed"].includes(order.status) && !reviewedByMe.has(order.id) && (
        <div className="mt-3 border-t border-border pt-3">
          <ReviewForm
            orderId={order.id}
            revieweeName={role === "buyer" ? name(order.seller_id) : name(order.buyer_id)}
          />
        </div>
      )}
    </div>
  );

  const OfferCard = ({
    offer,
    incoming,
  }: {
    offer: NonNullable<typeof myOffers>[number];
    incoming: boolean;
  }) => (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {statusPill(offer.status)}
          <Link
            href={`/listings/${offer.listing_id}`}
            className="min-w-0 truncate text-sm font-semibold text-text-primary transition hover:text-accent"
          >
            {listingTitle(offer.listing_id)}
          </Link>
        </div>
        <span className="shrink-0 text-sm font-bold text-text-primary">
          {formatPrice(offer.amount_cents)}
        </span>
      </div>
      {incoming && <p className="mt-1 text-xs text-text-muted">From {name(offer.buyer_id)}</p>}

      {messagesFor(offer.id).length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
          {messagesFor(offer.id).map((m) => (
            <p key={m.id} className="text-sm">
              <span className={m.sender_id === user!.id ? "text-accent" : "text-text-muted"}>
                {name(m.sender_id)}:
              </span>{" "}
              <span className="text-text-secondary">{m.body}</span>
            </p>
          ))}
        </div>
      )}

      {offer.status === "open" && (
        <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
          <form action={sendOfferMessage} className="flex gap-2">
            <input type="hidden" name="offer_id" value={offer.id} />
            <input
              name="body"
              required
              placeholder="Message…"
              className="h-9 flex-1 rounded-input border border-border bg-app px-3 text-sm text-text-primary outline-none placeholder:text-text-muted"
            />
            <button type="submit" className="rounded-pill border border-border px-4 text-sm text-text-secondary">
              Send
            </button>
          </form>
          {incoming && (
            <div className="flex gap-2">
              <form action={respondToOffer}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="decision" value="accepted" />
                <button type="submit" className="rounded-pill bg-success/90 px-4 py-1.5 text-sm font-semibold text-white">
                  Accept — sell for {formatPrice(offer.amount_cents)}
                </button>
              </form>
              <form action={respondToOffer}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="decision" value="declined" />
                <button type="submit" className="rounded-pill border border-border px-4 py-1.5 text-sm text-text-secondary">
                  Decline
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <NarrowColumn>
      <SectionLabel>Orders</SectionLabel>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Orders & offers</h1>
      {placed && (
        <p className="mt-4 rounded-card border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          Order placed. Payment was processed by the stub provider — no real charge.
        </p>
      )}

      {(incomingOffers ?? []).length > 0 && (
        <div className="mt-8">
          <SectionLabel>Offers on your listings</SectionLabel>
          <div className="mt-3 flex flex-col gap-3">
            {(incomingOffers ?? []).map((o) => (
              <OfferCard key={o.id} offer={o} incoming />
            ))}
          </div>
        </div>
      )}

      {(myOffers ?? []).length > 0 && (
        <div className="mt-8">
          <SectionLabel>Your offers</SectionLabel>
          <div className="mt-3 flex flex-col gap-3">
            {(myOffers ?? []).map((o) => (
              <OfferCard key={o.id} offer={o} incoming={false} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-8">
        <SectionLabel>Purchases</SectionLabel>
        <div className="mt-3 flex flex-col gap-3">
          {purchases.map((o) => (
            <OrderCard key={o.id} order={o} role="buyer" />
          ))}
          {purchases.length === 0 && <p className="text-sm text-text-muted">No purchases yet.</p>}
        </div>
      </div>

      <div className="mt-8">
        <SectionLabel>Sales</SectionLabel>
        <div className="mt-3 flex flex-col gap-3">
          {sales.map((o) => (
            <OrderCard key={o.id} order={o} role="seller" />
          ))}
          {sales.length === 0 && <p className="text-sm text-text-muted">No sales yet.</p>}
        </div>
      </div>
    </NarrowColumn>
  );
}
