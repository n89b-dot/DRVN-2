import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LiveDim, Rv } from "@/components/livesheet";
import { Alert, ButtonLink, Foot, SellingNav, Media, ObjectRow, RatingStars, TileHead } from "@/components/ui";
import {
  ConditionSummary,
  type ConditionSnapshot,
} from "@/components/condition-summary";
import {
  DISPUTE_CATEGORIES,
  DISPUTE_WINDOW_DAYS,
  SELLER_RESPONSE_DAYS,
} from "@/features/commerce/disputes";
import { fitmentLabel, readCommercialSnapshot } from "@/features/commerce/snapshot";
import { signEvidenceUrls } from "@/lib/evidence-urls";
import { formatPrice } from "@/lib/payments/fee";
import { countryLabel } from "@/lib/geo/countries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { markNotificationsReadForPage } from "@/lib/notifications-read";

import { ReviewForm } from "../review-form";
import { nextAction } from "../next-action";
import { OrderPipeline, StatusChip } from "@/components/commerce";
import {
  AcceptRefundButton,
  CloseDisputeButton,
  DisputeEvidenceForm,
  EscalateDisputeButton,
  RefundOfferForm,
  ReportProblemForm,
} from "./disputes";
import { CancelOrder, DispatchForm, ReceivedButton } from "./fulfilment";
import { BuyLabelPanel, LabelReadyPanel } from "./shipping-controls";
import { AddToCar } from "@/features/commerce/add-to-car";
import { orderCars } from "@/lib/cars/order";
import {
  PickupPassPanel,
  ReadyForPickupButton,
  RedeemPickupForm,
} from "./pickup-controls";
import {
  ProposeReturnForm,
  RequestShopReturnForm,
  ReturnInspectionPanel,
  ReturnShippingPanel,
  ShopReturnApprovalPanel,
} from "./return-controls";
import { reportError } from "@/lib/monitoring";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Order ${id.slice(0, 8)} - DRVN` };
}

export default async function OrderDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ placed?: string; skipped?: string; processing?: string }>;
}) {
  const { id } = await params;
  const { placed, skipped, processing } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS restricts orders to their participants, so a miss here is either a bad
  // id or someone else's order — both are a 404 from this user's point of view.
  // So is an id that isn't one at all (a mistyped or shortened link): the
  // query would error on it, and that isn't "something went wrong".
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const { data: order, error } = await supabase
    .from("orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    reportError("[orders] failed to load order", { id, error });
    throw new Error("Could not load this order");
  }
  if (!order) notFound();

  const isBuyer = order.buyer_id === user.id;
  const isSeller = order.seller_id === user.id;
  if (!isBuyer && !isSeller) notFound();
  const reportClosesAt = order.delivered_at
    ? new Date(new Date(order.delivered_at).getTime() + DISPUTE_WINDOW_DAYS * 86_400_000)
    : null;

  // Opening the order deals with what its notifications were about.
  await markNotificationsReadForPage(supabase, user.id, [`/orders/${id}`, `/orders/${id}/checkout`]);

  const counterpartyId = isBuyer ? order.seller_id : order.buyer_id;

  const [
    { data: items },
    { data: counterparty },
    { data: messages },
    { data: reviews },
    { data: payment },
    { data: evidence },
  ] = await Promise.all([
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
    supabase
      .from("reviews")
      .select("order_id, reviewer_id, rating")
      .eq("order_id", id),
    supabase
      .from("payments")
      .select("status, provider, provider_reference, refunded_cents")
      .eq("order_id", id)
      .maybeSingle(),
    // RLS: participants only ("participants read dispute evidence", 0024).
    supabase
      .from("dispute_evidence")
      .select("id, uploader_id, url, storage_path, note, created_at")
      .eq("order_id", id)
      .order("created_at"),
  ]);

  // dispute-evidence is a private bucket (0027) — the stored `url` is stale
  // (public-shaped or a bare path), so render a short-lived signed one
  // instead. Signing needs the admin storage client; RLS already gated the
  // `evidence` select above to this order's participants.
  const signedEvidence = await signEvidenceUrls(
    createAdminClient(),
    evidence ?? [],
  );

  // "As purchased" reads snapshot data only (0049): covers come from the
  // gallery frozen onto the order, and category/part identity/fitment from
  // commercial_snapshot. The live listing is linked for navigation, but it is
  // never evidence of what was bought — the seller may have edited or deleted
  // it since.
  const itemIds = (items ?? []).map((i) => i.id);
  const { data: snapshotImages } = itemIds.length
    ? await supabase
        .from("order_item_snapshot_images")
        .select("order_item_id, url, alt, position")
        .in("order_item_id", itemIds)
        .order("position")
    : { data: [] };
  const frozenGallery = new Map<string, { url: string; alt: string | null }[]>();
  for (const img of snapshotImages ?? []) {
    const list = frozenGallery.get(img.order_item_id) ?? [];
    list.push({ url: img.url, alt: img.alt });
    frozenGallery.set(img.order_item_id, list);
  }
  const snapshots = new Map(
    (items ?? []).map(
      (i) => [i.id, readCommercialSnapshot(i.commercial_snapshot)] as const,
    ),
  );

  // Shipments (0052) — the authoritative movement record. Admin client
  // because label_reference is deliberately not client-readable; the page
  // has already proven the viewer is a participant, and only the seller's
  // branch renders the label.
  const adminForShipping = createAdminClient();
  const { data: allShipments } = await adminForShipping
    .from("shipments")
    .select("*")
    .eq("order_id", id)
    .order("created_at");
  const liveShipments = (allShipments ?? []).filter(
    (s) => !["cancelled", "failed"].includes(s.status),
  );
  const { data: shipmentEvents } = liveShipments.length
    ? await adminForShipping
        .from("shipment_events")
        .select("shipment_id, status, description, occurred_at, city, state")
        .in(
          "shipment_id",
          liveShipments.map((s) => s.id),
        )
        .order("occurred_at", { ascending: false })
        .limit(12)
    : { data: [] };
  const latestEventFor = (shipmentId: string) =>
    (shipmentEvents ?? []).find((e) => e.shipment_id === shipmentId);
  const pendingLabel = liveShipments.find(
    (s) =>
      s.direction === "outbound" &&
      s.fulfillment_type === "drvn_shipping" &&
      s.status === "pending",
  );
  const boughtLabel = liveShipments.find(
    (s) =>
      s.direction === "outbound" &&
      s.fulfillment_type === "drvn_shipping" &&
      s.status === "label_purchased",
  );

  // Returns (0055): the latest RMA that still matters. RLS scopes to
  // participants; terminal-but-informative states still render as history.
  const { data: orderReturns } = await supabase
    .from("returns")
    .select("*")
    .eq("order_id", id)
    .order("created_at", { ascending: false });
  const activeReturn =
    (orderReturns ?? []).find(
      (r) => !["cancelled", "expired", "rejected"].includes(r.status),
    ) ?? null;

  // Shop preference-return window (§24B/§37): judged against the policy
  // FROZEN in the purchase snapshot, never the shop's current setting.
  const frozenPolicy =
    (items ?? [])
      .map((i) => snapshots.get(i.id)?.commercial.returnPolicy)
      .find((p) => p?.returnsAccepted) ?? null;
  const shopReturnDeadline =
    frozenPolicy && order.delivered_at
      ? new Date(
          new Date(order.delivered_at).getTime() +
            frozenPolicy.windowDays * 86_400_000,
        )
      : null;
  const canRequestShopReturn =
    isBuyer &&
    !activeReturn &&
    ["delivered", "completed"].includes(order.status) &&
    Boolean(shopReturnDeadline) &&
    new Date().getTime() < (shopReturnDeadline?.getTime() ?? 0);

  // C-1: the buyer's own cars, main first, offered only once the part has
  // arrived. A buyer with no garage sees nothing rather than an empty picker.
  const canAddToCar = isBuyer && ["delivered", "completed"].includes(order.status);
  const { data: garageRows } = canAddToCar
    ? await supabase
        .from("cars")
        .select("id, name, created_at")
        .eq("owner_id", user.id)
    : { data: [] };
  const { data: buyerProfile } = canAddToCar
    ? await supabase.from("profiles").select("main_car_id").eq("id", user.id).maybeSingle()
    : { data: null };
  const garageCars = orderCars(garageRows ?? [], buyerProfile?.main_car_id).map((c) => ({
    id: c.id,
    name: c.name,
  }));

  // Falls back to the snapshot label, so a deleted account still reads sensibly.
  const counterpartyName =
    counterparty?.display_name ??
    (counterparty?.username ? `@${counterparty.username}` : null) ??
    (isBuyer ? order.seller_label : order.buyer_label) ??
    "DRVN member";

  // Escalation gate (0024): seller-response window passed, no live offer, not
  // already escalated. Computed here, not in JSX — render stays pure.
  const canEscalate =
    isBuyer &&
    order.status === "disputed" &&
    !order.dispute_escalated_at &&
    !order.refund_offer_cents &&
    Boolean(order.disputed_at) &&
    // `new Date()` not `Date.now()` — the purity lint's house pattern.
    new Date().getTime() - new Date(order.disputed_at!).getTime() >
      SELLER_RESPONSE_DAYS * 86_400_000;

  // Seller-response deadline (0024/0021), for the same reason canEscalate is
  // computed here rather than in JSX — `new Date()` not `Date.now()`, the
  // purity lint's house pattern.
  const sellerResponseDueBy = order.disputed_at
    ? new Date(
        new Date(order.disputed_at).getTime() +
          SELLER_RESPONSE_DAYS * 86_400_000,
      )
    : null;
  const sellerResponseOverdue = Boolean(
    sellerResponseDueBy && new Date().getTime() > sellerResponseDueBy.getTime(),
  );

  // The family nav's Offers badge, and the offer this order came from — a
  // real column since 0034, so an order can name its negotiation without the
  // page reconstructing the link from order items and timestamps.
  const [offersCount, { data: originOffer }] = await Promise.all([
    loadOffersNeedingAttention(supabase, user.id),
    order.origin_offer_id
      ? supabase
          .from("offers")
          .select("id, amount_cents, counter_amount_cents")
          .eq("id", order.origin_offer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  // Stripe sent the buyer back before its webhook settled the order: the
  // money is on its way, so don't ask them to pay again.
  const confirmingPayment = Boolean(processing) && isBuyer && order.status === "pending";
  const action = confirmingPayment ? "Confirming your payment" : nextAction(order, isSeller);
  const canFinishCheckout = isBuyer && order.status === "pending" && !confirmingPayment;
  // Money only moved once the order was paid. An unpaid or failed checkout,
  // or one cancelled before payment, charged nobody and pays nobody out.
  const moneyMoved =
    !["pending", "requires_action", "payment_failed"].includes(order.status) &&
    !(order.status === "cancelled" && !["succeeded", "refunded", "partially_refunded"].includes(payment?.status ?? ""));

  const myReview = (reviews ?? []).find((r) => r.reviewer_id === user.id);
  const reviewedByMe = Boolean(myReview);
  const canReview =
    ["delivered", "completed"].includes(order.status) && !reviewedByMe;
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
      {/* An order sheet is still inside Orders — the family nav says so, and
          the breadcrumb underneath names the way back to the list. */}

      <SellingNav current="orders" offersCount={offersCount} />
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          <Link href="/orders" className="jumplink">
            Orders
          </Link>{" "}
          / {id.slice(0, 8).toUpperCase()} ·{" "}
          {isBuyer ? "your purchase" : "your sale"}
        </span>
        <h1>
          {(items ?? []).length === 1
            ? (items![0].title ?? "One part")
            : `${(items ?? []).length} parts`}{" "}
          <span className="live-word">
            {isBuyer ? "inbound." : "outbound."}
          </span>
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <OrderPipeline
            status={order.status}
            progressStatus={order.pre_dispute_status}
          />
          <StatusChip status={order.status} />
        </div>
      </Rv>
      {/* What this order needs next, above the tiles — a reader shouldn't have
          to open every panel to work out whose turn it is. The controls stay
          where they belong; this names the move and points at them. */}
      {action && (
        <div className="nextaction">
          <span className="microlabel">Next</span>
          <p className="nextaction__what">{action}</p>
          {confirmingPayment && (
            <p className="spec-note">
              Payment received — the bank is confirming it. There&apos;s nothing else to do; this
              page updates once it clears.
            </p>
          )}
          {canFinishCheckout && (
            <ButtonLink href={`/orders/${id}/checkout`} variant="live" className="mt-2">
              Finish checkout
            </ButtonLink>
          )}
          {originOffer && (
            <p className="spec-note">
              From an accepted offer of{" "}
              {formatPrice(
                originOffer.counter_amount_cents ?? originOffer.amount_cents,
              )}{" "}
              —{" "}
              <Link href={`/offers/${originOffer.id}`} className="jumplink">
                open the offer
              </Link>
            </p>
          )}
        </div>
      )}
      {!action && originOffer && (
        <p className="spec-note mb-4">
          From an accepted offer of{" "}
          {formatPrice(
            originOffer.counter_amount_cents ?? originOffer.amount_cents,
          )}{" "}
          —{" "}
          <Link href={`/offers/${originOffer.id}`} className="jumplink">
            open the offer
          </Link>
        </p>
      )}

      {placed && (
        <Alert tone="ok" ico="✓" title="Order placed" className="mb-6">
          {skipped
            ? `Some lines couldn't be included: ${skipped}. Everything else is confirmed below.`
            : "Your order went through — everything about it lives on this page."}
        </Alert>
      )}

      <section className="deck deck--two !items-start">
        <div className="grid gap-4">
          <Rv className="tile">
            <span className="microlabel microlabel--ink">
              What&apos;s on this order
            </span>
            <div className="rowlist mt-2">
              {(items ?? []).map((item) => (
                <ObjectRow
                  key={item.id}
                  media={{
                    src: frozenGallery.get(item.id)?.[0]?.url,
                    alt: item.title ?? "Part",
                  }}
                  actions={
                    /* C-1. Offered once the part has actually arrived, per
                       item — an order can hold several parts and they may
                       not all be going on the same car. Built from the
                       frozen purchase record, not the live listing. */
                    canAddToCar ? (
                      <AddToCar
                        orderItemId={item.id}
                        title={item.title ?? "this part"}
                        cars={garageCars}
                      />
                    ) : undefined
                  }
                >
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
                        {item.title ?? "Part"}{" "}
                        <span className="text-dim">(listing removed)</span>
                      </span>
                    )}
                    <span className="order__meta block">
                      {formatPrice(item.price_cents)}
                    </span>
                  </span>
                </ObjectRow>
              ))}
            </div>
          </Rv>

          {/* As purchased (0024/0049): the condition, identity, fitment and
              photos frozen onto this order at the moment of sale — the
              contract, not the listing as it reads today. */}
          {(items ?? []).length > 0 && (
            <Rv className="tile" stagger={1}>
              <span className="microlabel microlabel--ink">As purchased</span>
              <div className="mt-3 grid gap-5">
                {(items ?? []).map((item) => {
                  const snapshot = item.condition_snapshot as ConditionSnapshot;
                  const snap = snapshots.get(item.id);
                  const photos = frozenGallery.get(item.id) ?? [];
                  const partBits = [
                    snap?.part.partNumber
                      ? `Part № ${snap.part.partNumber}${
                          snap.part.altPartNumbers.length
                            ? ` (also ${snap.part.altPartNumbers.join(", ")})`
                            : ""
                        }`
                      : null,
                    snap?.fitment.length
                      ? `Fits ${snap.fitment.map(fitmentLabel).join(", ")}`
                      : null,
                    snap?.sourceCar?.name
                      ? `From ${snap.sourceCar.name}`
                      : null,
                  ].filter(Boolean);
                  return (
                    <div key={item.id} className="grid gap-3">
                      {snapshot && (
                        <ConditionSummary
                          snapshot={snapshot}
                          category={snap?.listing.category ?? undefined}
                          subcategory={snap?.listing.subcategory ?? undefined}
                          label={
                            (items ?? []).length > 1
                              ? (item.title ?? "Part")
                              : "Condition"
                          }
                          note="Declared by the seller at listing time and frozen onto this order at purchase."
                        />
                      )}
                      {partBits.length > 0 && (
                        <p className="spec-note">{partBits.join(" · ")}</p>
                      )}
                      {photos.length > 0 && (
                        <div>
                          <span className="microlabel">
                            Photos at purchase
                          </span>
                          <div className="thumbs !mt-1">
                            {photos.map((p, idx) => (
                              <a
                                key={`${item.id}-${idx}`}
                                href={p.url}
                                target="_blank"
                                rel="noreferrer"
                                className="thumb"
                              >
                                <Media
                                  src={p.url}
                                  alt={
                                    p.alt ??
                                    item.title ??
                                    "Listing photo at purchase"
                                  }
                                  className="h-full w-full"
                                  role="row"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Rv>
          )}

          <Rv className="tile" stagger={2}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0">
                <span className="microlabel microlabel--ink block">
                  Conversation
                </span>
                <span className="order__meta block">
                  {threadMessages.length > 0
                    ? `${threadMessages.length} message${threadMessages.length === 1 ? "" : "s"} with ${counterpartyName}`
                    : `Questions about this order go to ${counterpartyName}`}
                </span>
              </span>
              <Link href={`/messages/${id}`} className="jumplink shrink-0">
                {threadMessages.length > 0
                  ? "Open the conversation →"
                  : `Message ${isBuyer ? "the seller" : "the buyer"} →`}
              </Link>
            </div>
          </Rv>

          {canReview && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">
                Rate this trade
              </span>
              <div className="mt-3">
                <ReviewForm orderId={id} revieweeName={counterpartyName} />
              </div>
            </Rv>
          )}

          {myReview && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">Your review</span>
              <p className="mt-2">
                <RatingStars rating={myReview.rating} className="!ml-0" />
              </p>
            </Rv>
          )}
        </div>

        <div className="grid gap-4">
          <Rv className="tile tile--deep">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">
                {isSeller ? "Payout breakdown" : "Payment summary"}
              </span>
              <span className="microlabel">{order.currency}</span>
            </div>
            {/* Werkbank C3 — the seller's side is arithmetic they can check
                line by line, so every step is its own ruled row rather than a
                total with the working hidden. There is deliberately no
                "processing" line: DRVN charges 10% and nothing else, and
                inventing a fee the product doesn't take would be fiction. */}
            <div className="mt-2">
              <div className="sheet__row">
                <span>{isSeller ? "Sale price" : "Parts"}</span>
                <b>{formatPrice(order.subtotal_cents)}</b>
              </div>
              <div className="sheet__row">
                <span>Shipping{isSeller ? " — passed on" : ""}</span>
                <b>
                  {order.shipping_cents > 0
                    ? formatPrice(order.shipping_cents)
                    : "Free"}
                </b>
              </div>
              {isSeller && (
                <div className="sheet__row">
                  <span>DRVN fee — 10%</span>
                  <b>−{formatPrice(order.platform_fee_cents)}</b>
                </div>
              )}
              <div className="sheet__row sheet__total">
                <span>
                  {order.status === "cancelled" && !moneyMoved
                    ? "Cancelled — nothing charged"
                    : isSeller
                      ? moneyMoved
                        ? "Payout to you"
                        : "Payout once paid"
                      : moneyMoved
                        ? "You paid"
                        : "To pay"}
                </span>
                <b>{formatPrice(isSeller ? payout : order.total_cents)}</b>
              </div>
            </div>
            {isSeller && moneyMoved && !["cancelled", "refunded"].includes(order.status) && (
              <LiveDim
                label="Payout releases"
                value={
                  order.delivered_at
                    ? "Delivery confirmed — clearing"
                    : "On delivery confirm"
                }
                live={Boolean(order.delivered_at)}
              />
            )}
            {payment && (
              <p className="spec-note">
                Payment {payment.status.replace(/_/g, " ")}
                {payment.refunded_cents > 0
                  ? ` · ${formatPrice(payment.refunded_cents)} refunded`
                  : ""}
              </p>
            )}
          </Rv>

          <Rv className="tile" stagger={1}>
            <span className="microlabel microlabel--ink block">
              {isBuyer ? "The seller" : "The buyer"}
            </span>
            {counterparty?.username ? (
              <p className="mt-2">
                <Link
                  href={`/u/${counterparty.username}`}
                  className="font-medium transition-colors hover:text-live"
                >
                  {counterpartyName} →
                </Link>
              </p>
            ) : (
              <p className="mt-2 font-medium">{counterpartyName}</p>
            )}
          </Rv>

          <Rv className="tile" stagger={2}>
            <span className="microlabel microlabel--ink">
              {order.is_collection ? "Collection" : "Delivery"}
            </span>
            {order.is_collection ? (
              <p className="mt-2 text-body">
                Collection in person — arrange it in the conversation.
              </p>
            ) : order.ship_line1 ? (
              <address className="mt-2 not-italic text-body leading-relaxed">
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
                {order.ship_city}
                {order.ship_state ? `, ${order.ship_state}` : ""}{" "}
                {order.ship_postcode}
                <br />
                {countryLabel(order.ship_country)}
                {order.ship_phone && (
                  <>
                    <br />
                    {order.ship_phone}
                  </>
                )}
              </address>
            ) : (
              <p className="mt-2 text-body text-dim">No address recorded.</p>
            )}

            {order.tracking_number && (
              <p className="spec-note">
                {order.carrier} · {order.tracking_number}
              </p>
            )}
          </Rv>

          {/* Shipment tracking (0052): parcel-level truth for both parties —
              per-parcel detail lives here rather than in more order states. */}
          {liveShipments.length > 0 && (
            <Rv className="tile" stagger={2}>
              <span className="microlabel microlabel--ink">Tracking</span>
              <div className="mt-2 grid gap-3">
                {liveShipments.map((shipment) => {
                  const latest = latestEventFor(shipment.id);
                  return (
                    <div key={shipment.id} className="grid gap-1">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-micro font-medium">
                          {[shipment.carrier, shipment.service]
                            .filter(Boolean)
                            .join(" ") ||
                            (shipment.fulfillment_type === "drvn_shipping"
                              ? "DRVN Shipping"
                              : "Shipment")}
                          {shipment.direction === "return" ? " · return" : ""}
                        </span>
                        <span
                          className={
                            shipment.status === "delivered"
                              ? "chip chip--ok"
                              : "chip"
                          }
                        >
                          {shipment.status.replace(/_/g, " ")}
                        </span>
                      </div>
                      {shipment.tracking_code && (
                        <p className="spec-note !mt-0">{shipment.tracking_code}</p>
                      )}
                      {latest?.description && (
                        <p className="spec-note !mt-0">
                          {latest.description}
                          {latest.city ? ` — ${latest.city}${latest.state ? `, ${latest.state}` : ""}` : ""}
                          {" · "}
                          {new Date(latest.occurred_at).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </Rv>
          )}

          {/* Actions, gated by role and stage. */}
          {isSeller && order.status === "paid" && order.is_collection && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">Pickup</span>
              <div className="mt-3">
                {order.pickup_ready_at ? (
                  <RedeemPickupForm orderId={id} />
                ) : (
                  <ReadyForPickupButton orderId={id} />
                )}
              </div>
            </Rv>
          )}

          {isBuyer &&
            order.status === "paid" &&
            order.is_collection &&
            order.pickup_ready_at && (
              <Rv className="tile" stagger={3}>
                <span className="microlabel microlabel--ink">Pickup Pass</span>
                <div className="mt-3">
                  <PickupPassPanel orderId={id} />
                </div>
              </Rv>
            )}

          {isSeller && order.status === "paid" && !order.is_collection && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">Dispatch</span>
              <div className="mt-3 grid gap-4">
                {pendingLabel && (
                  <BuyLabelPanel
                    orderId={id}
                    quotedCents={pendingLabel.quoted_cents}
                  />
                )}
                {boughtLabel && (
                  <LabelReadyPanel
                    shipmentId={boughtLabel.id}
                    labelUrl={boughtLabel.label_reference}
                    trackingCode={boughtLabel.tracking_code}
                    carrier={boughtLabel.carrier}
                  />
                )}
                {pendingLabel || boughtLabel ? (
                  <details>
                    <summary className="jumplink cursor-pointer">
                      Shipping it yourself instead?
                    </summary>
                    <div className="mt-3">
                      <DispatchForm orderId={id} isCollection={order.is_collection} />
                    </div>
                  </details>
                ) : (
                  <DispatchForm orderId={id} isCollection={order.is_collection} />
                )}
              </div>
            </Rv>
          )}

          {isSeller && ["pending", "paid"].includes(order.status) && (
            <Rv className="tile" stagger={4}>
              <span className="microlabel microlabel--ink">
                Can&apos;t fulfil this?
              </span>
              <p className="spec-note">
                Cancelling refunds the buyer in full and puts the part back on
                sale. If the buyer asked to cancel, this is where you do it.
              </p>
              <div className="mt-3">
                <CancelOrder orderId={id} />
              </div>
            </Rv>
          )}

          {isBuyer && order.status === "shipped" && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">
                Has it arrived?
              </span>
              <p className="spec-note">
                Confirming receipt starts the seller&apos;s payout clearing
                window — check the part against its condition disclosure first.
              </p>
              <div className="mt-3">
                <ReceivedButton orderId={id} />
              </div>
            </Rv>
          )}

          {isBuyer &&
            ["shipped", "delivered", "completed"].includes(order.status) && (
              <Rv className="tile" stagger={4}>
                <span className="microlabel microlabel--ink">
                  Something wrong?
                </span>
                <p className="spec-note">
                  Item missing, damaged or not as described — open a dispute and
                  the seller can offer a refund.{" "}
                  <Link href="/protection" className="jumplink">
                    How protection works
                  </Link>
                </p>
                {/* The claim window (dispute-command.ts): 30 days from
                    delivery. Once it has closed, the form would only be
                    refused on submit — say so instead of offering it. */}
                {reportClosesAt && reportClosesAt.getTime() < Date.now() ? (
                  <p className="spec-note">
                    The {DISPUTE_WINDOW_DAYS}-day window to report a problem
                    closed on {reportClosesAt.toLocaleDateString()}. Message
                    the seller below if something isn&apos;t right.
                  </p>
                ) : (
                  <>
                    {reportClosesAt && (
                      <p className="spec-note">
                        You can report a problem until{" "}
                        {reportClosesAt.toLocaleDateString()} —{" "}
                        {DISPUTE_WINDOW_DAYS} days after delivery.
                      </p>
                    )}
                    <div className="mt-3">
                      <ReportProblemForm orderId={id} />
                    </div>
                  </>
                )}
              </Rv>
            )}

          {order.status === "disputed" && (
            <Rv className="tile tile--deep" stagger={4}>
              <div className="tile__head">
                <span className="microlabel microlabel--ink">Dispute</span>
                <span
                  className={
                    order.dispute_escalated_at
                      ? "chip chip--live"
                      : "chip chip--spent"
                  }
                >
                  {order.dispute_escalated_at
                    ? "With DRVN support"
                    : "In dispute"}
                </span>
              </div>
              <p className="mt-2 text-body">
                {DISPUTE_CATEGORIES.find(
                  (c) => c.value === order.dispute_category,
                )?.label ?? "Reported a problem"}
              </p>
              {order.dispute_reason && (
                <p className="spec-note">&quot;{order.dispute_reason}&quot;</p>
              )}
              <p className="spec-note">
                Opened{" "}
                {order.disputed_at
                  ? new Date(order.disputed_at).toLocaleDateString()
                  : ""}
                {isBuyer ? " by you" : ` by ${counterpartyName}`}
              </p>

              {/* Deadlines the dispute runs against (0024/0021): the seller's
                  response window, and — once it's passed — when the buyer can
                  ask DRVN to step in. Both derive from disputed_at; nothing
                  here is computed server-side beyond what canEscalate above
                  already checks. */}
              {sellerResponseDueBy && !order.dispute_escalated_at && (
                <p className="spec-note">
                  {sellerResponseOverdue
                    ? `Seller response was due ${sellerResponseDueBy.toLocaleDateString()} — ${isBuyer ? "you can now ask DRVN to step in." : "the buyer can now ask DRVN to step in."}`
                    : `Seller response due by ${sellerResponseDueBy.toLocaleDateString()}. Escalation to DRVN opens after that.`}
                </p>
              )}

              {/* The contract this dispute is judged against: the grade and
                  checklist the listing declared, frozen at purchase (0024) —
                  distinct from anything said in the conversation since. */}
              {(items ?? []).map((item) => {
                const snapshot = item.condition_snapshot as ConditionSnapshot;
                if (!snapshot) return null;
                const snap = snapshots.get(item.id);
                return (
                  <div key={item.id} className="mt-3">
                    <ConditionSummary
                      snapshot={snapshot}
                      category={snap?.listing.category ?? undefined}
                      subcategory={snap?.listing.subcategory ?? undefined}
                      label="What the listing promised (frozen at purchase)"
                      note="This is the contract the dispute is judged against — not anything said since in the conversation below."
                    />
                  </div>
                );
              })}

              {/* Evidence: photos beat adjectives in a condition argument. */}
              {signedEvidence.length > 0 && (
                <div className="mt-3">
                  <span className="microlabel">Photos on this case</span>
                  <div className="thumbs !mt-1">
                    {signedEvidence.map((e) => (
                      <a
                        key={e.id}
                        href={e.url}
                        target="_blank"
                        rel="noreferrer"
                        className="thumb"
                      >
                        <Media
                          src={e.url}
                          alt={e.note ?? "Dispute evidence photo"}
                          className="h-full w-full"
                          role="row"
                        />
                      </a>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3">
                <DisputeEvidenceForm orderId={id} userId={user.id} />
              </div>

              {order.refund_offer_cents ? (
                <div className="mt-3 grid gap-2">
                  <p className="spec-note">
                    {isBuyer
                      ? `The seller offered a refund of ${formatPrice(order.refund_offer_cents)}.`
                      : `You offered a refund of ${formatPrice(order.refund_offer_cents)} — waiting on the buyer.`}
                  </p>
                  {isBuyer && (
                    <AcceptRefundButton
                      orderId={id}
                      offerCents={order.refund_offer_cents}
                    />
                  )}
                </div>
              ) : (
                isSeller && (
                  <div className="mt-3 grid gap-4">
                    <RefundOfferForm
                      orderId={id}
                      totalCents={order.total_cents}
                    />
                    {/* §25: the third resolution — item back first, refund
                        after. Hidden once an RMA is already running. */}
                    {!activeReturn && (
                      <ProposeReturnForm
                        orderId={id}
                        items={(items ?? []).map((item) => ({
                          id: item.id,
                          title: item.title ?? "Part",
                          priceCents: item.price_cents,
                        }))}
                      />
                    )}
                  </div>
                )
              )}

              {/* Escalation (0024): shown once the seller-response window has
                  passed with no live offer and no prior escalation — the
                  server action re-checks all three. */}
              {canEscalate && (
                <div className="mt-3">
                  <p className="spec-note">
                    The seller has had {SELLER_RESPONSE_DAYS} days — you can
                    bring DRVN in.
                  </p>
                  <EscalateDisputeButton orderId={id} />
                </div>
              )}

              {isBuyer && (
                <div className="mt-3">
                  <CloseDisputeButton orderId={id} />
                </div>
              )}
            </Rv>
          )}

          {/* Return / RMA (0055): its own tile — goods moving back is a
              domain, not another order status. */}
          {activeReturn && (
            <Rv className="tile tile--deep" stagger={5}>
              <TileHead
                label="Return"
                end={
                  <span
                    className={
                      activeReturn.status === "completed"
                        ? "chip chip--ok"
                        : activeReturn.status === "escalated"
                          ? "chip chip--live"
                          : "chip"
                    }
                  >
                    {activeReturn.status.replace(/_/g, " ")}
                  </span>
                }
              />
              {activeReturn.refund_amount_cents != null && (
                <p className="spec-note">
                  Agreed refund {formatPrice(activeReturn.refund_amount_cents)}
                  {activeReturn.label_deduction_cents > 0
                    ? ` − ${formatPrice(activeReturn.label_deduction_cents)} return postage`
                    : ""}{" "}
                  — moves once the part is back with the seller.
                </p>
              )}
              {activeReturn.ship_by &&
                ["approved", "awaiting_shipment"].includes(activeReturn.status) && (
                  <p className="spec-note">
                    {isBuyer ? "Ship it back by " : "Buyer ships by "}
                    {new Date(activeReturn.ship_by).toLocaleDateString()} or the
                    return lapses.
                  </p>
                )}
              {activeReturn.seller_respond_by &&
                activeReturn.status === "delivered" && (
                  <p className="spec-note">
                    {isSeller ? "Confirm or flag it by " : "The seller has until "}
                    {new Date(activeReturn.seller_respond_by).toLocaleString()} —
                    silence releases the agreed refund automatically.
                  </p>
                )}
              {activeReturn.status === "escalated" && (
                <p className="spec-note">
                  DRVN is reviewing the returned item&apos;s condition — no refund
                  moves until that&apos;s settled.
                </p>
              )}

              {activeReturn.status === "requested" && (
                <div className="mt-3">
                  {isSeller ? (
                    <ShopReturnApprovalPanel returnId={activeReturn.id} />
                  ) : (
                    <p className="spec-note">
                      Waiting on the shop to approve your return request.
                    </p>
                  )}
                </div>
              )}
              {isBuyer &&
                ["approved", "awaiting_shipment"].includes(activeReturn.status) && (
                  <div className="mt-3">
                    <ReturnShippingPanel
                      returnId={activeReturn.id}
                      sellerPaysPostage={activeReturn.responsibility === "seller"}
                    />
                  </div>
                )}
              {isSeller &&
                ["in_transit", "delivered"].includes(activeReturn.status) && (
                  <div className="mt-3">
                    <ReturnInspectionPanel returnId={activeReturn.id} />
                  </div>
                )}
            </Rv>
          )}

          {canRequestShopReturn && shopReturnDeadline && frozenPolicy && (
            <Rv className="tile" stagger={5}>
              <span className="microlabel microlabel--ink">Returns</span>
              <div className="mt-3">
                <RequestShopReturnForm
                  orderId={id}
                  windowDays={frozenPolicy.windowDays}
                  deadline={shopReturnDeadline.toISOString()}
                />
              </div>
            </Rv>
          )}
        </div>
      </section>

      <Foot
        left={`DRVN — order ${id.slice(0, 8).toUpperCase()}`}
        right={<Link href="/orders">All orders →</Link>}
      />
    </div>
  );
}
