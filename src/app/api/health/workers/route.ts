import { createAdminClient } from "@/lib/supabase/admin";
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 404 });
  const { data, error } = await createAdminClient().rpc("worker_health_snapshot", {});
  if (error) return Response.json({ error: "Health data unavailable" }, { status: 503 });
  const health = data as { families: { stale: boolean }[]; queues: { status: string }[] };
  const unhealthy = health.families.some((family) => family.stale) || health.queues.some((queue) => queue.status === "failed");
  return Response.json(health, { status: unhealthy ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
