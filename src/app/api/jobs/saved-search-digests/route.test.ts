import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The digest worker against an in-memory model of the database: the in-app
 * worker's table reads and writes, and the digest RPCs with the semantics of
 * migration 20261107200300 (once a day per search, compare-and-set window,
 * attempt-fenced outcomes). The database's own rules are proven by
 * supabase/tests/saved_search_email_digest_guard.sql; this proves the routes
 * drive them correctly.
 */

type Listing = { id: string; title: string; price_cents: number; published_at: string; published_xact: number; seller_id: string };
type Search = { id: string; user_id: string; name: string; params: Record<string, string>; alert: boolean; last_checked_at: string | null; last_matched_at: string | null };
type Digest = {
  id: string; saved_search_id: string; digest_day: string; window_start: string; window_end: string; search_name: string;
  href: string; match_count: number; items: unknown; status: string; attempts: number; next_attempt_at: number; skip_reason: string | null;
  window_start_xact: number; window_end_xact: number;
};
type Cursor = { through: string; xact: number; activated: string };

const db = vi.hoisted(() => {
  const state = {
    listings: [] as Listing[],
    searches: [] as Search[],
    cursors: new Map<string, Cursor>(),
    // Transaction ids: the next to hand out, and publications begun but not
    // yet committed (their rows are invisible until they commit).
    xact: { next: 100 },
    inflight: [] as Listing[],
    digests: [] as Digest[],
    prefs: {} as Record<string, Record<string, boolean>>,
    failNext: {} as Record<string, number>,
    calls: [] as string[],
    deliver: vi.fn(),
    send: vi.fn(),
    transport: null as null | { name: string; send: (message: unknown) => Promise<unknown> },
  };
  const now = () => new Date().toISOString();
  const day = (iso: string) => iso.slice(0, 10);
  // The oldest transaction still running: pg_snapshot_xmin(pg_current_snapshot()).
  const xmin = () => Math.min(state.xact.next, ...state.inflight.map((l) => l.published_xact));
  const today = () => day(now());
  // Midnight seven days before today (UTC here; London in the database).
  const floor = () => new Date(Date.parse(`${today()}T00:00:00.000Z`) - 7 * 86_400_000).toISOString();
  const later = (a: string, b: string) => (a > b ? a : b);
  const unsentBefore = (id: string) =>
    state.digests.some((d) => d.saved_search_id === id && ["pending", "sending"].includes(d.status) && d.digest_day < today());
  const wants = (user: string) => state.prefs[user]?.saved_searches !== false && state.prefs[user]?.saved_search_emails !== false;
  const rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {
    saved_search_digest_sweep: () => {
      let carried = 0;
      for (const d of state.digests) {
        if (!["pending", "sending"].includes(d.status) || d.next_attempt_at > Date.now() || d.digest_day >= today()) continue;
        const cursor = state.cursors.get(d.saved_search_id);
        d.status = "skipped";
        if (cursor?.through === d.window_end) {
          state.cursors.set(d.saved_search_id, { ...cursor, through: later(d.window_start, floor()), xact: d.window_start_xact });
          d.skip_reason = "carried"; carried += 1;
        } else d.skip_reason = "expired";
      }
      return { carried, expired: 0, pruned: 0 };
    },
    saved_search_digests_due: (a) =>
      state.searches
        .filter((s) => s.alert && (!state.cursors.has(s.id) || day(state.cursors.get(s.id)!.through) < today()) && !unsentBefore(s.id))
        .slice(0, a.p_limit as number)
        .map((s) => ({
          saved_search_id: s.id, user_id: s.user_id, params: s.params,
          checked_through: state.cursors.get(s.id)?.through ?? null, checked_xact: state.cursors.get(s.id)?.xact ?? null,
          window_end: now(), window_xact: xmin(),
          window_floor: state.cursors.has(s.id) ? later(floor(), state.cursors.get(s.id)!.activated) : floor(),
        })),
    admit_saved_search_digest: (a) => {
      const search = state.searches.find((s) => s.id === a.p_saved_search_id);
      if (!search) return "gone";
      if (!search.alert) return "alert_off";
      const cursor = state.cursors.get(search.id);
      const expected = (a.p_expected_through as string | undefined) ?? null;
      const next = { through: a.p_window_end as string, xact: a.p_window_xact as number, activated: cursor?.activated ?? now() };
      if (next.xact > xmin()) throw new Error("a window closed on unfinished transactions");
      if (cursor === undefined) {
        if (expected) return "stale";
        state.cursors.set(search.id, next);
        return "baseline";
      }
      const through = cursor.through;
      if (expected !== through || next.through <= through || next.xact < cursor.xact) return "stale";
      if (day(through) >= today()) return "already_today";
      if (unsentBefore(search.id)) return "blocked";
      let written = false;
      if ((a.p_match_count as number) > 0 && wants(search.user_id)) {
        if (state.digests.some((d) => d.saved_search_id === search.id && d.digest_day === day(now()))) return "already_today";
        state.digests.push({
          id: `digest-${state.digests.length + 1}`, saved_search_id: search.id, digest_day: day(now()), window_start: later(through, floor()),
          window_end: a.p_window_end as string, search_name: search.name, href: a.p_href as string, match_count: a.p_match_count as number,
          items: a.p_items, status: "pending", attempts: 0, next_attempt_at: Date.now(), skip_reason: null,
          window_start_xact: cursor.xact, window_end_xact: next.xact,
        });
        written = true;
      }
      state.cursors.set(search.id, next);
      return a.p_match_count === 0 ? "empty" : written ? "admitted" : "muted";
    },
    claim_saved_search_digests: (a) => {
      const out = [];
      for (const d of state.digests) {
        if (out.length >= (a.p_limit as number)) break;
        if (!["pending", "sending"].includes(d.status) || d.next_attempt_at > Date.now() || d.digest_day !== day(now())) continue;
        const search = state.searches.find((s) => s.id === d.saved_search_id)!;
        const reason = !search.alert ? "alert_off" : !wants(search.user_id) ? "opted_out" : null;
        if (reason) { d.status = "skipped"; d.skip_reason = reason; continue; }
        d.status = "sending"; d.attempts += 1; d.next_attempt_at = Date.now() + 300_000;
        out.push({ digest_id: d.id, attempt: d.attempts, recipient: `${search.user_id}@drvn.test`, search_name: d.search_name, href: d.href, match_count: d.match_count, items: d.items, digest_day: d.digest_day });
      }
      return out;
    },
    complete_saved_search_digest: (a) => {
      const d = state.digests.find((x) => x.id === a.p_id);
      if (!d || d.status !== "sending" || d.attempts !== a.p_attempt) return "stale";
      if (a.p_outcome === "sent") d.status = "sent";
      else if (a.p_outcome === "retry") { d.status = "pending"; d.next_attempt_at = Date.now() + Math.min(600_000 * 2 ** (d.attempts - 1), 3_600_000); }
      else d.status = "failed";
      return d.status;
    },
  };
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    state.calls.push(name);
    if (state.failNext[name]) { state.failNext[name] -= 1; return { data: null, error: { code: "08006" } }; }
    return { data: rpcs[name](args), error: null };
  };
  // saved_search_email_window_start: on starts the window (and records when),
  // off skips unsent digests.
  const setAlert = (id: string, on: boolean) => {
    const search = state.searches.find((s) => s.id === id)!;
    if (on && !search.alert) state.cursors.set(id, { through: now(), xact: xmin(), activated: now() });
    if (!on && search.alert) {
      for (const d of state.digests) {
        if (d.saved_search_id === id && ["pending", "sending"].includes(d.status)) { d.status = "skipped"; d.skip_reason = "alert_off"; }
      }
    }
    search.alert = on;
  };
  return { ...state, rpc, xmin, setAlert };
});

vi.mock("@/lib/tracked-worker", () => ({ trackedWorker: (_family: string, _request: Request, run: () => Promise<Response>) => run() }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn(), flushMonitoring: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverNotification: db.deliver }));
vi.mock("@/lib/email/send", () => ({ emailTransport: () => db.transport }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => ({
    select: () => ({ eq: (_column: string, alert: boolean) => ({ order: () => ({ limit: async () => ({ data: db.searches.filter((s) => s.alert === alert).map((s) => ({ ...s })), error: null }) }) }) }),
    update: (patch: Partial<Search>) => ({ eq: async (_column: string, id: string) => { Object.assign(db.searches.find((s) => s.id === id)!, patch); return { error: null }; } }),
  }),
  rpc: db.rpc,
}) }));
// Only committed rows are visible, as to a real query; filters as PostgREST applies them.
vi.mock("@/lib/marketplace/query", () => ({ listingRowsQuery: () => {
  const filters: ((l: Listing) => boolean)[] = [];
  const field = (l: Listing, column: string) => (l as unknown as Record<string, string | number>)[column];
  const query = {
    gt: (column: string, value: string | number) => { filters.push((l) => field(l, column) > value); return query; },
    gte: (column: string, value: string | number) => { filters.push((l) => field(l, column) >= value); return query; },
    lt: (column: string, value: string | number) => { filters.push((l) => field(l, column) < value); return query; },
    lte: (column: string, value: string | number) => { filters.push((l) => field(l, column) <= value); return query; },
    neq: (column: string, value: string) => { filters.push((l) => field(l, column) !== value); return query; },
    order: () => query,
    limit: async (n: number) => {
      const rows = db.listings
        .filter((l) => filters.every((keep) => keep(l)))
        .sort((a, b) => b.published_at.localeCompare(a.published_at));
      return { data: rows.slice(0, n), count: rows.length, error: null };
    },
  };
  return query;
} }));

import { POST as inApp } from "../saved-searches/route";
import { POST as digests } from "./route";

const request = (path: string) => new Request(`http://localhost/api/jobs/${path}`, { method: "POST", headers: { authorization: "Bearer test-worker-only" } });
const runInApp = () => inApp(request("saved-searches"));
const runDigests = () => digests(request("saved-search-digests"));
const at = (iso: string) => vi.setSystemTime(new Date(iso));
let listingCount = 0;
/** A publication that commits at once: the transaction's start time and id. */
const publish = (iso: string, title = `Part ${listingCount + 1}`) => {
  db.listings.push(begin(iso, title));
  db.inflight.pop();
};
/** A publication begun (stamped with its start time and id) but not committed. */
const begin = (iso: string, title = `Part ${listingCount + 1}`): Listing => {
  listingCount += 1;
  const listing = { id: `listing-${listingCount}`, title, price_cents: 12_500, published_at: new Date(iso).toISOString(), published_xact: db.xact.next++, seller_id: "seller" };
  db.inflight.push(listing);
  return listing;
};
const commit = (listing: Listing) => {
  db.inflight.splice(db.inflight.indexOf(listing), 1);
  db.listings.push(listing);
};
const digestsFor = (id: string) => db.digests.filter((d) => d.saved_search_id === id);
const reliable = () => { db.send.mockResolvedValue({ status: "sent", providerId: "provider-id" }); db.transport = { name: "test", send: db.send }; };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  process.env.CRON_SECRET = "test-worker-only";
  process.env.NEXT_PUBLIC_SITE_URL = "https://drvn.example";
  listingCount = 0;
  db.listings.length = 0; db.digests.length = 0; db.calls.length = 0; db.cursors.clear(); db.inflight.length = 0; db.xact.next = 100;
  for (const key of Object.keys(db.prefs)) delete db.prefs[key];
  for (const key of Object.keys(db.failNext)) delete db.failNext[key];
  db.deliver.mockReset().mockResolvedValue("delivered");
  db.send.mockReset();
  db.transport = null;
  // Alerts on since yesterday morning: both cursors started then, and
  // yesterday's digest moved the email window at 08:41.
  db.searches.splice(0, db.searches.length, {
    id: "search", user_id: "member", name: "E46 coilovers", params: { _version: "2", q: "coilovers" },
    alert: true, last_checked_at: "2026-11-08T05:00:00.000Z", last_matched_at: null,
  });
  db.cursors.set("search", { through: "2026-11-07T08:41:00.000Z", xact: 50, activated: "2026-11-01T00:00:00.000Z" });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("accumulation across in-app runs", () => {
  it("one digest a day carries every match the half-hourly in-app passes saw", async () => {
    reliable();
    publish("2026-11-08T05:10:00Z", "Part A"); at("2026-11-08T05:30:00Z"); await runInApp();
    publish("2026-11-08T05:40:00Z", "Part B"); at("2026-11-08T06:00:00Z"); await runInApp();
    publish("2026-11-08T06:20:00Z", "Part C"); at("2026-11-08T06:30:00Z"); await runInApp();
    // Three in-app notifications, one per pass, and the in-app cursor has moved past all three parts.
    expect(db.deliver).toHaveBeenCalledTimes(3);
    expect(db.searches[0].last_checked_at).toBe("2026-11-08T06:30:00.000Z");

    at("2026-11-08T08:41:00Z");
    const response = await runDigests();
    expect(response.status).toBe(200);
    const [digest] = digestsFor("search");
    expect(digestsFor("search")).toHaveLength(1);
    expect(digest.match_count).toBe(3);
    expect((digest.items as { title: string }[]).map((item) => item.title)).toEqual(["Part C", "Part B", "Part A"]);
    // The digest's window is its own: from yesterday's digest, not the in-app cursor.
    expect(digest.window_start).toBe("2026-11-07T08:41:00.000Z");
    expect(digest.window_end).toBe("2026-11-08T08:41:00.000Z");
    expect(digest.href).toBe("/marketplace?q=coilovers");
    expect(db.send).toHaveBeenCalledOnce();
    expect(db.send.mock.calls[0][0]).toMatchObject({ to: "member@drvn.test", subject: "3 new parts match E46 coilovers", idempotencyKey: "saved-search-digest/digest-1" });
  });

  it("never sends a second digest the same day; later matches wait for tomorrow's", async () => {
    reliable();
    publish("2026-11-08T07:00:00Z");
    at("2026-11-08T08:41:00Z"); await runDigests();
    publish("2026-11-08T09:00:00Z", "Late part");
    at("2026-11-08T09:30:00Z"); await runInApp();
    at("2026-11-08T09:41:00Z"); await runDigests();
    at("2026-11-08T23:41:00Z"); await runDigests();
    expect(digestsFor("search")).toHaveLength(1);
    expect(db.send).toHaveBeenCalledOnce();

    at("2026-11-09T08:41:00Z"); await runDigests();
    const tomorrow = digestsFor("search")[1];
    expect(tomorrow).toMatchObject({ digest_day: "2026-11-09", match_count: 1, window_start: "2026-11-08T08:41:00.000Z" });
    expect(db.send).toHaveBeenCalledTimes(2);
    expect(db.send.mock.calls[1][0].subject).toBe("New match for E46 coilovers: Late part");
  });

  it("a day with no matches mails nothing and still uses the day", async () => {
    reliable();
    at("2026-11-08T08:41:00Z");
    expect((await runDigests()).status).toBe(200);
    expect(db.digests).toHaveLength(0);
    expect(db.cursors.get("search")?.through).toBe("2026-11-08T08:41:00.000Z");
    expect(db.send).not.toHaveBeenCalled();
  });
});

describe("preference opt-out", () => {
  it("a member with saved-search emails off gets no digest, and the in-app alert still runs", async () => {
    reliable();
    db.prefs.member = { saved_search_emails: false };
    publish("2026-11-08T07:00:00Z");
    at("2026-11-08T07:30:00Z"); await runInApp();
    at("2026-11-08T08:41:00Z");
    const body = await (await runDigests()).json();
    expect(body).toMatchObject({ muted: 1, admitted: 0 });
    expect(db.digests).toHaveLength(0);
    expect(db.send).not.toHaveBeenCalled();
    expect(db.deliver).toHaveBeenCalledOnce();
    // The window moved, so turning email back on does not mail the backlog.
    expect(db.cursors.get("search")?.through).toBe("2026-11-08T08:41:00.000Z");
  });

  it("opting out between admission and sending stops the email", async () => {
    publish("2026-11-08T07:00:00Z");
    at("2026-11-08T08:41:00Z"); await runDigests();  // no provider yet: recorded, not sent
    expect(digestsFor("search")[0].status).toBe("pending");
    db.prefs.member = { saved_searches: false };
    reliable();
    at("2026-11-08T09:41:00Z"); await runDigests();
    expect(db.send).not.toHaveBeenCalled();
    expect(digestsFor("search")[0]).toMatchObject({ status: "skipped", skip_reason: "opted_out" });
  });
});

describe("crash and retry", () => {
  it("a crash before admission loses nothing: the next run admits the same window once", async () => {
    reliable();
    publish("2026-11-08T07:00:00Z");
    db.failNext.admit_saved_search_digest = 1;
    at("2026-11-08T08:41:00Z");
    expect((await runDigests()).status).toBe(503);
    expect(db.digests).toHaveLength(0);
    expect(db.cursors.get("search")?.through).toBe("2026-11-07T08:41:00.000Z");

    publish("2026-11-08T09:00:00Z");
    at("2026-11-08T09:41:00Z");
    expect((await runDigests()).status).toBe(200);
    expect(digestsFor("search")).toHaveLength(1);
    expect(digestsFor("search")[0]).toMatchObject({ match_count: 2, window_start: "2026-11-07T08:41:00.000Z" });
    expect(db.send).toHaveBeenCalledOnce();
  });

  it("a failed send is retried after its backoff with the same email and key", async () => {
    db.transport = { name: "test", send: db.send };
    db.send.mockRejectedValueOnce(new Error("socket hang up")).mockResolvedValue({ status: "sent", providerId: "provider-id" });
    publish("2026-11-08T07:00:00Z");
    at("2026-11-08T08:41:00Z");
    const first = await (await runDigests()).json();
    expect(first.sent).toMatchObject({ claimed: 1, retrying: 1, sent: 0 });
    expect(digestsFor("search")[0].status).toBe("pending");

    at("2026-11-08T08:45:00Z"); await runDigests();  // inside the backoff
    expect(db.send).toHaveBeenCalledOnce();
    at("2026-11-08T09:41:00Z"); await runDigests();
    expect(db.send).toHaveBeenCalledTimes(2);
    expect(db.send.mock.calls[1][0]).toEqual(db.send.mock.calls[0][0]);
    expect(digestsFor("search")[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("a crash after the provider accepted it resends under the same key once the lease runs out, then never again", async () => {
    reliable();
    publish("2026-11-08T07:00:00Z");
    db.failNext.complete_saved_search_digest = 1;
    at("2026-11-08T08:41:00Z");
    expect((await runDigests()).status).toBe(503);
    expect(digestsFor("search")[0].status).toBe("sending");

    at("2026-11-08T08:43:00Z"); await runDigests();  // lease still held
    expect(db.send).toHaveBeenCalledOnce();
    at("2026-11-08T09:41:00Z"); await runDigests();
    expect(db.send).toHaveBeenCalledTimes(2);
    expect(db.send.mock.calls[1][0].idempotencyKey).toBe(db.send.mock.calls[0][0].idempotencyKey);
    expect(digestsFor("search")[0]).toMatchObject({ status: "sent", attempts: 2 });

    at("2026-11-08T10:41:00Z"); await runDigests();
    expect(db.send).toHaveBeenCalledTimes(2);
    expect(db.digests).toHaveLength(1);
  });

  it("a provider rejection fails the digest without failing the worker", async () => {
    db.transport = { name: "test", send: db.send };
    db.send.mockResolvedValue({ status: "rejected", reason: "address refused" });
    publish("2026-11-08T07:00:00Z");
    at("2026-11-08T08:41:00Z");
    expect((await runDigests()).status).toBe(200);
    expect(digestsFor("search")[0].status).toBe("failed");
  });
});

describe("no email provider", () => {
  it("records digests, sends nothing and says so", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    publish("2026-11-08T07:00:00Z");
    at("2026-11-08T08:41:00Z");
    const response = await runDigests();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ admitted: 1, provider: null, sent: null });
    expect(digestsFor("search")).toHaveLength(1);
    expect(db.calls).not.toContain("claim_saved_search_digests");
    expect(info).toHaveBeenCalledWith(expect.stringContaining("no email provider configured"), expect.anything());
  });
});

describe("windows survive in-flight publications (follow-up)", () => {
  it("a part whose publication was still committing when the window closed is in the next digest", async () => {
    reliable();
    publish("2026-11-08T07:00:00Z", "Committed part");
    // Stamped 08:40:59 by a transaction that commits after today's match query.
    const late = begin("2026-11-08T08:40:59Z", "Late commit");
    at("2026-11-08T08:41:00Z"); await runDigests();
    commit(late);
    expect(digestsFor("search")[0]).toMatchObject({ match_count: 1 });

    at("2026-11-09T08:41:00Z"); await runDigests();
    expect(digestsFor("search")[1]).toMatchObject({ digest_day: "2026-11-09", match_count: 1 });
    expect(db.send.mock.calls[1][0].subject).toBe("New match for E46 coilovers: Late commit");
  });
});

describe("a busy day drains fully (follow-up)", () => {
  const many = (n: number) => {
    db.searches.splice(0, db.searches.length, ...Array.from({ length: n }, (_, i) => ({
      id: `search-${i}`, user_id: `member-${i}`, name: `Search ${i}`, params: { _version: "2", q: "coilovers" },
      alert: true, last_checked_at: "2026-11-08T05:00:00.000Z", last_matched_at: null,
    })));
    db.cursors.clear();
    for (let i = 0; i < n; i += 1) db.cursors.set(`search-${i}`, { through: "2026-11-07T08:41:00.000Z", xact: 50, activated: "2026-11-01T00:00:00.000Z" });
  };

  it("one run admits and sends every due digest, not one batch of each", async () => {
    reliable();
    many(450);
    publish("2026-11-08T07:00:00Z");
    at("2026-11-08T08:41:00Z");
    const body = await (await runDigests()).json();
    expect(body).toMatchObject({ admitted: 450, sent: { sent: 450 } });
    expect(db.send).toHaveBeenCalledTimes(450);
    expect(db.digests.every((d) => d.status === "sent")).toBe(true);
  });

  it("a digest not sent on its day is carried into the next day's, never dropped", async () => {
    db.transport = { name: "test", send: db.send };
    db.send.mockResolvedValue({ status: "retry", reason: "provider down" });
    publish("2026-11-08T07:00:00Z", "Day one part");
    for (let hour = 8; hour <= 23; hour += 1) { at(`2026-11-08T${String(hour).padStart(2, "0")}:41:00Z`); await runDigests(); }
    expect(digestsFor("search")[0].status).toBe("pending");

    db.send.mockResolvedValue({ status: "sent", providerId: "provider-id" });
    publish("2026-11-09T07:00:00Z", "Day two part");
    at("2026-11-09T08:41:00Z"); await runDigests();
    const [first, second] = digestsFor("search");
    expect(first).toMatchObject({ status: "skipped", skip_reason: "carried" });
    expect(second).toMatchObject({ status: "sent", match_count: 2, window_start: "2026-11-07T08:41:00.000Z", window_start_xact: 50 });
    expect(db.send.mock.lastCall![0].subject).toBe("2 new parts match E46 coilovers");
  });
});

describe("a carried window reaches back at most 7 days", () => {
  it("ten days of unsent digests yield one email covering the last seven", async () => {
    db.transport = { name: "test", send: db.send };
    db.send.mockResolvedValue({ status: "retry", reason: "provider down" });
    db.cursors.set("search", { through: "2026-10-31T08:41:00.000Z", xact: 50, activated: "2026-10-01T00:00:00.000Z" });
    // A part a day for ten days, each day's digest never sent and carried.
    for (let d = 1; d <= 10; d += 1) {
      const date = `2026-11-${String(d).padStart(2, "0")}`;
      publish(`${date}T07:00:00Z`, `Part of day ${d}`);
      at(`${date}T08:41:00Z`); await runDigests();
      at(`${date}T23:41:00Z`); await runDigests();
    }
    db.send.mockResolvedValue({ status: "sent", providerId: "provider-id" });
    publish("2026-11-11T07:00:00Z", "Part of day 11");
    at("2026-11-11T08:41:00Z"); await runDigests();

    const sent = db.digests.filter((d) => d.status === "sent");
    expect(sent).toHaveLength(1);
    // From midnight on 4 November: days 4 to 11, and nothing from days 1 to 3.
    expect(sent[0]).toMatchObject({ window_start: "2026-11-04T00:00:00.000Z", match_count: 8 });
    const titles = (sent[0].items as { title: string }[]).map((item) => item.title);
    expect(titles).toContain("Part of day 11");
    expect(titles).not.toContain("Part of day 3");
    expect(db.send.mock.lastCall![0].subject).toBe("8 new parts match E46 coilovers");
  });
});

describe("a pinned xmin can't reach before the alert was turned on", () => {
  it("a part published while the alert was off is not mailed once the pinning transaction ends", async () => {
    reliable();
    at("2026-11-08T06:00:00Z");
    db.setAlert("search", false);
    // An unrelated transaction (id 100) opens and stays open, pinning xmin.
    const unrelated = begin("2026-11-08T06:00:00Z", "unrelated write");
    // Part 101 is published, and commits, while the alert is off.
    at("2026-11-08T06:10:00Z"); publish("2026-11-08T06:10:00Z", "Before activation");
    // The alert goes on: its window starts at the pinned xmin, 100.
    at("2026-11-08T06:20:00Z"); db.setAlert("search", true);
    expect(db.cursors.get("search")).toMatchObject({ xact: 100, activated: "2026-11-08T06:20:00.000Z" });
    // Transaction 100 ends; a part is published after activation.
    db.inflight.splice(db.inflight.indexOf(unrelated), 1);
    at("2026-11-08T07:00:00Z"); publish("2026-11-08T07:00:00Z", "After activation");

    at("2026-11-09T08:41:00Z"); await runDigests();
    const [digest] = digestsFor("search");
    expect(digest).toMatchObject({ match_count: 1 });
    expect((digest.items as { title: string }[]).map((item) => item.title)).toEqual(["After activation"]);
  });
});

