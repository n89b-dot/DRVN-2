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
