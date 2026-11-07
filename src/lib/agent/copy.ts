/**
 * What DRVN tells a member their agent does, in one place, so every surface
 * says the same true thing. Pure strings: client and server components both
 * import them, and copy.test.ts holds them to the rules they describe.
 *
 * - Who accepts (readiness 72, PRD AG-2 and AG-3): the seller's agent never
 *   accepts, it recommends and the seller taps Accept; the buyer's agent
 *   accepts a seller's counter within the buyer's max on its own, and asks
 *   before going over it (agent-foundations.md).
 * - How fast (R-instant): the agent moves on the worker's next pass, and the
 *   hosted schedule runs that every AGENT_WORKER_EVERY_MINUTES minutes
 *   (`drvn-agent-worker`, 20261026100000). Nothing wakes it sooner, so no
 *   copy may promise an instant answer.
 */

/** The `drvn-agent-worker` cron's interval, in minutes (20261026100000). */
export const AGENT_WORKER_EVERY_MINUTES = 5;

/** Who accepts, both sides, in one sentence pair — /agent's intro and empty state. */
export const AGENT_ACCEPT_RULE =
  "Selling, it never accepts for you: it tells you when an offer is worth taking. Buying, it makes offers and can accept a seller's counter within your max, and asks before going over it.";

/** "Let DRVN handle offers" on the sell form: what the seller's agent does, and when. */
export const SELLER_AGENT_HINT =
  "Your agent answers each offer within the limits below, usually within a few minutes, so offers don't sit waiting for you. It never accepts for you: when an offer reaches your target, it tells you why and you tap Accept.";

/** /agent's footer. */
export const AGENT_FOOT = "DRVN — your agent acts only within your limits and never messages the other side";
