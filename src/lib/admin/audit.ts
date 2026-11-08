import { createClient } from "@/lib/supabase/server";
import type { AdminAuditSubjectType } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/monitoring";

import { capabilityFor } from "./capabilities";

/** Database-only commands commit their mutation and audit in one transaction.
 * External operations journal authorization before invoking their durable provider
 * operation, then record completion or reconciliation requirements. */

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

/**
 * Thrown by an external operation's mutation when it is PROVEN that nothing
 * was done and nothing is still on its way — a refund refused before it was
 * reserved, or declined by Stripe at creation (N134). auditedAction then asks
 * the database to close the request as not applied, which it does only when
 * the durable refund records agree; anything less keeps the fence for the
 * operator's reconciliation, exactly like an unknown outcome.
 */
export class RefusedOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RefusedOperationError";
  }
}

/** External actions whose refusals the database can check against records. */
const RELEASABLE_ON_REFUSAL = new Set(["order.force_refund"]);

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
    throw new Error("Audit write failed.");
  }
}

export async function auditedAction<T>(
  admin: Admin,
  entry: AuditEntry,
  mutate: () => Promise<T>
): Promise<T> {
  if (!entry.reason || !entry.reason.trim()) {
    throw new Error("A reason is required.");
  }
  if (!capabilityFor(entry.action)) {
    throw new Error(`Unregistered admin action family: ${entry.action}`);
  }
  // Database boundary (0040): the mutation runs on the service role, which RLS
  // cannot distinguish, so the database itself verifies the named actor is a
  // full admin BEFORE anything mutates — whatever the app layer believed.
  const { error: actorError } = await admin.rpc("assert_admin_actor", {
    p_actor: entry.actorId,
  });
  if (actorError) {
    reportError("[admin] actor assertion refused", { action: entry.action, actorError });
    throw new Error("This account is not authorized to act — mutation refused.");
  }
  const transactional = new Set(["listing.remove", "listing.restore", "user.suspend", "user.unsuspend", "report.actioned", "report.dismissed", "recovery.recovered", "recovery.written_off", "note.internal", "dispute.resolve_for_seller", "dispute.reopen", "order.message_parties", "case.claim", "case.release", "case.update"]);
  if (transactional.has(entry.action)) {
    const session = await createClient();
    const { data, error } = await session.rpc("execute_admin_command", {
      p_action: entry.action, p_subject: entry.subjectId, p_reason: entry.reason,
      p_data: JSON.parse(JSON.stringify({ ...entry.metadata, subjectType: entry.subjectType, orderId: entry.orderId ?? null })),
    });
    if (error) throw new Error(error.message);
    return data as T;
  }
  const claim = await admin.rpc("begin_admin_external_operation", {
    p_actor: entry.actorId, p_action: entry.action, p_subject_type: entry.subjectType,
    p_subject: entry.subjectId, p_order: entry.orderId ?? null, p_reason: entry.reason,
    p_metadata: JSON.parse(JSON.stringify(entry.metadata ?? {})),
  });
  if (claim.error || !claim.data) throw new Error("External operation journal unavailable; action refused");
  const { operationId, reused } = claim.data as { operationId: string; reused: boolean };
  // This action atomically adopts its linked refund operation before provider
  // dispatch. Re-entering it reconciles that operation, including audit crashes.
  if (reused && entry.action !== "recovery.replace_refund") throw new Error(`Operation ${operationId} is awaiting reconciliation. Resume its existing provider operation; do not create another.`);
  let result: T;
  try { result = await mutate(); } catch (error) {
    if (error instanceof RefusedOperationError && RELEASABLE_ON_REFUSAL.has(entry.action)) {
      // A proven refusal leaves nothing to reconcile: close the request so the
      // next attempt isn't blocked — if the refund records agree.
      const { data: release, error: releaseError } = await admin.rpc("release_refused_admin_refund", {
        p_actor: entry.actorId, p_operation: operationId, p_detail: error.message,
      });
      if (!releaseError && (release as { released?: boolean } | null)?.released) throw error;
      reportError("[admin] refused operation kept for reconciliation", { operationId, releaseError, release });
    }
    try { await writeAudit(admin, { ...entry, metadata: { ...entry.metadata, operationId, phase: "failed_or_requires_reconciliation" } }); }
    catch { reportError("[admin] operation needs reconciliation", { operationId }); }
    throw error;
  }
  try {
    await writeAudit(admin, { ...entry, metadata: { ...entry.metadata, operationId, phase: "completed", result: summarize(result) } });
  } catch {
    throw new Error(`The operation ran, but its completion record could not be saved. Do not repeat it; reconcile operation ${operationId}.`);
  }
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
