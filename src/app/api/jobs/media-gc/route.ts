import { trackedWorker } from "@/lib/tracked-worker";
import { cronAuthorized } from "@/lib/cron-auth";
import { deleteMediaIfUnreferenced } from "@/lib/media-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";

/**
 * Staged-media garbage collector (migration 0029). Client uploads hit storage
 * before any DB row references them; each is ledgered in `staged_uploads` and
 * the persisting action stamps `consumed_at`. Rows still unconsumed after 48h
 * are abandoned forms — this sweep removes their storage objects, re-checking
 * every referencing table first so a URL that got persisted without a
 * finalize stamp is healed (marked consumed), never deleted.
 *
 * Same door as /api/jobs/transfers: bearer-secret gated, 404 to anyone else.
 * SCHEDULING — this route does not run itself. Point an external cron (or a
 * pg_cron + pg_net invoker like 0020's transfer worker) at it daily:
 *   curl -X POST https://<app-host>/api/jobs/media-gc \
 *     -H "Authorization: Bearer $CRON_SECRET"
 * See supabase/MIGRATIONS.md.
 */

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const BATCH = 200;

async function run(request: Request) {
  if (!process.env.CRON_SECRET) {
    reportError("[media-gc] CRON_SECRET is not configured");
    return new Response(null, { status: 404 });
  }
  if (!cronAuthorized(request)) {
    return new Response(null, { status: 404 });
  }

  try {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

    const { data: stale, error } = await admin
      .from("staged_uploads")
      .select("id, url")
      .is("consumed_at", null)
      .lt("created_at", cutoff)
      .order("created_at")
      .limit(BATCH);
    if (error) throw error;

    let removed = 0;
    let healed = 0;
    let skipped = 0;
    for (const row of stale ?? []) {
      const outcome = await deleteMediaIfUnreferenced(row.url);
      if (outcome === "removed") {
        // deleteMediaIfUnreferenced already deleted the staged row by url.
        removed += 1;
      } else if (outcome === "referenced") {
        // Persisted without a finalize stamp — heal the ledger, keep the object.
        const healedRow = await admin
          .from("staged_uploads")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", row.id);
        if (healedRow.error) throw healedRow.error;
        healed += 1;
      } else {
        // Transient storage error or unparseable URL — logged inside the
        // helper; left for the next pass rather than dropped on the floor.
        skipped += 1;
      }
    }

    return Response.json({ scanned: stale?.length ?? 0, removed, healed, skipped }, { status: skipped ? 503 : 200 });
  } catch (error) {
    reportError("[media-gc] sweep failed", error);
    return new Response("worker failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

export async function POST(request: Request) { return trackedWorker("media", request, () => run(request)); }

export const maxDuration = 300;
