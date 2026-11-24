import { afterEach, describe, expect, it, vi } from "vitest";

import { isSameOrigin, requireSameOrigin } from "./origin";

const post = (headers: Record<string, string>) => new Request("https://drvn.example/api/x", { method: "POST", headers });

afterEach(() => vi.unstubAllEnvs());

describe("same-origin check for cookie-authenticated writes", () => {
  it("accepts a write from the origin it was addressed to", () => {
    expect(isSameOrigin(post({ origin: "https://drvn.example" }))).toBe(true);
  });

  it("accepts the configured site origin, with or without a trailing slash or path", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://www.drvn.example/");
    expect(isSameOrigin(post({ origin: "https://www.drvn.example" }))).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "not a url");
    expect(isSameOrigin(post({ origin: "https://drvn.example" }))).toBe(true);
    expect(isSameOrigin(post({ origin: "https://www.drvn.example" }))).toBe(false);
  });

  it("refuses another site, a null origin and a lookalike", () => {
    for (const origin of ["https://evil.example", "null", "https://drvn.example.evil.test", "http://drvn.example"]) {
      expect(isSameOrigin(post({ origin })), origin).toBe(false);
    }
  });

  it("with no Origin header, takes the browser's own same-origin mark and nothing else", () => {
    expect(isSameOrigin(post({ "sec-fetch-site": "same-origin" }))).toBe(true);
    expect(isSameOrigin(post({ "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(post({ "sec-fetch-site": "same-site" }))).toBe(false);
    expect(isSameOrigin(post({}))).toBe(false);
  });

  it("a named origin decides even when the fetch mark disagrees", () => {
    expect(isSameOrigin(post({ origin: "https://evil.example", "sec-fetch-site": "same-origin" }))).toBe(false);
  });

  it("answers 403 with the caller's headers, or nothing when the request is ours", async () => {
    const refused = requireSameOrigin(post({ origin: "https://evil.example" }), { "Cache-Control": "no-store" });
    expect(refused?.status).toBe(403);
    expect(refused?.headers.get("Cache-Control")).toBe("no-store");
    expect(await refused?.json()).toEqual({ error: "Invalid origin." });
    expect(requireSameOrigin(post({ origin: "https://drvn.example" }))).toBeNull();
  });
});
