import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sign: vi.fn(),
  rpc: vi.fn(),
  clients: [] as { key: string; fetch: typeof fetch | undefined }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: vi.fn() }));
// The real @supabase/supabase-js is not needed: what is under test is the
// fetch that src/lib/supabase/public.ts hands it, which is captured here.
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string, options: { global?: { fetch?: typeof fetch } }) => {
    mocks.clients.push({ key, fetch: options.global?.fetch });
    return {
      storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], expiresIn: number) => mocks.sign(bucket, paths, expiresIn) }) },
      rpc: (fn: string, args: unknown) => ({ abortSignal: () => mocks.rpc(fn, args) }),
    };
  },
}));

const O = "https://proj.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_URL = O;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "public-test-key";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-test-key";
process.env.SUPABASE_SECRET_KEY = "secret-test-key";
process.env.DRVN_PUBLIC_CACHE = "on";

const { createPublicClient } = await import("./public");
const { PUBLIC_TAGS } = await import("./public-cache");
const { SIGN_RETRY_STEPS_MS } = await import("./photo-signing");

const ME = "11111111-1111-4111-8111-111111111111";
const canonical = `${O}/storage/v1/object/public/car-images/${ME}/kept.webp`;
const signed = `${O}/storage/v1/object/sign/car-images/${ME}/kept.webp?token=t`;
const stored = JSON.stringify([{ owner_id: ME, cover_image_url: canonical }]);

/**
 * Next's data cache, reduced to what matters here. It lives inside `fetch`:
 * a request that asks for a copy (`next.revalidate`) is answered from one and
 * kept; any other goes to the database. What it keeps is the response it was
 * given, which is why no wrapper outside it can put a signed link in it.
 */
function dataCache() {
  const state = { copies: new Map<string, string>(), databaseReads: 0, asked: [] as unknown[] };
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit & { next?: { revalidate?: number; tags?: string[] } }) => {
    const key = String(input);
    state.asked.push(init?.next ?? null);
    const keeps = Boolean(init?.next?.revalidate);
    if (!keeps || !state.copies.has(key)) state.databaseReads += 1;
    if (keeps && !state.copies.has(key)) state.copies.set(key, stored);
    return new Response(keeps ? state.copies.get(key) : stored, { headers: { "content-type": "application/json", date: new Date().toUTCString() } });
  }) as typeof fetch;
  return { state, fetchImpl };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("N1062: the public client as src/lib/supabase/public.ts builds it (reviews of #210 and #244)", () => {
  it("N1062: a reader during a signing outage and a reader after it are answered from one kept copy of the database's answer, the second with the photo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { state, fetchImpl } = dataCache();
    vi.stubGlobal("fetch", fetchImpl);
    mocks.rpc.mockImplementation(async (fn: string, args: { p_signed?: unknown[] }) => ({ data: fn === "photo_signing_ready" ? true : fn === "photo_signatures_offer" ? args.p_signed : [], error: null }));

    createPublicClient({ maxAge: 300, kinds: ["cars"] });
    const made = mocks.clients.at(-1)!;
    // Made with the public key, never the secret one.
    expect(made.key).toBe("public-test-key");
    const read = async () => (await made.fetch!(`${O}/rest/v1/cars?select=owner_id,cover_image_url`, { method: "GET" })).json();

    // The photo store is down: this reader gets the photo unsigned (the page shows its plate).
    mocks.sign.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    expect(await read()).toEqual([{ owner_id: ME, cover_image_url: canonical }]);
    // It was asked for as a kept copy, with this client's age and tag.
    expect(state.asked[0]).toEqual({ revalidate: 300, tags: [PUBLIC_TAGS.cars] });

    // The store recovers and the bucket's pause passes. The next reader is answered from the same copy, signed.
    mocks.sign.mockImplementation(async (_bucket: string, paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: signed, error: null })), error: null }));
    vi.setSystemTime(Date.now() + SIGN_RETRY_STEPS_MS[0]);
    expect(await read()).toEqual([{ owner_id: ME, cover_image_url: signed }]);
    expect(state.databaseReads).toBe(1);
    // The copy is still the database's own answer: no link, good or failed, was ever put in it.
    expect([...state.copies.values()]).toEqual([stored]);
  });

  it("N1062: without an age the client keeps no copy, and still signs", async () => {
    const { state, fetchImpl } = dataCache();
    vi.stubGlobal("fetch", fetchImpl);
    mocks.rpc.mockImplementation(async (fn: string, args: { p_signed?: unknown[] }) => ({ data: fn === "photo_signing_ready" ? true : fn === "photo_signatures_offer" ? args.p_signed : [], error: null }));
    mocks.sign.mockImplementation(async (_bucket: string, paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: signed, error: null })), error: null }));
    createPublicClient();
    const made = mocks.clients.at(-1)!;
    const read = async () => (await made.fetch!(`${O}/rest/v1/cars?select=owner_id,cover_image_url`, { method: "GET" })).json();
    expect(await read()).toEqual([{ owner_id: ME, cover_image_url: signed }]);
    expect(await read()).toEqual([{ owner_id: ME, cover_image_url: signed }]);
    expect(state.databaseReads).toBe(2);
    expect(state.copies.size).toBe(0);
  });
});
