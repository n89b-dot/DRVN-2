/**
 * What a reporter is told, and which other reports a takedown settles
 * (OS-W21 N140).
 *
 * Marking a report "actioned" from the queue used to tell the reporter "We
 * took action on the … you reported" even when nothing was removed, and
 * removing a post left every other open report on that same post (and on
 * its replies) sitting in the queue. A takedown now closes those siblings
 * and tells each of their reporters what really happened.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, ReportSubjectType } from "@/lib/database.types";

/** What the reporter can truthfully be told. */
export type ReporterOutcome =
  /** The thing itself was taken down from this console (removed or hidden). */
  | "removed"
  /** Marked actioned without a takedown here — the admin followed up elsewhere. */
  | "reviewed"
  /** No breach found. */
  | "dismissed";

export function reportSubjectWord(subjectType: ReportSubjectType | string): string {
  switch (subjectType) {
    case "post":
      return "post";
    case "comment":
      return "reply";
    case "listing":
      return "listing";
    case "car":
      return "build";
    default:
      return "member";
  }
}

export function reporterNotice(subjectType: ReportSubjectType | string, outcome: ReporterOutcome) {
  const what = reportSubjectWord(subjectType);
  const body =
    outcome === "removed"
      ? `We took down the ${what} you reported.`
      : outcome === "reviewed"
        ? `We reviewed the ${what} you reported and followed it up under DRVN's rules.`
        : `We looked at the ${what} you reported and didn't find a breach of DRVN's rules.`;
  return {
    title: "Thanks — we reviewed your report",
    body,
    section:
      subjectType === "post" || subjectType === "comment" || subjectType === "car"
        ? ("engagement" as const)
        : ("marketplace" as const),
  };
}

/** The queue's "Actioned" button: no takedown happened from the report. */
export function outcomeForResolution(outcome: "actioned" | "dismissed"): ReporterOutcome {
  return outcome === "actioned" ? "reviewed" : "dismissed";
}

/**
 * After a listing takedown or a hidden build, closes every other open report
 * on the same thing. Returns the ids it closed so each reporter can be told.
 * A removed post or reply doesn't come here: take_down_reported_content
 * (20261108130100) closes its reports, and its replies', in the same
 * transaction, since a post's reply ids can outnumber one PostgREST read.
 */
export async function closeSiblingReports(
  admin: SupabaseClient<Database>,
  args: {
    subjects: { type: ReportSubjectType; ids: string[] }[];
    exceptReportId: string | null;
    adminId: string;
    note: string;
  }
): Promise<{ id: string; subject_type: string }[]> {
  const closed: { id: string; subject_type: string }[] = [];
  for (const subject of args.subjects) {
    if (!subject.ids.length) continue;
    let query = admin
      .from("reports")
      .update({
        status: "actioned",
        resolved_by: args.adminId,
        resolved_at: new Date().toISOString(),
        resolution_note: args.note,
      })
      .eq("subject_type", subject.type)
      .in("subject_id", subject.ids)
      .eq("status", "open");
    if (args.exceptReportId) query = query.neq("id", args.exceptReportId);
    const { data, error } = await query.select("id, subject_type");
    if (error) throw new Error(error.message);
    closed.push(...(data ?? []));
  }
  return closed;
}

/** A report a takedown closed, as take_down_reported_content returns it. */
export type ClosedReport = { id: string; subject_type: string; reporter_id: string | null };

/** Notifications inserted per request: well under PostgREST's body limits. */
const REPORTER_NOTICE_CHUNK = 500;

/**
 * The "we reviewed your report" notices for every report a takedown closed —
 * one per reporter and kind of thing, so someone who reported a post and ten
 * of its replies hears twice, not eleven times. Reports with no reporter
 * (their account is gone) are skipped.
 */
export function reporterNotifications(closed: ClosedReport[], outcome: ReporterOutcome) {
  const seen = new Set<string>();
  const rows: Database["public"]["Tables"]["notifications"]["Insert"][] = [];
  for (const report of closed) {
    if (!report.reporter_id) continue;
    const key = `${report.reporter_id}:${report.subject_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const notice = reporterNotice(report.subject_type, outcome);
    rows.push({
      user_id: report.reporter_id,
      kind: "report_reviewed",
      section: notice.section,
      title: notice.title,
      body: notice.body,
      href: null,
      actor_id: null,
    });
  }
  return rows;
}

/** Tells every reporter whose report a takedown closed, in batches. */
export async function notifyReporters(
  admin: SupabaseClient<Database>,
  closed: ClosedReport[],
  outcome: ReporterOutcome
): Promise<number> {
  const rows = reporterNotifications(closed, outcome);
  for (let start = 0; start < rows.length; start += REPORTER_NOTICE_CHUNK) {
    const { error } = await admin.from("notifications").insert(rows.slice(start, start + REPORTER_NOTICE_CHUNK));
    if (error) throw new Error(error.message);
  }
  return rows.length;
}
