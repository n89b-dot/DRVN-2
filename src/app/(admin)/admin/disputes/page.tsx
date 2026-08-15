import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { SheetTabs } from "@/components/ui";
import { getDisputeQueue, DISPUTE_SLA_DAYS, DISPUTES_PAGE_SIZE, type DisputeQueueRow } from "@/lib/admin/queries";
import type { DisputeCategory } from "@/lib/database.types";
import { gradeLabel } from "@/lib/marketplace/grading";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx, isPersonStub, personLabel } from "@/lib/format";

import { ConsoleEmpty } from "../_components/console-empty";
import { Pager } from "../_components/pager";

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
  page,
  hasMore,
  pagerHref,
}: {
  rows: DisputeQueueRow[];
  total: number;
  empty: string;
  page: number;
  hasMore: boolean;
  pagerHref: (page: number) => string;
}) {
  if (!rows.length) {
    return (
      <ConsoleEmpty
        className="mt-4"
        mark={total > 0 ? "⌕" : "—"}
        title={total > 0 ? "Nothing matches" : "Queue clear"}
        body={total > 0 ? `${total} in the queue without filters.` : empty}
        actionHref={total > 0 ? "/admin/disputes" : undefined}
        actionLabel="Clear the filters"
      />
    );
  }
  return (
    <>
      <p className="order__meta mt-3">
        Showing {page * DISPUTES_PAGE_SIZE + 1}–{page * DISPUTES_PAGE_SIZE + rows.length} of {total}
      </p>
      <table className="ledger mt-2">
      <thead>
        <tr>
          <th scope="col">Order</th>
          <th scope="col">Category</th>
          <th scope="col">Grade</th>
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
              {/* Id-fallback titles already carry the prefix — repeating it says nothing. */}
              {r.title !== `Order ${r.orderId.slice(0, 8)}` && (
                <span className="order__meta">{r.orderId.slice(0, 8)}</span>
              )}
            </td>
            <td>
              <span className="status-plain">{CATEGORY_LABEL[r.category ?? "other"]}</span>
              {r.reason && (
                <span className="order__meta mt-1 block max-w-[44ch] truncate" title={r.reason}>
                  “{r.reason}”
                </span>
              )}
            </td>
            <td data-label="Purchased grade">
              {r.purchasedGrade ? (
                <span className="chip">{gradeLabel(r.purchasedGrade)}</span>
              ) : (
                <span className="order__meta">—</span>
              )}
            </td>
            <td data-label="Buyer">
              {r.buyer?.id ? (
                <Link
                  href={`/admin/users/${r.buyer.id}`}
                  className={cx("hover:text-live", isPersonStub(r.buyer) && "person--stub")}
                >
                  {personLabel(r.buyer)}
                </Link>
              ) : (
                <span className={cx(isPersonStub(r.buyer) && "person--stub")}>
                  {personLabel(r.buyer)}
                </span>
              )}
            </td>
            <td data-label="Seller">
              {r.seller?.id ? (
                <Link
                  href={`/admin/users/${r.seller.id}`}
                  className={cx("hover:text-live", isPersonStub(r.seller) && "person--stub")}
                >
                  {personLabel(r.seller)}
                </Link>
              ) : (
                <span className={cx(isPersonStub(r.seller) && "person--stub")}>
                  {personLabel(r.seller)}
                </span>
              )}
            </td>
            <td className="ledger__num" data-label="Value">
              {formatPrice(r.totalCents)}
            </td>
            <td className={cx("ledger__num", r.overSla && "text-live")} data-label="Age">
              {r.ageDays}d
            </td>
            <td data-label="State">
              {r.overSla ? (
                <span className="chip chip--live">Over SLA</span>
              ) : r.escalated ? (
                // The buyer pressed "ask DRVN to step in" (or the day-4 cron
                // flagged it) — support owes this row a decision.
                <span className="chip chip--warn">
                  {r.buyerEscalated ? "Buyer escalated" : "Escalated"}
                </span>
              ) : r.transferred && !r.refundOfferCents ? (
                // Money already left for the seller — a refund here means a
                // clawback, so this is the state worth noticing.
                <span className="chip chip--warn">Paid out</span>
              ) : (
                <span className="status-plain">
                  {r.refundOfferCents ? "offer out" : "funds held"}
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    <Pager page={page} hasMore={hasMore} href={pagerHref} prevLabel="← Back" nextLabel="More →" />
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
  searchParams: Promise<{ view?: string; q?: string; category?: string; sla?: string; page?: string }>;
}) {
  const { view, q, category, sla, page: pageParam } = await searchParams;
  const overSlaOnly = sla === "over";
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const activeCategory = Object.keys(CATEGORY_LABEL).includes(category ?? "")
    ? (category as DisputeCategory)
    : undefined;
  const filters = { query: q, category: activeCategory, overSlaOnly, page };
  const [open, resolved] = await Promise.all([
    getDisputeQueue("open", filters),
    getDisputeQueue("resolved", filters),
  ]);

  const pagerHref = (tab: "open" | "resolved") => (target: number) =>
    `/admin/disputes?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(activeCategory ? { category: activeCategory } : {}),
      ...(overSlaOnly ? { sla: "over" } : {}),
      ...(tab === "resolved" ? { view: "resolved" } : {}),
      ...(target > 0 ? { page: String(target) } : {}),
    })}`;

  const linkFor = (cat?: string, slaOverride?: boolean) =>
    `/admin/disputes?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(cat ? { category: cat } : {}),
      ...((slaOverride ?? overSlaOnly) ? { sla: "over" } : {}),
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

      <div className="finder mb-4">
        <form method="get" className="search" role="search">
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

        <div className="filters" aria-label="Filter by category">
          <span className="microlabel filters__label">Category</span>
          <Link href={linkFor()} className={cx("fbtn", !activeCategory && "is-on")}>
            All
          </Link>
          {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
            <Link key={key} href={linkFor(key)} className={cx("fbtn", activeCategory === key && "is-on")}>
              {label}
            </Link>
          ))}
          <Link
            href={linkFor(activeCategory, !overSlaOnly)}
            className={cx("fbtn", overSlaOnly && "is-on")}
            title="Only disputes already past the escalation window"
          >
            Over SLA
          </Link>
          <a
            href={`/admin/export?${new URLSearchParams({
              view: "disputes",
              scope: view === "resolved" ? "resolved" : "open",
              ...(q ? { q } : {}),
              ...(activeCategory ? { category: activeCategory } : {}),
            })}`}
            className="jumplink sm:ml-auto"
          >
            Export CSV ↓
          </a>
        </div>
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
                page={open.page}
                hasMore={open.hasMore}
                pagerHref={pagerHref("open")}
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
                page={resolved.page}
                hasMore={resolved.hasMore}
                pagerHref={pagerHref("resolved")}
              />
            ),
          },
        ]}
      />
    </>
  );
}
