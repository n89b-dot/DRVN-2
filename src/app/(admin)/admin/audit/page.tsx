import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { AUDIT_PAGE_SIZE, getAuditLog } from "@/lib/admin/queries";
import type { AdminAuditSubjectType } from "@/lib/database.types";
import { cx, isPersonStub, personLabel } from "@/lib/format";

import { ConsoleEmpty } from "../_components/console-empty";
import { Pager } from "../_components/pager";

export const dynamic = "force-dynamic";

const SUBJECT_TYPES: AdminAuditSubjectType[] = [
  "order",
  "dispute",
  "listing",
  "user",
  "report",
  "payment",
];

/** Fixed-width local timestamp ("2026-08-02 14:03") so the gutter never drifts. */
function auditStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-CA")} ${d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

/**
 * The append-only record. There is no edit and no delete — a wrong entry is
 * corrected by another action, and the database enforces that (0018 trigger,
 * CI-asserted). Filterable by action prefix, actor, and subject, and paged,
 * so "every refund ever" and "everything Dana did in March" are both links.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{
    action?: string;
    actor?: string;
    subject?: string;
    page?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const { action, actor, subject, page: pageParam, from, to } = await searchParams;
  const fromIso = from ? `${from}T00:00:00Z` : undefined;
  const toIso = to
    ? new Date(Date.parse(`${to}T00:00:00Z`) + 86_400_000).toISOString()
    : undefined;
  const subjectType = SUBJECT_TYPES.includes(subject as AdminAuditSubjectType)
    ? (subject as AdminAuditSubjectType)
    : undefined;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const { rows, hasMore } = await getAuditLog({
    action,
    actorQuery: actor,
    subjectType,
    page,
    from: fromIso,
    to: toIso,
  });

  const link = (overrides: Record<string, string | undefined>) => {
    const params = { action, actor, subject: subjectType, from, to, ...overrides };
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

      <div className="finder mb-4">
      <form method="get" className="search" role="search">
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
        <label htmlFor="audit-from" className="sr-only">
          From date
        </label>
        <input id="audit-from" type="date" name="from" defaultValue={from ?? ""} className="ctl" />
        <label htmlFor="audit-to" className="sr-only">
          To date
        </label>
        <input id="audit-to" type="date" name="to" defaultValue={to ?? ""} className="ctl" />
        <button type="submit" className="btn">
          Filter
        </button>
      </form>

      <div className="filters" aria-label="Filter by subject">
        <span className="microlabel filters__label">Subject</span>
        <Link href={link({ subject: undefined, page: undefined })} className={cx("fbtn", !subjectType && "is-on")}>
          All
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
      </div>

      {rows.length ? (
        <>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <p className="order__meta !mb-0">
              Showing {page * AUDIT_PAGE_SIZE + 1}–{page * AUDIT_PAGE_SIZE + rows.length} · newest
              first
            </p>
            <a
              href={`/admin/export?${new URLSearchParams({
                view: "audit",
                ...(action ? { action } : {}),
                ...(actor ? { actor } : {}),
                ...(subjectType ? { subject: subjectType } : {}),
                ...(fromIso ? { from: fromIso } : {}),
                ...(toIso ? { to: toIso } : {}),
              })}`}
              className="jumplink"
            >
              Export CSV ↓
            </a>
          </div>
          <div className="rowlist">
            {rows.map((r) => (
              <div key={r.id} className="jobrow auditrow">
                <span className="auditrow__ts">{auditStamp(r.created_at)}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2.5">
                    <span
                      className={cx("auditrow__dot", `auditrow__dot--${r.subject_type}`)}
                      title={r.subject_type}
                      aria-hidden="true"
                    />
                    <span
                      className={cx(
                        "auditrow__actor",
                        isPersonStub(r.actor ?? { id: r.actor_id }) && "person--stub",
                      )}
                    >
                      {personLabel(r.actor ?? { id: r.actor_id })}
                    </span>
                    <span className="auditrow__action">{r.action}</span>
                  </p>
                  <p className="mt-1 text-body">“{r.reason}”</p>
                  <p className="order__meta mt-0.5">
                    {r.order_id === r.subject_id ? (
                      <Link href={`/admin/orders/${r.order_id}`} className="jumplink">
                        order {r.order_id.slice(0, 8)} →
                      </Link>
                    ) : (
                      <>
                        <span className="sr-only">{r.subject_type} </span>
                        {r.subject_id.slice(0, 8)}
                        {r.order_id && (
                          <>
                            {" · "}
                            <Link href={`/admin/orders/${r.order_id}`} className="jumplink">
                              order {r.order_id.slice(0, 8)} →
                            </Link>
                          </>
                        )}
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
          <Pager
            page={page}
            hasMore={hasMore}
            href={(target) => link({ page: target > 0 ? String(target) : undefined })}
          />
        </>
      ) : (
        <ConsoleEmpty
          title={action || actor || subjectType ? "No entries match" : "No actions recorded yet"}
          body={
            action || actor || subjectType
              ? "Widen or clear the filters to see the full log."
              : "Every admin mutation lands here with its reason."
          }
          actionHref={action || actor || subjectType ? "/admin/audit" : undefined}
          actionLabel="Clear the filters"
        />
      )}
    </>
  );
}
