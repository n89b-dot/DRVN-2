import { randomUUID } from "node:crypto";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { CheckoutSteps } from "@/app/(product)/checkout/checkout-steps";
import { listSavedCards } from "@/lib/payments/customers";
import { Rv } from "@/components/livesheet";
import { Foot, Media } from "@/components/ui";
import { completeReservedOrder } from "@/features/commerce/actions";
import { formatPrice } from "@/lib/payments/fee";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Complete order ${id.slice(0, 8)} - DRVN` };
}

/**
 * Checkout for an order that is already reserved.
 *
 * Accepting an offer used to charge the buyer on the seller's click, which
 * produced a paid order with no delivery address — unfulfillable, and billed
 * to someone who had never seen a total. Acceptance now holds the part for 24
 * hours and sends the buyer here to supply an address and confirm.
 */
export default async function CompleteOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/orders/${id}/checkout`)}`);

  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    reportError("[checkout] failed to load order", { id, error });
    throw new Error("Could not load this order");
  }
  if (!order) notFound();

  // Only the buyer completes it; the seller has no checkout to run.
  if (order.buyer_id !== user.id) notFound();

  // Anything already settled belongs on the order page, not here.
  if (order.status !== "pending") redirect(`/orders/${id}`);

  const [{ data: items }, { data: seller }] = await Promise.all([
    supabase.from("order_items").select("*").eq("order_id", id),
    order.seller_id
      ? supabase
          .from("profiles")
          .select("display_name, username")
          .eq("id", order.seller_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const listingIds = (items ?? [])
    .map((i) => i.listing_id)
    .filter((x): x is string => Boolean(x));

  const [{ data: images }, { data: listings }] = await Promise.all([
    listingIds.length
      ? supabase
          .from("listing_images")
          .select("listing_id, url, position")
          .in("listing_id", listingIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    listingIds.length
      ? supabase.from("listings").select("id, allows_collection").in("id", listingIds)
      : Promise.resolve({ data: [] }),
  ]);

  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  // Collection is only offered when every line on the order allows it.
  const allowsCollection =
    (listings ?? []).length > 0 && (listings ?? []).every((l) => l.allows_collection);

  const sellerName =
    seller?.display_name ?? (seller?.username ? `@${seller.username}` : order.seller_label) ?? "the seller";

  const expiresSoon = order.created_at
    ? new Date(new Date(order.created_at).getTime() + 24 * 60 * 60 * 1000)
    : null;

  return (
    <div className="mx-auto w-full max-w-[820px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Offer accepted · ref {id.slice(0, 8).toUpperCase()}
        </span>
        <h1>
          Finish up and it&apos;s <span className="live-word">yours.</span>
        </h1>
        <p className="mt-2 text-[15px] text-dim">
          {sellerName} accepted your offer, so the part is held for you. Add a delivery address to
          complete the order.
          {expiresSoon && (
            <>
              {" "}
              The hold releases{" "}
              <time dateTime={expiresSoon.toISOString()}>
                {expiresSoon.toLocaleString(undefined, {
                  weekday: "short",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </time>
              .
            </>
          )}
        </p>
      </Rv>

      <section className="deck deck--two !items-start">
        <div className="grid gap-4">
          <Rv className="tile">
            <span className="microlabel microlabel--ink">What you&apos;re buying</span>
            <div className="rowlist mt-2">
              {(items ?? []).map((item) => (
                <div key={item.id} className="order">
                  <span className="order__img">
                    <Media
                      src={item.listing_id ? cover.get(item.listing_id) : undefined}
                      alt={item.title ?? "Part"}
                      className="h-full w-full"
                    />
                  </span>
                  <span className="min-w-0">
                    {item.listing_id ? (
                      <Link
                        href={`/listings/${item.listing_id}`}
                        className="order__name block truncate"
                      >
                        {item.title ?? "Part"}
                      </Link>
                    ) : (
                      <span className="order__name block truncate">{item.title ?? "Part"}</span>
                    )}
                    <span className="order__meta block">{formatPrice(item.price_cents)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Rv>

          <Rv stagger={1}>
            <CheckoutSteps
              idempotencyKey={randomUUID()}
              allowsCollection={allowsCollection}
              total={formatPrice(order.total_cents)}
              savedCards={await listSavedCards(user.id).catch(() => [])}
              action={completeReservedOrder}
              orderId={id}
            />
          </Rv>
        </div>

        <Rv className="tile tile--deep" stagger={2}>
          <div className="tile__head">
            <span className="microlabel microlabel--ink">The money</span>
            <span className="microlabel">{order.currency}</span>
          </div>
          <dl className="kv mt-2">
            <dt>Agreed price</dt>
            <dd>{formatPrice(order.subtotal_cents)}</dd>
            <dt>Shipping</dt>
            <dd>
              {order.shipping_cents > 0 ? formatPrice(order.shipping_cents) : "Included"}
            </dd>
            <dt>
              <b>Total</b>
            </dt>
            <dd>
              <b>{formatPrice(order.total_cents)}</b>
            </dd>
          </dl>
        </Rv>
      </section>

      <Foot left="Orders" right="DRVN" />
    </div>
  );
}
