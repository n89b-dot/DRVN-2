import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { ButtonLink, buttonClass, Foot, Media, MessageBubble, MessageRun, MessageThread, SellingNav, TileHead } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { loadOffersNeedingAttention } from "@/lib/shell-counts";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";
import { reportError } from "@/lib/monitoring";
import { markThreadMessagesRead } from "@/features/commerce/actions";
import { markNotificationsReadForPage } from "@/lib/notifications-read";

import { OfferRound as OfferRoundRow, StatusChip } from "@/components/commerce";
import { StopBuyerAgent } from "@/features/agent/stop-buyer-agent";
import { AskAgentButton } from "@/features/agent/ask-agent-button";
import { agentStepOpen, agentTabOpen } from "@/lib/agent/beta";
import { loadAgentMode } from "@/lib/agent/member-mode";
import { agentModeAllowsChat, agentModeRefusal } from "@/lib/agent/mode";
import { agentPriceLine, type PriceRound } from "@/features/commerce/agent-price";
import { CancelOrder } from "@/features/commerce/cancel-order";
import { OfferDecision } from "@/features/commerce/offer-decision";
import { offerHistoryFromRounds, type HistoryMandate, type OfferRound } from "@/features/commerce/offer-history";

/** How much of the conversation the offer page previews. */
const PREVIEW_COUNT = 3;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return { title: `Offer ${id.slice(0, 8)} - DRVN` };
}

type HistoryEntry = { label: string; at: string; amount?: number; viaAgent?: boolean; reason?: string };

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
  const supabase = await getPageClient();
  const user = await getViewer();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/offers/${id}`)}`);

  const { data: offer, error: offerError } = await supabase
    .from("offers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (offerError)
    reportError("[offers] failed to load offer", { id, offerError });
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

  const [{ data: image }, { data: counterparty }, { data: rawMessages }, { data: rounds }, { count: buyerOffersUsed }, { data: ownMandate }] =
    await Promise.all([
      supabase
        .from("listing_images")
        .select("url")
        .eq("listing_id", listing.id)
        .order("position")
        .limit(1)
        .maybeSingle(),
      counterpartyId
        ? supabase
            .from("profiles")
            .select("id, display_name, username")
            .eq("id", counterpartyId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("offer_id", id)
        .eq("kind", "message")
        .order("created_at", { ascending: false })
        .limit(PREVIEW_COUNT),
      // Every move as it happened (migration 20261017150000). Missing or
      // unreadable rounds fall back to the history the offer row implies.
      supabase
        .from("offer_rounds")
        .select("round_no, actor_role, kind, amount_cents, created_at, actor_task_id")
        .eq("offer_id", id)
        .order("round_no"),
      // The buyer's offers on this part, across every thread: 3 in all,
      // counter-backs and below-minimum attempts included.
      supabase
        .from("offer_rounds")
        .select("id", { count: "exact", head: true })
        .eq("listing_id", listing.id)
        .eq("buyer_id", offer.buyer_id)
        .eq("actor_role", "buyer")
        .in("kind", ["offer", "counter", "below_minimum"]),
      // The viewer's own agent limits here (owner-only, A2), for the one-line
      // reasons under their agent's turns, and — while it is live — the
      // buyer's "Stop negotiating for me". The other side's never load.
      supabase
        .from("agent_mandates")
        .select("id, status, minimum_cents, target_cents, style")
        .eq("owner_id", user.id)
        .eq("listing_id", listing.id)
        .eq("scope", incoming ? "seller" : "buyer")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  // This viewer's read receipt for the thread — scoped to messages
  // addressed to them, safe to call unconditionally on every render.
  await Promise.all([
    markThreadMessagesRead(supabase, user.id, { offerId: id }),
    // Opening the offer deals with what its notification was about.
    markNotificationsReadForPage(supabase, user.id, [`/offers/${id}`]),
  ]);

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
  let checkoutStarted = true;
  if (offer.status === "accepted") {
    const { data: order } = await supabase
      .from("orders")
      .select("id, status, accepted_checkout_shipping")
      .eq("origin_offer_id", offer.id)
      .maybeSingle();
    acceptedOrderId = order?.id ?? null;
    acceptedOrderStatus = order?.status ?? null;
    // Cancel before checkout (A1): settle_seller_cancellation refuses once
    // the buyer's checkout is frozen, so the control only shows before that.
    checkoutStarted = order?.accepted_checkout_shipping != null;
  }
  const canCancelBeforeCheckout =
    incoming && acceptedOrderId != null && acceptedOrderStatus === "pending" && !checkoutStarted;
  // The buyer's running "Negotiate for me" on this part (readiness 64).
  const buyerMandateLive = isBuyer && ownMandate != null && (ownMandate.status === "active" || ownMandate.status === "paused");
  // AG-4: when an agent fixed the price the buyer is about to pay, say so here too.
  const priceLine = isBuyer && offer.status === "accepted" && rounds?.length ? agentPriceLine(rounds as PriceRound[]) : null;
  // "Ask your agent" about this offer (readiness 85), when the chat is open and the member's agent isn't off.
  const agentChat = (await agentTabOpen()) && (await agentStepOpen("chat"));
  const agentMode = agentChat ? await loadAgentMode(user.id) : "act";
  const askDisabled = agentChat && !agentModeAllowsChat(agentMode) ? agentModeRefusal(agentMode) : null;

  const offersCount = await loadOffersNeedingAttention(supabase, user.id);

  const counterpartyName =
    counterparty?.display_name ??
    (counterparty?.username ? `@${counterparty.username}` : "DRVN member");

  // The latest few lines about this offer; the whole relationship lives in
  // the person's conversation (/messages), which this links into.
  const preview = [...(rawMessages ?? [])].reverse();

  // Derived history, oldest first — every column already on the offer row
  // is a timestamped state change. Used only when the rounds can't be read.
  const derived: HistoryEntry[] = [
    {
      label: incoming
        ? `${counterpartyName} made an offer`
        : "You made an offer",
      at: offer.created_at,
      amount: offer.amount_cents,
    },
  ];
  if (offer.countered_at && offer.counter_amount_cents) {
    derived.push({
      label: incoming ? "You countered" : `${counterpartyName} countered`,
      at: offer.countered_at,
      amount: offer.counter_amount_cents,
    });
  }
  if (offer.status === "accepted" && offer.responded_at) {
    derived.push({
      label: incoming ? "You accepted" : `${counterpartyName} accepted`,
      at: offer.responded_at,
    });
  }
  if (offer.status === "declined" && offer.responded_at) {
    derived.push({
      label: incoming ? "You declined" : `${counterpartyName} declined`,
      at: offer.responded_at,
    });
  }
  if (offer.status === "expired" && offer.responded_at) {
    derived.push({ label: "Offer expired unanswered", at: offer.responded_at });
  }
  if (offer.status === "withdrawn") {
    derived.push({
      label: isBuyer
        ? "You withdrew the offer"
        : `${counterpartyName} withdrew the offer`,
      at: offer.updated_at,
    });
  }

  const mandate: HistoryMandate | null = ownMandate
    ? {
        minimumCents: ownMandate.minimum_cents,
        targetCents: ownMandate.target_cents,
        style: ownMandate.style as HistoryMandate["style"],
      }
    : null;
  const history: HistoryEntry[] = rounds?.length
    ? offerHistoryFromRounds(rounds as OfferRound[], { incoming, mandate })
    : derived;

  const live = offer.status === "open" || offer.status === "countered";
  // What the dateline says depends on how the offer stands: a live offer
  // expires; a settled one says what happened and when — never "Expired"
  // with a future date on an offer that was withdrawn or accepted.
  const stamp = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
      : null;
  const settledAt: Record<string, [string, string | null | undefined]> = {
    accepted: ["Accepted", offer.responded_at],
    declined: ["Declined", offer.responded_at],
    withdrawn: ["Withdrawn", offer.updated_at],
    expired: ["Expired", offer.responded_at ?? offer.expires_at],
  };
  const expiresLabel = live
    ? offer.expires_at
      ? `Expires ${stamp(offer.expires_at)}`
      : null
    : settledAt[offer.status]
      ? [settledAt[offer.status][0], stamp(settledAt[offer.status][1])].filter(Boolean).join(" ")
      : null;

  return (
    <div className="wrap">
      {/* A thread is still inside the Offers surface — the family nav keeps
          saying so, and the breadcrumb underneath names the way back. */}

      <SellingNav current="offers" offersCount={offersCount} />
      <Rv as="header" className="pagehead pagehead--task">
        <span className="microlabel">
          <Link href="/offers" className="jumplink">
            Offers
          </Link>{" "}
          / {listing.title}
        </span>
        <h1>
          {incoming ? "Offer on your listing" : "Your offer"}{" "}
          <span className="live-word">{formatPrice(offer.amount_cents)}</span>
        </h1>
      </Rv>
      <Rv className="tile mb-4">
        <Link
          href={`/listings/${listing.id}`}
          className="flex items-center gap-3"
        >
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
            <span className="order__meta">
              {formatPrice(listing.price_cents)} asking
            </span>
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
              <ButtonLink href={`/orders/${acceptedOrderId}/checkout`} variant="live">
                Complete checkout →
              </ButtonLink>
            ) : null}
            <Link href={`/orders/${acceptedOrderId}`} className="jumplink">
              Order {acceptedOrderId.slice(0, 8).toUpperCase()} →
            </Link>
            {priceLine && <span className="order__meta basis-full">{priceLine.text}</span>}
          </div>
        )}
        {buyerMandateLive && ownMandate && (
          <div className="mt-3 grid gap-2 border-t border-[color:var(--rule-soft)] pt-3">
            <StopBuyerAgent mandateId={ownMandate.id} offerId={offer.id} />
            <p className="field__hint !mt-0">
              Your agent is negotiating this part within your max. Stopping it leaves this offer as it stands.
            </p>
          </div>
        )}
        {agentChat && (
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[color:var(--rule-soft)] pt-3">
            <AskAgentButton about={{ kind: "listing", id: listing.id }} disabledReason={askDisabled} />
          </div>
        )}
        {canCancelBeforeCheckout && acceptedOrderId && (
          <div className="mt-3 grid gap-2 border-t border-[color:var(--rule-soft)] pt-3">
            <CancelOrder
              orderId={acceptedOrderId}
              label="Cancel before checkout"
              triggerClassName={buttonClass("destructive", "justify-self-start")}
            />
            <p className="field__hint !mt-0">
              Only until the buyer starts checkout. No mark against you during the beta.
            </p>
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
            <OfferRoundRow
              key={i}
              who={entry.label}
              amount={entry.amount != null ? formatPrice(entry.amount) : undefined}
              when={new Date(entry.at).toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
              viaAgent={entry.viaAgent}
              reason={entry.reason}
            />
          ))}
        </ol>
      </Rv>

      {live && (
        <Rv className="mb-4" stagger={2}>
          <OfferDecision
            offerId={offer.id}
            status={offer.status}
            amountCents={offer.amount_cents}
            counterAmountCents={offer.counter_amount_cents}
            incoming={incoming}
            counterpartyName={counterpartyName}
            expiresAt={offer.expires_at}
            round={offer.round_count}
            buyerOffersLeft={buyerOffersUsed == null ? undefined : Math.max(0, 3 - buyerOffersUsed)}
            block
          />
        </Rv>
      )}

      <Rv className="tile" stagger={3}>
        <TileHead
          label={`Conversation with ${counterpartyName}`}
          end={
            <Link href={`/messages/${offer.id}`} className="jumplink">
              {preview.length ? "Open the conversation →" : `Message ${counterpartyName} →`}
            </Link>
          }
        />
        {preview.length > 0 ? (
          <MessageThread className="mt-2">
            {preview.map((m) => (
              <MessageRun
                key={m.id}
                me={m.sender_id === user.id}
                who={m.sender_id === user.id ? "You" : counterpartyName}
                when={m.created_at}
                whenLabel={new Date(m.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              >
                <MessageBubble>{m.body}</MessageBubble>
              </MessageRun>
            ))}
          </MessageThread>
        ) : (
          <p className="field__hint mt-2">No messages yet. Agents never message the other side; only you do.</p>
        )}
      </Rv>

      <Foot
        left="DRVN — each turn on an offer lasts 72 hours"
        right={<Link href="/offers">All offers →</Link>}
      />
    </div>
  );
}
