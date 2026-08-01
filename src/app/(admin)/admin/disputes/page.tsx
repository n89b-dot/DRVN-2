import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { SheetTabs } from "@/components/ui";
import { getDisputeQueue, DISPUTE_SLA_DAYS, type DisputeQueueRow } from "@/lib/admin/queries";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx } from "@/lib/format";

export const dynamic = "force-dynamic";

const CATEGORY_LABEL: Record<string, string> = {
  item_not_received: "Not received",
  item_not_as_described: "Not as described",
  damaged_in_transit: "Damaged",
  wrong_item: "Wrong item",
  other: "Other",
};

function DisputeTable({ rows, empty }: { rows: DisputeQueueRow[]; empty: string }) {
  if (!rows.length) {
    return (
      <div className="tile mt-4">
        <span className="microlabel">Queue</span>
        <p className="order__meta">{empty}</p>
      </div>
    );
  }
  return (
    <table className="ledger mt-4">
      <thead>
        <tr>
          <th scope="col">Order</th>
          <th scope="col">Category</th>
          <th scope="col">Buyer</th>
          <th scope="col">Seller</th>
          <th scope="col" className="text-right">
            Value
          </th>
          <th scope="col" className="text-right">
            Age
          </th>
          <th scope="col">State</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.orderId}>
            <td>
              <Link
                href={`/admin/orders/${r.orderId}`}
                className="order__name block transition-colors hover:text-live"
              >
                {r.title}
              </Link>
              <span className="order__meta">{r.orderId.slice(0, 8)}</span>
            </td>
            <td>
              <span className="chip chip--spent">{CATEGORY_LABEL[r.category ?? "other"]}</span>
              {r.reason && (
                <span className="order__meta mt-1 block max-w-[28ch] truncate" title={r.reason}>
                  “{r.reason}”
                </span>
              )}
            </td>
            <td>{r.buyer?.username ?? r.buyer?.displayName ?? "—"}</td>
            <td>{r.seller?.username ?? r.seller?.displayName ?? "—"}</td>
            <td className="ledger__num" data-label="Value">
              {formatPrice(r.totalCents)}
            </td>
            <td className={cx("ledger__num", r.overSla && "text-live")} data-label="Age">
              {r.ageDays}d
            </td>
            <td>
              {r.overSla ? (
                <span className="chip chip--live">Over SLA</span>
              ) : r.refundOfferCents ? (
                <span className="chip chip--ok">Offer out</span>
              ) : r.transferred ? (
                <span className="chip chip--spent">Paid out</span>
              ) : (
                <span className="chip chip--spent">Funds held</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * The dispute queue — oldest first, because the oldest one is the one
 * stranding someone's money. "Over SLA" marks silence past the escalation
 * window; those are the rows this console exists for.
 */
export default async function AdminDisputesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const [open, resolved] = await Promise.all([
    getDisputeQueue("open"),
    getDisputeQueue("resolved"),
  ]);

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Disputes</h1>
        <p className="pagehead__sub">
          Oldest first. Rows past {DISPUTE_SLA_DAYS} days of silence are flagged — open the order
          to force a refund or resolve for the seller.
        </p>
      </Rv>

      <SheetTabs
        label="Dispute queues"
        // resolveTab lives in a client module and can't be called here (Next 16).
        initialTab={view === "resolved" ? "resolved" : "open"}
        tabs={[
          {
            key: "open",
            label: "Open",
            count: open.length,
            live: open.some((r) => r.overSla),
            panel: <DisputeTable rows={open} empty="No open disputes. The queue is clear." />,
          },
          {
            key: "resolved",
            label: "Resolved",
            panel: (
              <DisputeTable rows={resolved} empty="Nothing resolved yet — history lands here." />
            ),
          },
        ]}
      />
    </>
  );
}
