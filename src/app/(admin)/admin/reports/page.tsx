import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { SheetTabs } from "@/components/ui";
import { adminResolveReport, adminResolveReports } from "@/lib/admin/actions";
import { getReports, REPORTS_PAGE_SIZE, type AdminReportRow } from "@/lib/admin/queries";
import type { ReportReason } from "@/lib/database.types";
import { cx } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";
import { Pager } from "../_components/pager";

export const dynamic = "force-dynamic";

const REASON_LABEL: Record<string, string> = {
  prohibited_item: "Prohibited item",
  counterfeit: "Counterfeit",
  stolen_goods: "Stolen goods",
  scam_or_fraud: "Scam or fraud",
  offensive_content: "Offensive content",
  wrong_category: "Wrong category",
  other: "Other",
};

function ReportList({
  rows,
  open,
  total,
  page,
  hasMore,
  pagerHref,
}: {
  rows: AdminReportRow[];
  open: boolean;
  total: number;
  page: number;
  hasMore: boolean;
  pagerHref: (page: number) => string;
}) {
  if (!rows.length) {
    return (
      <div className="tile mt-4">
        <span className="microlabel">Queue</span>
        <p className="order__meta">{open ? "No open reports." : "No resolved reports yet."}</p>
      </div>
    );
  }
  return (
    <>
    <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
      {total > rows.length ? (
        <p className="order__meta !mb-0">
          Showing {page * REPORTS_PAGE_SIZE + 1}–{page * REPORTS_PAGE_SIZE + rows.length} of {total}
        </p>
      ) : (
        <span />
      )}
      {open && rows.length > 1 && (
        <ActionDialog
          action={adminResolveReports}
          title={`Resolve all ${rows.length} shown`}
          trigger={`Resolve all ${rows.length} shown`}
          triggerClassName="relbtn !static"
          hidden={{ report_ids: rows.map((r) => r.id).join(",") }}
          confirmNote="Applies one outcome and note to every report listed on this page — the sweep for many flags about the same subject. Each report still gets its own audit row."
          fields={[
            {
              kind: "select",
              name: "outcome",
              label: "Outcome",
              options: [
                { value: "actioned", label: "Actioned — content removed / seller handled" },
                { value: "dismissed", label: "Dismissed — no breach" },
              ],
            },
            { kind: "reason", name: "note", label: "Resolution note" },
          ]}
          submitLabel="Resolve all"
        />
      )}
    </div>
    <div className="rowlist mt-4">
      {rows.map((r) => (
        <div key={r.id} className="jobrow">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="flex items-baseline gap-2">
              <span className="chip chip--live">{REASON_LABEL[r.reason]}</span>
              <Link
                href={
                  r.subject_type === "listing"
                    ? `/admin/listings?q=${encodeURIComponent(r.subjectLabel)}`
                    : `/admin/users?q=${encodeURIComponent(r.subjectLabel)}`
                }
                className="order__name hover:text-live"
              >
                {r.subject_type === "listing" ? "Listing" : "User"}: {r.subjectLabel}
              </Link>
            </span>
            <span className="order__meta">
              by {r.reporter?.username ?? "deleted account"} ·{" "}
              {new Date(r.created_at).toLocaleDateString()}
            </span>
          </div>
          {r.detail && <p className="mt-1 text-[14.5px]">“{r.detail}”</p>}
          {open ? (
            <div className="mt-2 flex gap-2">
              <ActionDialog
                action={adminResolveReport}
                title="Resolve report"
                trigger="Resolve"
                triggerClassName="relbtn !static"
                hidden={{ report_id: r.id }}
                confirmNote="Actioned = you took the subject down or suspended the seller (do that from Listings/Users). Dismissed = no breach."
                fields={[
                  {
                    kind: "select",
                    name: "outcome",
                    label: "Outcome",
                    options: [
                      { value: "actioned", label: "Actioned — content removed / seller handled" },
                      { value: "dismissed", label: "Dismissed — no breach" },
                    ],
                  },
                  { kind: "reason", name: "note", label: "Resolution note" },
                ]}
                submitLabel="Resolve report"
              />
            </div>
          ) : (
            <p className="order__meta mt-1">
              {r.status} — “{r.resolution_note}”
            </p>
          )}
        </div>
      ))}
    </div>
    <Pager
      page={page}
      hasMore={hasMore}
      href={pagerHref}
      prevLabel={open ? "← Back" : "← Newer"}
      nextLabel={open ? "More →" : "Older →"}
    />
    </>
  );
}

/**
 * The moderation queue over `reports` (0018) — the capability the
 * prohibited-items policy promises. Actioning happens on the subject
 * (listing takedown, user suspension); this queue records the decision.
 */
export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; reason?: string; page?: string }>;
}) {
  const { view, reason, page: pageParam } = await searchParams;
  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);
  const activeReason = Object.keys(REASON_LABEL).includes(reason ?? "")
    ? (reason as ReportReason)
    : undefined;
  const [open, closed] = await Promise.all([
    getReports("open", { reason: activeReason, page }),
    getReports("closed", { reason: activeReason, page }),
  ]);

  const pagerHref = (tab: "open" | "resolved") => (target: number) =>
    `/admin/reports?${new URLSearchParams({
      ...(activeReason ? { reason: activeReason } : {}),
      ...(tab === "resolved" ? { view: "resolved" } : {}),
      ...(target > 0 ? { page: String(target) } : {}),
    })}`;

  const linkFor = (r?: string) =>
    `/admin/reports?${new URLSearchParams({
      ...(r ? { reason: r } : {}),
      ...(view === "resolved" ? { view } : {}),
    })}`;

  return (
    <>
      <Rv as="header" className="pagehead">
        <h1>Reports</h1>
        <p className="pagehead__sub">
          User-flagged listings and sellers. Oldest first — silence here is a policy breach left
          standing.
        </p>
      </Rv>

      <div className="filters mb-4" aria-label="Filter by reason">
        <Link href={linkFor()} className={cx("fbtn", !activeReason && "is-on")}>
          All
        </Link>
        {Object.entries(REASON_LABEL).map(([key, label]) => (
          <Link key={key} href={linkFor(key)} className={cx("fbtn", activeReason === key && "is-on")}>
            {label}
          </Link>
        ))}
      </div>

      <SheetTabs
        label="Report queues"
        // resolveTab lives in a client module and can't be called here (Next 16).
        initialTab={view === "resolved" ? "resolved" : "open"}
        tabs={[
          {
            key: "open",
            label: "Open",
            count: open.total,
            live: open.total > 0,
            panel: (
              <ReportList
                rows={open.rows}
                open
                total={open.total}
                page={open.page}
                hasMore={open.hasMore}
                pagerHref={pagerHref("open")}
              />
            ),
          },
          {
            key: "resolved",
            label: "Resolved",
            panel: (
              <ReportList
                rows={closed.rows}
                open={false}
                total={closed.total}
                page={closed.page}
                hasMore={closed.hasMore}
                pagerHref={pagerHref("resolved")}
              />
            ),
          },
        ]}
      />
    </>
  );
}
