import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { getAuditLog } from "@/lib/admin/queries";

export const dynamic = "force-dynamic";

/**
 * The append-only record. There is no edit and no delete — a wrong entry is
 * corrected by another action, and the database enforces that (0018 trigger,
 * CI-asserted). Filterable by action prefix so "every refund ever" is a link.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string }>;
}) {
  const { action } = await searchParams;
  const rows = await getAuditLog({ action });

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Audit log</h1>
        <p className="pagehead__sub">
          Every admin action: who, what, which order, why, when. Append-only at the database
          level — nothing here can be edited or removed, by anyone.
        </p>
      </Rv>

      <form method="get" className="search mb-4" role="search">
        <label htmlFor="audit-action" className="sr-only">
          Filter by action prefix
        </label>
        <input
          id="audit-action"
          type="search"
          name="action"
          defaultValue={action ?? ""}
          placeholder="Filter by action, e.g. order.force_refund, user., listing."
          className="ctl"
        />
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      {rows.length ? (
        <div className="rowlist">
          {rows.map((r) => (
            <div key={r.id} className="jobrow">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="flex items-baseline gap-2">
                  <span className="chip chip--spent">{r.action}</span>
                  <span className="order__name !text-[14.5px]">
                    {r.actor?.username ?? r.actor?.displayName ?? r.actor_id.slice(0, 8)}
                  </span>
                </span>
                <span className="order__meta">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 text-[14.5px]">“{r.reason}”</p>
              <p className="order__meta mt-0.5">
                {r.subject_type} {r.subject_id.slice(0, 8)}
                {r.order_id && (
                  <>
                    {" · "}
                    <Link href={`/admin/orders/${r.order_id}`} className="jumplink">
                      order {r.order_id.slice(0, 8)} →
                    </Link>
                  </>
                )}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="tile">
          <span className="microlabel">Log</span>
          <p className="order__meta">
            {action ? "No entries match that prefix." : "No admin actions recorded yet."}
          </p>
        </div>
      )}
    </>
  );
}
