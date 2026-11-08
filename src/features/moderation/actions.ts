"use server";

import { redirect } from "next/navigation";

import type { ReportReason } from "@/lib/database.types";
import { RATE_LIMITS, allowAction, rateLimitMessage } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * The report button's server half (Rev E item 13) — the capability the
 * prohibited-items policy promises. Inserts through the RLS client: the 0018
 * policy only accepts rows where reporter_id = auth.uid(), so this can't file
 * as anyone else even if the form lies. Reports land in the admin console's
 * moderation queue.
 */

export type ReportState = { error?: string; ok?: string } | null;

const REASONS: ReportReason[] = [
  "prohibited_item",
  "counterfeit",
  "stolen_goods",
  "scam_or_fraud",
  "offensive_content",
  "wrong_category",
  "copyright",
  "other",
];

export async function fileReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const reporterId = user.id;

  const subjectType = String(formData.get("subject_type") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const reason = String(formData.get("reason") ?? "") as ReportReason;
  // Where it was filed from ("From conversation <id>") leads the detail so a
  // reviewer can open the thread; the reporter's own words follow.
  const context = String(formData.get("context") ?? "").trim().slice(0, 120);
  const typed = String(formData.get("detail") ?? "").trim();
  const detail = (context ? `${context}${typed ? `\n${typed}` : ""}` : typed).slice(0, 1000);

  // A post or a reply on one (20260928182300) as well as a listing or a member.
  if (!["listing", "user", "post", "comment"].includes(subjectType) || !subjectId) {
    return { error: "Missing what you're reporting." };
  }
  if (!REASONS.includes(reason)) return { error: "Pick what's wrong." };

  const reportId = String(formData.get("report_id") ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reportId)) {
    return { error: "Refresh this page before filing your report." };
  }
  const success = { ok: "Reported — DRVN will review it. Thanks for flagging." };
  async function readExisting() {
    return supabase.from("reports").select("reporter_id, subject_type, subject_id, reason, detail").eq("id", reportId).maybeSingle();
  }
  function matches(row: { reporter_id: string | null; subject_type: string; subject_id: string; reason: string; detail: string | null }) {
    return row.reporter_id === reporterId && row.subject_type === subjectType && row.subject_id === subjectId && row.reason === reason && row.detail === (detail || null);
  }
  const existing = await readExisting();
  if (existing.error) return { error: "Couldn't check whether your report was filed. Try again." };
  if (existing.data) return matches(existing.data) ? success : { error: "This report changed after filing. Refresh the page to file another report." };
  if (!(await allowAction(RATE_LIMITS.fileReport, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.fileReport) };
  }

  const { error } = await supabase.from("reports").insert({
    id: reportId,
    reporter_id: user.id,
    subject_type: subjectType as "listing" | "user" | "post" | "comment",
    subject_id: subjectId,
    reason,
    detail: detail || null,
  });
  if (error) {
    const committed = await readExisting();
    if (committed.error || !committed.data || !matches(committed.data)) {
      return { error: "The report couldn't be confirmed — try again with the same details." };
    }
  }

  return success;
}
