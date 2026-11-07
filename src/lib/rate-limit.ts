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
  /** CSP violation reports (src/app/api/monitoring/csp): per visitor, plus
   *  one ceiling across everyone so a broken policy can't flood monitoring. */
  cspReport: { action: "csp-report", limit: 20, windowSeconds: 60, failClosed: true },
  cspReportCeiling: { action: "csp-report-all", limit: 120, windowSeconds: 60, failClosed: true },
  makeOffer: { action: "offer", limit: 10, windowSeconds: 60 * 10 },
  askQuestion: { action: "question", limit: 10, windowSeconds: 60 * 10 },
  addComment: { action: "comment", limit: 20, windowSeconds: 60 * 10 },
  react: { action: "react", limit: 60, windowSeconds: 60 * 5 },
  sendMessage: { action: "message", limit: 40, windowSeconds: 60 * 10 },
  /** A message to the member's own agent (A3c): each one is a model turn,
   *  so it is capped here as well as by the daily spend caps. */
  agentChat: { action: "agent-chat", limit: 30, windowSeconds: 60 * 10 },
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
  /** Sign-in and reset are keyed three ways (src/app/(auth)/actions.ts):
   *  the tight limit by email *from one visitor's address*, so a stranger's
   *  junk attempts don't lock the owner out of their own account; a looser
   *  ceiling by email alone, so one account still can't be guessed at from
   *  many addresses without end; and by the visitor's address, so one address
   *  can't spray many accounts. Supabase's own per-IP limits only ever see
   *  this server. */
  signIn: { action: "sign-in", limit: 10, windowSeconds: 60 * 15 },
  signInEmailCeiling: { action: "sign-in-email", limit: 50, windowSeconds: 60 * 15 },
  signInNetwork: { action: "sign-in-network", limit: 30, windowSeconds: 60 * 15 },
  passwordReset: { action: "password-reset", limit: 5, windowSeconds: 60 * 30 },
  /** Also the most reset emails one address can be sent in the window. */
  passwordResetEmailCeiling: { action: "password-reset-email", limit: 10, windowSeconds: 60 * 30 },
  passwordResetNetwork: { action: "password-reset-network", limit: 15, windowSeconds: 60 * 30 },
  /** Following notifies the followed member, so it is a spam vector too. */
  follow: { action: "follow", limit: 60, windowSeconds: 60 * 10 },
  fileReport: { action: "report", limit: 5, windowSeconds: 60 * 60 },
  /** Explore autocomplete: four searches a request, public and signed-out, so
   *  keyed by the visitor's address. A person typing (150 ms debounce, two
   *  characters minimum) makes a handful a query; this is a minute of
   *  non-stop typing. */
  searchSuggest: { action: "search-suggest", limit: 60, windowSeconds: 60 },
  /** Where no address can be trusted every visitor shares one bucket, so it
   *  is a ceiling on the endpoint as a whole rather than on one person. */
  searchSuggestUnattributed: { action: "search-suggest-shared", limit: 600, windowSeconds: 60 },
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
