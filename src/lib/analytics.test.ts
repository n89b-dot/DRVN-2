import { afterEach, describe, expect, it, vi } from "vitest";

const context = vi.hoisted(() => ({ consent: "v1:no", missingRequest: false, tasks: [] as Array<() => Promise<void>> }));
vi.mock("next/headers", () => ({ cookies: async () => { if (context.missingRequest) throw new Error("No request"); return { get: () => ({ value: context.consent }) }; } }));
vi.mock("next/server", () => ({ after: (task: () => Promise<void>) => { if (context.missingRequest) throw new Error("No request"); context.tasks.push(task); } }));
import { capture, flagEnabled } from "./analytics";

describe("analytics", () => {
  afterEach(() => {
    context.tasks = []; context.consent = "v1:no"; context.missingRequest = false;
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

  it("posts only with explicit consent and survives transport failure", async () => {
    context.consent = "v1:yes";
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    vi.stubEnv("POSTHOG_HOST", "https://ph.example");
    const fetchSpy = vi.fn().mockRejectedValue(new Error("down"));
    vi.stubGlobal("fetch", fetchSpy);
    expect(() =>
      capture("user-1", { event: "search_performed", props: { lane: "human", results: 3 } }),
    ).not.toThrow();
    await Promise.all(context.tasks.map((task) => task()));
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe("https://ph.example/capture/");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.event).toBe("search_performed");
    expect(body.distinct_id).toBe("user-1");
    expect(body.properties).toEqual({ lane: "human", results: 3 });
  });

  it("does not send configured analytics without opt-in", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    capture("user-1", { event: "offer_submitted" });
    await Promise.all(context.tasks.map((task) => task()));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays off without a request context and consumes the cookie rejection", async () => {
    context.missingRequest = true;
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    const fetchSpy = vi.fn(); vi.stubGlobal("fetch", fetchSpy);
    expect(() => capture("worker", { event: "offer_submitted" })).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reads env feature flags", () => {
    vi.stubEnv("FLAG_NEW_SEARCH", "true");
    expect(flagEnabled("new_search")).toBe(true);
    expect(flagEnabled("other")).toBe(false);
  });
});
