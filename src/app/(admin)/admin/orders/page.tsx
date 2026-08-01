import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { ORDERS_PAGE_SIZE, searchOrders } from "@/lib/admin/queries";
import type { OrderStatus } from "@/lib/database.types";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx } from "@/lib/format";

export const dynamic = "force-dynamic";

const STATUSES: OrderStatus[] = [
  "paid",
  "shipped",
  "delivered",
  "completed",
  "disputed",
  "refunded",
  "cancelled",
  "pending",
  "payment_failed",
];

/**
 * Order search: id or payment-intent prefix, or a party's username. GET form —
 * a filtered view should survive being a link.
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q, status, page: pageParam } = await searchParams;
  const activeStatus = STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const { rows, hasMore } = await searchOrders({ query: q, status: activeStatus, page });

  const pageLink = (target: number) =>
    `/admin/orders?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(activeStatus ? { status: activeStatus } : {}),
      ...(target > 0 ? { page: String(target) } : {}),
    })}`;

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Orders</h1>
        <p className="pagehead__sub">
          Search by order id, payment reference (pi_…), or either party&apos;s username.
        </p>
      </Rv>

      <form method="get" className="search mb-2" role="search">
        <label htmlFor="admin-order-q" className="sr-only">
          Search orders
        </label>
        <input
          id="admin-order-q"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Order id, pi_…, or username"
          className="ctl"
        />
        {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      <div className="filters mb-4" aria-label="Filter by status">
        <Link href={`/admin/orders${q ? `?q=${encodeURIComponent(q)}` : ""}`} className={cx("fbtn", !activeStatus && "is-on")}>
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/orders?${new URLSearchParams({ ...(q ? { q } : {}), status: s })}`}
            className={cx("fbtn", activeStatus === s && "is-on")}
          >
            {s.replace("_", " ")}
          </Link>
        ))}
      </div>

      {rows.length ? (
        <>
        <p className="order__meta mb-2">
          Showing {page * ORDERS_PAGE_SIZE + 1}–{page * ORDERS_PAGE_SIZE + rows.length} · newest
          first
        </p>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Buyer</th>
              <th scope="col">Seller</th>
              <th scope="col" className="text-right">
                Total
              </th>
              <th scope="col">Money</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/admin/orders/${r.id}`} className="order__name block hover:text-live">
                    {r.title}
                  </Link>
                  <span className="order__meta">
                    {r.id.slice(0, 8)} · {new Date(r.createdAt).toLocaleDateString()}
                  </span>
                </td>
                <td data-label="Buyer">{r.buyer?.username ?? "—"}</td>
                <td data-label="Seller">{r.seller?.username ?? "—"}</td>
                <td className="ledger__num" data-label="Total">
                  {formatPrice(r.totalCents)}
                </td>
                <td data-label="Money">
                  {r.refundedCents > 0 ? (
                    <span className="chip chip--live">Refunded {formatPrice(r.refundedCents)}</span>
                  ) : r.transferred ? (
                    <span className="chip chip--ok">Paid out</span>
                  ) : (
                    <span className="chip chip--spent">Held</span>
                  )}
                </td>
                <td data-label="Status">
                  <span className="chip chip--spent">{r.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {(page > 0 || hasMore) && (
          <div className="mt-4 flex items-center justify-between">
            {page > 0 ? (
              <Link href={pageLink(page - 1)} className="jumplink">
                ← Newer
              </Link>
            ) : (
              <span />
            )}
            {hasMore && (
              <Link href={pageLink(page + 1)} className="jumplink">
                Older →
              </Link>
            )}
          </div>
        )}
        </>
      ) : (
        <div className="tile">
          <span className="microlabel">Results</span>
          <p className="order__meta">Nothing matches. Try a shorter prefix or a username.</p>
        </div>
      )}
    </>
  );
}
