/**
 * N247 (OS-W21): the social and messaging limits are also held in the
 * database, by `private.member_write_quota` triggers in
 * `supabase/migrations/20261107220000_social_write_quotas.sql`, so a member's
 * own token can't skip them by writing through PostgREST.
 *
 * This is the list those triggers enforce. Each row matches the app rule in
 * `RATE_LIMITS` (src/lib/rate-limit.ts) where there is one; `db-write-quotas.test.ts`
 * reads the migration and fails if either side drifts.
 */
export type DbWriteQuota = {
  table: string;
  /** Key prefix in `rate_limits` is `db-<action>:<member id>`. */
  action: string;
  limit: number;
  windowSeconds: number;
  /** The `RATE_LIMITS` key the app checks first, when there is one. */
  appRule: string | null;
};

export const DB_WRITE_QUOTAS: readonly DbWriteQuota[] = [
  { table: "messages", action: "message", limit: 40, windowSeconds: 600, appRule: "sendMessage" },
  { table: "activity_comments", action: "comment", limit: 20, windowSeconds: 600, appRule: "addComment" },
  { table: "activity_reactions", action: "react", limit: 60, windowSeconds: 300, appRule: "react" },
  { table: "likes", action: "react", limit: 60, windowSeconds: 300, appRule: "react" },
  { table: "follows", action: "follow", limit: 60, windowSeconds: 600, appRule: "follow" },
  // Saves have no app rule; the database one is deliberately generous.
  { table: "saves", action: "save", limit: 120, windowSeconds: 600, appRule: null },
  { table: "listing_questions", action: "question", limit: 10, windowSeconds: 600, appRule: "askQuestion" },
  { table: "reports", action: "report", limit: 5, windowSeconds: 3600, appRule: "fileReport" },
];

/** SQLSTATE the quota trigger raises. */
export const DB_QUOTA_SQLSTATE = "RL429";

/** True when a Supabase/PostgREST error is the database write quota. */
export function isDatabaseQuotaError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === DB_QUOTA_SQLSTATE);
}
