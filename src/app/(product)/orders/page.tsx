import Link from "next/link";
import { redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { OfferRow, type OfferView } from "./offer-row";
import { OrderPipeline } from "./order-pipeline";
import { ReceivedButton } from "./[id]/fulfilment";

export const metadata = { title: "Orders - DRVN" };

/** Bounded: these queries used to fetch every order, offer and message ever. */
const PAGE_SIZE = 25;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ placed?: string; skipped?: string }>;
}) {
  const { placed, skipped } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [{ data: orders, error: ordersError }, { data: myListings }] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
    supabase.from("listings").select("id, title").eq("seller_id", user.id).limit(200),
  ]);

  if (ordersError) console.error("[orders] failed to load orders", ordersError);

  const orderIds = (orders ?? []).map((o) => o.id);
  const myListingIds = (myListings ?? []).map((l) => l.id);

  const [{ data: items }, { data: incomingOffers }, { data: myOffers }] = await Promise.all([
    orderIds.length
      ? supabase.from("order_items").select("*").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    myListingIds.length
      ? supabase
          .from("offers")
          .select("*")
          .in("listing_id", myListingIds)
          .order("created_at", { ascending: false })
          .limit(PAGE_SIZE)
      : Promise.resolve({ data: [] }),
    supabase
      .from("offers")
      .select("*")
      .eq("buyer_id", user.id)
      .order("created_at", { ascending: false })
      .limit(PAGE_SIZE),
  ]);

  const allOffers = [...(incomingOffers ?? []), ...(myOffers ?? [])];
  const allOfferIds = allOffers.map((o) => o.id);
  const offerListingIds = [...new Set(allOffers.map((o) => o.listing_id))];
  const counterpartyIds = [
    ...new Set([
      ...(orders ?? []).flatMap((o) => [o.buyer_id, o.seller_id]),
      ...(incomingOffers ?? []).map((o) => o.buyer_id),
    ]),
  ].filter((x): x is string => Boolean(x) && x !== user.id);

  const [{ data: people }, { data: offerListings }, { data: offerMessages }] = await Promise.all([
    counterpartyIds.length
      ? supabase.from("profiles").select("id, display_name, username").in("id", counterpartyIds)
      : Promise.resolve({ data: [] }),
    offerListingIds.length
      ? supabase.from("listings").select("id, title").in("id", offerListingIds)
      : Promise.resolve({ data: [] }),
    allOfferIds.length
      ? supabase
          .from("messages")
          .select("id, offer_id, sender_id, body")
          .in("offer_id", allOfferIds)
          .order("created_at")
      : Promise.resolve({ data: [] }),
  ]);

  const name = (pid: string | null, fallback?: string | null) => {
    if (!pid) return fallback ?? "DRVN member";
    if (pid === user.id) return "You";
    const p = (people ?? []).find((x) => x.id === pid);
    return p?.display_name ?? (p?.username ? `@${p.username}` : fallback ?? "DRVN member");
  };
  const listingTitle = (lid: string | null) =>
    (offerListings ?? []).find((l) => l.id === lid)?.title ??
    (myListings ?? []).find((l) => l.id === lid)?.title ??
    "Listing";

  // Absolute rather than relative: a countdown needs the current clock, and
  // reading it during render is impure (it would also be stale the moment the
  // page is cached). The exact deadline is the more useful number anyway.
  const expiresLabel = (expiresAt: string | null) => {
    if (!expiresAt) return null;
    return `lapses ${new Date(expiresAt).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    })}`;
  };

  const toOfferView = (offer: (typeof allOffers)[number]): OfferView => ({
    id: offer.id,
    listing_id: offer.listing_id,
    listing_title: listingTitle(offer.listing_id),
    buyer_id: offer.buyer_id,
    buyer_name: name(offer.buyer_id),
    amount_cents: offer.amount_cents,
    counter_amount_cents: offer.counter_amount_cents,
    status: offer.status,
    expiresLabel: expiresLabel(offer.expires_at),
    messages: (offerMessages ?? [])
      .filter((m) => m.offer_id === offer.id)
      .map((m) => ({
        id: m.id,
        sender_id: m.sender_id,
        sender_name: name(m.sender_id),
        body: m.body,
      })),
  });

  const purchases = (orders ?? []).filter((o) => o.buyer_id === user.id);
  const sales = (orders ?? []).filter((o) => o.seller_id === user.id);
  const needsAnswer = (incomingOffers ?? []).filter((o) => o.status === "open").length;
  const needsDispatch = sales.filter((o) => o.status === "paid").length;

  const OrderRow = ({
    order,
    role,
  }: {
    order: NonNullable<typeof orders>[number];
    role: "buyer" | "seller";
  }) => (
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
        {role === "buyer"
          ? `Seller — ${name(order.seller_id, order.seller_label)}`
          : `Buyer — ${name(order.buyer_id, order.buyer_label)} · payout ${formatPrice(
              order.total_cents - order.platform_fee_cents
            )}`}
        {" · "}
        {new Date(order.created_at).toLocaleDateString()}
      </p>
    </Link>
  );

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Orders &amp; offers
          {needsAnswer > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">
                {needsAnswer} offer{needsAnswer === 1 ? "" : "s"} need an answer
              </span>
            </>
          )}
          {needsDispatch > 0 && (
            <>
              {" · "}
              <span className="microlabel--live">{needsDispatch} to dispatch</span>
            </>
          )}
        </span>
        <h1>
          Offers in, orders <span className="live-word">out.</span>
        </h1>
        <p className="sub">
          Answer offers, track what&apos;s shipping, and message the other side — everything still
          in flight lives here.
        </p>
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

      <section className="deck deck--two !items-start">
        <div className="grid gap-4">
          {(incomingOffers ?? []).length > 0 && (
            <Rv className="tile">
              <div className="tile__head">
                <span className="microlabel microlabel--ink">Offers on your listings</span>
                {needsAnswer > 0 && <span className="chip chip--live">{needsAnswer} open</span>}
              </div>
              <div className="rowlist">
                {(incomingOffers ?? []).map((o) => (
                  <OfferRow key={o.id} offer={toOfferView(o)} incoming currentUserId={user.id} />
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
                  <OfferRow
                    key={o.id}
                    offer={toOfferView(o)}
                    incoming={false}
                    currentUserId={user.id}
                  />
                ))}
              </div>
            </Rv>
          )}

          {(incomingOffers ?? []).length === 0 && (myOffers ?? []).length === 0 && (
            <Rv className="undrawn">
              <span className="undrawn__mark" aria-hidden="true">
                ⏱
              </span>
              <h3>No offers yet</h3>
              <p>
                When someone offers on one of your listings it lands here — who it&apos;s from, how
                it compares to your asking price, and 72 hours to answer.
              </p>
              <Link href="/marketplace" className="btn btn--ghost">
                Browse the marketplace
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
                  <div key={o.id}>
                    <OrderRow order={o} role="buyer" />
                    {o.status === "shipped" && (
                      <div className="flex items-center justify-between gap-3 border-t border-[color:var(--rule-soft)] px-1 py-2">
                        <span className="order__meta">Has this arrived?</span>
                        <ReceivedButton orderId={o.id} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">
                No purchases yet
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
        left="DRVN — offers expire 72 hours after they're made"
        right={<Link href="/sell">List a part →</Link>}
      />
    </div>
  );
}
