import "server-only";

import { captureMessage } from "@/lib/monitoring";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Fixed-window rate limiting, backed by `consume_rate_limit` in Postgres
 * (migration 0006). Signup, offers, questions, comments and reactions were all
 * unthrottled; this keeps the limiter dependency-free rather than introducing
 * Redis for it.
 *
 * Checkout and monitoring intake fail closed on infrastructure errors. Other
 * rules retain their explicit availability tradeoff; database guards still apply.
 */
export type RateLimitRule = {
  /** Stable name for the action being limited. */
  action: string;
  failClosed?: boolean;
  /** Permitted attempts per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

export const RATE_LIMITS = {
  checkout: { action: "checkout", limit: 10, windowSeconds: 600, failClosed: true },
  clientError: { action: "client-error", limit: 20, windowSeconds: 60, failClosed: true },
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
  /** Adding a mod by pasting a link (L-1). Far lighter than the importer —
   *  one page fetch, one thumbnail, no AI — so it gets a looser limit: a
   *  member filling in a build sheet in one sitting pastes a lot of links. */
  fetchPartLink: { action: "part-link", limit: 30, windowSeconds: 60 * 60 },
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
      return !rule.failClosed;
    }
    return data !== false;
  } catch (error) {
    failOpen(rule, error);
    return !rule.failClosed;
  }
}

/**
 * The fail-open path is a deliberate availability trade — which is exactly
 * why it must page someone when it happens: unthrottled abuse windows are
 * only acceptable when they're known about. Tagged for a dedicated Sentry
 * alert rule (R2).
 */
function failOpen(rule: RateLimitRule, error: unknown): void {
  console.error("[rate-limit] check failed", { action: rule.action, error });
  void captureMessage(rule.failClosed ? "rate limiter failed closed" : "rate limiter failed open", "warning", {
    tags: { alert: "rate-limiter-fail-open", action: rule.action },
    extra: { error: error instanceof Error ? error.message : String(error) },
  });
}

export function rateLimitMessage(rule: RateLimitRule): string {
  const minutes = Math.round(rule.windowSeconds / 60);
  return `That's a lot at once — try again in a few minutes. (Limit: ${rule.limit} per ${minutes} minutes.)`;
}
