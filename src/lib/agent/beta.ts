import "server-only";

/**
 * The agent beta (plan: "Ships behind AGENTS_BETA"). No invited cohort
 * (decided 17 Oct): when it is on, it is on for every signed-in member, and
 * each A3 step opens as its gate passes. Off unless AGENTS_BETA is "on".
 * The agent still acts only while the admin kill switches allow it.
 */
export function agentsBetaOn(): boolean {
  return process.env.AGENTS_BETA === "on";
}
