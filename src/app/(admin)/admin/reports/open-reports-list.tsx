"use client";

import Link from "next/link";
import { useState } from "react";

import { adminHideReportedCar, adminRemoveReportedContent, adminResolveReport, adminResolveReports } from "@/lib/admin/actions";
import type { AdminReportRow } from "@/lib/admin/queries";
import { useHydrated } from "@/lib/hooks/useHydrated";

import { ActionDialog } from "../_components/action-dialog";

const REASON_LABEL: Record<string, string> = {
  prohibited_item: "Prohibited item",
  counterfeit: "Counterfeit",
  stolen_goods: "Stolen goods",
  scam_or_fraud: "Scam or fraud",
  offensive_content: "Offensive content",
  wrong_category: "Wrong category",
  other: "Other",
};

const OUTCOME_FIELDS = [
  {
    kind: "select" as const,
    name: "outcome",
    label: "Outcome",
    // No default: "Actioned" used to be preselected, so a reviewer who only
    // wrote a note recorded a takedown that never happened.
    options: [
      { value: "", label: "Choose…" },
      { value: "actioned", label: "Actioned — handled elsewhere (suspension, listing takedown)" },
      { value: "dismissed", label: "Dismissed — no breach" },
    ],
  },
  { kind: "reason" as const, name: "note", label: "Resolution note" },
];

/**
 * The open-reports queue, selection-based (0024 follow-up): checkboxes per
 * row + select-all-on-page replace the old "resolve everything shown"
 * button, so a sweep can never catch a report the admin didn't mean to
 * touch. One outcome + note applies to exactly the selected ids; the server
 * action validates every id independently and reports failures without
 * aborting the rest (see adminResolveReports).
 */
export function OpenReportsList({ rows }: { rows: AdminReportRow[] }) {
  // Controlled fields must not replace what was typed before hydration
  // (see useHydrated): they stay disabled until the page is live.
  const ready = useHydrated();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-micro">
          <input
            type="checkbox"
            className="sq"
            checked={allSelected}
            disabled={!ready}
            onChange={toggleAll}
            aria-label="Select all reports shown"
          />
          Select all shown
        </label>
        <span className="order__meta !mb-0">{selected.size} selected</span>
        <ActionDialog
          action={adminResolveReports}
          title={`Resolve ${selected.size} selected report${selected.size === 1 ? "" : "s"}`}
          trigger={`Resolve selected (${selected.size})`}
          triggerClassName="relbtn !static"
          triggerDisabled={selected.size === 0}
          hidden={{ report_ids: [...selected].join(",") }}
          confirmNote="Applies one outcome and note to every selected report — a deliberate batch, not everything on the page. Each report still gets its own audit row, and a failure on one report doesn't stop the rest."
          fields={OUTCOME_FIELDS}
          submitLabel="Resolve selected"
        />
      </div>
      <div className="rowlist mt-4">
        {rows.map((r) => (
          <div key={r.id} className="jobrow">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="sq mt-1"
                  checked={selected.has(r.id)}
                  disabled={!ready}
                  onChange={() => toggleOne(r.id)}
                  aria-label={`Select report on ${r.subjectLabel}`}
                />
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="chip chip--live">{REASON_LABEL[r.reason]}</span>
                  <Link href={r.subjectHref} className="order__name hover:text-live">
                    {r.subjectKind}: {r.subjectLabel}
                  </Link>
                </span>
              </label>
              <span className="order__meta">
                by {r.reporter?.username ?? "deleted account"} ·{" "}
                {new Date(r.created_at).toLocaleDateString()}
              </span>
            </div>
            {r.detail && <p className="mt-1 text-body">“{r.detail}”</p>}
            <div className="mt-2 flex gap-2">
              <ActionDialog
                action={adminResolveReport}
                title="Resolve report"
                trigger="Resolve"
                triggerClassName="relbtn !static"
                hidden={{ report_id: r.id }}
                confirmNote="Actioned = you dealt with it elsewhere (a suspension from Users, a takedown from Listings); the reporter is told it was reviewed and followed up, not that anything was removed. To take down a post, reply or build, use its button below instead. Dismissed = no breach."
                fields={OUTCOME_FIELDS}
                submitLabel="Resolve report"
              />
              {(r.subject_type === "post" || r.subject_type === "comment") && (
                <ActionDialog
                  action={adminRemoveReportedContent}
                  title={r.subject_type === "post" ? "Remove this post" : "Remove this reply"}
                  trigger={r.subject_type === "post" ? "Remove post" : "Remove reply"}
                  triggerClassName="relbtn !static"
                  hidden={{ report_id: r.id }}
                  confirmNote="Deletes it for everyone (its text is kept in the audit log) and then deletes its photos from storage, tells the author why, and closes this and every other open report on it (and on a post's replies), telling each reporter."
                  fields={[{ kind: "reason" as const, name: "reason", label: "Reason — shown to the author" }]}
                  submitLabel="Remove"
                />
              )}
              {r.subject_type === "car" && !r.carHidden && (
                <ActionDialog
                  action={adminHideReportedCar}
                  title="Hide this build"
                  trigger="Hide build"
                  triggerClassName="relbtn !static"
                  hidden={{ report_id: r.id }}
                  confirmNote="Makes the build private and holds it there — the owner can't republish it until you lift the hold from Resolved. Nothing is deleted. The owner is told why; this and every other open report on the build are closed and each reporter is told."
                  fields={[{ kind: "reason" as const, name: "reason", label: "Reason — shown to the owner" }]}
                  submitLabel="Hide build"
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
