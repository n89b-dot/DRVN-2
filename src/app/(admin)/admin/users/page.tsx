import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { adminSuspendUser, adminUnsuspendUser } from "@/lib/admin/actions";
import { isDeletionPending, SUSPENDED_CHIP } from "@/lib/admin/presentation";
import { searchUsers, USER_STATE_FILTERS, USERS_PAGE_SIZE, type UserStateFilter } from "@/lib/admin/queries";
import { cx, isPersonStub, personLabel } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";
import { ConsoleEmpty } from "../_components/console-empty";
import { SearchField, Pagination } from "@/components/ui";

export const dynamic = "force-dynamic";

/**
 * People: search, history at a glance (sales, disputes), suspend/unsuspend.
 * Suspension pauses live stock and hides it from browse (RLS-enforced, 0018);
 * lifting it restores exactly the set the suspension paused. Admin rows are
 * marked and unsuspendable from here — membership itself is SQL-only.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; page?: string }>;
}) {
  const { q, state, page: pageParam } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const activeState = (USER_STATE_FILTERS.some((f) => f.key === state)
    ? state
    : "all") as UserStateFilter;
  const { rows, total, hasMore } = await searchUsers(q, activeState, page);

  const pagerHref = (target: number) =>
    `/admin/users?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(activeState !== "all" ? { state: activeState } : {}),
      ...(target > 0 ? { page: String(target) } : {}),
    })}`;

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Users</h1>
        <p className="pagehead__sub">
          Suspension pauses a seller&apos;s live stock and blocks new listings; the database
          enforces both. Admin membership is managed in SQL, never from here.
        </p>
      </Rv>

      <div className="finder mb-4">
        <form method="get" className="finder__main" role="search">
          <SearchField label="Search users" defaultValue={q ?? ""} placeholder="Username or display name…" />
          {activeState !== "all" && <input type="hidden" name="state" value={activeState} />}
        </form>

        <div className="filters" aria-label="Filter by state">
          <span className="microlabel filters__label">State</span>
          {USER_STATE_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/users?${new URLSearchParams({
              ...(q ? { q } : {}),
              ...(f.key !== "all" ? { state: f.key } : {}),
            })}`}
            className={cx("fbtn", activeState === f.key && "is-on")}
          >
            {f.label}
          </Link>
        ))}
        </div>
      </div>

      {rows.length ? (
        <>
        <p className="order__meta mb-2">
          {total} user{total === 1 ? "" : "s"}
          {total > rows.length &&
            ` · showing ${page * USERS_PAGE_SIZE + 1}–${page * USERS_PAGE_SIZE + rows.length}`}
        </p>
        <table className="ledger">
          <thead>
            <tr>
              <th scope="col">User</th>
              <th scope="col" className="text-right">
                Listings
              </th>
              <th scope="col" className="text-right">
                Sales
              </th>
              <th scope="col" className="text-right">
                Disputes
              </th>
              <th scope="col">Payouts</th>
              <th scope="col">State</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <Link
                    href={`/admin/users/${u.id}`}
                    className={cx(
                      "order__name block hover:text-live",
                      isPersonStub(u) && "person--stub",
                    )}
                  >
                    {personLabel(u)}
                  </Link>
                  <span className="order__meta">
                    @{u.username ?? "—"} · joined {new Date(u.createdAt).toLocaleDateString()}
                    {u.isAdmin && " · console admin"}
                  </span>
                  {u.suspendedAt && u.suspendedReason && (
                    <span className="order__meta mt-0.5 block text-live">“{u.suspendedReason}”</span>
                  )}
                </td>
                <td className="ledger__num" data-label="Listings">
                  {u.listingCount || "—"}
                </td>
                <td className="ledger__num" data-label="Sales">
                  {u.saleCount || "—"}
                </td>
                <td className={cx("ledger__num", u.disputeCount > 0 && "text-live")} data-label="Disputes">
                  {u.disputeCount || "—"}
                </td>
                <td data-label="Payouts">
                  <span className="status-plain">
                    {u.payoutsEnabled ? "enabled" : "not set up"}
                  </span>
                </td>
                <td data-label="State">
                  {u.suspendedAt && isDeletionPending(u.suspendedReason) ? (
                    <span className="chip chip--warn">Deleting</span>
                  ) : u.suspendedAt ? (
                    <span className={cx("chip", SUSPENDED_CHIP)}>Suspended</span>
                  ) : (
                    <span className="status-plain">active</span>
                  )}
                </td>
                <td>
                  {u.isAdmin || (u.suspendedAt && isDeletionPending(u.suspendedReason)) ? (
                    <span className="order__meta">—</span>
                  ) : u.suspendedAt ? (
                    <ActionDialog
                      action={adminUnsuspendUser}
                      title={`Lift suspension — ${u.username ?? u.id.slice(0, 8)}`}
                      trigger="Unsuspend"
                      triggerClassName="relbtn !static"
                      hidden={{ user_id: u.id }}
                      confirmNote="Clears the suspension and reactivates the listings it paused."
                      fields={[{ kind: "reason" }]}
                      submitLabel="Lift suspension"
                    />
                  ) : (
                    <ActionDialog
                      action={adminSuspendUser}
                      title={`Suspend ${u.username ?? u.id.slice(0, 8)}`}
                      trigger="Suspend"
                      triggerClassName="relbtn !static"
                      danger
                      hidden={{ user_id: u.id }}
                      confirmNote="Pauses their live listings, hides their stock from browse, and blocks new listings. Existing orders are unaffected — resolve those individually."
                      fields={[{ kind: "reason" }]}
                      submitLabel="Suspend user"
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pagination page={page + 1} hasMore={hasMore} hrefFor={(target) => pagerHref(target - 1)} prevLabel="← Newer" nextLabel="Older →" />
        </>
      ) : (
        <ConsoleEmpty
          title="No users match"
          body="Try a different search, or widen the state filter."
          actionHref="/admin/users"
          actionLabel="Clear the search"
        />
      )}
    </>
  );
}
