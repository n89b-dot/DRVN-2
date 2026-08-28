import "server-only";

import { reportError } from "@/lib/monitoring";

/**
 * Product analytics (brief §AE) — a typed event taxonomy behind one seam.
 *
 * The sink is optional and self-hostable: with POSTHOG_KEY (+ optional
 * POSTHOG_HOST, default https://us.i.posthog.com) configured, events POST to
 * PostHog's capture API fire-and-forget; unconfigured, capture() is a no-op.
 * DRVN never requires a paid analytics service to run, and no product logic
 * may ever read from analytics.
 *
 * Privacy by construction: events carry the pseudonymous user id and the
 * coarse properties DECLARED HERE — never free text, addresses, message
 * bodies, payment details or evidence. Adding an event means adding it to
 * this union, which is the review gate. There is no client-side autocapture
 * and no session replay.
 *
 * Feature flags (§AE): env-based `flagEnabled("x")` reads FLAG_X — a
 * deliberate minimum. If flags ever need percentage rollout or targeting,
 * PostHog flags slot in behind the same function.
 */

export type AnalyticsEvent =
  | { event: "vehicle_added"; props: { identity_source: "picker" | "vin" | "manual" } }
  | { event: "update_started"; props?: undefined }
  | { event: "update_published"; props: { blocks: number; automotive_blocks: number } }
  | { event: "listing_started"; props?: undefined }
  | { event: "listing_published"; props: { category: string; has_source_car: boolean; fitment_rows: number } }
  | { event: "search_performed"; props: { lane: "identifier" | "human"; results: number } }
  | { event: "fitment_filter_used"; props?: undefined }
  | { event: "saved_search_created"; props?: undefined }
  | { event: "saved_search_alert_enabled"; props?: undefined }
  | { event: "offer_submitted"; props?: undefined }
  | { event: "checkout_started"; props: { items: number } }
  | { event: "purchase_completed"; props: { orders: number } }
  | { event: "seller_dispatched"; props?: undefined }
  | { event: "dispute_opened"; props: { category: string } };

function configured(): boolean {
  return Boolean(process.env.POSTHOG_KEY);
}

/**
 * Fire-and-forget capture. `distinctId` is the pseudonymous user uuid (or
 * "anonymous"). Never await this on a user-facing critical path beyond the
 * built-in 2s timeout, and never let it throw.
 */
export function capture(distinctId: string | null, entry: AnalyticsEvent): void {
  if (!configured()) return;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  void fetch(`${host}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.POSTHOG_KEY,
      event: entry.event,
      distinct_id: distinctId ?? "anonymous",
      properties: { ...entry.props },
      timestamp: new Date().toISOString(),
    }),
    signal: AbortSignal.timeout(2000),
  }).catch((error) => {
    reportError("[analytics] capture failed", { event: entry.event, error: String(error) });
  });
}

/** Env-based feature flag: flagEnabled("new_search") reads FLAG_NEW_SEARCH. */
export function flagEnabled(name: string): boolean {
  return process.env[`FLAG_${name.toUpperCase()}`] === "true";
}
