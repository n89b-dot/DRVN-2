import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { KeyValueTable } from "@/components/ui";
import { adminAddNote, adminSuspendUser, adminUnsuspendUser } from "@/lib/admin/actions";
import { getUserDetail, type AdminUserOrderRow } from "@/lib/admin/queries";
import { ORDER_STATUS_CHIP } from "@/lib/admin/presentation";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { cx, isPersonStub, personLabel, plural } from "@/lib/format";

import { ActionDialog } from "../../_components/action-dialog";

export const dynamic = "force-dynamic";

function OrderList({
  rows,
  role,
  empty,
}: {
  rows: AdminUserOrderRow[];
  role: "buyer" | "seller";
  empty: string;
}) {
  if (!rows.length) return <p className="order__meta mt-2">{empty}</p>;
  return (
    <div className="rowlist">
      {rows.map((o) => (
        <div key={o.id} className="jobrow">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <Link href={`/admin/orders/${o.id}`} className="order__name hover:text-live">
              {o.title}
            </Link>
            <span className="flex items-baseline gap-2">
              {o.disputed && <span className="chip chip--live">disputed</span>}
              <span className={cx("chip", ORDER_STATUS_CHIP[o.status] ?? "chip--spent")}>
                {o.status.replace("_", " ")}
              </span>
              <span className="kv">{formatPrice(o.totalCents)}</span>
            </span>
          </div>
          <p className="order__meta mt-0.5">
            {new Date(o.createdAt).toLocaleDateString()} ·{" "}
            {role === "buyer" ? "from" : "to"}{" "}
            <span className={cx(isPersonStub(o.counterparty) && "person--stub")}>
              {personLabel(o.counterparty)}
            </span>
            {o.refundedCents > 0 && ` · refunded ${formatPrice(o.refundedCents)}`}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * One person, whole story: identity and payout state, both sides of their
 * order history, their stock, the reports naming them, and every admin action
 * that ever touched them — the sheet a suspend or refund decision reads first.
 */
export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getUserDetail(id);
  if (!user) notFound();

  return (
    <>
      <nav aria-label="Breadcrumb" className="mt-2">
        <Link href="/admin/users" className="jumplink">
          ← Users
        </Link>
      </nav>

      <Rv as="header" className="pagehead">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className={cx(isPersonStub(user) && "person--stub")}>{personLabel(user)}</h1>
          {user.suspendedAt ? (
            <span className="chip chip--live">suspended</span>
          ) : (
            <span className="chip chip--ok">active</span>
          )}
          {user.isAdmin && <span className="chip chip--ink">console admin</span>}
        </div>
        <p className="pagehead__sub">
          @{user.username ?? "—"} · joined {new Date(user.createdAt).toLocaleDateString()} ·{" "}
          {plural(user.totals.purchases, "purchase")} · {plural(user.totals.sales, "sale")} ·{" "}
          {plural(user.totals.disputes, "dispute")}
          {user.totals.disputesLost > 0 && (
            <>
              {" "}
              ·{" "}
              <span className="text-live">
                {user.totals.disputesLost} lost as seller
              </span>
            </>
          )}
        </p>
      </Rv>

      <div className="deck deck--two mb-8">
        <section className="tile" aria-label="Account">
          <span className="microlabel">Account</span>
          <KeyValueTable
            rows={[
              { label: "User id", value: user.id },
              { label: "Type", value: user.profileType },
              {
                label: "Payouts",
                value: user.payoutsEnabled
                  ? "enabled"
                  : user.stripeAccountId
                    ? "onboarding incomplete"
                    : "not set up",
              },
              { label: "Stripe account", value: user.stripeAccountId ?? "—" },
              {
                label: "Reports against",
                value: String(user.totals.reportsAgainst),
              },
            ]}
          />
          <div className="mt-4 flex flex-wrap gap-2">
            {user.username && (
              <Link href={`/u/${user.username}`} className="jumplink">
                Public profile →
              </Link>
            )}
            {user.isAdmin ? (
              <span className="chip chip--spent">Admins are managed in SQL</span>
            ) : user.suspendedAt ? (
              <ActionDialog
                action={adminUnsuspendUser}
                title={`Lift suspension — ${personLabel(user)}`}
                trigger="Unsuspend"
                triggerClassName="btn"
                hidden={{ user_id: user.id }}
                confirmNote="Clears the suspension and reactivates the listings it paused."
                fields={[{ kind: "reason" }]}
                submitLabel="Lift suspension"
              />
            ) : (
              <ActionDialog
                action={adminSuspendUser}
                title={`Suspend ${personLabel(user)}`}
                trigger="Suspend"
                triggerClassName="btn btn--live"
                danger
                hidden={{ user_id: user.id }}
                confirmNote="Pauses their live listings, hides their stock from browse, and blocks new listings. Existing orders are unaffected — resolve those individually."
                fields={[{ kind: "reason" }]}
                submitLabel="Suspend user"
              />
            )}
          </div>
          {user.suspendedAt && user.suspendedReason && (
            <p className="order__meta mt-3 text-live">
              Suspended {new Date(user.suspendedAt).toLocaleDateString()} — “{user.suspendedReason}”
            </p>
          )}
        </section>

        <section className="tile" aria-label="Listings">
          <span className="microlabel">
            Listings ({user.totals.listings}
            {user.totals.listings > user.listings.length ? `, latest ${user.listings.length}` : ""})
          </span>
          {user.listings.length ? (
            <div className="rowlist">
              {user.listings.map((l) => (
                <div key={l.id} className="jobrow">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/listings/${l.id}`} className="order__name hover:text-live">
                      {l.title}
                    </Link>
                    <span className="flex items-baseline gap-2">
                      <span
                        className={cx(
                          "chip",
                          l.status === "removed"
                            ? "chip--live"
                            : l.status === "active"
                              ? "chip--ok"
                              : "chip--spent"
                        )}
                      >
                        {l.status}
                      </span>
                      <span className="kv">{formatPrice(l.price_cents)}</span>
                    </span>
                  </div>
                  {l.status === "removed" && l.removed_reason && (
                    <p className="order__meta mt-0.5 text-live">“{l.removed_reason}”</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="order__meta mt-2">No listings.</p>
          )}
        </section>
      </div>

      <div className="deck deck--two mb-8">
        <section aria-label="Sales" className="tile">
          <span className="microlabel">
            Sales ({user.totals.sales}
            {user.totals.sales > user.sales.length ? `, latest ${user.sales.length}` : ""})
          </span>
          <OrderList rows={user.sales} role="seller" empty="Nothing sold." />
        </section>
        <section aria-label="Purchases" className="tile">
          <span className="microlabel">
            Purchases ({user.totals.purchases}
            {user.totals.purchases > user.purchases.length
              ? `, latest ${user.purchases.length}`
              : ""})
          </span>
          <OrderList rows={user.purchases} role="buyer" empty="Nothing bought." />
        </section>
      </div>

      {user.reportsAgainst.length > 0 && (
        <section aria-label="Reports against this user" className="mb-8">
          <span className="microlabel">Reports against this user</span>
          <div className="rowlist">
            {user.reportsAgainst.map((r) => (
              <div key={r.id} className="jobrow">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="chip chip--live">{r.reason.replaceAll("_", " ")}</span>
                  <span className="order__meta">
                    by{" "}
                    <span className={cx(isPersonStub(r.reporter) && "person--stub")}>
                      {personLabel(r.reporter)}
                    </span>{" "}
                    · {new Date(r.created_at).toLocaleDateString()} ·{" "}
                    {r.status}
                  </span>
                </div>
                {r.detail && <p className="mt-1 text-body">“{r.detail}”</p>}
              </div>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Admin history">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <span className="microlabel !mb-0">Admin actions on this user</span>
          <ActionDialog
            action={adminAddNote}
            title="Internal note"
            trigger="Add note"
            triggerClassName="relbtn !static"
            hidden={{ subject_type: "user", subject_id: user.id }}
            confirmNote="Internal only — lands in the history below and the audit log, visible to admins alone."
            fields={[{ kind: "reason", label: "Note", placeholder: "What the next admin needs to know" }]}
            submitLabel="Record note"
          />
        </div>
        {user.adminHistory.length ? (
          <div className="rowlist">
            {user.adminHistory.map((a) => (
              <div key={a.id} className="jobrow">
                <p className="order__meta">
                  {a.action} · {new Date(a.created_at).toLocaleString()}
                </p>
                <p className="mt-0.5 text-body">“{a.reason}”</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="order__meta mt-2">None. Anything done here is recorded permanently.</p>
        )}
      </section>
    </>
  );
}
