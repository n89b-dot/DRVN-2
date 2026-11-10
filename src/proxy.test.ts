import { NextRequest, NextResponse } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ update: vi.fn() }));
const blocked = vi.hoisted(() => ({ keys: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: session.update }));
vi.mock("@/lib/copyright/blocked-media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/copyright/blocked-media")>()),
  blockedMediaKeys: blocked.keys,
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
  const source = (file: string) => `https://project.supabase.co/storage/v1/object/public/listing-images/${OWNER}/${file}`;
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
