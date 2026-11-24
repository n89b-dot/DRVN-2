import { describe, expect, it } from "vitest";

import { NO_STORE, VISITOR_BROWSE, isSessionCookie, pageCacheControl } from "./page-cache";

const visitor = { method: "GET", cookieNames: [] as string[], status: 200, setsCookie: false };

describe("page Cache-Control", () => {
  it.each(["/", "/marketplace", "/explore", "/listings/abc", "/cars/e30-m3", "/cars/e30-m3/activity/p1", "/posts/p1", "/u/kaito"])(
    "lets a signed-out visitor's browser keep %s for Back",
    (pathname) => {
      expect(pageCacheControl({ ...visitor, pathname })).toBe(VISITOR_BROWSE);
    },
  );

  it.each(["/checkout", "/cart", "/admin", "/admin/users", "/login", "/signup", "/api/health", "/sell", "/orders/1", "/listings/abc/edit", "/settings", "/messages"])(
    "keeps %s out of every cache, signed out or not",
    (pathname) => {
      expect(pageCacheControl({ ...visitor, pathname })).toBe(NO_STORE);
    },
  );

  it("keeps a member's pages out of every cache, so signing out and pressing Back shows nothing of theirs", () => {
    for (const cookieNames of [["sb-abc-auth-token"], ["sb-abc-auth-token.0", "sb-abc-auth-token.1"], ["drvn-tz", "sb-local-auth-token"]]) {
      expect(pageCacheControl({ ...visitor, pathname: "/marketplace", cookieNames })).toBe(NO_STORE);
    }
  });

  it("does not take a visitor's other cookies for a session", () => {
    expect(pageCacheControl({ ...visitor, pathname: "/marketplace", cookieNames: ["drvn-tz", "drvn_cart", "drvn_age_checked"] })).toBe(VISITOR_BROWSE);
    expect(isSessionCookie("sb-abc-auth-token-code-verifier")).toBe(false);
  });

  it("never relaxes a write, a redirect, an error or a response that sets a cookie", () => {
    expect(pageCacheControl({ ...visitor, pathname: "/marketplace", method: "POST" })).toBe(NO_STORE);
    expect(pageCacheControl({ ...visitor, pathname: "/marketplace", status: 307 })).toBe(NO_STORE);
    expect(pageCacheControl({ ...visitor, pathname: "/marketplace", status: 404 })).toBe(NO_STORE);
    expect(pageCacheControl({ ...visitor, pathname: "/marketplace", setsCookie: true })).toBe(NO_STORE);
  });
});
