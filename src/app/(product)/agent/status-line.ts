/**
 * AG-1: one agent, one status line. Whatever it is doing for the member —
 * handling offers on their listings, negotiating parts for them, waiting on
 * them — is said in one place, not split into a seller agent and a buyer one.
 */
export function agentStatusLine({ handling, buying, needsYou }: { handling: number; buying: number; needsYou: number }): string {
  if (!handling && !buying && !needsYou) return "Nothing running yet";
  return [
    handling ? `Handling offers on ${handling} listing${handling === 1 ? "" : "s"}` : null,
    buying ? `Negotiating ${buying} part${buying === 1 ? "" : "s"} for you` : null,
    needsYou ? `${needsYou} need${needsYou === 1 ? "s" : ""} you` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
