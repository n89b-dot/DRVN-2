import "server-only";

import type { EmailMessage, EmailTransport } from "@/lib/email/send";
import { money } from "@/lib/format";
import { listingRowsQuery } from "@/lib/marketplace/query";
import { readSavedSearch } from "@/lib/marketplace/saved-search";
import { listingHref, marketplaceHref } from "@/lib/marketplace/state";
import { reportError } from "@/lib/monitoring";
import type { createAdminClient } from "@/lib/supabase/admin";

/**
 * Saved-search email digests (N78, migration 20261107200300): at most one
 * email per saved search per day, listing what matched since the last one.
 *
 * Each alerting search has its own email window
 * (saved_search_email_cursors), separate from the half-hourly in-app cursor
 * (saved_searches.last_checked_at), so every part published while in-app
 * passes come and go lands in the next digest. Once a day per search,
 * `admitDigests` counts the active matches whose publishing transaction is
 * in [checked_xact, window_xact) (migration 20261107200350: transaction ids,
 * so a publication in flight when the window closes is in the next one) and
 * hands them to admit_saved_search_digest, which writes the digest and moves
 * the window in one transaction, compare-and-set on where the window
 * started: a crash before it means the next run redoes the same window, and
 * a replay after it is refused. `sendDigests` leases the day's digests in
 * batches until none are left or the run's time is up, sends each through
 * the email seam and records the outcome, fenced by the attempt number. A
 * digest still unsent at the end of its day is carried into the next day's
 * window by saved_search_digest_sweep, reaching back at most 7 days (older
 * matches drop silently); turning an alert off skips its unsent digests.
 */

type Admin = ReturnType<typeof createAdminClient>;

/** Parts listed in one email; the rest are "and N more". */
export const DIGEST_ITEMS = 5;
export const DUE_PER_RUN = 200;
export const SEND_BATCH = 25;
/** Time each run gives admission and then sending (maxDuration is 300 s). */
export const ADMIT_BUDGET_MS = 120_000;
export const SEND_BUDGET_MS = 120_000;

export type DigestItem = { id: string; title: string; price_cents: number | null };

export type AdmitTally = {
  checked: number;
  admitted: number;
  empty: number;
  muted: number;
  baselines: number;
  skipped: number;
  failed: number;
};

export async function admitDigests(admin: Admin, deadline = Date.now() + ADMIT_BUDGET_MS): Promise<AdmitTally> {
  const tally: AdmitTally = { checked: 0, admitted: 0, empty: 0, muted: 0, baselines: 0, skipped: 0, failed: 0 };
  // Batches until nothing is due, a batch moves nothing (every one failed:
  // the same rows would come back), or the time is up. What is left waits
  // for the next hourly run with its window unmoved, so nothing is lost.
  while (Date.now() < deadline) {
    const { data: due, error } = await admin.rpc("saved_search_digests_due", { p_limit: DUE_PER_RUN });
    if (error) throw new Error(`Due digests lookup: ${error.code}`);
    let moved = 0;
    for (const search of due ?? []) {
      if (Date.now() >= deadline) break;
      const outcome = await admitOne(admin, search, tally);
      if (outcome && MOVED.has(outcome)) moved += 1;
    }
    if (!moved || (due ?? []).length < DUE_PER_RUN) break;
  }
  return tally;
}

const MOVED = new Set(["admitted", "empty", "muted", "baseline"]);

type DueSearch = {
  saved_search_id: string;
  user_id: string;
  params: unknown;
  checked_through: string | null;
  checked_xact: number | null;
  window_end: string;
  window_xact: number;
  /** The later of midnight (London) seven days before today and when the
   *  alert was last turned on: nothing published before it is mailed,
   *  however far back a carried window, or a window start pinned by a long
   *  transaction, reaches. */
  window_floor: string;
};

async function admitOne(admin: Admin, search: DueSearch, tally: AdmitTally): Promise<string | null> {
  tally.checked += 1;
  const params = readSavedSearch(search.params);
  if (!params) {
    tally.failed += 1;
    reportError("[saved-search-digests] unsupported definition", { id: search.saved_search_id });
    return null;
  }
  const href = marketplaceHref(params);
  // A database row may have no window yet (null), whatever the type says.
  const since = search.checked_through;

  let matchCount = 0;
  let items: DigestItem[] = [];
  if (since && search.checked_xact !== null) {
    // The window is cut on publishing transaction ids, not times:
    // [checked_xact, window_xact). Every id below window_xact had finished
    // when the window closed, so a part whose publication was still in
    // flight then (stamped with a time inside the window, committed after
    // this query) is in the next window instead of in neither.
    const { data: matches, count, error: matchError } = await listingRowsQuery(admin, params, search.user_id)
      .gte("published_xact", search.checked_xact).lt("published_xact", search.window_xact)
      .gte("published_at", search.window_floor).neq("seller_id", search.user_id)
      .order("published_at", { ascending: false }).order("id").limit(DIGEST_ITEMS);
    if (matchError) {
      // The window stays put, so the next hourly run tries the same one.
      tally.failed += 1;
      reportError("[saved-search-digests] match query failed", { id: search.saved_search_id, code: matchError.code });
      return null;
    }
    items = (matches ?? []).map((m) => ({ id: m.id, title: m.title, price_cents: m.price_cents }));
    matchCount = Math.max(count ?? 0, items.length);
  }

  const { data: outcome, error: admitError } = await admin.rpc("admit_saved_search_digest", {
    p_saved_search_id: search.saved_search_id,
    p_window_end: search.window_end,
    p_window_xact: search.window_xact,
    p_match_count: matchCount,
    p_items: items,
    p_href: href,
    ...(since ? { p_expected_through: since } : {}),
  });
  if (admitError) {
    tally.failed += 1;
    reportError("[saved-search-digests] admission failed", { id: search.saved_search_id, code: admitError.code });
    return null;
  }
  if (outcome === "admitted") tally.admitted += 1;
  else if (outcome === "empty") tally.empty += 1;
  else if (outcome === "muted") tally.muted += 1;
  else if (outcome === "baseline") tally.baselines += 1;
  // 'stale', 'already_today', 'blocked', 'alert_off', 'gone': nothing moved.
  else tally.skipped += 1;
  return outcome;
}

/** `failed`: digests that will not be sent (rejected, or out of attempts).
 *  `errors`: outcomes the database could not record, which make the run
 *  unhealthy. */
export type SendTally = { claimed: number; sent: number; retrying: number; failed: number; errors: number };

export type ClaimedDigest = {
  digest_id: string;
  attempt: number;
  recipient: string;
  search_name: string;
  href: string;
  match_count: number;
  items: unknown;
  digest_day: string;
};

export async function sendDigests(
  admin: Admin, transport: EmailTransport, origin: string, deadline = Date.now() + SEND_BUDGET_MS,
): Promise<SendTally> {
  const tally: SendTally = { claimed: 0, sent: 0, retrying: 0, failed: 0, errors: 0 };
  // Batches until the day's queue is empty or the time is up, so a busy day
  // is not capped at one batch an hour. What is left keeps its lease or its
  // place and goes in the next run; one not sent by the end of its day is
  // carried into the next day's window by the sweep, never dropped.
  while (Date.now() < deadline) {
    const { data: claimed, error } = await admin.rpc("claim_saved_search_digests", { p_limit: SEND_BATCH });
    if (error) throw new Error(`Digest claim: ${error.code}`);
    for (const digest of claimed ?? []) await sendOne(admin, transport, origin, digest, tally);
    if ((claimed ?? []).length < SEND_BATCH) break;
  }
  return tally;
}

async function sendOne(admin: Admin, transport: EmailTransport, origin: string, digest: ClaimedDigest, tally: SendTally) {
  tally.claimed += 1;
  const outcome = await transport
    .send({ to: digest.recipient, ...renderDigest(digest, origin), idempotencyKey: `saved-search-digest/${digest.digest_id}` })
    .catch((cause: unknown) => ({ status: "retry" as const, reason: cause instanceof Error ? cause.message : "send threw" }));
  const { data: status, error: completeError } = await admin.rpc("complete_saved_search_digest", {
    p_id: digest.digest_id,
    p_attempt: digest.attempt,
    p_outcome: outcome.status,
    ...(outcome.status === "sent" ? { p_provider_message_id: outcome.providerId ?? undefined } : { p_error: outcome.reason }),
  });
  if (completeError) {
    // The lease runs out and the digest is claimed again; the idempotency
    // key keeps a provider that honours it from sending it twice.
    tally.errors += 1;
    reportError("[saved-search-digests] outcome not recorded", { id: digest.digest_id, code: completeError.code });
    return;
  }
  if (status === "sent") tally.sent += 1;
  else if (status === "pending") tally.retrying += 1;
  else if (status === "failed") {
    tally.failed += 1;
    reportError("[saved-search-digests] digest failed", { id: digest.digest_id, attempt: digest.attempt });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function readItems(value: unknown): DigestItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const { id, title, price_cents } = item as Record<string, unknown>;
    if (typeof id !== "string" || typeof title !== "string") return [];
    return [{ id, title, price_cents: typeof price_cents === "number" ? price_cents : null }];
  });
}

/** One digest as an email. Content was frozen at admission, so every retry
 *  renders the same message. */
export function renderDigest(
  digest: Pick<ClaimedDigest, "search_name" | "href" | "match_count" | "items">,
  origin: string,
): Omit<EmailMessage, "to" | "idempotencyKey"> {
  const items = readItems(digest.items);
  const name = digest.search_name;
  const subject = digest.match_count === 1 && items[0]
    ? `New match for ${name}: ${items[0].title}`
    : `${digest.match_count} new parts match ${name}`;
  const lines = items.map((item) => ({
    title: item.title,
    price: item.price_cents === null ? null : money.format(item.price_cents / 100),
    url: origin + listingHref(item.id),
  }));
  const more = digest.match_count - items.length;
  const all = origin + digest.href;
  const settings = `${origin}/settings#signals`;
  const saved = `${origin}/saved`;
  const footer = "You get at most one email a day for each saved search with alerts on.";

  const text = [
    `New parts matching ${name} since our last email:`,
    "",
    ...lines.map((line) => `- ${line.title}${line.price ? ` (${line.price})` : ""}\n  ${line.url}`),
    ...(more > 0 ? ["", `And ${more} more.`] : []),
    "",
    `See them all: ${all}`,
    "",
    footer,
    `Stop these emails: ${settings}`,
    `Turn off alerts for this search: ${saved}`,
  ].join("\n");

  const html = [
    `<p>New parts matching <strong>${escapeHtml(name)}</strong> since our last email:</p>`,
    `<ul>${lines.map((line) => `<li><a href="${escapeHtml(line.url)}">${escapeHtml(line.title)}</a>${line.price ? ` (${escapeHtml(line.price)})` : ""}</li>`).join("")}</ul>`,
    more > 0 ? `<p>And ${more} more.</p>` : "",
    `<p><a href="${escapeHtml(all)}">See them all</a></p>`,
    `<p><small>${footer} <a href="${escapeHtml(settings)}">Stop these emails</a> · <a href="${escapeHtml(saved)}">Turn off alerts for this search</a></small></p>`,
  ].join("");

  return { subject, text, html };
}
