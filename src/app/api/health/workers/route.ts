import { createAdminClient } from "@/lib/supabase/admin";
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response(null, { status: 404 });
  const { data, error } = await createAdminClient().rpc("worker_health_snapshot", {});
  if (error) return Response.json({ error: "Health data unavailable" }, { status: 503 });
  const health = data as { families: { family: string; stale: boolean; disabled?: boolean }[]; queues: { status: string; oldest?: string; kind?: string; disabled?: boolean }[] };
  const disabled = new Set<string>();
  if (!process.env.TYPESENSE_URL || !process.env.TYPESENSE_API_KEY) disabled.add("search");
  if (!process.env.POSTHOG_KEY) disabled.add("analytics");
  health.families = health.families.map(family => disabled.has(family.family) ? { ...family, stale: false, disabled: true } : family);
  health.queues = health.queues.map(queue => disabled.has(queue.kind ?? "") ? { ...queue, disabled: true } : queue);
  const unhealthy = health.families.some((family) => family.stale) || health.queues.some((queue) => !queue.disabled && (queue.status === "failed" || queue.kind === "capture_recovery" || (queue.status !== "completed" && Boolean(queue.oldest) && Date.now() - Date.parse(queue.oldest!) > 24 * 60 * 60 * 1000)));
  return Response.json(health, { status: unhealthy ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
