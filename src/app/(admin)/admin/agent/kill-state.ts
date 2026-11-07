/**
 * What the admin agent page knows about the kill switches (R-audit-killstate).
 * A failed read of `agent_controls` is not "no switch is on": the page says
 * the state is unknown and offers no Pause or Lift until it reloads, so an
 * operator never acts on, or trusts, a reading the page never made.
 */

export type ControlRow = { id: string; scope: string; subject_id: string | null; reason: string; set_at: string };

export type KillState =
  | { known: false }
  | {
      known: true;
      /** A global switch ("all", "seller", "buyer") is on. */
      isOn: (scope: string) => boolean;
      /** Switches on one member, mandate, listing or account. */
      targeted: ControlRow[];
    };

export function readKillState(result: { data: unknown; error: unknown }): KillState {
  if (result.error || !Array.isArray(result.data)) return { known: false };
  const live = result.data as ControlRow[];
  return {
    known: true,
    isOn: (scope) => live.some((row) => row.scope === scope && row.subject_id === null),
    targeted: live.filter((row) => row.subject_id !== null),
  };
}

/** The page head's chip: everyone paused, running, or unknown. */
export function killHeadline(state: KillState): { label: string; tone: "live" | "ok" | "warn" } {
  if (!state.known) return { label: "State unknown", tone: "warn" };
  return state.isOn("all") ? { label: "Paused for everyone", tone: "live" } : { label: "Running", tone: "ok" };
}
