import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { adminRemoveListing, adminRestoreListing } from "@/lib/admin/actions";
import { LISTINGS_PAGE_SIZE, searchListings } from "@/lib/admin/queries";
import type { Listing } from "@/lib/database.types";
import { CATEGORIES, formatPrice } from "@/lib/marketplace/taxonomy";
import { cx, isPersonStub, personLabel } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";
import { Pager } from "../_components/pager";

export const dynamic = "force-dynamic";

const STATUSES: Listing["status"][] = ["active", "paused", "draft", "reserved", "sold", "archived", "removed"];

/**
 * Moderation over stock: search, takedown with a seller-visible reason,
 * restore (to paused — the seller republishes deliberately). Sold/reserved
 * rows can't be taken down; the order is the thing to resolve there.
 */
export default async function AdminListingsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; category?: string; page?: string }>;
}) {
  const { q, status, category, page: pageParam } = await searchParams;
  const activeCategory = CATEGORIES.some((c) => c.slug === category) ? category : undefined;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const activeStatus = STATUSES.includes(status as Listing["status"])
    ? (status as Listing["status"])
    : undefined;
  const { rows, total, hasMore } = await searchListings({ query: q, status: activeStatus, category: activeCategory, page });

  const linkParams = (overrides: Record<string, string | undefined> = {}) => {
    const params = {
      ...(q ? { q } : {}),
      ...(activeStatus ? { status: activeStatus } : {}),
      ...(activeCategory ? { category: activeCategory } : {}),
      ...overrides,
    };
    return new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))
    );
  };
  const pagerHref = (target: number) =>
    `/admin/listings?${linkParams(target > 0 ? { page: String(target) } : {})}`;

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Listings</h1>
        <p className="pagehead__sub">
          Takedowns are recorded with a reason the seller sees; restores land as paused.
        </p>
      </Rv>

      <form method="get" className="search mb-2" role="search">
        <label htmlFor="admin-listing-q" className="sr-only">
          Search listings
        </label>
        <input
          id="admin-listing-q"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search titles"
          className="ctl"
        />
        {activeStatus && <input type="hidden" name="status" value={activeStatus} />}
        {activeCategory && <input type="hidden" name="category" value={activeCategory} />}
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      <div className="filters mb-2" aria-label="Filter by status">
        <Link
          href={`/admin/listings?${linkParams({ status: undefined })}`}
          className={cx("fbtn", !activeStatus && "is-on")}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/listings?${linkParams({ status: s })}`}
            className={cx("fbtn", activeStatus === s && "is-on")}
          >
            {s}
          </Link>
        ))}
      </div>

      <div className="filters mb-4" aria-label="Filter by category">
        <Link
          href={`/admin/listings?${linkParams({ category: undefined })}`}
          className={cx("fbtn", !activeCategory && "is-on")}
        >
          All categories
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c.slug}
            href={`/admin/listings?${linkParams({ category: c.slug })}`}
            className={cx("fbtn", activeCategory === c.slug && "is-on")}
          >
            {c.label}
          </Link>
        ))}
      </div>

      {rows.length ? (
        <>
        <p className="order__meta mb-2">
          {total} listing{total === 1 ? "" : "s"}
          {total > rows.length &&
            ` · showing ${page * LISTINGS_PAGE_SIZE + 1}–${page * LISTINGS_PAGE_SIZE + rows.length}`}
        </p>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">Listing</th>
              <th scope="col">Seller</th>
              <th scope="col" className="text-right">
                Asking
              </th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id}>
                <td>
                  <Link href={`/listings/${l.id}`} className="order__name block hover:text-live">
                    {l.title}
                  </Link>
                  <span className="order__meta mt-1 block">
                    {l.category}
                    {l.condition && ` · ${l.condition.replace("_", " ")}`}
                    {" · listed "}
                    {new Date(l.created_at).toLocaleDateString()}
                  </span>
                  {l.status === "removed" && l.removed_reason && (
                    <span className="order__meta mt-0.5 block text-live">“{l.removed_reason}”</span>
                  )}
                  {(l.imageUrl || l.description) && (
                    <details className="mt-1">
                      <summary className="jumplink cursor-pointer">preview</summary>
                      <div className="mt-2 flex max-w-[52ch] gap-3">
                        {l.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element -- moderation preview of user uploads; keep it out of the image optimizer
                          <img
                            src={l.imageUrl}
                            alt=""
                            className="h-20 w-20 shrink-0 rounded-lg object-cover"
                          />
                        )}
                        {l.description && (
                          <p className="order__meta whitespace-pre-line">
                            {l.description.length > 280
                              ? `${l.description.slice(0, 280)}…`
                              : l.description}
                          </p>
                        )}
                      </div>
                    </details>
                  )}
                </td>
                <td data-label="Seller">
                  <span className={cx(isPersonStub(l.seller) && "person--stub")}>
                    {personLabel(l.seller)}
                  </span>
                </td>
                <td className="ledger__num" data-label="Asking">
                  {formatPrice(l.price_cents)}
                </td>
                <td data-label="Status">
                  {l.status === "removed" ? (
                    <span className="chip chip--live">removed</span>
                  ) : (
                    <span className="status-plain">{l.status}</span>
                  )}
                </td>
                <td>
                  {l.status === "removed" ? (
                    <ActionDialog
                      action={adminRestoreListing}
                      title={`Restore “${l.title}”`}
                      trigger="Restore"
                      triggerClassName="relbtn !static"
                      hidden={{ listing_id: l.id }}
                      confirmNote="Returns the listing to the seller as paused; they choose to republish."
                      fields={[{ kind: "reason" }]}
                      submitLabel="Restore listing"
                    />
                  ) : ["reserved", "sold"].includes(l.status) ? (
                    <span className="order__meta">via order</span>
                  ) : (
                    <ActionDialog
                      action={adminRemoveListing}
                      title={`Remove “${l.title}”`}
                      trigger="Take down"
                      triggerClassName="relbtn !static"
                      danger
                      hidden={{ listing_id: l.id }}
                      confirmNote="Removes the listing from the marketplace immediately. The reason is shown to the seller."
                      fields={[{ kind: "reason", placeholder: "e.g. Prohibited item — airbag (terms §4)" }]}
                      submitLabel="Remove listing"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager page={page} hasMore={hasMore} href={pagerHref} />
        </>
      ) : (
        <div className="tile">
          <span className="microlabel">Results</span>
          <p className="order__meta">No listings match.</p>
        </div>
      )}
    </>
  );
}
