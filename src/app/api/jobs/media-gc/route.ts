import { trackedWorker } from "@/lib/tracked-worker";
import { ensureMediaStorageOrigin, processMediaCleanupQueue, removeMediaObject } from "@/lib/media-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import { cronAuthorized } from "@/lib/cron-auth";

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
 *
 * Since 20261107150500 (N12) a staged row can only be written by the server
 * and only for an object in its owner's own folder, and this sweep removes
 * an object only as that verified owner — a row naming anyone else's object
 * (registered before the lockdown) is dropped from the ledger without
 * touching storage. The same run works the cleanup queue of deleted cars,
 * posts and listings (N51).
 */

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;
const BATCH = 200;
// Leaves the staged sweep most of maxDuration (300 s).
const CLEANUP_BUDGET_MS = 150_000;

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

    await ensureMediaStorageOrigin(admin);
    // Drain the deleted-content queue in batches within a time budget, so a
    // backlog still clears within the day the privacy page promises. Stop
    // early when a batch makes no progress (only busy or failing rows left).
    const started = Date.now();
    const cleanup = { scanned: 0, removed: 0, retained: 0, rejected: 0, busy: 0, failed: 0 };
    for (;;) {
      const batch = await processMediaCleanupQueue({ admin, limit: BATCH });
      for (const key of Object.keys(cleanup) as (keyof typeof cleanup)[]) cleanup[key] += batch[key];
      const progressed = batch.removed + batch.retained + batch.rejected;
      if (batch.scanned < BATCH || progressed === 0 || Date.now() - started > CLEANUP_BUDGET_MS) break;
    }

    const { data: stale, error } = await admin
      .from("staged_uploads")
      .select("id, owner_id, bucket, path")
      .is("consumed_at", null)
      .lt("created_at", cutoff)
      .order("created_at")
      .limit(BATCH);
    if (error) throw error;

    let removed = 0;
    let healed = 0;
    let skipped = 0;
    let rejected = 0;
    for (const row of stale ?? []) {
      const outcome = await removeMediaObject({ bucket: row.bucket, path: row.path }, row.owner_id, { admin });
      if (outcome === "removed") {
        // removeMediaObject already deleted the staged row.
        removed += 1;
      } else if (outcome === "referenced") {
        // Persisted without a finalize stamp — heal the ledger, keep the object.
        const healedRow = await admin
          .from("staged_uploads")
          .update({ consumed_at: new Date().toISOString() })
          .eq("id", row.id);
        if (healedRow.error) throw healedRow.error;
        healed += 1;
      } else if (outcome === "invalid") {
        // Not an object its owner uploaded: not a ledger entry worth keeping,
        // and never a reason to touch storage.
        const dropped = await admin.from("staged_uploads").delete().eq("id", row.id);
        if (dropped.error) throw dropped.error;
        rejected += 1;
      } else {
        // Busy (another remover holds it), or a transient storage or lookup error — logged inside the helper; left
        // for the next pass rather than dropped on the floor.
        skipped += 1;
      }
    }

    const failing = skipped + cleanup.failed;
    return Response.json(
      { scanned: stale?.length ?? 0, removed, healed, skipped, rejected, cleanup },
      { status: failing ? 503 : 200 }
    );
  } catch (error) {
    reportError("[media-gc] sweep failed", error);
    return new Response("worker failed", { status: 500 });
  } finally {
    await flushMonitoring();
  }
}

export async function POST(request: Request) { return trackedWorker("media", request, () => run(request)); }

export const maxDuration = 300;
