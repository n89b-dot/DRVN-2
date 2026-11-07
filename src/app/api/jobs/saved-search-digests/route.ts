import { NextResponse } from "next/server";

import { emailTransport } from "@/lib/email/send";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import { admitDigests, sendDigests, type SendTally } from "@/lib/saved-search-digests";
import { siteUrl } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { trackedWorker } from "@/lib/tracked-worker";

export const dynamic = "force-dynamic";

/**
 * Saved-search email digests (N78): at most one email per saved search per
 * day. pg_cron calls this hourly (drvn-saved-search-digests, migration
 * 20261107200300); each search's window is admitted once a day from 08:00
 * London, and the other runs retry sends. See src/lib/saved-search-digests.ts.
 *
 * With no email provider configured (R-email: none chosen yet) digests are
 * still admitted and recorded in saved_search_email_digests; nothing is sent,
 * the log says so, and a digest not sent on its day expires.
 */
async function run() {
  const admin = createAdminClient();
  try {
    const sweep = await admin.rpc("saved_search_digest_sweep");
    if (sweep.error) throw new Error(`Digest sweep: ${sweep.error.code}`);

    const admitted = await admitDigests(admin);

    const transport = emailTransport();
    let sent: SendTally | null = null;
    if (transport) sent = await sendDigests(admin, transport, siteUrl());
    else {
      console.info("[saved-search-digests] no email provider configured (EMAIL_PROVIDER unset): digests are recorded, none sent", {
        admitted: admitted.admitted,
      });
    }

    const failed = admitted.failed + (sent?.errors ?? 0);
    return NextResponse.json(
      { ...admitted, provider: transport?.name ?? null, sent, sweep: sweep.data },
      { status: failed ? 503 : 200 },
    );
  } catch (error) {
    reportError("[saved-search-digests] pass failed", { error: String(error) });
    return NextResponse.json({ error: true }, { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

export async function POST(request: Request) {
  return trackedWorker("savedSearchDigests", request, run);
}

export const maxDuration = 300;
