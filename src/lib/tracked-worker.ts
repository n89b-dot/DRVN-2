import "server-only";
import { randomUUID } from "node:crypto";
import { cronAuthorized } from "./cron-auth";
import { createAdminClient } from "./supabase/admin";
export async function trackedWorker(family: string, request: Request, run: () => Promise<Response>) {
  if (!cronAuthorized(request)) return new Response(null, { status: 404 });
  const admin = createAdminClient(), id = randomUUID();
  const started = await admin.rpc("record_worker_run", { p_id: id, p_family: family, p_status: "running" });
  if (started.error) return new Response("Worker tracking unavailable", { status: 503 });
  let response: Response;
  try { response = await run(); } catch { response = new Response("Worker requires retry", { status: 503 }); }
  const done = await admin.rpc("record_worker_run", { p_id: id, p_family: family, p_status: response.ok ? "succeeded" : "failed", p_summary: { http_status: response.status } });
  return done.error ? new Response("Worker completion unavailable", { status: 503 }) : response;
}
