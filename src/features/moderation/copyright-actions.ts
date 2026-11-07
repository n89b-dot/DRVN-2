"use server";

import { headers } from "next/headers";

import { abuseIdentity } from "@/lib/abuse-identity";
import { sendAdminAlert } from "@/lib/admin/alerts";
import { reportError } from "@/lib/monitoring";
import { allowAction, RATE_LIMITS, rateLimitMessage } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

import { copyrightHosts } from "@/lib/copyright/hosts";
import { validateCopyrightNotice, type CopyrightNoticeErrors } from "@/lib/copyright/notice";

export type CopyrightNoticeState = {
  ok?: string;
  error?: string;
  errors?: CopyrightNoticeErrors;
} | null;

/**
 * Files a copyright notice from the public /copyright page (R69-dmca). No
 * account is needed: a rights holder usually has none. The notice is stored
 * by the server (members can't write the table), admins are alerted, and the
 * admin console's Copyright page is where it is acted on.
 */
export async function submitCopyrightNotice(
  _prev: CopyrightNoticeState,
  formData: FormData
): Promise<CopyrightNoticeState> {
  const hosts = copyrightHosts();
  const { notice, errors } = validateCopyrightNotice(formData, [...hosts.site, ...hosts.storage]);
  if (!notice) return { error: "Some details are missing. Check the highlighted fields.", errors };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const subject = abuseIdentity(await headers(), user?.id);
  if (!(await allowAction(RATE_LIMITS.copyrightNotice, subject))) {
    return { error: rateLimitMessage(RATE_LIMITS.copyrightNotice) };
  }

  const { data, error } = await createAdminClient()
    .from("copyright_notices")
    .insert({ ...notice, submitted_by: user?.id ?? null })
    .select("id")
    .single();
  if (error || !data) {
    reportError("[copyright] notice could not be stored", { error });
    return { error: "We couldn't send your notice. Try again in a moment." };
  }

  await sendAdminAlert({
    kind: "copyright_notice",
    title: "A copyright notice arrived",
    detail: `${notice.content_urls.length} link(s) named. Review it in Admin → Copyright.`,
    dedupKey: `copyright-notice:${data.id}`,
  });

  return {
    ok: `Notice received (reference ${data.id.slice(0, 8)}). We'll review it and reply to ${notice.claimant_email}.`,
  };
}
