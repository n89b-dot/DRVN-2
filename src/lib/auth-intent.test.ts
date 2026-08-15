import { describe, expect, it } from "vitest";

import {
  AUTH_INTENTS,
  AUTH_INTENT_COPY,
  authHref,
  authReturnTo,
  parseAuthIntent,
} from "./auth-intent";
import { onboardingPath, safeRedirectPath } from "./safe-redirect";

describe("parseAuthIntent", () => {
  it("accepts the known intents", () => {
    for (const intent of AUTH_INTENTS) {
      expect(parseAuthIntent(intent)).toBe(intent);
    }
  });

  it("rejects anything else", () => {
    for (const value of ["", "delete", "OFFER", null, undefined, 7, {}]) {
      expect(parseAuthIntent(value)).toBeNull();
    }
  });
});

describe("authReturnTo", () => {
  it("encodes the intent onto the listing path", () => {
    expect(authReturnTo("/listings/abc", "offer")).toBe("/listings/abc?action=offer");
  });

  it("keeps existing query params", () => {
    expect(authReturnTo("/listings/abc?from=grid", "save")).toBe(
      "/listings/abc?from=grid&action=save"
    );
  });

  it("does not gate buying — purchasing is not an auth intent", () => {
    expect(AUTH_INTENTS).not.toContain("buy");
    expect(parseAuthIntent("buy")).toBeNull();
  });

  it("replaces a stale action rather than stacking a second one", () => {
    expect(authReturnTo("/listings/abc?action=save", "offer")).toBe(
      "/listings/abc?action=offer"
    );
  });

  it("produces a destination the redirect guard accepts", () => {
    const returnTo = authReturnTo("/listings/abc", "offer");
    expect(safeRedirectPath(returnTo, "/home")).toBe(returnTo);
  });
});

describe("authHref", () => {
  it("hands both auth routes the same escaped destination", () => {
    const returnTo = authReturnTo("/listings/abc", "offer");
    expect(authHref("/login", returnTo)).toBe(
      "/login?next=%2Flistings%2Fabc%3Faction%3Doffer"
    );
    expect(authHref("/signup", returnTo)).toBe(
      "/signup?next=%2Flistings%2Fabc%3Faction%3Doffer"
    );
  });
});

describe("onboardingPath", () => {
  it("carries a validated destination through onboarding", () => {
    expect(onboardingPath("/listings/abc?action=offer")).toBe(
      "/onboarding?next=%2Flistings%2Fabc%3Faction%3Doffer"
    );
  });

  it("drops an off-site destination instead of forwarding it", () => {
    for (const hostile of ["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)"]) {
      expect(onboardingPath(hostile)).toBe("/onboarding");
    }
  });

  it("is a bare path when there's nothing to carry", () => {
    expect(onboardingPath(undefined)).toBe("/onboarding");
    expect(onboardingPath("")).toBe("/onboarding");
  });
});

describe("intent copy", () => {
  it("explains every intent — the dialog has no generic fallback text", () => {
    for (const intent of AUTH_INTENTS) {
      const copy = AUTH_INTENT_COPY[intent];
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.lead.length).toBeGreaterThan(0);
      expect(copy.reasons.length).toBeGreaterThan(0);
    }
  });
});
