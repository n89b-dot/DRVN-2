import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { SheetTabs } from "@/components/ui";
import { getDisputeQueue, DISPUTE_SLA_DAYS, type DisputeQueueRow } from "@/lib/admin/queries";
import type { DisputeCategory } from "@/lib/database.types";
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

function DisputeTable({
  rows,
  total,
  empty,
}: {
  rows: DisputeQueueRow[];
  total: number;
  empty: string;
}) {
  if (!rows.length) {
    return (
      <div className="tile mt-4">
        <span className="microlabel">Queue</span>
        <p className="order__meta">
          {total > 0 ? `Nothing matches — ${total} in the queue without filters.` : empty}
        </p>
      </div>
    );
  }
  return (
    <>
      <p className="order__meta mt-3">
        Showing {rows.length} of {total}
      </p>
      <table className="ledger mt-2">
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
                <span className="order__meta mt-1 block max-w-[44ch] truncate" title={r.reason}>
                  “{r.reason}”
                </span>
              )}
            </td>
            <td data-label="Buyer">{r.buyer?.username ?? r.buyer?.displayName ?? "—"}</td>
            <td data-label="Seller">{r.seller?.username ?? r.seller?.displayName ?? "—"}</td>
            <td className="ledger__num" data-label="Value">
              {formatPrice(r.totalCents)}
            </td>
            <td className={cx("ledger__num", r.overSla && "text-live")} data-label="Age">
              {r.ageDays}d
            </td>
            <td data-label="State">
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
    </>
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
  searchParams: Promise<{ view?: string; q?: string; category?: string }>;
}) {
  const { view, q, category } = await searchParams;
  const activeCategory = Object.keys(CATEGORY_LABEL).includes(category ?? "")
    ? (category as DisputeCategory)
    : undefined;
  const filters = { query: q, category: activeCategory };
  const [open, resolved] = await Promise.all([
    getDisputeQueue("open", filters),
    getDisputeQueue("resolved", filters),
  ]);

  const linkFor = (cat?: string) =>
    `/admin/disputes?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(cat ? { category: cat } : {}),
      ...(view === "resolved" ? { view } : {}),
    })}`;

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Disputes</h1>
        <p className="pagehead__sub">
          Oldest first. Rows past {DISPUTE_SLA_DAYS} days of silence are flagged — open the order
          to force a refund or resolve for the seller.
        </p>
      </Rv>

      <form method="get" className="search mb-2" role="search">
        <label htmlFor="admin-dispute-q" className="sr-only">
          Search disputes
        </label>
        <input
          id="admin-dispute-q"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Order id, part, buyer or seller"
          className="ctl"
        />
        {activeCategory && <input type="hidden" name="category" value={activeCategory} />}
        {view === "resolved" && <input type="hidden" name="view" value="resolved" />}
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      <div className="filters mb-4" aria-label="Filter by category">
        <Link href={linkFor()} className={cx("fbtn", !activeCategory && "is-on")}>
          All
        </Link>
        {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
          <Link key={key} href={linkFor(key)} className={cx("fbtn", activeCategory === key && "is-on")}>
            {label}
          </Link>
        ))}
      </div>

      <SheetTabs
        label="Dispute queues"
        // resolveTab lives in a client module and can't be called here (Next 16).
        initialTab={view === "resolved" ? "resolved" : "open"}
        tabs={[
          {
            key: "open",
            label: "Open",
            count: open.rows.length,
            live: open.rows.some((r) => r.overSla),
            panel: (
              <DisputeTable
                rows={open.rows}
                total={open.total}
                empty="No open disputes. The queue is clear."
              />
            ),
          },
          {
            key: "resolved",
            label: "Resolved",
            panel: (
              <DisputeTable
                rows={resolved.rows}
                total={resolved.total}
                empty="Nothing resolved yet — history lands here."
              />
            ),
          },
        ]}
      />
    </>
  );
}
