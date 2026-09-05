import { createAdminClient } from "@/lib/supabase/admin";
import { evaluateWorkerHealth } from "@/lib/worker-health";
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 404 });
  const { data, error } = await createAdminClient().rpc("worker_health_snapshot", {});
  if (error) return Response.json({ error: "Health data unavailable" }, { status: 503 });
  try {
    const {unhealthy,...health}=evaluateWorkerHealth(data,{searchEnabled:Boolean(process.env.TYPESENSE_URL&&process.env.TYPESENSE_API_KEY),analyticsEnabled:Boolean(process.env.POSTHOG_KEY)});
    return Response.json(health,{status:unhealthy?503:200,headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({error:"Health data incomplete"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
}
