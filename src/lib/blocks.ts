/**
 * The database's refusal when two members have a block between them (N54,
 * 20261107220600). The words never say who blocked whom.
 */
export const BLOCKED_SQLSTATE = "BL403";

export const BLOCKED_MESSAGE = "You can't contact this member.";

export function isBlockedError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === BLOCKED_SQLSTATE);
}
