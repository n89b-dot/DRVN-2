import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { KeyValueTable } from "@/components/ui";
import {
  adminForceRefund,
  adminResolveForSeller,
} from "@/lib/admin/actions";
import { getOrderDetail } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx } from "@/lib/format";

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

const STATUS_CHIP: Record<string, string> = {
  disputed: "chip--live",
  refunded: "chip--spent",
  paid: "chip--ok",
  shipped: "chip--ok",
  delivered: "chip--ok",
  completed: "chip--ok",
};

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
  const { order, items, payment, transferIntent, buyer, seller, messages, audit } = detail;

  const refundable = order.total_cents - order.refunded_cents;
  const disputed = order.status === "disputed";

  return (
    <>
      <Rv as="header" className="pagehead">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1>{items[0]?.title ?? "Order"}</h1>
          <span className={cx("chip", STATUS_CHIP[order.status] ?? "chip--spent")}>
            {order.status}
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
          </p>
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
              {
                label: "Transferred to seller",
                value: order.transfer_reference
                  ? `${formatPrice(order.total_cents - order.platform_fee_cents)} · ${days(order.transferred_at)}`
                  : transferIntent
                    ? (INTENT_STATE[transferIntent.status] ?? transferIntent.status)
                    : "not yet",
              },
              { label: "Platform fee", value: formatPrice(order.platform_fee_cents) },
              {
                label: "Refunded",
                value:
                  order.refunded_cents > 0
                    ? `${formatPrice(order.refunded_cents)} (fee share ${formatPrice(order.platform_fee_refunded_cents)})`
                    : "—",
              },
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
                <Link href={`/admin/users?q=${buyer.username ?? ""}`} className="hover:text-live">
                  {buyer.displayName ?? buyer.username ?? buyer.id}
                </Link>
                {buyer.suspendedAt && <span className="chip chip--live ml-2">suspended</span>}
              </p>
              <p className="order__meta mt-1">
                {buyer.orderCount} orders · {buyer.disputeCount} disputes
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
                <Link href={`/admin/users?q=${seller.username ?? ""}`} className="hover:text-live">
                  {seller.displayName ?? seller.username ?? seller.id}
                </Link>
                {seller.suspendedAt && <span className="chip chip--live ml-2">suspended</span>}
              </p>
              <p className="order__meta mt-1">
                {seller.salesCount} sales · {seller.disputeCount} disputes ·{" "}
                {seller.payoutsEnabled ? "payouts enabled" : "payouts NOT enabled"}
              </p>
            </>
          ) : (
            <p className="order__meta">Account deleted</p>
          )}
        </section>
      </div>

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
                <p className="mt-0.5 text-[14.5px]">{m.body}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="order__meta mt-2">No messages on this order.</p>
        )}
      </section>

      {/* ---------- Prior admin actions ---------- */}
      <section aria-label="Audit trail">
        <span className="microlabel">Admin actions on this order</span>
        {audit.length ? (
          <div className="rowlist">
            {audit.map((a) => (
              <div key={a.id} className="jobrow">
                <p className="order__meta">
                  {a.action} · {new Date(a.created_at).toLocaleString()}
                </p>
                <p className="mt-0.5 text-[14.5px]">“{a.reason}”</p>
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
