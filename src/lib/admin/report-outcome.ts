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
 * After a takedown, closes every other open report on the same thing — and,
 * for a removed post, the open reports on its replies, which went with it.
 * Returns the ids it closed so each reporter can be told.
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
