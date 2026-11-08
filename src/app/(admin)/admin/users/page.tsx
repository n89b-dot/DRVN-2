import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { adminSuspendUser, adminUnsuspendUser } from "@/lib/admin/actions";
import { isDeletionPending, SUSPENDED_CHIP } from "@/lib/admin/presentation";
import { ACCOUNT_DELETIONS_PAGE_SIZE, getAccountDeletionCases, searchUsers, USER_STATE_FILTERS, USERS_PAGE_SIZE, type UserStateFilter } from "@/lib/admin/queries";
import { cx, isPersonStub, personLabel } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";
import { ConsoleEmpty } from "../_components/console-empty";
import { Pager } from "../_components/pager";
import { SearchField, TileHead } from "@/components/ui";

export const dynamic = "force-dynamic";

const DELETION_STATE = {
  temporary_financial_hold: "On hold: money still moving",
  cleanup_pending: "Cleaning up",
  operator_attention: "Needs an operator",
} as const;

function daysSince(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "1 day ago" : `${days} days ago`;
}

/**
 * People: search, history at a glance (sales, disputes), suspend/unsuspend.
 * Suspension pauses live stock and hides it from browse (RLS-enforced, 0018);
 * lifting it restores exactly the set the suspension paused. Admin rows are
 * marked and unsuspendable from here — membership itself is SQL-only.
 */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; page?: string; dpage?: string }>;
}) {
  const { q, state, page: pageParam, dpage: deletionPageParam } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const deletionPage = Math.max(0, Number.parseInt(deletionPageParam ?? "0", 10) || 0);
  const activeState = (USER_STATE_FILTERS.some((f) => f.key === state)
    ? state
    : "all") as UserStateFilter;
  const [{ rows, total, hasMore }, deletions] = await Promise.all([searchUsers(q, activeState, page), getAccountDeletionCases(deletionPage)]);

  const pagerHref = (target: number) =>
    `/admin/users?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(activeState !== "all" ? { state: activeState } : {}),
      ...(target > 0 ? { page: String(target) } : {}),
      ...(deletionPage > 0 ? { dpage: String(deletionPage) } : {}),
    })}`;
  // The deletion queue pages on its own (dpage), keeping the user search
  // where it was.
  const deletionPagerHref = (target: number) =>
    `/admin/users?${new URLSearchParams({
      ...(q ? { q } : {}),
      ...(activeState !== "all" ? { state: activeState } : {}),
      ...(page > 0 ? { page: String(page) } : {}),
      ...(target > 0 ? { dpage: String(target) } : {}),
    })}#deletions`;
  const deletionFrom = deletions.page * ACCOUNT_DELETIONS_PAGE_SIZE;

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Users</h1>
        <p className="pagehead__sub">
          Suspension pauses a seller&apos;s live stock and blocks new listings; the database
          enforces both. Admin membership is managed in SQL, never from here.
        </p>
      </Rv>

      {/* N35: every account deletion that hasn't finished, oldest first,
          with who acts next. "Operator attention" used to exist only inside
          the deletion worker. */}
      {deletions.total > 0 && (
        <section id="deletions" className="tile mb-6" aria-label="Account deletions not finished">
          <TileHead label="Account deletions not finished" end={<span className="kv">{deletions.total}</span>} />
          {deletions.total > deletions.rows.length && (
            <p className="order__meta mb-2">
              {deletions.rows.length
                ? `Showing ${deletionFrom + 1}–${deletionFrom + deletions.rows.length} of ${deletions.total}`
                : `None on this page · ${deletions.total} in all`}
            </p>
          )}
          <table className="ledger">
            <thead>
              <tr>
                <th scope="col">Member</th>
                <th scope="col">State</th>
                <th scope="col">Next step</th>
                <th scope="col">Asked</th>
              </tr>
            </thead>
            <tbody>
              {deletions.rows.map((d) => (
                <tr key={d.id}>
                  <td data-label="Member">
                    {d.userId ? (
                      <Link href={`/admin/users/${d.userId}`} className="order__name block hover:text-live">
                        {d.person ? personLabel(d.person) : "Member"}
                      </Link>
                    ) : (
                      <span className="order__name block">Account removed</span>
                    )}
                  </td>
                  <td data-label="State">
                    <span className={cx("chip", d.outcome === "operator_attention" ? "chip--live" : "chip--warn")}>
                      {DELETION_STATE[d.outcome]}
                    </span>
                  </td>
                  <td data-label="Next step">
                    {d.nextAction ?? "—"}
                    <span className="order__meta block">
                      {d.owner ? `On: ${d.owner}` : ""}
                      {d.pendingDecisions.length ? ` · waiting on ${d.pendingDecisions.join(", ")}` : ""}
                      {d.reviewAt ? ` · review by ${new Date(d.reviewAt).toLocaleDateString()}` : ""}
                      {d.retainUntil ? ` · keys kept until ${new Date(d.retainUntil).toLocaleDateString()}` : ""}
                    </span>
                  </td>
                  <td data-label="Asked">
                    {new Date(d.requestedAt).toLocaleDateString()}
                    <span className="order__meta block">{daysSince(d.requestedAt)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager
            page={deletions.page}
            hasMore={deletions.hasMore}
            href={deletionPagerHref}
            prevLabel="← Older cases"
            nextLabel="Newer cases →"
          />
        </section>
      )}

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
        <Pager page={page} hasMore={hasMore} href={pagerHref} />
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
