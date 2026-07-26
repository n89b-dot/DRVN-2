import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { respondToOffer, sendOfferMessage } from "@/features/commerce/actions";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Orders - DRVN" };

function StatusChip({ status }: { status: string }) {
  const cls =
    status === "paid" || status === "completed" || status === "accepted"
      ? "chip chip--ok"
      : status === "pending" || status === "open"
        ? "chip chip--live"
        : "chip chip--spent";
  return <span className={cls}>{status}</span>;
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
  const openIncoming = (incomingOffers ?? []).filter((o) => o.status === "open").length;

  const OrderRow = ({ order, role }: { order: NonNullable<typeof orders>[number]; role: "buyer" | "seller" }) => (
    <div className="jobrow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <StatusChip status={order.status} />
          <span className="font-mono text-xs text-dim">
            {new Date(order.created_at).toLocaleDateString()}
          </span>
        </span>
        <span className="kv font-medium">{formatPrice(order.total_cents)}</span>
      </div>
      <ul className="mt-2">
        {(items ?? [])
          .filter((i) => i.order_id === order.id)
          .map((i) => (
            <li key={i.id} className="flex justify-between gap-3 py-0.5">
              <Link
                href={`/listings/${i.listing_id}`}
                className="order__name min-w-0 truncate !text-[14.5px] transition-colors hover:text-live"
              >
                {listingTitle(i.listing_id)}
              </Link>
              <span className="kv shrink-0 text-dim">{formatPrice(i.price_cents)}</span>
            </li>
          ))}
      </ul>
      <p className="order__meta mt-1">
        {role === "buyer"
          ? `Seller — ${name(order.seller_id)} · money sits in the stub until delivery`
          : `Buyer — ${name(order.buyer_id)} · fee ${formatPrice(order.platform_fee_cents)} · payout ${formatPrice(order.total_cents - order.platform_fee_cents)}`}
      </p>
      {["paid", "shipped", "completed"].includes(order.status) && !reviewedByMe.has(order.id) && (
        <div className="mt-3 border-t border-[color:var(--rule-soft)] pt-3">
          <ReviewForm
            orderId={order.id}
            revieweeName={role === "buyer" ? name(order.seller_id) : name(order.buyer_id)}
          />
        </div>
      )}
    </div>
  );

  const OfferRow = ({
    offer,
    incoming,
  }: {
    offer: NonNullable<typeof myOffers>[number];
    incoming: boolean;
  }) => (
    <div className="jobrow">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <StatusChip status={offer.status} />
          <Link
            href={`/listings/${offer.listing_id}`}
            className="order__name min-w-0 truncate transition-colors hover:text-live"
          >
            {listingTitle(offer.listing_id)}
          </Link>
        </span>
        <span className="kv shrink-0 font-medium">{formatPrice(offer.amount_cents)}</span>
      </div>
      {incoming && <p className="order__meta mt-0.5">@{name(offer.buyer_id)} makes the offer</p>}

      {messagesFor(offer.id).length > 0 && (
        <div className="thread mt-3 border-t border-[color:var(--rule-soft)] pt-2">
          {messagesFor(offer.id).map((m) => (
            <div key={m.id} className={`msg !py-1.5 ${m.sender_id === user!.id ? "msg--me" : ""}`}>
              <span className="msg__who">{name(m.sender_id)}</span>
              <p className="msg__body !text-[14px]">{m.body}</p>
            </div>
          ))}
        </div>
      )}

      {offer.status === "open" && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[color:var(--rule-soft)] pt-3">
          <form action={sendOfferMessage} className="composer__row">
            <input type="hidden" name="offer_id" value={offer.id} />
            <input name="body" required placeholder="Message…" className="ctl max-w-none flex-1 !py-2" />
            <button type="submit" className="btn btn--ghost !py-2.5">
              Send
            </button>
          </form>
          {incoming && (
            <div className="flex flex-wrap gap-2">
              <form action={respondToOffer}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="decision" value="accepted" />
                <button type="submit" className="btn btn--live">
                  Accept {formatPrice(offer.amount_cents)}
                </button>
              </form>
              <form action={respondToOffer}>
                <input type="hidden" name="offer_id" value={offer.id} />
                <input type="hidden" name="decision" value="declined" />
                <button type="submit" className="btn btn--ghost">
                  Pass
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Orders &amp; offers
          {openIncoming > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">
                {openIncoming} offer{openIncoming === 1 ? "" : "s"} need an answer
              </span>
            </>
          )}
        </span>
        <h1>
          Work orders on the <span className="live-word">sheet.</span>
        </h1>
        <p className="sub">
          Offers arrive as work orders — accept, counter in the thread, or pass. Money sits with
          the stub provider until the part is confirmed.
        </p>
      </Rv>

      {placed && (
        <div className="alert alert--ok mb-6">
          <span className="alert__ico" aria-hidden="true">
            ✓
          </span>
          <h4>Order placed</h4>
          <p>Payment was processed by the stub provider — no real charge.</p>
        </div>
      )}

      <section className="deck deck--two !items-start">
        <div className="grid gap-4">
          {(incomingOffers ?? []).length > 0 && (
            <Rv className="tile">
              <div className="tile__head">
                <span className="microlabel microlabel--ink">Offers on your listings</span>
                {openIncoming > 0 && <span className="chip chip--live">{openIncoming} open</span>}
              </div>
              <div className="rowlist">
                {(incomingOffers ?? []).map((o) => (
                  <OfferRow key={o.id} offer={o} incoming />
                ))}
              </div>
            </Rv>
          )}

          {(myOffers ?? []).length > 0 && (
            <Rv className="tile" stagger={1}>
              <div className="tile__head">
                <span className="microlabel microlabel--ink">Offers you&apos;ve made</span>
              </div>
              <div className="rowlist">
                {(myOffers ?? []).map((o) => (
                  <OfferRow key={o.id} offer={o} incoming={false} />
                ))}
              </div>
            </Rv>
          )}

          {(incomingOffers ?? []).length === 0 && (myOffers ?? []).length === 0 && (
            <Rv className="undrawn">
              <span className="undrawn__mark" aria-hidden="true">
                ⏱
              </span>
              <h3>No offers in motion</h3>
              <p>
                When an offer lands it arrives here as a work order — buyer, amount against your
                ask, and a window that counts down.
              </p>
              <Link href="/marketplace" className="btn btn--ghost">
                Browse the market
              </Link>
            </Rv>
          )}
        </div>

        <div className="grid gap-4">
          <Rv className="tile tile--deep" stagger={1}>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">What you&apos;re buying</span>
              {purchases.length > 0 && <span className="chip">{purchases.length}</span>}
            </div>
            {purchases.length > 0 ? (
              <div className="rowlist">
                {purchases.map((o) => (
                  <OrderRow key={o.id} order={o} role="buyer" />
                ))}
              </div>
            ) : (
              <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
                No purchases yet — first payout lands here
              </p>
            )}
          </Rv>

          <Rv className="tile tile--deep" stagger={2}>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">What you&apos;ve sold</span>
              {sales.length > 0 && <span className="chip">{sales.length}</span>}
            </div>
            {sales.length > 0 ? (
              <div className="rowlist">
                {sales.map((o) => (
                  <OrderRow key={o.id} order={o} role="seller" />
                ))}
              </div>
            ) : (
              <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
                No sales yet — buyers can&apos;t offer until you list
              </p>
            )}
          </Rv>
        </div>
      </section>

      <Foot
        left="DRVN / Livesheet — the clock is the contract"
        right={<Link href="/cart">Your cart →</Link>}
      />
    </div>
  );
}
