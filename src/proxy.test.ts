// Next's own matcher check. Its docs call it unstable_doesProxyMatch; the
// installed 16.4.3 exports it under the name it had before the rename.
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ update: vi.fn() }));
const blocked = vi.hoisted(() => ({ keys: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: session.update }));
vi.mock("@/lib/copyright/blocked-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/copyright/blocked-media")>()),
  // The proxy asks about one object; these tests still say which objects are blocked (null: unknown).
  mediaIsBlocked: async (key: string) => {
    const keys: Set<string> | null | undefined = await blocked.keys();
    return keys === null ? null : (keys?.has(key) ?? false);
  },
}));
session.update.mockImplementation(async () => NextResponse.next());

import { buildContentSecurityPolicy } from "@/lib/csp";

import { config, proxy } from "./proxy";

/** The generated policy as directive → sources. */
function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split(";").map((part) => part.trim().split(/\s+/)).filter((p) => p[0]).map(([name, ...sources]) => [name, sources]));
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("Content Security Policy header (N25)", () => {
  it("admits Stripe.js's frame and script origins for the Payment Element and 3-D Secure", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NODE_ENV", "production");
    const response = await proxy(new NextRequest("https://drvn.example/checkout"));
    const policy = directives(response.headers.get("Content-Security-Policy") ?? "");

    // Stripe's integration security guide, Stripe.js set.
    expect(policy.get("frame-src")).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"]));
    expect(policy.get("script-src")).toEqual(expect.arrayContaining(["https://js.stripe.com", "https://*.js.stripe.com"]));
    expect(policy.get("connect-src")).toEqual(expect.arrayContaining(["https://api.stripe.com", "https://project.supabase.co", "wss://project.supabase.co"]));
  });

  it("stays narrow: no wildcard Stripe origin beyond js.stripe.com, no unsafe script sources in production", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NODE_ENV", "production");
    const response = await proxy(new NextRequest("https://drvn.example/"));
    const policy = directives(response.headers.get("Content-Security-Policy") ?? "");
    const all = [...policy.values()].flat();
    expect(all).not.toContain("https://*.stripe.com");
    expect(all).not.toContain("*");
    expect(all.filter((s) => s.includes("stripe")).every((s) => /^https:\/\/(\*\.js|js|hooks|api)\.stripe\.com$/.test(s))).toBe(true);
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
    expect(policy.get("script-src")?.some((s) => s.startsWith("'nonce-"))).toBe(true);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.has("upgrade-insecure-requests")).toBe(true);
  });

  it("reports violations to the intake, through both reporting mechanisms", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    const response = await proxy(new NextRequest("https://drvn.example/"));
    const policy = directives(response.headers.get("Content-Security-Policy") ?? "");
    expect(policy.get("report-uri")).toEqual(["/api/monitoring/csp"]);
    expect(policy.get("report-to")).toEqual(["csp"]);
    expect(response.headers.get("Reporting-Endpoints")).toBe('csp="/api/monitoring/csp"');
  });

  it("allows eval and plain http only where the dev server or local stack needs them", () => {
    const dev = directives(buildContentSecurityPolicy({ nonce: "n", supabaseOrigin: "http://127.0.0.1:54321", development: true, allowInsecure: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws://127.0.0.1:54321");
    expect(dev.has("upgrade-insecure-requests")).toBe(false);
  });

  it("issues a fresh nonce per request", async () => {
    const a = await proxy(new NextRequest("https://drvn.example/"));
    const b = await proxy(new NextRequest("https://drvn.example/"));
    expect(a.headers.get("Content-Security-Policy")).not.toBe(b.headers.get("Content-Security-Policy"));
  });
});

// R69-dmca: Next.js keeps resized images for a month and can't evict one, so
// a photo a copyright takedown removed is refused before the cache answers.
describe("copyright image gate", () => {
  const OWNER = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";
  // Signed, as every page sends a member photo since N455 (an unsigned one is
  // refused before the blocklist; see the N940 tests below).
  const liveToken = ["e30", Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url"), "sig"].join(".");
  const source = (file: string) => `https://project.supabase.co/storage/v1/object/sign/listing-images/${OWNER}/${file}?token=${liveToken}`;
  const imageRequest = (file: string) =>
    new NextRequest(`https://drvn.example/_next/image?url=${encodeURIComponent(source(file))}&w=640&q=75`);

  it("runs on optimised images", () => {
    expect(config.matcher).toContain("/_next/image");
  });

  it("refuses a taken-down photo with 451 and nothing cacheable", async () => {
    blocked.keys.mockResolvedValue(new Set([`listing-images/${OWNER}/rehosted.webp`]));
    session.update.mockClear();
    const response = await proxy(imageRequest("rehosted.webp"));
    expect(response.status).toBe(451);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(session.update).not.toHaveBeenCalled();
  });

  it("refuses storage photos, not site images, while no blocklist has been read (N718)", async () => {
    blocked.keys.mockResolvedValue(null);
    const response = await proxy(imageRequest("own-photo.webp"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("15");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const site = await proxy(new NextRequest("https://drvn.example/_next/image?url=%2Fhero.png&w=640&q=75"));
    expect(site.status).toBe(200);
  });

  it("passes every other image straight through, with no session work", async () => {
    blocked.keys.mockResolvedValue(new Set([`listing-images/${OWNER}/rehosted.webp`]));
    session.update.mockClear();
    const response = await proxy(imageRequest("own-photo.webp"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(session.update).not.toHaveBeenCalled();

    blocked.keys.mockClear();
    await proxy(new NextRequest("https://drvn.example/_next/image?url=%2Fhero.png&w=640&q=75"));
    expect(blocked.keys).not.toHaveBeenCalled();
  });
});

describe("an expired member-photo link is refused before the optimiser's cache (N940, #178 review)", () => {
  const OWNER = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";
  const token = (exp: number | undefined) =>
    ["e30", Buffer.from(JSON.stringify(exp === undefined ? { url: "x" } : { url: "x", exp })).toString("base64url"), "sig"].join(".");
  const signedRequest = (exp: number | undefined) =>
    new NextRequest(
      `https://drvn.example/_next/image?url=${encodeURIComponent(`https://project.supabase.co/storage/v1/object/sign/car-images/${OWNER}/a.webp?token=${token(exp)}`)}&w=640&q=75`,
    );

  it("refuses an expired, unreadable or expiry-less token with a 404 and nothing cacheable", async () => {
    blocked.keys.mockResolvedValue(new Set());
    for (const exp of [Math.floor(Date.now() / 1000) - 60, undefined]) {
      const response = await proxy(signedRequest(exp));
      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("passes a live token through", async () => {
    blocked.keys.mockResolvedValue(new Set());
    const response = await proxy(signedRequest(Math.floor(Date.now() / 1000) + 3600));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("the image gate refuses unsigned member photos and nothing else (N940, Codex on #178)", () => {
  const OWNER = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";
  const gate = (url: string) => proxy(new NextRequest(`https://drvn.example/_next/image?url=${encodeURIComponent(url)}&w=640&q=75`));

  it("refuses a member photo's canonical URL, which an old cached copy could still answer", async () => {
    blocked.keys.mockResolvedValue(new Set());
    const response = await gate(`https://project.supabase.co/storage/v1/object/public/car-images/${OWNER}/a.webp`);
    expect(response.status).toBe(404);
  });

  it("passes avatars, brand assets and other hosts, with no extra call", async () => {
    blocked.keys.mockResolvedValue(new Set());
    session.update.mockClear();
    for (const url of [`https://project.supabase.co/storage/v1/object/public/avatars/${OWNER}/me.webp`, "/landing/hero.webp", "https://images.example/x.jpg"]) {
      const response = await gate(url);
      expect(response.headers.get("x-middleware-next"), url).toBe("1");
    }
    expect(session.update).not.toHaveBeenCalled();
  });
});

describe("gate order and the optimiser's other spellings (N940, #196 review)", () => {
  const OWNER = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";
  it("a taken-down photo is 451 even when requested unsigned", async () => {
    blocked.keys.mockResolvedValue(new Set([`car-images/${OWNER}/gone.webp`]));
    const response = await proxy(new NextRequest(`https://drvn.example/_next/image?url=${encodeURIComponent(`https://project.supabase.co/storage/v1/object/public/car-images/${OWNER}/gone.webp`)}&w=640&q=75`));
    expect(response.status).toBe(451);
  });

  it("gates /_next/image/ with a trailing slash too", async () => {
    blocked.keys.mockResolvedValue(new Set([`car-images/${OWNER}/gone.webp`]));
    const response = await proxy(new NextRequest(`https://drvn.example/_next/image/?url=${encodeURIComponent(`https://project.supabase.co/storage/v1/object/public/car-images/${OWNER}/gone.webp`)}&w=640&q=75`));
    expect(response.status).toBe(451);
    expect(config.matcher).toContain("/_next/image/:path*");
  });
});

describe("N715: the proxy's matcher runs on every console path (work review #143)", () => {
  const runs = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it("runs on the console whatever the path ends in, an image extension included", () => {
    for (const url of ["/admin", "/admin/", "/admin/users", "/admin/users/x.png", "/admin/cases/photo.JPG", "/admin/a/b/c.webp", "/admin/logo.svg"]) {
      expect(runs(url), url).toBe(true);
    }
  });

  it("still runs on pages, actions' own URLs and optimised images", () => {
    for (const url of ["/", "/home", "/listings/123", "/admin-verify", "/api/version", "/_next/image", "/_next/image/"]) {
      expect(runs(url), url).toBe(true);
    }
  });

  it("still skips static assets and public image files outside the console", () => {
    for (const url of ["/_next/static/chunks/main.js", "/favicon.ico", "/logo.png", "/brand/mark.svg", "/administrator.png"]) {
      expect(runs(url), url).toBe(false);
    }
  });
});
