import type { AdminRole } from "./guard";

/**
 * The centralized admin capability registry (brief §L). Every audit action
 * name belongs to a family here; `capabilityFor` is how code asks "what does
 * this action require?". Today the answer is always the full 'admin' role —
 * viewers read, admins act — and the real enforcement is the database
 * (`assert_admin_actor`, 0040), called by auditedAction before any mutation.
 *
 * The extension path, when finer roles actually exist (specialized
 * moderators, shop staff): add roles to AdminRole, set `requires` per family
 * here, teach assert_admin_actor a capability argument (0040's header
 * documents the shape), and nothing about the action call sites changes.
 * Deliberately no capability *table* yet — no speculative machinery.
 */

export type AdminCapability = {
  /** Audit-action prefix, e.g. "order." matches "order.force_refund". */
  family: string;
  description: string;
  requires: AdminRole;
};

export const ADMIN_CAPABILITIES: AdminCapability[] = [
  { family: "order.", description: "Force refunds and message order parties", requires: "admin" },
  { family: "dispute.", description: "Resolve disputes", requires: "admin" },
  { family: "listing.", description: "Take down and restore listings", requires: "admin" },
  { family: "car.", description: "Lift a moderation hold on a build", requires: "admin" },
  { family: "user.", description: "Suspend and unsuspend accounts", requires: "admin" },
  { family: "payments.", description: "Run workers, replay webhooks, close recoveries", requires: "admin" },
  { family: "recovery.", description: "Close payment-recovery cases", requires: "admin" },
  { family: "report.", description: "Action or dismiss moderation reports", requires: "admin" },
  { family: "note.", description: "Record internal notes", requires: "admin" },
  { family: "case.", description: "Claim, label and work operations cases", requires: "admin" },
  { family: "invitation.", description: "Issue and revoke beta invitations", requires: "admin" },
  { family: "operation.", description: "Record the outcome of a provider operation that lost its answer", requires: "admin" },
  { family: "product.", description: "Decide product identity: merge, keep separate, dismiss", requires: "admin" },
  { family: "agent.", description: "Pause and resume the agent: everyone, one side, one member, mandate, listing or account", requires: "admin" },
];

export function capabilityFor(action: string): AdminCapability | null {
  return ADMIN_CAPABILITIES.find((capability) => action.startsWith(capability.family)) ?? null;
}

/** True when the role satisfies the action's family requirement. */
export function roleAllows(role: AdminRole, action: string): boolean {
  const capability = capabilityFor(action);
  if (!capability) return false; // unregistered action families never pass
  return capability.requires === "viewer" || role === "admin";
}
