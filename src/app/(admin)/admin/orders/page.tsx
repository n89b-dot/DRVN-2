import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { getOrderStatusCounts, ORDERS_PAGE_SIZE, searchOrders } from "@/lib/admin/queries";
import { ORDER_STATUS_CHIP } from "@/lib/admin/presentation";
import type { OrderStatus } from "@/lib/database.types";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx, isPersonStub, personLabel } from "@/lib/format";

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
  searchParams: Promise<{
    q?: string;
    status?: string;
    page?: string;
    from?: string;
    to?: string;
    min?: string;
    max?: string;
  }>;
}) {
  const { q, status, page: pageParam, from, to, min, max } = await searchParams;
  const activeStatus = STATUSES.includes(status as OrderStatus) ? (status as OrderStatus) : undefined;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const fromIso = from ? `${from}T00:00:00Z` : undefined;
  const toIso = to
    ? new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString()
    : undefined;
  // Dollar inputs; blank or junk = unbounded.
  const parseAmount = (v?: string) => {
    const n = Number(v);
    return v && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
  };
  const minCents = parseAmount(min);
  const maxCents = parseAmount(max);
  const [{ rows, hasMore }, counts] = await Promise.all([
    searchOrders({ query: q, status: activeStatus, page, from: fromIso, to: toIso, minCents, maxCents }),
    getOrderStatusCounts({ statuses: STATUSES, from: fromIso, to: toIso }),
  ]);
  const allCount = STATUSES.reduce((s, key) => s + (counts[key] ?? 0), 0);

  const dateParams = {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(minCents != null && min ? { min } : {}),
    ...(maxCents != null && max ? { max } : {}),
  };
  const pageLink = (target: number) =>
    `/admin/orders?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(activeStatus ? { status: activeStatus } : {}),
      ...dateParams,
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
        <label htmlFor="admin-order-from" className="sr-only">
          From date
        </label>
        <input id="admin-order-from" type="date" name="from" defaultValue={from ?? ""} className="ctl" />
        <label htmlFor="admin-order-to" className="sr-only">
          To date
        </label>
        <input id="admin-order-to" type="date" name="to" defaultValue={to ?? ""} className="ctl" />
        <label htmlFor="admin-order-min" className="sr-only">
          Minimum total ($)
        </label>
        <input
          id="admin-order-min"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          name="min"
          defaultValue={min ?? ""}
          placeholder="Min $"
          className="ctl max-w-[10ch]"
        />
        <label htmlFor="admin-order-max" className="sr-only">
          Maximum total ($)
        </label>
        <input
          id="admin-order-max"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          name="max"
          defaultValue={max ?? ""}
          placeholder="Max $"
          className="ctl max-w-[10ch]"
        />
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      <div className="filters mb-4" aria-label="Filter by status">
        <Link
          href={`/admin/orders?${new URLSearchParams({ ...(q ? { q } : {}), ...dateParams })}`}
          className={cx("fbtn", !activeStatus && "is-on")}
        >
          All <span className="n ml-1">{allCount}</span>
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/orders?${new URLSearchParams({ ...(q ? { q } : {}), ...dateParams, status: s })}`}
            className={cx("fbtn", activeStatus === s && "is-on")}
          >
            {s.replace("_", " ")}
            {(counts[s] ?? 0) > 0 && <span className="n ml-1">{counts[s]}</span>}
          </Link>
        ))}
      </div>

      {rows.length ? (
        <>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="order__meta !mb-0">
            Showing {page * ORDERS_PAGE_SIZE + 1}–{page * ORDERS_PAGE_SIZE + rows.length} · newest
            first
          </p>
          <a
            href={`/admin/export?${new URLSearchParams({
              view: "orders",
              ...(q ? { q } : {}),
              ...(activeStatus ? { status: activeStatus } : {}),
              ...(fromIso ? { from: fromIso } : {}),
              ...(toIso ? { to: toIso } : {}),
              ...(minCents != null && min ? { min } : {}),
              ...(maxCents != null && max ? { max } : {}),
            })}`}
            className="jumplink"
          >
            Export CSV ↓
          </a>
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Buyer</th>
              <th scope="col">Seller</th>
              <th scope="col" className="text-right">
                Total
              </th>
              <th scope="col" className="cell-gap">
                Money
              </th>
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
                    {/* When the title is already the id fallback, repeating the
                        id below it says nothing — the date carries the line. */}
                    {r.title === `Order ${r.id.slice(0, 8)}`
                      ? new Date(r.createdAt).toLocaleDateString()
                      : `${r.id.slice(0, 8)} · ${new Date(r.createdAt).toLocaleDateString()}`}
                  </span>
                </td>
                <td data-label="Buyer">
                  <span className={cx(isPersonStub(r.buyer) && "person--stub")}>
                    {personLabel(r.buyer)}
                  </span>
                </td>
                <td data-label="Seller">
                  <span className={cx(isPersonStub(r.seller) && "person--stub")}>
                    {personLabel(r.seller)}
                  </span>
                </td>
                <td className="ledger__num" data-label="Total">
                  {formatPrice(r.totalCents)}
                </td>
                <td data-label="Money" className="cell-gap">
                  {r.refundedCents > 0 ? (
                    <span className="chip chip--live">Refunded {formatPrice(r.refundedCents)}</span>
                  ) : (
                    <span className="status-plain">{r.transferred ? "paid out" : "held"}</span>
                  )}
                </td>
                <td data-label="Status">
                  {ORDER_STATUS_CHIP[r.status] ? (
                    <span className={cx("chip", ORDER_STATUS_CHIP[r.status])}>
                      {r.status.replace("_", " ")}
                    </span>
                  ) : (
                    <span className="status-plain">{r.status.replace("_", " ")}</span>
                  )}
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
