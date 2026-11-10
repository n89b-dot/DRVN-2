/**
 * The settled chargeback states (#108, 20261110180000): won, warning closed,
 * lost, and written off. Every other journal state (open, loss_pending,
 * recovery, or one added later) is an unresolved chargeback, and fails
 * closed. The database's list is private.dispute_terminal_states(); a test
 * (dispute-terminal.test.ts) checks the two agree.
 */
export const DISPUTE_TERMINAL_STATES = ["won", "warning_closed", "lost", "written_off"] as const;

const TERMINAL = new Set<string>(DISPUTE_TERMINAL_STATES);

export function disputeSettled(state: string | null | undefined): boolean {
  return state != null && TERMINAL.has(state);
}
