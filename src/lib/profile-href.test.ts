import { describe, expect, it } from "vitest";

import { PROFILE_VIEWS, profileHref, resolveProfileView } from "./profile-href";

describe("profileHref (R2-06)", () => {
  it("links a tab with the key the profile route reads", () => {
    expect(profileHref("kaito", "parts")).toBe("/u/kaito?view=parts");
    expect(profileHref("kaito", "garage")).toBe("/u/kaito?view=garage");
  });

  it("never emits the ?tab= key the route used to ignore", () => {
    for (const view of PROFILE_VIEWS) expect(profileHref("kaito", view)).not.toContain("tab=");
  });

  it("is the bare profile URL for Overview or no view", () => {
    expect(profileHref("kaito")).toBe("/u/kaito");
    expect(profileHref("kaito", "overview")).toBe("/u/kaito");
  });

  it("encodes the handle so it can't add a query of its own", () => {
    expect(profileHref("a?b", "parts")).toBe("/u/a%3Fb?view=parts");
  });

  it("round-trips through the route's resolver", () => {
    for (const view of PROFILE_VIEWS) {
      const href = profileHref("kaito", view);
      const param = new URL(href, "https://drvn.test").searchParams.get("view") ?? undefined;
      expect(resolveProfileView(param) ?? "overview").toBe(view);
    }
  });
});

describe("resolveProfileView", () => {
  it("reads ?view=", () => {
    expect(resolveProfileView("parts")).toBe("parts");
    expect(resolveProfileView("reviews")).toBe("reviews");
  });

  it("still resolves the old tab names (P-3)", () => {
    expect(resolveProfileView("forsale")).toBe("parts");
    expect(resolveProfileView("about")).toBe("overview");
    expect(resolveProfileView("activity")).toBe("updates");
  });

  it("accepts the legacy ?tab= key when ?view= is absent", () => {
    expect(resolveProfileView(undefined, "parts")).toBe("parts");
    expect(resolveProfileView(undefined, "forsale")).toBe("parts");
  });

  it("prefers ?view= over ?tab=", () => {
    expect(resolveProfileView("garage", "parts")).toBe("garage");
  });

  it("ignores unknown values so the route picks its default", () => {
    expect(resolveProfileView(undefined)).toBeUndefined();
    expect(resolveProfileView("store")).toBeUndefined();
    expect(resolveProfileView(undefined, "store")).toBeUndefined();
  });
});
