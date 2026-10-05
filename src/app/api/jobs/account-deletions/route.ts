import { processAccountExports, purgeExpiredAccountExports } from "@/lib/account-export-worker";
import { trackedWorker } from "@/lib/tracked-worker";
import { processAccountDeletions } from "@/lib/account-deletion-worker";
import { flushMonitoring, reportError } from "@/lib/monitoring";
import { ALL_PUBLIC_KINDS } from "@/lib/supabase/public-cache";
import { clearPublicData } from "@/lib/supabase/clear-public-data";
async function run(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 404 });
  try {
    const results = await Promise.allSettled([processAccountDeletions(), processAccountExports(), purgeExpiredAccountExports()]);
    // A deleted account's cars, parts and posts leave the shared copy
    // signed-out visitors read as soon as they leave the database.
    if (results[0].status === "fulfilled" && results[0].value.completed) clearPublicData(...ALL_PUBLIC_KINDS);
    if (results.some(result => result.status === "rejected")) throw new Error("Privacy work requires retry");
    return Response.json(Object.fromEntries(results.map((result, index) => [["deletions", "exports", "expiry"][index], result.status === "fulfilled" ? result.value : null])));
  }
  catch (error) { reportError("[account-deletion] worker failed", error); return new Response("Deletion requires retry", { status: 503 }); }
  finally { await flushMonitoring(); }
}

export async function POST(request: Request) { return trackedWorker("deletions", request, () => run(request)); }

export const maxDuration = 300;
