import { processAccountDeletions } from "@/lib/account-deletion-worker";
import { flushMonitoring, reportError } from "@/lib/monitoring";
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 404 });
  try { return Response.json(await processAccountDeletions()); }
  catch (error) { reportError("[account-deletion] worker failed", error); return new Response("Deletion requires retry", { status: 503 }); }
  finally { await flushMonitoring(); }
}
