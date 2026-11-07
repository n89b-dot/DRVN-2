import "server-only";

import { reportError } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Whether an admin kill switch stops this member's agent from calling the
 * model (readiness report two, issue 66). The worker checks the switches in
 * the database before every write (agent_halt_reason); chat and the
 * sentence-to-filters call had no equivalent, so "Every agent" left the
 * model running. The switches that reach the model are the ones that name
 * nobody else: `all`, and this member's own `member` or `account` row.
 * A switch that can't be read halts: no turn is better than one past it.
 * agent_spend_reserve (20261107100000) checks the same switches again in the
 * database, so a caller that skipped this still can't spend.
 */
export async function agentModelHalted(ownerId: string): Promise<boolean> {
  // Only a member id can name a member here: anything else is unreadable.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId)) return true;
  try {
    const { data, error } = await createAdminClient()
      .from("agent_controls")
      .select("scope")
      .is("cleared_at", null)
      .or(`scope.eq.all,and(scope.eq.member,subject_id.eq.${ownerId}),and(scope.eq.account,subject_id.eq.${ownerId})`)
      .limit(1);
    if (error) {
      reportError("[agent] kill switches unreadable", { code: error.code });
      return true;
    }
    return (data?.length ?? 0) > 0;
  } catch (error) {
    // No client (missing configuration) or no answer: the same as unreadable.
    reportError("[agent] kill switches unreadable", { kind: error instanceof Error ? error.name : "unknown" });
    return true;
  }
}
