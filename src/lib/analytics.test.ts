import { afterEach, describe, expect, it, vi } from "vitest";

import { capture, flagEnabled } from "./analytics";

describe("analytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is a no-op without POSTHOG_KEY", () => {
    vi.stubEnv("POSTHOG_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    capture("user-1", { event: "offer_submitted" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("posts the typed event when configured, and never throws on failure", () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    vi.stubEnv("POSTHOG_HOST", "https://ph.example");
    const fetchSpy = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchSpy);
    expect(() =>
      capture("user-1", { event: "search_performed", props: { lane: "human", results: 3 } }),
    ).not.toThrow();
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://ph.example/capture/");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.event).toBe("search_performed");
    expect(body.distinct_id).toBe("user-1");
    expect(body.properties).toEqual({ lane: "human", results: 3 });
  });

  it("reads env feature flags", () => {
    vi.stubEnv("FLAG_NEW_SEARCH", "true");
    expect(flagEnabled("new_search")).toBe(true);
    expect(flagEnabled("other")).toBe(false);
  });
});
