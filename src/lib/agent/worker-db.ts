import "server-only";

import { Pool } from "pg";

import type { AgentDb } from "./worker";

/**
 * The worker's own connection: the agent_worker role through the pooler
 * (docs/production-runbook.md §13a). There is deliberately no fallback to the
 * service role: without AGENT_WORKER_DATABASE_URL the worker doesn't run.
 * The first connection checks it really is agent_worker, so a misconfigured
 * URL with a powerful role refuses instead of acting with too much authority.
 */

let pool: Pool | null = null;
let verified = false;

export function agentWorkerConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(env.AGENT_WORKER_DATABASE_URL);
}

export async function agentWorkerDb(): Promise<AgentDb | null> {
  const url = process.env.AGENT_WORKER_DATABASE_URL;
  if (!url) return null;
  pool ??= new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 10_000, statement_timeout: 15_000 });
  if (!verified) {
    const who = await pool.query<{ role: string }>("select current_user as role");
    if (who.rows[0]?.role !== "agent_worker") {
      await pool.end();
      pool = null;
      throw new Error("AGENT_WORKER_DATABASE_URL must connect as agent_worker");
    }
    verified = true;
  }
  return pool;
}
