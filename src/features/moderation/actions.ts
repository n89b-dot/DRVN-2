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
  "other",
];

export async function fileReport(_prev: ReportState, formData: FormData): Promise<ReportState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  if (!(await allowAction(RATE_LIMITS.fileReport, user.id))) {
    return { error: rateLimitMessage(RATE_LIMITS.fileReport) };
  }

  const subjectType = String(formData.get("subject_type") ?? "");
  const subjectId = String(formData.get("subject_id") ?? "");
  const reason = String(formData.get("reason") ?? "") as ReportReason;
  const detail = String(formData.get("detail") ?? "").trim().slice(0, 1000);

  if (!["listing", "user"].includes(subjectType) || !subjectId) {
    return { error: "Missing what you're reporting." };
  }
  if (!REASONS.includes(reason)) return { error: "Pick what's wrong." };

  const { error } = await supabase.from("reports").insert({
    reporter_id: user.id,
    subject_type: subjectType as "listing" | "user",
    subject_id: subjectId,
    reason,
    detail: detail || null,
  });
  if (error) return { error: "The report couldn't be filed — try again." };

  return { ok: "Reported — DRVN will review it. Thanks for flagging." };
}
