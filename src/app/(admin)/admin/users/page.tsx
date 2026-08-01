import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { adminSuspendUser, adminUnsuspendUser } from "@/lib/admin/actions";
import { searchUsers } from "@/lib/admin/queries";
import { cx } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";

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
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const rows = await searchUsers(q);

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Users</h1>
        <p className="pagehead__sub">
          Suspension pauses a seller&apos;s live stock and blocks new listings; the database
          enforces both. Admin membership is managed in SQL, never from here.
        </p>
      </Rv>

      <form method="get" className="search mb-4" role="search">
        <label htmlFor="admin-user-q" className="sr-only">
          Search users
        </label>
        <input
          id="admin-user-q"
          type="search"
          name="q"
          defaultValue={q ?? ""}
          placeholder="Username or display name"
          className="ctl"
        />
        <button type="submit" className="btn">
          Search
        </button>
      </form>

      {rows.length ? (
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
                    href={u.username ? `/u/${u.username}` : `/admin/users?q=${u.id}`}
                    className="order__name block hover:text-live"
                  >
                    {u.displayName ?? u.username ?? u.id.slice(0, 8)}
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
                <td>
                  <span className={cx("chip", u.payoutsEnabled ? "chip--ok" : "chip--spent")}>
                    {u.payoutsEnabled ? "enabled" : "not set up"}
                  </span>
                </td>
                <td>
                  {u.suspendedAt ? (
                    <span className="chip chip--live">suspended</span>
                  ) : (
                    <span className="chip chip--ok">active</span>
                  )}
                </td>
                <td>
                  {u.isAdmin ? (
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
      ) : (
        <div className="tile">
          <span className="microlabel">Results</span>
          <p className="order__meta">No users match.</p>
        </div>
      )}
    </>
  );
}
