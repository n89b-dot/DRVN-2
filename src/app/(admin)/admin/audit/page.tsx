import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { AUDIT_PAGE_SIZE, getAuditLog } from "@/lib/admin/queries";
import type { AdminAuditSubjectType } from "@/lib/database.types";
import { cx } from "@/lib/format";

export const dynamic = "force-dynamic";

const SUBJECT_TYPES: AdminAuditSubjectType[] = [
  "order",
  "dispute",
  "listing",
  "user",
  "report",
  "payment",
];

/**
 * The append-only record. There is no edit and no delete — a wrong entry is
 * corrected by another action, and the database enforces that (0018 trigger,
 * CI-asserted). Filterable by action prefix, actor, and subject, and paged,
 * so "every refund ever" and "everything Dana did in March" are both links.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; actor?: string; subject?: string; page?: string }>;
}) {
  const { action, actor, subject, page: pageParam } = await searchParams;
  const subjectType = SUBJECT_TYPES.includes(subject as AdminAuditSubjectType)
    ? (subject as AdminAuditSubjectType)
    : undefined;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const { rows, hasMore } = await getAuditLog({ action, actorQuery: actor, subjectType, page });

  const link = (overrides: Record<string, string | undefined>) => {
    const params = { action, actor, subject: subjectType, ...overrides };
    const qs = new URLSearchParams(
      Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))
    );
    return `/admin/audit${qs.size ? `?${qs}` : ""}`;
  };

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Audit log</h1>
        <p className="pagehead__sub">
          Every admin action: who, what, which order, why, when. Append-only at the database
          level — nothing here can be edited or removed, by anyone.
        </p>
      </Rv>

      <form method="get" className="search mb-2" role="search">
        <label htmlFor="audit-action" className="sr-only">
          Filter by action prefix
        </label>
        <input
          id="audit-action"
          type="search"
          name="action"
          defaultValue={action ?? ""}
          placeholder="Action prefix, e.g. order.force_refund, user., listing."
          className="ctl"
        />
        <label htmlFor="audit-actor" className="sr-only">
          Filter by actor
        </label>
        <input
          id="audit-actor"
          type="search"
          name="actor"
          defaultValue={actor ?? ""}
          placeholder="Actor username"
          className="ctl"
        />
        {subjectType && <input type="hidden" name="subject" value={subjectType} />}
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="filters mb-4" aria-label="Filter by subject">
        <Link href={link({ subject: undefined, page: undefined })} className={cx("fbtn", !subjectType && "is-on")}>
          All subjects
        </Link>
        {SUBJECT_TYPES.map((s) => (
          <Link
            key={s}
            href={link({ subject: s, page: undefined })}
            className={cx("fbtn", subjectType === s && "is-on")}
          >
            {s}
          </Link>
        ))}
      </div>

      {rows.length ? (
        <>
          <p className="order__meta mb-2">
            Showing {page * AUDIT_PAGE_SIZE + 1}–{page * AUDIT_PAGE_SIZE + rows.length} · newest
            first
          </p>
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
          {(page > 0 || hasMore) && (
            <div className="mt-4 flex items-center justify-between">
              {page > 0 ? (
                <Link href={link({ page: String(page - 1) === "0" ? undefined : String(page - 1) })} className="jumplink">
                  ← Newer
                </Link>
              ) : (
                <span />
              )}
              {hasMore && (
                <Link href={link({ page: String(page + 1) })} className="jumplink">
                  Older →
                </Link>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="tile">
          <span className="microlabel">Log</span>
          <p className="order__meta">
            {action || actor || subjectType
              ? "No entries match those filters."
              : "No admin actions recorded yet."}
          </p>
        </div>
      )}
    </>
  );
}
