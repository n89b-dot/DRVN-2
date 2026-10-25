import Link from "next/link";

import { Rv } from "@/components/livesheet";
import {
  adminCancelCarryPayout,
  adminReplayWebhookEvent,
  adminReplaceFailedRefund,
  adminResolveRecovery,
  adminRetryCarryPayout,
  adminRunTransferWorker,
} from "@/lib/admin/actions";
import { payoutAlertChip, refundChip, transferChip } from "@/lib/admin/presentation";
import { getPaymentsOps } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx, isPersonStub, personLabel } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";
import { ConsoleEmpty } from "../_components/console-empty";
import { PayloadViewer } from "../_components/payload-viewer";
import { ObjectRow, SearchField } from "@/components/ui";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  reversal_failed: "Reversal failed — reclaim from seller",
  refund_failed: "Refund failed",
  partial_refund_unattributed: "Partial refund needs attribution",
  transfer_after_refund: "Transfer landed after refund",
  capture_unresolved: "Captured payment needs reconciliation",
  transfer_unresolved: "Seller transfer needs reconciliation",
  refund_lifecycle_unresolved: "Refund status needs reconciliation",
  refund_late_failure: "Refund failed after settlement",
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
export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const ops = await getPaymentsOps({ query: q });
  const openRecoveries = ops.recoveries.filter((r) => r.status === "open");
  const closedRecoveries = ops.recoveries.filter((r) => r.status !== "open");

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Payments ops</h1>
        <p className="pagehead__sub">
          Recovery cases need an audited resolution. Late refund failures require verified seller
          recredit and a settled replacement buyer refund before they can close.
        </p>
      </Rv>

      <form method="get" className="finder mb-6" role="search">
        <div className="finder__main">
          <SearchField label="Search payments ops" defaultValue={q ?? ""} placeholder="Order id, part title, or seller…" />
        </div>
      </form>

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
                <p className="mt-1 text-body">
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
                  {r.kind === "refund_late_failure" && <ActionDialog
                    action={adminReplaceFailedRefund}
                    title="Replace failed buyer refund"
                    trigger="Replace refund"
                    triggerClassName="relbtn !static"
                    hidden={{recovery_id: r.id}}
                    confirmNote="This sends the failed refund amount to the buyer again. Verify any seller repayment first. Repeated submissions resume the recorded replacement; the case remains open until settlement is confirmed."
                    fields={[
                      {kind: "text", name: "recredit_transfer_reference", label: "Seller recredit transfer ID", hint: "Required for a positive seller obligation unless already verified."},
                      {kind: "reason", name: "note", label: "Reason for replacement"},
                    ]}
                    submitLabel="Issue replacement refund"
                  />}
                  <ActionDialog
                    action={adminResolveRecovery}
                    title="Close recovery case"
                    trigger="Close case"
                    triggerClassName="relbtn !static"
                    hidden={{ recovery_id: r.id }}
                    confirmNote={r.kind === "refund_late_failure" ? "Seller repayment alone does not settle this case. The replacement buyer refund must also be completed and linked to the failed refund." : "Recovered = the money is back where it belongs. Written off = the platform absorbs it, on record."}
                    fields={[
                      ...(r.kind === "refund_late_failure" ? [{kind: "text" as const, name: "recredit_transfer_reference", label: "Seller recredit transfer ID", hint: "Required when the seller is owed a recredit. DRVN verifies the amount, recipient and refund identity with Stripe."}] : []),
                      {
                        kind: "select",
                        name: "outcome",
                        label: "Outcome",
                        // Never answered by default: an operator chooses
                        // recovered or written off, or the form won't submit.
                        placeholder: "Choose an outcome",
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
          <ConsoleEmpty
            className="mt-2"
            mark="—"
            title="Nothing open"
            body="Failed reversals and refunds land here."
          />
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
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="microlabel !mb-0">Transfer pipeline ({ops.stuckIntents.length})</span>
          <ActionDialog
            action={adminRunTransferWorker}
            title="Run background money jobs"
            trigger="Run worker now"
            triggerClassName="relbtn !static"
            hidden={{}}
            confirmNote="Runs the scheduled money pass now: payouts, expired holds, refunds, returns, disputes, alerts and receipts. Safe to repeat: one transfer per order, ever."
            fields={[{ kind: "reason", placeholder: "e.g. seller finished onboarding, paying out stuck funds" }]}
            submitLabel="Run worker"
          />
        </div>
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
                  <td data-label="Seller">
                    <span className={cx(isPersonStub(i.seller) && "person--stub")}>
                      {personLabel(i.seller)}
                    </span>
                  </td>
                  <td className="ledger__num" data-label="Net owed">
                    {formatPrice(i.amount_cents)}
                  </td>
                  <td data-label="State">
                    {transferChip(i.status) ? (
                      <span className={cx("chip", transferChip(i.status))}>
                        {INTENT_LABEL[i.status] ?? i.status}
                      </span>
                    ) : (
                      <span className="status-plain">{INTENT_LABEL[i.status] ?? i.status}</span>
                    )}
                    {i.last_error && <span className="order__meta mt-0.5 block">{i.last_error}</span>}
                  </td>
                  <td className="order__meta" data-label="Available">
                    {i.available_at ? new Date(i.available_at).toLocaleDateString() : "on delivery"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ConsoleEmpty
            className="mt-2"
            mark="—"
            title="No held or stuck transfers"
            body="Sellers who sold before finishing payout onboarding appear here instead of vanishing into an error log."
          />
        )}
      </section>

      <section aria-label="Seller credit payouts" className="mb-8">
        <span className="microlabel">Seller credit payouts stuck ({ops.stuckCarryPayouts.length})</span>
        {ops.stuckCarryPayouts.length ? (
          <div className="rowlist">
            {ops.stuckCarryPayouts.map((p) => (
              <ObjectRow
                key={p.id}
                title={
                  <>
                    <span className={cx(isPersonStub(p.seller) && "person--stub")}>{personLabel(p.seller)}</span>
                    {" · "}
                    <span className="kv">{formatPrice(p.amount_cents)}</span>
                  </>
                }
                meta={
                  <>
                    {p.attempts} attempt{p.attempts === 1 ? "" : "s"} · since {new Date(p.created_at).toLocaleDateString()} ·{" "}
                    {p.provider_call_may_have_occurred ? "Stripe may have been called" : "nothing sent"} · {p.id.slice(0, 8)}
                    {p.last_error && <span className="mt-0.5 block">{p.last_error}</span>}
                  </>
                }
                actions={
                  <>
                    <ActionDialog
                      action={adminRetryCarryPayout}
                      title="Retry seller credit payout"
                      trigger="Retry"
                      triggerClassName="relbtn !static"
                      hidden={{ payout_id: p.id }}
                      confirmNote={
                        p.provider_call_may_have_occurred
                          ? `Puts the payout back in the queue. Stripe may already hold a transfer in group carry-payout:${p.id}; the worker looks it up first and completes rather than sends again.`
                          : "Puts the payout back in the queue with its attempts reset. The next worker pass sends it; it fails back here if the cause remains."
                      }
                      fields={[{ kind: "reason", placeholder: "e.g. platform balance topped up, seller finished onboarding" }]}
                      submitLabel="Queue again"
                    />
                    <ActionDialog
                      action={adminCancelCarryPayout}
                      title="Cancel seller credit payout"
                      trigger="Cancel"
                      triggerClassName="relbtn !static"
                      triggerDisabled={p.provider_call_may_have_occurred}
                      hidden={{ payout_id: p.id }}
                      danger
                      confirmNote={`Ends this payout and puts ${formatPrice(p.amount_cents)} back on the seller's credit balance, where the next payout run or transfer collects it. Only possible while nothing was sent to Stripe.`}
                      fields={[{ kind: "reason", placeholder: "e.g. account closing, credit to be settled on the next transfer" }]}
                      submitLabel="Cancel payout"
                    />
                  </>
                }
              />
            ))}
          </div>
        ) : (
          <ConsoleEmpty
            className="mt-2"
            mark="—"
            title="No stuck credit payouts"
            body="A seller credit the worker gave up paying out (20261008100100) lands here with Retry and Cancel instead of only an alert."
          />
        )}
      </section>

      <section aria-label="Refund operations" className="mb-8">
        <span className="microlabel">Refund operations ({ops.refundOps.length} not completed)</span>
        {ops.refundOps.length ? (
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col" className="text-right">Amount</th>
                <th scope="col">State</th>
                <th scope="col">Requested by</th>
                <th scope="col">Last error</th>
              </tr>
            </thead>
            <tbody>
              {ops.refundOps.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/orders/${r.order_id}`} className="order__name block hover:text-live">
                      {r.orderTitle}
                    </Link>
                    <span className="order__meta">{r.id.slice(0, 8)}</span>
                  </td>
                  <td className="ledger__num" data-label="Amount">
                    {formatPrice(r.amount_cents)}
                  </td>
                  <td data-label="State">
                    {refundChip(r.status) ? (
                      <span className={cx("chip", refundChip(r.status))}>
                        {r.status.replaceAll("_", " ")}
                      </span>
                    ) : (
                      <span className="status-plain">{r.status.replaceAll("_", " ")}</span>
                    )}
                    {r.attempts > 0 && (
                      <span className="order__meta mt-0.5 block">attempt {r.attempts}</span>
                    )}
                  </td>
                  <td className="order__meta" data-label="Requested by">{r.requested_by}</td>
                  <td className="order__meta" data-label="Last error">{r.last_error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <ConsoleEmpty
            className="mt-2"
            mark="—"
            title="No refund operations in flight"
            body="Every refund is a durable state machine (0026) — anything a crash abandons appears here and is resumed by the worker pass."
          />
        )}
      </section>

      <section aria-label="Alert delivery" className="mb-8">
        <span className="microlabel">Alert delivery backlog ({ops.alertBacklog.length})</span>
        {ops.alertBacklog.length ? (
          <div className="rowlist">
            {ops.alertBacklog.map((alertRow) => (
              <div key={alertRow.id} className="jobrow">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="order__name">{alertRow.title}</span>
                  {payoutAlertChip(alertRow.status) ? (
                    <span className={cx("chip", payoutAlertChip(alertRow.status))}>
                      {alertRow.status}
                    </span>
                  ) : (
                    <span className="status-plain">{alertRow.status}</span>
                  )}
                </div>
                <p className="order__meta">
                  {alertRow.kind} · {new Date(alertRow.created_at).toLocaleString()}
                  {alertRow.attempts > 0 ? ` · ${alertRow.attempts} attempts` : ""}
                  {alertRow.status === "disabled"
                    ? " · ADMIN_ALERT_WEBHOOK_URL was unset when this was raised"
                    : ""}
                  {alertRow.last_error ? ` — ${alertRow.last_error}` : ""}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <ConsoleEmpty
            className="mt-2"
            mark="—"
            title="Nothing undelivered"
            body="Alerts are durable outbox rows (0026): delivery failures retry with backoff here instead of vanishing."
          />
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
                  <span className="flex items-baseline gap-2">
                    <span className="order__meta">
                      {new Date(e.receivedAt).toLocaleString()} ·{" "}
                      {e.processedAt ? "processed" : "received"}
                    </span>
                    <ActionDialog
                      action={adminReplayWebhookEvent}
                      title={`Replay ${e.type}`}
                      trigger="Replay"
                      triggerClassName="relbtn !static"
                      hidden={{ event_id: e.id }}
                      confirmNote={
                        e.payload
                          ? "Re-runs this event through the same idempotent handlers the live webhook uses. Already-applied effects are skipped by design."
                          : "This event was recorded before payload retention — there is nothing stored to replay."
                      }
                      fields={[{ kind: "reason" }]}
                      submitLabel="Replay event"
                    />
                  </span>
                </div>
                <p className="order__meta mt-0.5">{e.id}</p>
                {e.payload && (
                  <details className="mt-1">
                    <summary className="jumplink cursor-pointer">payload</summary>
                    <PayloadViewer payload={e.payload} eventType={e.type} />
                  </details>
                )}
              </div>
            ))}
          </div>
        ) : (
          <ConsoleEmpty
            className="mt-2"
            mark="—"
            title="No events recorded yet"
            body="The dedup table fills as Stripe delivers."
          />
        )}
      </section>
    </>
  );
}
