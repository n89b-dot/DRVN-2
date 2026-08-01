import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { adminResolveRecovery } from "@/lib/admin/actions";
import { getPaymentsOps } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  reversal_failed: "Reversal failed — reclaim from seller",
  refund_failed: "Refund failed",
  partial_refund_unattributed: "Partial refund needs attribution",
  transfer_after_refund: "Transfer landed after refund",
  negative_balance: "Seller owes the platform",
};

const INTENT_LABEL: Record<string, string> = {
  holding: "holding (clearing window)",
  ready: "ready for transfer",
  processing: "processing",
  blocked_unpayable: "seller not payable — stuck",
  failed: "transfer failed",
};

/**
 * The money nobody would otherwise look for: open recovery cases (failed
 * reversals, unattributed partials), transfers that can't move (sellers who
 * sold before onboarding), and the webhook event stream. Every open row here
 * is a real amount in the wrong place.
 */
export default async function AdminPaymentsPage() {
  const ops = await getPaymentsOps();
  const openRecoveries = ops.recoveries.filter((r) => r.status === "open");
  const closedRecoveries = ops.recoveries.filter((r) => r.status !== "open");

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Payments ops</h1>
        <p className="pagehead__sub">
          Recovery cases stay open until a human closes them with a note. Refunds are driven from
          the order sheet — never the Stripe dashboard, which the database can&apos;t see.
        </p>
      </Rv>

      <section aria-label="Recovery cases" className="mb-8">
        <span className="microlabel">Recovery cases ({openRecoveries.length} open)</span>
        {openRecoveries.length ? (
          <div className="rowlist">
            {openRecoveries.map((r) => (
              <div key={r.id} className="jobrow">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="flex items-baseline gap-2">
                    <span className="chip chip--live">{KIND_LABEL[r.kind] ?? r.kind}</span>
                    {r.amount_cents != null && (
                      <span className="kv font-medium">{formatPrice(r.amount_cents)}</span>
                    )}
                  </span>
                  <span className="order__meta">{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-1 text-[14.5px]">
                  {r.order_id ? (
                    <Link href={`/admin/orders/${r.order_id}`} className="jumplink">
                      {r.orderTitle} →
                    </Link>
                  ) : (
                    "No order attributed"
                  )}
                </p>
                {r.detail && <p className="order__meta mt-0.5">{r.detail}</p>}
                <div className="mt-2">
                  <ActionDialog
                    action={adminResolveRecovery}
                    title="Close recovery case"
                    trigger="Close case"
                    triggerClassName="relbtn !static"
                    hidden={{ recovery_id: r.id }}
                    confirmNote="Recovered = the money is back where it belongs. Written off = the platform absorbs it, on record."
                    fields={[
                      {
                        kind: "select",
                        name: "outcome",
                        label: "Outcome",
                        options: [
                          { value: "recovered", label: "Recovered" },
                          { value: "written_off", label: "Written off" },
                        ],
                      },
                      { kind: "reason", name: "note", label: "What happened" },
                    ]}
                    submitLabel="Close case"
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="tile mt-2">
            <span className="microlabel">Open</span>
            <p className="order__meta">Nothing open. Failed reversals and refunds land here.</p>
          </div>
        )}
        {closedRecoveries.length > 0 && (
          <details className="mt-3">
            <summary className="jumplink cursor-pointer">
              {closedRecoveries.length} closed case{closedRecoveries.length === 1 ? "" : "s"}
            </summary>
            <div className="rowlist mt-2">
              {closedRecoveries.map((r) => (
                <div key={r.id} className="jobrow">
                  <p className="order__meta">
                    {KIND_LABEL[r.kind] ?? r.kind} · {r.status} ·{" "}
                    {r.amount_cents != null ? formatPrice(r.amount_cents) : "—"} — “
                    {r.resolution_note}”
                  </p>
                </div>
              ))}
            </div>
          </details>
        )}
      </section>

      <section aria-label="Transfer pipeline" className="mb-8">
        <span className="microlabel">Transfer pipeline ({ops.stuckIntents.length})</span>
        {ops.stuckIntents.length ? (
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Seller</th>
                <th scope="col" className="text-right">
                  Net owed
                </th>
                <th scope="col">State</th>
                <th scope="col">Available</th>
              </tr>
            </thead>
            <tbody>
              {ops.stuckIntents.map((i) => (
                <tr key={i.order_id}>
                  <td>
                    <Link href={`/admin/orders/${i.order_id}`} className="order__name block hover:text-live">
                      {i.orderTitle}
                    </Link>
                    <span className="order__meta">{i.order_id.slice(0, 8)}</span>
                  </td>
                  <td>{i.seller?.username ?? "—"}</td>
                  <td className="ledger__num" data-label="Net owed">
                    {formatPrice(i.amount_cents)}
                  </td>
                  <td>
                    <span
                      className={cx(
                        "chip",
                        ["blocked_unpayable", "failed"].includes(i.status) ? "chip--live" : "chip--spent"
                      )}
                    >
                      {INTENT_LABEL[i.status] ?? i.status}
                    </span>
                    {i.last_error && <span className="order__meta mt-0.5 block">{i.last_error}</span>}
                  </td>
                  <td className="order__meta">
                    {i.available_at ? new Date(i.available_at).toLocaleDateString() : "on delivery"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="tile mt-2">
            <span className="microlabel">Pipeline</span>
            <p className="order__meta">
              No held or stuck transfers. Sellers who sold before finishing payout onboarding
              appear here instead of vanishing into an error log.
            </p>
          </div>
        )}
      </section>

      <section aria-label="Webhook events">
        <span className="microlabel">Recent webhook events</span>
        {ops.recentEvents.length ? (
          <div className="rowlist">
            {ops.recentEvents.map((e) => (
              <div key={e.id} className="jobrow">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="kv">{e.type}</span>
                  <span className="order__meta">
                    {new Date(e.receivedAt).toLocaleString()} ·{" "}
                    {e.processedAt ? "processed" : "received"}
                  </span>
                </div>
                <p className="order__meta mt-0.5">{e.id}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="tile mt-2">
            <span className="microlabel">Stream</span>
            <p className="order__meta">
              No events recorded yet — the dedup table fills as Stripe delivers.
            </p>
          </div>
        )}
      </section>
    </>
  );
}
