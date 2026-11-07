import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "./safe-redirect";

/**
 * Regression tests for the open redirect. The original check was
 * `next.startsWith("/")`, which `//evil.com` passes — browsers treat that as a
 * protocol-relative URL and navigate off-site, turning the post-login redirect
 * into a phishing vector.
 */
describe("safeRedirectPath", () => {
  it("accepts ordinary in-app paths", () => {
    expect(safeRedirectPath("/garage")).toBe("/garage");
    expect(safeRedirectPath("/orders/abc-123")).toBe("/orders/abc-123");
    expect(safeRedirectPath("/marketplace?category=engine")).toBe("/marketplace?category=engine");
  });

  it("rejects protocol-relative URLs", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/home");
    expect(safeRedirectPath("//evil.com/path")).toBe("/home");
  });

  it("rejects absolute URLs and embedded schemes", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/home");
    expect(safeRedirectPath("http://evil.com")).toBe("/home");
    expect(safeRedirectPath("javascript:alert(1)")).toBe("/home");
    expect(safeRedirectPath("/javascript:alert(1)")).toBe("/home");
  });

  it("rejects backslash tricks", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/home");
  });

  // Readiness N19: the URL parser strips tabs and newlines before it reads
  // the authority, so `/\t/evil.com` used to pass every prefix check and
  // then parse as https://evil.com/.
  it("rejects control characters hidden inside the path", () => {
    for (const value of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/\r\n/evil.com", "/\u0000/evil.com", "/\u007f/evil.com"]) {
      expect(safeRedirectPath(value)).toBe("/home");
    }
    // What a browser would actually do with the tab variant.
    expect(new URL("/\t/evil.com", "https://drvn.app").origin).toBe("https://evil.com");
  });

  it("rejects backslashes anywhere, not only after the first slash", () => {
    expect(safeRedirectPath("/garage\\..\\evil.com")).toBe("/home");
    expect(safeRedirectPath("/\t\\evil.com")).toBe("/home");
  });

  it("rejects encoded variants that turn dangerous after one more decode", () => {
    for (const value of ["/%09/evil.com", "/%0a/evil.com", "/%0D%0A/evil.com", "/%5cevil.com", "/%5C%5Cevil.com", "/%2F%2Fevil.com", "/%2f/evil.com", "/%3Aevil", "/%E0%A4%A"]) {
      expect(safeRedirectPath(value)).toBe("/home");
    }
  });

  it("rejects every protocol-relative spelling", () => {
    for (const value of ["//evil.com", " //evil.com", "///evil.com", "//\\evil.com", "/\t/\t/evil.com"]) {
      expect(safeRedirectPath(value)).toBe("/home");
    }
  });

  it("returns the resolved same-origin path, so the browser gets what was checked", () => {
    expect(safeRedirectPath("/listings/abc/../def")).toBe("/listings/def");
    expect(safeRedirectPath("/settings?changed=email#account")).toBe("/settings?changed=email#account");
    expect(safeRedirectPath("/onboarding?next=%2Flistings%2Fabc")).toBe("/onboarding?next=%2Flistings%2Fabc");
  });

  it("keeps every result on the trusted origin", () => {
    const hostile = ["/\t/evil.com", "/%09/evil.com", "//evil.com", "/\\evil.com", "https://evil.com", "/.//evil.com", "/..//evil.com"];
    for (const value of hostile) {
      const result = safeRedirectPath(value, "/home");
      expect(new URL(result, "https://drvn.app").origin).toBe("https://drvn.app");
    }
  });

  it("falls back for non-strings and empty input", () => {
    expect(safeRedirectPath(undefined)).toBe("/home");
    expect(safeRedirectPath(null)).toBe("/home");
    expect(safeRedirectPath(42)).toBe("/home");
    expect(safeRedirectPath("")).toBe("/home");
    expect(safeRedirectPath("garage")).toBe("/home");
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeRedirectPath("//evil.com", "/login")).toBe("/login");
  });
});
