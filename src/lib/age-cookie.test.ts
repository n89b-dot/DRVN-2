import { afterEach, describe, expect, it, vi } from "vitest";

import { AGE_COOKIE, ageCookieIsFor, ageCookieValue } from "./age-cookie";

afterEach(() => vi.unstubAllEnvs());

describe("N662: the cookie that remembers a checked 18+ answer is signed (work review #152)", () => {
  it("believes only a value this server signed for exactly this account", () => {
    vi.stubEnv("GUEST_RECEIPT_SECRET", "a".repeat(40));
    const value = ageCookieValue("member-1")!;
    expect(AGE_COOKIE).toBe("drvn_age_checked");
    expect(value.startsWith("member-1.")).toBe(true);
    expect(ageCookieIsFor(value, "member-1")).toBe(true);
    // The old cookie, and what a member could type by hand: the bare account id.
    expect(ageCookieIsFor("member-1", "member-1")).toBe(false);
    // Another account's cookie, a cut signature, a swapped id, nothing at all.
    expect(ageCookieIsFor(ageCookieValue("member-2")!, "member-1")).toBe(false);
    expect(ageCookieIsFor(value.slice(0, -1), "member-1")).toBe(false);
    expect(ageCookieIsFor(value.replace("member-1", "member-2"), "member-2")).toBe(false);
    expect(ageCookieIsFor(undefined, "member-1")).toBe(false);
    expect(ageCookieIsFor(value, "")).toBe(false);
  });

  it("a value signed under another key is not believed", () => {
    vi.stubEnv("GUEST_RECEIPT_SECRET", "a".repeat(40));
    const value = ageCookieValue("member-1")!;
    vi.stubEnv("GUEST_RECEIPT_SECRET", "b".repeat(40));
    expect(ageCookieIsFor(value, "member-1")).toBe(false);
  });

  it("in production without the key, writes no cookie and believes none", () => {
    vi.stubEnv("GUEST_RECEIPT_SECRET", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(ageCookieValue("member-1")).toBeNull();
    expect(ageCookieIsFor("member-1.anything", "member-1")).toBe(false);
  });
});
