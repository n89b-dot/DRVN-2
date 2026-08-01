import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { SheetTabs } from "@/components/ui";
import { adminResolveReport } from "@/lib/admin/actions";
import { getReports, type AdminReportRow } from "@/lib/admin/queries";
import type { ReportReason } from "@/lib/database.types";
import { cx } from "@/lib/format";

import { ActionDialog } from "../_components/action-dialog";

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

function ReportList({ rows, open }: { rows: AdminReportRow[]; open: boolean }) {
  if (!rows.length) {
    return (
      <div className="tile mt-4">
        <span className="microlabel">Queue</span>
        <p className="order__meta">{open ? "No open reports." : "No resolved reports yet."}</p>
      </div>
    );
  }
  return (
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
  searchParams: Promise<{ view?: string; reason?: string }>;
}) {
  const { view, reason } = await searchParams;
  const activeReason = Object.keys(REASON_LABEL).includes(reason ?? "")
    ? (reason as ReportReason)
    : undefined;
  const [open, closed] = await Promise.all([
    getReports("open", { reason: activeReason }),
    getReports("closed", { reason: activeReason }),
  ]);

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
            count: open.length,
            live: open.length > 0,
            panel: <ReportList rows={open} open />,
          },
          { key: "resolved", label: "Resolved", panel: <ReportList rows={closed} open={false} /> },
        ]}
      />
    </>
  );
}
