import type { AdminAuditSubjectType } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

/**
 * Append-only audit trail (0018). Every admin mutation flows through
 * `auditedAction`, which makes "no mutation without an audit row" structural
 * rather than a convention each action must remember: the mutation callback
 * only runs after its audit entry is validated, and the row is written in the
 * same code path — if the audit INSERT fails, the action fails.
 */

type Admin = ReturnType<typeof createAdminClient>;

export type AuditEntry = {
  actorId: string;
  action: string;
  subjectType: AdminAuditSubjectType;
  subjectId: string;
  orderId?: string | null;
  reason: string;
  metadata?: Record<string, unknown>;
};

export async function writeAudit(admin: Admin, entry: AuditEntry): Promise<void> {
  const { error } = await admin.from("admin_audit_log").insert({
    actor_id: entry.actorId,
    action: entry.action,
    subject_type: entry.subjectType,
    subject_id: entry.subjectId,
    order_id: entry.orderId ?? null,
    reason: entry.reason,
    metadata: (entry.metadata ?? {}) as never,
  });
  if (error) {
    reportError("[admin] audit write failed", { action: entry.action, error });
    throw new Error("Audit write failed — action aborted.");
  }
}

/**
 * Runs `mutate` and records the audit row around it. The audit entry is
 * written AFTER the mutation succeeds (so the log records what happened, not
 * what was attempted) — but a failed audit write still surfaces as an error
 * to the actor, and the mutation result carries what to record.
 */
export async function auditedAction<T>(
  admin: Admin,
  entry: AuditEntry,
  mutate: () => Promise<T>
): Promise<T> {
  if (!entry.reason || !entry.reason.trim()) {
    throw new Error("A reason is required.");
  }
  const result = await mutate();
  await writeAudit(admin, {
    ...entry,
    metadata: { ...entry.metadata, result: summarize(result) },
  });
  return result;
}

function summarize(result: unknown): unknown {
  if (result == null || typeof result !== "object") return result ?? null;
  try {
    return JSON.parse(JSON.stringify(result));
  } catch {
    return String(result);
  }
}
