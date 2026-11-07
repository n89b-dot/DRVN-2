import "server-only";

import { after } from "next/server";
import { cookies } from "next/headers";

import { createAdminClient } from "@/lib/supabase/admin";
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
  | { event: "marketplace_listing_opened"; props?: undefined }
  | { event: "marketplace_results_viewed"; props: { results: number; zero: boolean; has_query: boolean; filters: number; category: boolean } }
  | { event: "vehicle_added"; props: { identity_source: "picker" | "vin" | "manual" } }
  | { event: "update_started"; props?: undefined }
  | { event: "update_published"; props: { blocks: number; automotive_blocks: number } }
  /** W-1. Counted separately from update_published: the whole question the
   *  quick box exists to answer is whether people post more when it costs
   *  less, and merging the two would hide the answer. */
  | { event: "quick_post_published"; props: { photos: number; tagged: number } }
  | { event: "listing_started"; props?: undefined }
  | { event: "listing_published"; props: { category: string; has_source_car: boolean; fitment_rows: number } }
  | { event: "search_performed"; props: { lane: "identifier" | "human"; results: number } }
  /** Explore search (§39) — scope + coarse counts only, never query text.
   *  Account search deliberately adds no extra properties: discovery must
   *  not become a surveillance dataset because analytics exist. */
  | { event: "explore_search_performed"; props: { scope: string; has_query: boolean; filters: number; results: number; zero: boolean } }
  | { event: "fitment_filter_used"; props?: undefined }
  | { event: "saved_search_created"; props?: undefined }
  | { event: "saved_search_alert_enabled"; props?: undefined }
  | { event: "listing_import_started"; props: { mode: "url" | "paste"; adapter: string } }
  | { event: "listing_import_fetch_succeeded"; props: { adapter: string; fetch_method: "http" | "render"; images: number } }
  | { event: "listing_import_fetch_failed"; props: { adapter: string; code: string } }
  | { event: "listing_import_fallback_to_paste"; props: { adapter: string } }
  | { event: "listing_import_extraction_succeeded"; props: { adapter: string; multiple_items: boolean; needs_review: number } }
  | { event: "listing_import_review_opened"; props: { adapter: string } }
  /** Fired by createListing when a draft/publish consumed an import. `fields_edited`
   *  counts imported fields the seller changed before saving — the honest
   *  extraction-quality signal (never field contents, only which/how many). */
  | { event: "listing_import_consumed"; props: { adapter: string; published: boolean; fields_edited: number; edited_fields: string } }
  /** Aggregate viability signal for anonymous Facebook retrieval (§32). */
  | { event: "listing_import_facebook_outcome"; props: { outcome: "fetch_attempted" | "fetch_succeeded" | "render_attempted" | "render_succeeded" | "fallback_to_paste" | "listing_gone" } }
  | { event: "offer_submitted"; props?: undefined }
  /** The agent's screens (plan: "measuring the agent" 5). Coarse properties
   *  only, never an amount or a limit. The agent's own moves happen in the
   *  worker, which has no consent context; those are measured from DRVN's
   *  records instead (agent_metrics_daily). */
  | { event: "agent_offers_enabled"; props: { style: "firm" | "balanced" | "flexible"; has_target: boolean } }
  | { event: "agent_offers_disabled"; props?: undefined }
  | { event: "negotiate_for_me_started"; props: { basis: "item" | "total"; style: "firm" | "balanced" | "flexible" } }
  /** The buyer ended their own agent on a listing (readiness 64). */
  | { event: "negotiate_for_me_stopped"; props?: undefined }
  /** AG-7: the member changed their agent's mode; `ended` counts the live mandates it stopped. */
  | { event: "agent_mode_set"; props: { mode: "off" | "suggest" | "act"; ended: number } }
  | { event: "agent_tab_viewed"; props: { needs: "0" | "1" | "2-5" | "6+" } }
  /** `outcome` is what the database reported (N128): only "accepted" is a sale. */
  | { event: "agent_approval_answered"; props: { choice: "accept" | "dismiss"; outcome: "accepted" | "expired" | "refused" | "noop" | "dismissed" | "unknown" } }
  /** One message to the agent (A3c): how many tools it used, and whether the model answered. */
  | { event: "agent_chat_turn"; props: { tool_calls: number; ok: boolean } }
  /** Confirm on an "Update my build" card (A3c): whether it replaced a part. */
  | { event: "agent_build_change_confirmed"; props: { replaced: boolean } }
  /** Confirm on a "Paste your build" card (A3d): how many lines it added. */
  | { event: "agent_build_list_confirmed"; props: { lines: number } }
  /** "Turn this into filters" on the Marketplace (A4): whether it found any. */
  | { event: "marketplace_sentence_filters"; props: { ok: boolean } }
  | { event: "checkout_started"; props: { items: number } }
  | { event: "purchase_completed"; props: { orders: number } }
  | { event: "seller_dispatched"; props?: undefined }
  /** Local pickup handoff proven via the Pickup Pass (0054). */
  | { event: "pickup_confirmed"; props?: undefined }
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
  if (!configured() || entry.event === "purchase_completed") return; // Authoritative purchases use the durable outbox.
  try {
    const consent = cookies().then((store) => store.get("drvn_analytics_consent")?.value === "v1:yes").catch(() => false);
    after(async () => {
      if (!(await consent) || !distinctId) return;
      try {
      // A stale opt-in cookie must not override account-wide withdrawal.
      const current = await createAdminClient().from("analytics_consents")
        .select("allowed,expires_at").eq("user_id", distinctId).abortSignal(AbortSignal.timeout(2000)).maybeSingle();
      if (current.error || !current.data?.allowed || Date.parse(current.data.expires_at) <= Date.now()) return;
      const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
        const response = await fetch(`${host}/capture/`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: process.env.POSTHOG_KEY, event: entry.event,
            distinct_id: distinctId ?? "anonymous", properties: { ...entry.props }, timestamp: new Date().toISOString() }),
          signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) throw new Error(`Analytics HTTP ${response.status}`);
      } catch (error) { reportError("[analytics] capture failed", { event: entry.event, error: String(error) }); }
    });
  } catch { /* No request consent in workers or scripts: analytics stays off. */ }
}

/** Env-based feature flag: flagEnabled("new_search") reads FLAG_NEW_SEARCH. */
export function flagEnabled(name: string): boolean {
  return process.env[`FLAG_${name.toUpperCase()}`] === "true";
}
