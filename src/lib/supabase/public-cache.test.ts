import { afterEach, describe, expect, it, vi } from "vitest";

import { cachedPublicFetch, isCacheablePublicRead, isWithinMaxAge, publicCacheEnabled, PUBLIC_READ_FUNCTIONS } from "./public-cache";

const REST = "https://db.example.co/rest/v1";
const answeredAt = (ms: number) => new Response("[]", { headers: { date: new Date(ms).toUTCString() } });

afterEach(() => vi.unstubAllEnvs());

describe("what may be answered from the shared copy", () => {
  it("table reads", () => {
    expect(isCacheablePublicRead("GET", `${REST}/listings?id=eq.1`)).toBe(true);
    expect(isCacheablePublicRead(undefined, `${REST}/cars?slug=eq.a`)).toBe(true);
    expect(isCacheablePublicRead("HEAD", `${REST}/listings?select=id`)).toBe(true);
  });

  it("never a write to a table", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(isCacheablePublicRead(method, `${REST}/listings`)).toBe(false);
    }
  });

  it("a function only when it is on the read-only list", () => {
    expect(isCacheablePublicRead("POST", `${REST}/rpc/marketplace_browse_rows`)).toBe(true);
    // The view counter is a write: cached, it would count one look per minute.
    expect(isCacheablePublicRead("POST", `${REST}/rpc/bump_listing_view`)).toBe(false);
    expect(isCacheablePublicRead("POST", `${REST}/rpc/anything_new`)).toBe(false);
    expect(PUBLIC_READ_FUNCTIONS.has("bump_listing_view")).toBe(false);
  });

  it("the public counts and pages (OS-W22), never a member's own saves or follows", () => {
    for (const name of ["listing_engagement_counts", "seller_review_summaries", "post_reaction_counts", "post_comment_page", "car_update_page"]) {
      expect(isCacheablePublicRead("POST", `${REST}/rpc/${name}`), name).toBe(true);
    }
    for (const name of ["followed_feed_rows", "saved_counts", "saved_listing_page", "saved_page"]) {
      expect(PUBLIC_READ_FUNCTIONS.has(name), name).toBe(false);
    }
  });

  it("nothing outside the data API", () => {
    expect(isCacheablePublicRead("GET", "https://db.example.co/auth/v1/user")).toBe(false);
    expect(isCacheablePublicRead("GET", "https://db.example.co/storage/v1/object/x")).toBe(false);
    expect(isCacheablePublicRead("GET", "not a url")).toBe(false);
  });
});

describe("the age limit", () => {
  const now = Date.parse("2026-10-04T12:00:00Z");
  it("accepts a copy inside the limit and refuses one past it", () => {
    expect(isWithinMaxAge(answeredAt(now - 30_000), 60, now)).toBe(true);
    expect(isWithinMaxAge(answeredAt(now - 3_600_000), 60, now)).toBe(false);
  });
  it("allows a few seconds of clock disagreement, either way", () => {
    expect(isWithinMaxAge(answeredAt(now - 63_000), 60, now)).toBe(true);
    expect(isWithinMaxAge(answeredAt(now + 20_000), 60, now)).toBe(true);
  });
  it("refuses a copy whose age cannot be read", () => {
    expect(isWithinMaxAge(new Response("[]"), 60, now)).toBe(false);
    expect(isWithinMaxAge(new Response("[]", { headers: { date: "soon" } }), 60, now)).toBe(false);
  });
});

describe("the cached fetch", () => {
  const url = `${REST}/listings?id=eq.1`;

  it("asks for a tagged, time-limited copy of a read", async () => {
    const base = vi.fn(async () => answeredAt(Date.now()));
    await cachedPublicFetch({ maxAge: 60, tags: ["public:listings"] }, base as unknown as typeof fetch)(url);
    expect(base).toHaveBeenCalledTimes(1);
    expect(base.mock.calls[0]).toEqual([url, { next: { revalidate: 60, tags: ["public:listings"] } }]);
  });

  it("throws away an expired copy and asks the database", async () => {
    const base = vi.fn()
      .mockResolvedValueOnce(answeredAt(Date.now() - 3_600_000))
      .mockResolvedValueOnce(new Response("fresh"));
    const response = await cachedPublicFetch({ maxAge: 60, tags: [] }, base as unknown as typeof fetch)(url);
    expect(await response.text()).toBe("fresh");
    expect(base.mock.calls[1][1]).toEqual({ cache: "no-store" });
  });

  it("sends a write straight to the database", async () => {
    const base = vi.fn(async () => new Response("null"));
    await cachedPublicFetch({ maxAge: 60, tags: [] }, base as unknown as typeof fetch)(`${REST}/rpc/bump_listing_view`, { method: "POST", body: "{}" });
    expect(base.mock.calls).toEqual([[`${REST}/rpc/bump_listing_view`, { method: "POST", body: "{}", cache: "no-store" }]]);
  });

  it("is off on the isolated e2e stack, by switch, and at age 0", async () => {
    const base = vi.fn(async () => answeredAt(Date.now()));
    const call = (maxAge: number) => cachedPublicFetch({ maxAge, tags: [] }, base as unknown as typeof fetch)(url);
    await call(0);
    vi.stubEnv("E2E_TEST_PROJECT_REF", "local-drvn-remediation");
    await call(60);
    vi.stubEnv("E2E_TEST_PROJECT_REF", "");
    vi.stubEnv("DRVN_PUBLIC_CACHE", "off");
    await call(60);
    expect((base.mock.calls as unknown[][]).map((c) => c[1])).toEqual([{ cache: "no-store" }, { cache: "no-store" }, { cache: "no-store" }]);
    expect(publicCacheEnabled({})).toBe(true);
  });
});
