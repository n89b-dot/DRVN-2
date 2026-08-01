import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { adminRemoveListing, adminRestoreListing } from "@/lib/admin/actions";
import { searchListings } from "@/lib/admin/queries";
import type { Listing } from "@/lib/database.types";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";

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
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const activeStatus = STATUSES.includes(status as Listing["status"])
    ? (status as Listing["status"])
    : undefined;
  const rows = await searchListings({ query: q, status: activeStatus });

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
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      <div className="filters mb-4" aria-label="Filter by status">
        <Link
          href={`/admin/listings${q ? `?q=${encodeURIComponent(q)}` : ""}`}
          className={cx("fbtn", !activeStatus && "is-on")}
        >
          All
        </Link>
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/listings?${new URLSearchParams({ ...(q ? { q } : {}), status: s })}`}
            className={cx("fbtn", activeStatus === s && "is-on")}
          >
            {s}
          </Link>
        ))}
      </div>

      {rows.length ? (
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
                  <span className="order__meta">
                    {l.category} · listed {new Date(l.created_at).toLocaleDateString()}
                  </span>
                  {l.status === "removed" && l.removed_reason && (
                    <span className="order__meta mt-0.5 block text-live">“{l.removed_reason}”</span>
                  )}
                </td>
                <td>{l.seller?.username ?? l.seller?.displayName ?? "—"}</td>
                <td className="ledger__num" data-label="Asking">
                  {formatPrice(l.price_cents)}
                </td>
                <td>
                  <span className={cx("chip", l.status === "removed" ? "chip--live" : l.status === "active" ? "chip--ok" : "chip--spent")}>
                    {l.status}
                  </span>
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
      ) : (
        <div className="tile">
          <span className="microlabel">Results</span>
          <p className="order__meta">No listings match.</p>
        </div>
      )}
    </>
  );
}
