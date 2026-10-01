import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// RR-06: a token refresh during the session check writes rotated cookies.
// Every response the proxy returns — pass-through or redirect — must carry
// them, or the browser keeps a refresh token the server already spent.

type Scenario = { claims: Record<string, unknown> | null; refresh: boolean; throws?: boolean };
let scenario: Scenario = { claims: null, refresh: false };

const ROTATED = [
  { name: "sb-test-auth-token.0", value: "rotated-chunk-0", options: { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: 3600 } },
  { name: "sb-test-auth-token.1", value: "rotated-chunk-1", options: { path: "/", httpOnly: true, sameSite: "lax" as const, maxAge: 3600 } },
  // A chunk the refreshed session no longer needs is removed.
  { name: "sb-test-auth-token.2", value: "", options: { path: "/", maxAge: 0 } },
];

vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, opts: { cookies: { setAll: (c: typeof ROTATED) => void } }) => ({
    auth: {
      getClaims: async () => {
        if (scenario.refresh) opts.cookies.setAll(ROTATED);
        if (scenario.throws) throw new Error("auth unreachable");
        return { data: scenario.claims ? { claims: scenario.claims } : null };
      },
    },
  }),
}));
vi.mock("@/lib/env", () => ({ hasSupabaseConfig: () => true, isProduction: false, publicKey: () => "anon-key" }));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));

import { updateSession } from "./proxy";

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";

const request = (path: string) => new NextRequest(new URL(path, "https://drvn.test"));

function expectRotatedCookies(response: Response & { cookies: { get(name: string): unknown } }) {
  const jar = response as unknown as { cookies: { get(n: string): { value: string; maxAge?: number; httpOnly?: boolean } | undefined } };
  expect(jar.cookies.get("sb-test-auth-token.0")).toMatchObject({ value: "rotated-chunk-0", httpOnly: true, maxAge: 3600 });
  expect(jar.cookies.get("sb-test-auth-token.1")).toMatchObject({ value: "rotated-chunk-1" });
  expect(jar.cookies.get("sb-test-auth-token.2")).toMatchObject({ value: "", maxAge: 0 });
}

describe("updateSession keeps a refreshed session on every response", () => {
  beforeEach(() => {
    scenario = { claims: null, refresh: false };
  });

  it("passes through with the rotated cookies", async () => {
    scenario = { claims: { sub: "u1" }, refresh: true };
    const response = await updateSession(request("/marketplace"));
    expect(response.headers.get("location")).toBeNull();
    expectRotatedCookies(response);
  });

  it("signed in at / → /home, carrying the rotated cookies", async () => {
    scenario = { claims: { sub: "u1" }, refresh: true };
    const response = await updateSession(request("/"));
    expect(new URL(response.headers.get("location")!).pathname).toBe("/home");
    expectRotatedCookies(response);
  });

  it("signed in at /login?next=… → that safe destination, carrying the rotated cookies", async () => {
    scenario = { claims: { sub: "u1" }, refresh: true };
    const response = await updateSession(request("/login?next=%2Forders%3Fview%3Dsales"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname + location.search).toBe("/orders?view=sales");
    expectRotatedCookies(response);
  });

  it("still refuses an external ?next= after sign-in", async () => {
    scenario = { claims: { sub: "u1" }, refresh: true };
    const response = await updateSession(request("/login?next=https%3A%2F%2Fevil.test%2Fx"));
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://drvn.test");
    expect(location.pathname).toBe("/home");
  });

  it("a failed refresh on a product route → /login with the whole destination and the cookie removals", async () => {
    scenario = { claims: null, refresh: true };
    const response = await updateSession(request("/orders?view=sales"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/orders?view=sales");
    expectRotatedCookies(response);
  });

  it("an auth outage on a product route keeps the query and the cookies written before it", async () => {
    scenario = { claims: null, refresh: true, throws: true };
    const response = await updateSession(request("/garage?car=all"));
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/garage?car=all");
    expect(location.searchParams.get("error")).toBe("session-unavailable");
    expectRotatedCookies(response);
  });
});
