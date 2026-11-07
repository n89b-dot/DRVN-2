/**
 * Where /agent puts "Stop negotiating for me" (readiness 64): on every live
 * (active or paused) buyer mandate, exactly once.
 *
 * - On its Working row, while its task is open and not waiting on the buyer.
 * - On its Needs you row, while the agent waits on the buyer's answer: that
 *   task is not on Working, so without this the buyer had no Stop there.
 * - Otherwise on a row of its own: a mandate whose task finished (a failed
 *   opening offer leaves the mandate live with nothing in progress and no
 *   offer page to stop it from), or whose task isn't in the page's read.
 */

export type StopMandate = { id: string; listing_id: string; scope: string; status: string };
export type StopTask = { id: string; scope: string; mandate_id: string | null; listing_id: string | null; finished_at: string | null };
export type StopApproval = { id: string; task_id: string };

export type BuyerStops = {
  /** Working task id → its live buyer mandate. */
  onTask: Map<string, string>;
  /** Needs-you approval id → its live buyer mandate. */
  onApproval: Map<string, string>;
  /** Live buyer mandates no row above carries. */
  alone: StopMandate[];
};

export function buyerStops(mandates: readonly StopMandate[], tasks: readonly StopTask[], approvals: readonly StopApproval[]): BuyerStops {
  const live = new Map(mandates.filter((m) => m.scope === "buyer" && (m.status === "active" || m.status === "paused")).map((m) => [m.id, m]));
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const needs = new Set(approvals.map((a) => a.task_id));
  const placed = new Set<string>();

  const onApproval = new Map<string, string>();
  for (const approval of approvals) {
    const mandate = taskById.get(approval.task_id)?.mandate_id;
    if (mandate && live.has(mandate) && !placed.has(mandate)) {
      onApproval.set(approval.id, mandate);
      placed.add(mandate);
    }
  }
  const onTask = new Map<string, string>();
  for (const task of tasks) {
    if (task.finished_at || task.scope !== "buyer" || needs.has(task.id) || !task.mandate_id) continue;
    if (live.has(task.mandate_id) && !placed.has(task.mandate_id)) {
      onTask.set(task.id, task.mandate_id);
      placed.add(task.mandate_id);
    }
  }
  const alone = [...live.values()].filter((m) => !placed.has(m.id));
  return { onTask, onApproval, alone };
}
