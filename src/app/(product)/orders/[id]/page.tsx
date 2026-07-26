import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, Media } from "@/components/ui";
import { formatPrice } from "@/lib/payments/fee";
import { createClient } from "@/lib/supabase/server";

import { ReviewForm } from "../review-form";
import { OrderPipeline, StatusChip } from "../order-pipeline";
import { CancelOrder, DispatchForm, OrderThread, ReceivedButton } from "./fulfilment";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Order ${id.slice(0, 8)} - DRVN` };
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string; skipped?: string }>;
}) {
  const { id } = await params;
  const { placed, skipped } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS restricts orders to their participants, so a miss here is either a bad
  // id or someone else's order — both are a 404 from this user's point of view.
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[orders] failed to load order", { id, error });
    throw new Error("Could not load this order");
  }
  if (!order) notFound();

  const isBuyer = order.buyer_id === user.id;
  const isSeller = order.seller_id === user.id;
  if (!isBuyer && !isSeller) notFound();

  const counterpartyId = isBuyer ? order.seller_id : order.buyer_id;

  const [{ data: items }, { data: counterparty }, { data: messages }, { data: reviews }, { data: payment }] =
    await Promise.all([
      supabase.from("order_items").select("*").eq("order_id", id),
      counterpartyId
        ? supabase
            .from("profiles")
            .select("id, display_name, username, avatar_url")
            .eq("id", counterpartyId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("order_id", id)
        .order("created_at"),
      supabase.from("reviews").select("order_id, reviewer_id").eq("order_id", id),
      supabase
        .from("payments")
        .select("status, provider, provider_reference, refunded_cents")
        .eq("order_id", id)
        .maybeSingle(),
    ]);

  const listingIds = (items ?? [])
    .map((i) => i.listing_id)
    .filter((x): x is string => Boolean(x));
  const { data: images } = listingIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", listingIds)
        .order("position")
    : { data: [] };
  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  // Falls back to the snapshot label, so a deleted account still reads sensibly.
  const counterpartyName =
    counterparty?.display_name ??
    (counterparty?.username ? `@${counterparty.username}` : null) ??
    (isBuyer ? order.seller_label : order.buyer_label) ??
    "DRVN member";

  const reviewedByMe = (reviews ?? []).some((r) => r.reviewer_id === user.id);
  const canReview = ["delivered", "completed"].includes(order.status) && !reviewedByMe;
  const payout = order.total_cents - order.platform_fee_cents;

  const threadMessages = (messages ?? []).map((m) => ({
    id: m.id,
    sender_id: m.sender_id,
    sender_name: m.sender_id === user.id ? "You" : counterpartyName,
    body: m.body,
    created_at: m.created_at,
  }));

  return (
    <div className="mx-auto w-full max-w-[820px] px-5 pb-10">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          {isBuyer ? "Your purchase" : "Your sale"} · ref {id.slice(0, 8).toUpperCase()}
        </span>
        <h1>
          {(items ?? []).length === 1
            ? (items![0].title ?? "One part")
            : `${(items ?? []).length} parts`}{" "}
          <span className="live-word">{isBuyer ? "inbound." : "outbound."}</span>
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <OrderPipeline status={order.status} />
          <StatusChip status={order.status} />
        </div>
      </Rv>

      {placed && (
        <div className="alert alert--ok mb-6">
          <span className="alert__ico" aria-hidden="true">
            ✓
          </span>
          <h4>Order placed</h4>
          <p>
            {skipped
              ? `Some lines couldn't be included: ${skipped}. Everything else is confirmed below.`
              : "The seller has been notified and will dispatch it."}
          </p>
        </div>
      )}

      <section className="deck deck--two !items-start">
        <div className="grid gap-4">
          <Rv className="tile">
            <span className="microlabel microlabel--ink">What&apos;s on this order</span>
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
                        className="order__name block truncate transition-colors hover:text-live"
                      >
                        {item.title ?? "Part"}
                      </Link>
                    ) : (
                      <span className="order__name block truncate">
                        {item.title ?? "Part"} <span className="text-dim">(listing removed)</span>
                      </span>
                    )}
                    <span className="order__meta block">{formatPrice(item.price_cents)}</span>
                  </span>
                </div>
              ))}
            </div>
          </Rv>

          <Rv className="tile" stagger={1}>
            <span className="microlabel microlabel--ink">Conversation</span>
            <div className="mt-3">
              <OrderThread orderId={id} currentUserId={user.id} messages={threadMessages} />
            </div>
          </Rv>

          {canReview && (
            <Rv className="tile" stagger={2}>
              <span className="microlabel microlabel--ink">Rate this trade</span>
              <div className="mt-3">
                <ReviewForm orderId={id} revieweeName={counterpartyName} />
              </div>
            </Rv>
          )}
        </div>

        <div className="grid gap-4">
          <Rv className="tile tile--deep">
            <span className="microlabel microlabel--ink">The money</span>
            <div className="mt-2">
              <div className="sheet__row">
                <span>Parts</span>
                <b>{formatPrice(order.subtotal_cents)}</b>
              </div>
              <div className="sheet__row">
                <span>Shipping</span>
                <b>{order.shipping_cents > 0 ? formatPrice(order.shipping_cents) : "Free"}</b>
              </div>
              {isSeller && (
                <div className="sheet__row">
                  <span>DRVN fee (10%)</span>
                  <b>−{formatPrice(order.platform_fee_cents)}</b>
                </div>
              )}
              <div className="sheet__row sheet__total">
                <span>{isSeller ? "Your payout" : "You paid"}</span>
                <b>{formatPrice(isSeller ? payout : order.total_cents)}</b>
              </div>
            </div>
            {payment && (
              <p className="spec-note">
                Payment {payment.status.replace(/_/g, " ")} via {payment.provider}
                {payment.provider_reference ? ` · ${payment.provider_reference}` : ""}
                {payment.refunded_cents > 0
                  ? ` · ${formatPrice(payment.refunded_cents)} refunded`
                  : ""}
              </p>
            )}
          </Rv>

          <Rv className="tile" stagger={1}>
            <span className="microlabel microlabel--ink">
              {isBuyer ? "The seller" : "The buyer"}
            </span>
            <p className="mt-2 font-medium">{counterpartyName}</p>
            {counterparty?.username && (
              <Link href={`/u/${counterparty.username}`} className="jumplink !mt-2 inline-flex">
                View their sheet
              </Link>
            )}
          </Rv>

          <Rv className="tile" stagger={2}>
            <span className="microlabel microlabel--ink">
              {order.is_collection ? "Collection" : "Delivery"}
            </span>
            {order.is_collection ? (
              <p className="mt-2 text-[14.5px]">
                Collection in person — arrange it in the conversation.
              </p>
            ) : order.ship_line1 ? (
              <address className="mt-2 not-italic text-[14.5px] leading-relaxed">
                {order.ship_name}
                <br />
                {order.ship_line1}
                {order.ship_line2 && (
                  <>
                    <br />
                    {order.ship_line2}
                  </>
                )}
                <br />
                {order.ship_city} {order.ship_postcode}
                <br />
                {order.ship_country}
                {order.ship_phone && (
                  <>
                    <br />
                    {order.ship_phone}
                  </>
                )}
              </address>
            ) : (
              <p className="mt-2 text-[14.5px] text-dim">No address recorded.</p>
            )}

            {order.tracking_number && (
              <p className="spec-note">
                {order.carrier} · {order.tracking_number}
              </p>
            )}
          </Rv>

          {/* Actions, gated by role and stage. */}
          {isSeller && order.status === "paid" && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">Dispatch</span>
              <div className="mt-3">
                <DispatchForm orderId={id} isCollection={order.is_collection} />
              </div>
            </Rv>
          )}

          {isBuyer && ["paid", "shipped"].includes(order.status) && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">Arrived?</span>
              <p className="spec-note">
                Confirming receipt closes the order and unlocks reviews for both sides.
              </p>
              <div className="mt-3">
                <ReceivedButton orderId={id} />
              </div>
            </Rv>
          )}

          {["pending", "paid"].includes(order.status) && (
            <Rv className="tile" stagger={4}>
              <span className="microlabel microlabel--ink">Change of plan</span>
              <p className="spec-note">
                Cancellable until it&apos;s dispatched. After that, message{" "}
                {isBuyer ? "the seller" : "the buyer"} first.
              </p>
              <div className="mt-3">
                <CancelOrder orderId={id} />
              </div>
            </Rv>
          )}
        </div>
      </section>

      <Foot
        left={`DRVN / Livesheet — order ${id.slice(0, 8).toUpperCase()}`}
        right={<Link href="/orders">All orders →</Link>}
      />
    </div>
  );
}
