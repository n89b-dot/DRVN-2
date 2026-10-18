import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { KeyValueTable } from "@/components/ui";
import { ConditionSummary, conditionMaterialDiff, type ConditionSnapshot } from "@/components/condition-summary";
import {
  adminAddNote,
  adminForceRefund,
  adminMessageParties,
  adminResolveForSeller,
} from "@/lib/admin/actions";
import { OfferRound } from "@/components/commerce";
import { getOrderDetail } from "@/lib/admin/queries";
import { createAdminClient } from "@/lib/supabase/admin";
import { ORDER_STATUS_CHIP } from "@/lib/admin/presentation";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx, isPersonStub, personLabel, plural } from "@/lib/format";

import { ActionDialog } from "../../_components/action-dialog";

export const dynamic = "force-dynamic";

const INTENT_STATE: Record<string, string> = {
  holding: "held — clearing window",
  ready: "due — next worker pass",
  processing: "transferring now",
  blocked_unpayable: "stuck — seller not payable",
  failed: "transfer failed — see Payments",
  cancelled: "no transfer — cancelled",
};

/**
 * What actually moved to the seller: the amount the transfer was dispatched
 * with (or, for intents from before dispatch amounts were frozen, the intent's
 * amount). total − fee is what the seller was owed before refunds and label
 * costs, not what was sent, so it is never shown as the transfer.
 */
function transferredValue(
  order: { transfer_reference: string | null; transferred_at: string | null },
  intent: { status: string; amount_cents: number; dispatch_amount_cents: number | null; transfer_reference: string | null } | null
): string {
  if (intent?.status === "transferred") {
    return `${formatPrice(intent.dispatch_amount_cents ?? intent.amount_cents)} · ${days(order.transferred_at)}`;
  }
  if (order.transfer_reference) {
    // A transfer recorded on the order with no intent row predates intents;
    // its amount isn't held locally — Stripe has it under the reference.
    return `Transferred (amount not recorded) · ${order.transfer_reference} · ${days(order.transferred_at)}`;
  }
  if (intent) return INTENT_STATE[intent.status] ?? intent.status;
  return "Not transferred";
}

function days(iso: string | null): string {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d === 0 ? "today" : `${d}d ago`;
}

/**
 * One order, everything an intervention needs on a single sheet: the money
 * state (charged / transferred / refunded), the dispute block, both parties
 * with their history, the order thread, and the action rail. The refund
 * button drives lib/payments/refunds.ts — reversal, fee reconciliation and
 * recovery cases included — never the Stripe dashboard.
 */
export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const { order, items, payment, transferIntent, buyer, seller, messages, evidence, audit, timeline } =
    detail;

  // Agent provenance (plan: admin controls 4): an order made from an offer
  // shows every round, which were the agent's, and the mandate version each
  // was made under, so "the seller didn't mean it" can be checked.
  const { data: originOffer } = await createAdminClient().from("orders").select("origin_offer_id").eq("id", id).maybeSingle();
  const { data: rounds } = originOffer?.origin_offer_id
    ? await createAdminClient()
        .from("offer_rounds")
        .select("round_no, actor_role, kind, amount_cents, created_at, actor_task_id, mandate_version")
        .eq("offer_id", originOffer.origin_offer_id)
        .order("round_no")
    : { data: null };

  const refundable = order.total_cents - order.refunded_cents;
  const disputed = order.status === "disputed";

  return (
    <>
      <nav aria-label="Breadcrumb" className="mt-2">
        <Link href="/admin/orders" className="jumplink">
          ← Orders
        </Link>
      </nav>

      <Rv as="header" className="pagehead">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1>{items[0]?.title ?? `Order ${order.id.slice(0, 8)}`}</h1>
          {/* Same exception-first rule as the orders table: nominal states are
              plain text, only actionable ones get a chip. */}
          <span
            className={
              ORDER_STATUS_CHIP[order.status]
                ? cx("chip", ORDER_STATUS_CHIP[order.status])
                : "status-plain"
            }
          >
            {order.status.replace("_", " ")}
          </span>
        </div>
        <p className="pagehead__sub">
          {order.id} · placed {days(order.created_at)} · {formatPrice(order.total_cents)}
        </p>
      </Rv>

      {disputed && (
        <div className="alert alert--live mb-6" role="status">
          <span className="alert__ico" aria-hidden="true">
            ●
          </span>
          <h4>
            Dispute — {(order.dispute_category ?? "other").replaceAll("_", " ")} · opened{" "}
            {days(order.disputed_at)}
          </h4>
          <p>
            {order.dispute_reason ?? "No reason text given."}
            {order.refund_offer_cents
              ? ` The seller has offered ${formatPrice(order.refund_offer_cents)} — awaiting the buyer.`
              : ""}
            {order.dispute_escalated_at
              ? order.dispute_escalated_by
                ? " Escalated by the buyer — support owes this case a decision."
                : " Escalated by the SLA sweep."
              : ""}
          </p>
          {evidence.length > 0 && (
            <div className="col-span-full mt-2">
              <span className="microlabel">Evidence ({evidence.length})</span>
              <div className="thumbs !mt-1">
                {evidence.map((e) => (
                  <a key={e.id} href={e.url} target="_blank" rel="noreferrer" className="thumb" title={e.note ?? undefined}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={e.url} alt={e.note ?? "Dispute evidence"} className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="deck deck--two mb-8">
        {/* ---------- Money ---------- */}
        <section className="tile" aria-label="Money state">
          <span className="microlabel">Money</span>
          <KeyValueTable
            rows={[
              { label: "Charged", value: payment ? formatPrice(payment.amount_cents) : "—" },
              { label: "Payment ref", value: payment?.provider_reference ?? "—" },
              { label: "Transferred to seller", value: transferredValue(order, transferIntent) },
              { label: "Platform fee", value: formatPrice(order.platform_fee_cents) },
              {
                label: "Refunded",
                value:
                  order.refunded_cents > 0
                    ? `${formatPrice(order.refunded_cents)} (fee share ${formatPrice(order.platform_fee_refunded_cents)})`
                    : "—",
              },
              ...(order.refund_offer_cents
                ? [
                    {
                      label: "Seller's refund offer",
                      value: `${formatPrice(order.refund_offer_cents)}${order.refund_offered_at ? ` · ${days(order.refund_offered_at)}` : ""} — awaiting buyer`,
                    },
                  ]
                : []),
              ...(order.dispute_outcome
                ? [
                    {
                      label: "Dispute outcome",
                      value: `${order.dispute_outcome.replace(/_/g, " ")}${order.dispute_resolved_at ? ` · ${days(order.dispute_resolved_at)}` : ""}`,
                    },
                  ]
                : []),
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {refundable > 0 && payment?.provider_reference ? (
              <ActionDialog
                action={adminForceRefund}
                title="Force refund"
                trigger={disputed ? "Force refund" : "Refund order"}
                triggerClassName="btn btn--live"
                danger
                hidden={{ order_id: order.id }}
                confirmNote={
                  order.transfer_reference
                    ? `Refunds the buyer AND reverses the seller's transfer proportionally. ${formatPrice(refundable)} remains refundable.`
                    : `Refunds the buyer. No transfer has been made yet, so nothing needs reclaiming. ${formatPrice(refundable)} remains refundable.`
                }
                fields={[
                  {
                    kind: "amount",
                    label: `Amount (${order.currency})`,
                    hint: "Blank = refund everything left.",
                  },
                  { kind: "reason" },
                ]}
                submitLabel="Refund"
              />
            ) : (
              <span className="chip chip--spent">
                {payment?.provider_reference ? "Fully refunded" : "No captured payment"}
              </span>
            )}
            {disputed && (
              <ActionDialog
                action={adminResolveForSeller}
                title="Resolve for seller"
                trigger="Resolve for seller"
                triggerClassName="btn"
                hidden={{ order_id: order.id }}
                confirmNote="Closes the dispute with no refund and restores the order to its pre-dispute status. Both parties are notified."
                fields={[{ kind: "reason" }]}
                submitLabel="Close dispute"
              />
            )}
          </div>
        </section>

        {/* ---------- Fulfilment ---------- */}
        <section className="tile" aria-label="Fulfilment">
          <span className="microlabel">Fulfilment</span>
          <KeyValueTable
            rows={[
              { label: "Items", value: items.map((i) => i.title ?? "Part").join(", ") || "—" },
              {
                label: "Shipped",
                value: order.shipped_at
                  ? `${days(order.shipped_at)} · ${[order.carrier, order.tracking_number].filter(Boolean).join(" ")}`
                  : "not yet",
              },
              { label: "Delivered", value: order.delivered_at ? days(order.delivered_at) : "not yet" },
              {
                label: "Ship to",
                value: order.is_collection
                  ? "Collection"
                  : [order.ship_name, order.ship_city, order.ship_postcode].filter(Boolean).join(", ") || "—",
              },
            ]}
          />
        </section>

        {/* ---------- Parties ---------- */}
        <section className="tile" aria-label="Buyer">
          <span className="microlabel">Buyer</span>
          {buyer ? (
            <>
              <p className="order__name">
                <Link
                  href={`/admin/users/${buyer.id}`}
                  className={cx("hover:text-live", isPersonStub(buyer) && "person--stub")}
                >
                  {personLabel(buyer)}
                </Link>
                {buyer.suspendedAt && <span className="chip chip--danger ml-2">suspended</span>}
              </p>
              <p className="order__meta mt-1">
                {plural(buyer.orderCount, "order")} · {plural(buyer.disputeCount, "dispute")}
              </p>
            </>
          ) : (
            <p className="order__meta">Account deleted</p>
          )}
        </section>

        <section className="tile" aria-label="Seller">
          <span className="microlabel">Seller</span>
          {seller ? (
            <>
              <p className="order__name">
                <Link
                  href={`/admin/users/${seller.id}`}
                  className={cx("hover:text-live", isPersonStub(seller) && "person--stub")}
                >
                  {personLabel(seller)}
                </Link>
                {seller.suspendedAt && <span className="chip chip--danger ml-2">suspended</span>}
              </p>
              <p className="order__meta mt-1">
                {plural(seller.salesCount, "sale")} · {plural(seller.disputeCount, "dispute")} ·{" "}
                {seller.payoutsEnabled ? "payouts enabled" : "payouts NOT enabled"}
              </p>
            </>
          ) : (
            <p className="order__meta">Account deleted</p>
          )}
        </section>
      </div>

      {/* ---------- Condition: purchased vs current ---------- */}
      {items.some((i) => i.conditionSnapshot || i.currentListing) && (
        <section aria-label="Condition comparison" className="mb-8">
          <span className="microlabel">Condition — purchased vs current</span>
          <div className="deck deck--two mt-2">
            {items.map((item) => {
              const purchased = item.conditionSnapshot as ConditionSnapshot;
              const current: ConditionSnapshot = item.currentListing
                ? {
                    condition: item.currentListing.condition,
                    grade: item.currentListing.grade,
                    checklist: item.currentListing.checklist,
                    compatibility_notes: item.currentListing.compatibilityNotes,
                  }
                : null;
              if (!purchased && !current) return null;
              const changed = conditionMaterialDiff(purchased, current);
              const category = item.currentListing?.category;
              const subcategory = item.currentListing?.subcategory;
              return (
                <div key={item.id} className="tile" aria-label={item.title ?? "Item"}>
                  <div className="tile__head">
                    <span className="order__name">{item.title ?? "Part"}</span>
                    {changed && <span className="chip chip--warn">Changed since sale</span>}
                  </div>
                  <div className="mt-3 grid gap-4">
                    <ConditionSummary
                      snapshot={purchased}
                      category={category}
                      subcategory={subcategory}
                      label="Purchased (frozen at sale)"
                    />
                    {item.currentListing ? (
                      <ConditionSummary
                        snapshot={current}
                        category={category}
                        subcategory={subcategory}
                        label={`Current listing${item.currentListing.status !== "active" ? ` (${item.currentListing.status})` : ""}`}
                      />
                    ) : item.listingId ? (
                      <p className="order__meta">Listing no longer exists.</p>
                    ) : (
                      <p className="order__meta">Not linked to a listing.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {rounds?.length ? (
        <section aria-label="Negotiation" className="mb-8">
          <span className="microlabel">
            Negotiation ({rounds.length} round{rounds.length === 1 ? "" : "s"}
            {rounds.some((r) => r.actor_task_id) ? ", agent involved" : ""})
          </span>
          <ol className="rowlist">
            {rounds.map((r) => (
              <OfferRound
                key={r.round_no}
                who={`${r.actor_role === "seller" ? "Seller" : r.actor_role === "buyer" ? "Buyer" : "System"}${r.actor_task_id ? "'s agent" : ""} · ${r.kind}${r.mandate_version != null ? ` · mandate v${r.mandate_version}` : ""}`}
                amount={r.amount_cents != null ? formatPrice(r.amount_cents) : undefined}
                when={new Date(r.created_at).toLocaleString()}
                viaAgent={Boolean(r.actor_task_id)}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {/* ---------- Diagnostics timeline (§AF) ---------- */}
      <section aria-label="Transaction timeline" className="mb-8">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="microlabel !mb-0">Transaction timeline ({timeline.length})</span>
          {order.correlation_id ? (
            <span className="kv" title="Shared by every order in this checkout and stamped into the Stripe PaymentIntent metadata.">
              correlation {order.correlation_id.slice(0, 8)}
            </span>
          ) : null}
        </div>
        {timeline.length ? (
          <div className="rowlist">
            {timeline.map((event, index) => (
              <div key={`${event.at}-${event.label}-${index}`} className="jobrow">
                <p className="order__meta">
                  {new Date(event.at).toLocaleString()} · {event.source}
                </p>
                <p className="mt-0.5 text-body">
                  {event.label}
                  {event.detail ? <span className="text-dim"> — {event.detail}</span> : null}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="order__meta mt-2">No recorded events yet.</p>
        )}
      </section>

      {/* ---------- Thread ---------- */}
      <section aria-label="Order thread" className="mb-8">
        <span className="microlabel">Order thread ({messages.length})</span>
        {messages.length ? (
          <div className="rowlist">
            {messages.map((m) => (
              <div key={m.id} className="jobrow">
                <p className="order__meta">
                  {m.senderId === order.buyer_id ? "Buyer" : m.senderId === order.seller_id ? "Seller" : "System"} ·{" "}
                  {new Date(m.createdAt).toLocaleString()}
                </p>
                <p className="mt-0.5 text-body">{m.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="order__meta mt-2">No messages on this order.</p>
        )}
      </section>

      {/* ---------- Prior admin actions ---------- */}
      <section aria-label="Audit trail">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="microlabel !mb-0">Admin actions on this order</span>
          <span className="flex gap-2">
            <ActionDialog
              action={adminAddNote}
              title="Internal note"
              trigger="Add note"
              triggerClassName="relbtn !static"
              hidden={{ subject_type: "order", subject_id: order.id, order_id: order.id }}
              confirmNote="Internal only — lands in the audit trail below and the audit log, visible to admins alone."
              fields={[{ kind: "reason", label: "Note", placeholder: "What the next admin needs to know" }]}
              submitLabel="Record note"
            />
            <ActionDialog
              action={adminMessageParties}
              title="Message both parties"
              trigger="Message parties"
              triggerClassName="relbtn !static"
              hidden={{ order_id: order.id }}
              confirmNote="Both buyer and seller receive this as a notification from DRVN support. The full text is recorded in the audit log."
              fields={[{ kind: "reason", label: "Message", placeholder: "e.g. We're reviewing this order; please upload photos of the damage." }]}
              submitLabel="Send to both"
            />
          </span>
        </div>
        {audit.length ? (
          <div className="rowlist">
            {audit.map((a) => (
              <div key={a.id} className="jobrow">
                <p className="order__meta">
                  {a.action} · {new Date(a.created_at).toLocaleString()}
                </p>
                <p className="mt-0.5 text-body">“{a.reason}”</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="order__meta mt-2">None. Anything done here is recorded permanently.</p>
        )}
      </section>
    </>
  );
}
