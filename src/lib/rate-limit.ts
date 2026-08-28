import "server-only";

import { captureMessage } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiting, backed by `consume_rate_limit` in Postgres
 * (migration 0006). Signup, offers, questions, comments and reactions were all
 * unthrottled; this keeps the limiter dependency-free rather than introducing
 * Redis for it.
 *
 * Fails **open** on infrastructure error: a limiter outage should not take the
 * product down. Abuse is bounded by the DB constraints and RLS either way.
 */
export type RateLimitRule = {
  /** Stable name for the action being limited. */
  action: string;
  /** Permitted attempts per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export const RATE_LIMITS = {
  makeOffer: { action: "offer", limit: 10, windowSeconds: 60 * 10 },
  askQuestion: { action: "question", limit: 10, windowSeconds: 60 * 10 },
  addComment: { action: "comment", limit: 20, windowSeconds: 60 * 10 },
  react: { action: "react", limit: 60, windowSeconds: 60 * 5 },
  sendMessage: { action: "message", limit: 40, windowSeconds: 60 * 10 },
  openDispute: { action: "dispute", limit: 5, windowSeconds: 60 * 60 },
  disputeEvidence: { action: "dispute-evidence", limit: 20, windowSeconds: 60 * 60 },
  createListing: { action: "listing", limit: 20, windowSeconds: 60 * 60 },
  /** Remote fetch + AI + media transfer — the most expensive user-triggered
   *  action in the product, so the tightest listing-side limit. */
  importListing: { action: "listing-import", limit: 10, windowSeconds: 60 * 60 },
  passwordReset: { action: "password-reset", limit: 5, windowSeconds: 60 * 30 },
  fileReport: { action: "report", limit: 5, windowSeconds: 60 * 60 },
} as const satisfies Record<string, RateLimitRule>;

/** True when the caller is within the limit and the attempt may proceed. */
export async function allowAction(rule: RateLimitRule, subject: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("consume_rate_limit", {
      p_key: `${rule.action}:${subject}`,
      p_limit: rule.limit,
      p_window: `${rule.windowSeconds} seconds`,
    });

    if (error) {
      failOpen(rule, error);
      return true;
    }
    return data !== false;
  } catch (error) {
    failOpen(rule, error);
    return true;
  }
}

/**
 * The fail-open path is a deliberate availability trade — which is exactly
 * why it must page someone when it happens: unthrottled abuse windows are
 * only acceptable when they're known about. Tagged for a dedicated Sentry
 * alert rule (R2).
 */
function failOpen(rule: RateLimitRule, error: unknown): void {
  console.error("[rate-limit] check failed, allowing", { action: rule.action, error });
  void captureMessage("rate limiter failed open", "warning", {
    tags: { alert: "rate-limiter-fail-open", action: rule.action },
    extra: { error: error instanceof Error ? error.message : String(error) },
  });
}

export function rateLimitMessage(rule: RateLimitRule): string {
  const minutes = Math.round(rule.windowSeconds / 60);
  return `That's a lot at once — try again in a few minutes. (Limit: ${rule.limit} per ${minutes} minutes.)`;
}
