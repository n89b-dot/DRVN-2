import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { LiveDim, Rv } from "@/components/livesheet";
import { Alert, Foot, SellingNav, Media, ObjectRow, RatingStars } from "@/components/ui";
import {
  ConditionSummary,
  type ConditionSnapshot,
} from "@/components/condition-summary";
import {
  DISPUTE_CATEGORIES,
  DISPUTE_WINDOW_DAYS,
  SELLER_RESPONSE_DAYS,
} from "@/features/commerce/disputes";
import { signEvidenceUrls } from "@/lib/evidence-urls";
import { formatPrice } from "@/lib/payments/fee";
import { countryLabel } from "@/lib/geo/countries";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { loadOffersNeedingAttention } from "@/lib/shell-counts";

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
    reportError("[orders] failed to load order", { id, error });
    throw new Error("Could not load this order");
  }
  if (!order) notFound();

  const isBuyer = order.buyer_id === user.id;
  const isSeller = order.seller_id === user.id;
  if (!isBuyer && !isSeller) notFound();

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

  const listingIds = (items ?? [])
    .map((i) => i.listing_id)
    .filter((x): x is string => Boolean(x));
  const [{ data: images }, { data: listingMeta }] = await Promise.all([
    listingIds.length
      ? supabase
          .from("listing_images")
          .select("listing_id, url, position")
          .in("listing_id", listingIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    // Category/subcategory for the checklist's question catalog — the
    // snapshot itself only carries answers, not which questions they
    // answer (0024's trigger doesn't freeze category). Best-effort: a
    // listing edited since the sale still has the right catalog (question
    // keys are stable per category); a hard-deleted one falls back to
    // humanized raw keys in ConditionSummary.
    listingIds.length
      ? supabase
          .from("listings")
          .select("id, category, subcategory")
          .in("id", listingIds)
      : Promise.resolve({ data: [] }),
  ]);
  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }
  const listingCategory = new Map<
    string,
    { category: string; subcategory: string | null }
  >();
  for (const l of listingMeta ?? []) {
    listingCategory.set(l.id, {
      category: l.category,
      subcategory: l.subcategory,
    });
  }

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

  const action = nextAction(order, isSeller);

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
                    src: item.listing_id ? cover.get(item.listing_id) : undefined,
                    alt: item.title ?? "Part",
                  }}
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

          {/* As purchased (0024): the grade/checklist/notes frozen onto
              this order at the moment of sale — the contract, not the
              listing as it reads today. */}
          {(items ?? []).some((item) => item.condition_snapshot) && (
            <Rv className="tile" stagger={1}>
              <span className="microlabel microlabel--ink">As purchased</span>
              <div className="mt-3 grid gap-5">
                {(items ?? []).map((item) => {
                  const snapshot = item.condition_snapshot as ConditionSnapshot;
                  if (!snapshot) return null;
                  const meta = item.listing_id
                    ? listingCategory.get(item.listing_id)
                    : undefined;
                  return (
                    <ConditionSummary
                      key={item.id}
                      snapshot={snapshot}
                      category={meta?.category}
                      subcategory={meta?.subcategory}
                      label={
                        (items ?? []).length > 1
                          ? (item.title ?? "Part")
                          : "Condition"
                      }
                      note="Declared by the seller at listing time and frozen onto this order at purchase."
                    />
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
                <span>{isSeller ? "Payout to you" : "You paid"}</span>
                <b>{formatPrice(isSeller ? payout : order.total_cents)}</b>
              </div>
            </div>
            {isSeller && (
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

          {/* Actions, gated by role and stage. */}
          {isSeller && order.status === "paid" && (
            <Rv className="tile" stagger={3}>
              <span className="microlabel microlabel--ink">Dispatch</span>
              <div className="mt-3">
                <DispatchForm orderId={id} isCollection={order.is_collection} />
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
                {order.delivered_at && (
                  <p className="spec-note">
                    You can report a problem until{" "}
                    {new Date(
                      new Date(order.delivered_at).getTime() +
                        DISPUTE_WINDOW_DAYS * 86_400_000,
                    ).toLocaleDateString()}{" "}
                    — {DISPUTE_WINDOW_DAYS} days after delivery.
                  </p>
                )}
                <div className="mt-3">
                  <ReportProblemForm orderId={id} />
                </div>
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
                const meta = item.listing_id
                  ? listingCategory.get(item.listing_id)
                  : undefined;
                return (
                  <div key={item.id} className="mt-3">
                    <ConditionSummary
                      snapshot={snapshot}
                      category={meta?.category}
                      subcategory={meta?.subcategory}
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
                  <div className="mt-3">
                    <RefundOfferForm
                      orderId={id}
                      totalCents={order.total_cents}
                    />
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
        </div>
      </section>

      <Foot
        left={`DRVN — order ${id.slice(0, 8).toUpperCase()}`}
        right={<Link href="/orders">All orders →</Link>}
      />
    </div>
  );
}
