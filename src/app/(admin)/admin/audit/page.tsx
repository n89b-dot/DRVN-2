import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { adminReconcileOperation } from "@/lib/admin/actions";
import { AUDIT_PAGE_SIZE, getAuditLog, getOpenOperations, type OpenOperation } from "@/lib/admin/queries";
import type { AdminAuditSubjectType } from "@/lib/database.types";
import { cx, isPersonStub, personLabel } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";
import { ConsoleEmpty } from "../_components/console-empty";
import { SearchField, TileHead, Pagination } from "@/components/ui";

export const dynamic = "force-dynamic";

const SUBJECT_TYPES: AdminAuditSubjectType[] = [
  "order",
  "dispute",
  "listing",
  "user",
  "report",
  "payment",
  "product_review",
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
const OPERATION_STATE: Record<OpenOperation["state"], string> = {
  requested: "requested · no outcome recorded",
  errored: "errored partway",
  escalated: "marked unknown · still blocked",
  refund_running: "refund still processing",
  refund_completed: "refund completed · record it",
  refund_failed: "refund refused by provider",
};

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
  const [pendingOps, { rows, hasMore }] = await Promise.all([getOpenOperations(), getAuditLog({
    action,
    actorQuery: actor,
    subjectType,
    page,
    from: fromIso,
    to: toIso,
  })]);

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

      {/* RR-15: provider-facing actions whose outcome was never recorded.
          Each one blocks the same action on the same record until an
          operator checks the provider and says what happened. */}
      {pendingOps.length > 0 && (
        <section id="pending" className="tile mb-6 scroll-mt-24" aria-label="Operations that need reconciliation">
          <TileHead label={`Needs reconciliation · ${pendingOps.length}`} />
          <p className="order__meta">
            Each of these was requested and never recorded an outcome. A request doesn&apos;t prove a
            provider call happened. Check what the records and the provider (Stripe, the carrier)
            show, then record it. Refunds are checked against DRVN&apos;s own refund records, and an
            outcome that contradicts them is refused. Until an outcome is recorded, the same action on
            the same record is refused. &ldquo;Can&apos;t tell yet&rdquo; keeps it blocked.
          </p>
          <div className="rowlist mt-2">
            {pendingOps.map((op) => (
              <div key={op.operationId} className="jobrow auditrow">
                <span className="auditrow__ts">{auditStamp(op.requestedAt)}</span>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="auditrow__action">{op.action}</span>
                    <span className="order__meta">
                      {OPERATION_STATE[op.state]} · op {op.operationId.slice(0, 8)}
                    </span>
                  </p>
                  <p className="mt-1 text-body">“{op.reason}”</p>
                  {op.orderId && (
                    <p className="order__meta mt-0.5">
                      <Link href={`/admin/orders/${op.orderId}`} className="jumplink">
                        order {op.orderId.slice(0, 8)} →
                      </Link>
                    </p>
                  )}
                </div>
                <ActionDialog
                  action={adminReconcileOperation}
                  title="Record what happened"
                  trigger="Resolve"
                  hidden={{ operation_id: op.operationId, seen_through: String(op.seenThrough) }}
                  confirmNote={`${op.action} on ${op.subjectType} ${op.subjectId.slice(0, 8)}. This records the outcome only; it never calls the provider or starts another refund.`}
                  fields={[
                    {
                      kind: "select",
                      name: "outcome",
                      label: "Did it go through at the provider?",
                      placeholder: "Choose what you found…",
                      options: [
                        { value: "applied", label: "Yes, it went through" },
                        { value: "not_applied", label: "No, nothing happened" },
                        { value: "unknown", label: "Can't tell yet — keep it blocked" },
                      ],
                    },
                    { kind: "reason", label: "How you checked (recorded in the audit log)" },
                  ]}
                  submitLabel="Record outcome"
                />
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="finder mb-4">
      {/* Keeps its submit: several fields block implicit Enter submission. */}
      <form method="get" className="finder__main" role="search">
        <SearchField
          label="Filter by action prefix"
          name="action"
          defaultValue={action ?? ""}
          placeholder="Action prefix, e.g. order.force_refund…"
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
                  <p className="flex flex-wrap items-baseline gap-x-2">
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
          <Pagination
            page={page + 1}
            hasMore={hasMore}
            hrefFor={(target) => link({ page: target > 1 ? String(target - 1) : undefined })}
            prevLabel="← Newer"
            nextLabel="Older →"
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
