import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sign: vi.fn(), rpc: vi.fn(), reportError: vi.fn(), signals: [] as AbortSignal[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], expiresIn: number) => mocks.sign(bucket, paths, expiresIn) }) },
    // The shared memo's calls carry a time budget (abortSignal), as supabase-js builders do.
    rpc: (fn: string, args: unknown) => ({ abortSignal: (signal: AbortSignal) => { mocks.signals.push(signal); return mocks.rpc(fn, args); } }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SECRET_KEY = "unit-test-key";

const { EXPORT_PHOTO_LINK_SECONDS, photoFetch, signedPhotoUrls, signPhotosForExport } = await import("./photo-signing");
const { tableContext } = await import("@/lib/photo-urls");

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const canonical = (bucket: string, file: string) => `${O}/storage/v1/object/public/${bucket}/${ME}/${file}`;
const signedFor = (bucket: string, path: string) => `${O}/storage/v1/object/sign/${bucket}/${path}?token=t-${bucket}-${path.split("/").pop()}`;

beforeEach(() => {
  vi.clearAllMocks();
  // No shared memo by default: the read finds nothing and the offer keeps this instance's URL.
  mocks.rpc.mockImplementation(async (fn: string, args: { p_signed?: unknown[] }) => ({ data: fn === "photo_signing_ready" ? true : fn === "photo_signatures_offer" ? args.p_signed : [], error: null }));
  mocks.sign.mockImplementation(async (bucket: string, paths: string[]) => ({
    data: paths.map((path) => ({ path, signedUrl: signedFor(bucket, path), error: null })),
    error: null,
  }));
});

describe("photo signing at the database boundary (N455)", () => {
  it("N455: signs a response's member photos in one batch per bucket and leaves avatars and other text alone", async () => {
    const rows = [
      { url: canonical("car-images", "1.webp") },
      { url: canonical("car-images", "2.webp") },
      { url: canonical("listing-images", "3.webp") },
      { avatar: canonical("avatars", "me.webp"), note: "hello" },
    ];
    const base = vi.fn(async () => new Response(JSON.stringify(rows), { headers: { "content-type": "application/json", "content-length": "999" } }));
    const res = await photoFetch(base as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/car_images?select=url`, { method: "GET" });
    const out = await res.json();
    expect(out[0].url).toBe(signedFor("car-images", `${ME}/1.webp`));
    expect(out[2].url).toBe(signedFor("listing-images", `${ME}/3.webp`));
    expect(out[3]).toEqual(rows[3]);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("N455: reuses a minted URL for the rest of its window", async () => {
    const url = canonical("activity-images", "reuse.webp");
    const now = Date.UTC(2026, 10, 8, 20, 5);
    const first = await signedPhotoUrls([url], now);
    const again = await signedPhotoUrls([url], now + 30 * 60_000);
    expect(again.get(url)).toBe(first.get(url));
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    await signedPhotoUrls([url], now + 60 * 60_000);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("N455: the database only ever receives canonical photo URLs, from any client", async () => {
    const base = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } }));
    const body = JSON.stringify({ p_image_urls: [signedFor("activity-images", `${ME}/x.webp`)] });
    await photoFetch(base as unknown as typeof fetch, { sign: false })(`${O}/rest/v1/rpc/write_activity_post`, { method: "POST", body });
    const sent = JSON.parse((base.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(sent.p_image_urls).toEqual([canonical("activity-images", "x.webp")]);
  });

  it("N455: without sign, responses stay canonical (workers and cleanup act on identities)", async () => {
    const body = JSON.stringify([{ url: canonical("car-images", "w.webp") }]);
    const base = vi.fn(async () => new Response(body, { headers: { "content-type": "application/json" } }));
    const res = await photoFetch(base as unknown as typeof fetch, { sign: false })(`${O}/rest/v1/car_images`, {});
    expect(await res.text()).toBe(body);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("N455: Storage and Auth calls, empty answers and failures pass through untouched", async () => {
    const base = vi.fn(async () => new Response(null, { status: 204 }));
    const wrapped = photoFetch(base as unknown as typeof fetch, { sign: true });
    expect((await wrapped(`${O}/rest/v1/car_images`, { method: "PATCH" })).status).toBe(204);
    await wrapped(`${O}/storage/v1/object/car-images/x`, { method: "POST", body: "raw" });
    expect((base.mock.calls[1] as unknown as [string, RequestInit])[1].body).toBe("raw");
  });

  it("N455: a photo Storage won't sign keeps its canonical URL (a missing photo, never a failed page)", async () => {
    mocks.sign.mockResolvedValue({ data: null, error: { message: "boom" } });
    const url = canonical("car-images", "fail.webp");
    expect((await signedPhotoUrls([url])).has(url)).toBe(false);
    expect(mocks.reportError).toHaveBeenCalled();
  });

  it("N455: a member's export links their photos for seven days, minted fresh, never from the shared window", async () => {
    const url = canonical("car-images", "export.webp");
    await signedPhotoUrls([url]);
    mocks.sign.mockClear();
    const rows = await signPhotosForExport([{ url, alt: "x" }, { avatar_url: canonical("avatars", "me.webp") }], ME, tableContext("car_images", "*"));
    expect(rows[0]).toEqual({ url: signedFor("car-images", `${ME}/export.webp`), alt: "x" });
    expect(rows[1]).toEqual({ avatar_url: canonical("avatars", "me.webp") });
    expect(mocks.sign).toHaveBeenCalledWith("car-images", [`${ME}/export.webp`], EXPORT_PHOTO_LINK_SECONDS);
    expect(EXPORT_PHOTO_LINK_SECONDS).toBe(604_800);
  });
});

describe("one signed URL per photo per window across instances (N954, report five #117)", () => {
  const at = (minute: number) => Date.UTC(2026, 10, 10, 9, minute);

  it("uses the URL another instance already signed, without minting", async () => {
    const url = canonical("car-images", "shared-hit.webp");
    const theirs = `${O}/storage/v1/object/sign/car-images/${ME}/shared-hit.webp?token=other-instance`;
    mocks.rpc.mockImplementation(async (fn: string) => ({
      data: fn === "photo_signatures_read" ? [{ bucket: "car-images", path: `${ME}/shared-hit.webp`, signed_url: theirs }] : [],
      error: null,
    }));
    expect((await signedPhotoUrls([url], at(1))).get(url)).toBe(theirs);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenCalledWith("photo_signatures_read", { p_window: expect.any(Number), p_objects: [{ bucket: "car-images", path: `${ME}/shared-hit.webp` }] });
  });

  it("offers what it minted and shows the race's winner", async () => {
    const url = canonical("listing-images", "race.webp");
    const winner = `${O}/storage/v1/object/sign/listing-images/${ME}/race.webp?token=won-first`;
    mocks.rpc.mockImplementation(async (fn: string) => ({
      data: fn === "photo_signatures_offer" ? [{ bucket: "listing-images", path: `${ME}/race.webp`, signed_url: winner }] : [],
      error: null,
    }));
    expect((await signedPhotoUrls([url], at(2))).get(url)).toBe(winner);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("photo_signatures_offer", {
      p_window: expect.any(Number),
      p_signed: [{ bucket: "listing-images", path: `${ME}/race.webp`, signed_url: signedFor("listing-images", `${ME}/race.webp`) }],
    });
  });

  it("the export's fixed-life links never touch the shared memo", async () => {
    await signPhotosForExport({ url: canonical("car-images", "export-shared.webp") }, ME, tableContext("car_images", "url"), at(3));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("signs on its own when the shared memo is unavailable, reports it, and remembers nothing it couldn't share", async () => {
    mocks.rpc.mockImplementation(async () => ({ data: null, error: { message: "function public.photo_signatures_read does not exist" } }));
    const url = canonical("activity-images", "no-shared.webp");
    expect((await signedPhotoUrls([url], at(4))).get(url)).toBe(signedFor("activity-images", `${ME}/no-shared.webp`));
    expect(mocks.reportError).toHaveBeenCalledWith("[photos] shared signing memo failed; signing per response", expect.objectContaining({ failures: 1 }));
    expect(mocks.signals.at(-1)).toBeInstanceOf(AbortSignal);
  });
});


describe("only photo fields are signed, never a URL a member wrote (N940, #178 review)", () => {
  const other = canonical("car-images", "someone-elses-private.webp");
  const mine = canonical("car-images", "my-cover.webp");
  const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const read = async (value: unknown) => {
    const res = await photoFetch((async () => json(value)) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/rpc/x`, { method: "POST" });
    return res.json();
  };

  it("leaves a photo URL pasted into a comment, a description, a bio or a whole-value comment canonical", async () => {
    const out = await read([
      { body: `look at this ${other} nice` },
      { body: other },
      { description: other, bio: `${other}`, title: other },
    ]);
    expect(JSON.stringify(out)).not.toContain("/object/sign/");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("leaves a profile link, a product link and a video link canonical", async () => {
    const out = await read({ links: [{ label: "website", url: other }], product_url: other, video_url: other, source_url: other });
    expect(JSON.stringify(out)).not.toContain("/object/sign/");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("signs the photo fields of a table read: its guarded columns, its embeds' and a post's image and before/after blocks", async () => {
    const value = [{
      cover_image_url: mine,
      gallery: [{ url: canonical("car-images", "g1.webp") }],
      image: canonical("listing-images", "card.webp"),
    }];
    const res = await photoFetch((async () => json(value)) as unknown as typeof fetch, { sign: true })(
      `${O}/rest/v1/cars?select=${encodeURIComponent("cover_image_url,image,gallery:car_images(url)")}`, { method: "GET" });
    const [car] = await res.json();
    expect(car.cover_image_url).toBe(signedFor("car-images", `${ME}/my-cover.webp`));
    expect(car.gallery[0].url).toBe(signedFor("car-images", `${ME}/g1.webp`));
    expect(car.image).toBe(canonical("listing-images", "card.webp"));
    const post = [{ body: [
      { type: "images", urls: [canonical("activity-images", "p1.webp")] },
      { type: "before_after", beforeUrl: canonical("activity-images", "b.webp"), afterUrl: canonical("activity-images", "a.webp") },
      { type: "text", text: `see ${other}` },
    ] }];
    const out = await (await photoFetch((async () => json(post)) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/activity_posts?select=body`, { method: "GET" })).json();
    expect(out[0].body[0].urls[0]).toBe(signedFor("activity-images", `${ME}/p1.webp`));
    expect(out[0].body[1].beforeUrl).toBe(signedFor("activity-images", `${ME}/b.webp`));
    expect(out[0].body[2].text).toBe(`see ${other}`);
  });

  it("the export links the member's photo fields for seven days and not a URL they wrote in a comment", async () => {
    const cars = await signPhotosForExport([{ cover_image_url: mine }], ME, tableContext("cars", "id,cover_image_url"));
    expect(cars[0].cover_image_url).toBe(signedFor("car-images", `${ME}/my-cover.webp`));
    const comments = await signPhotosForExport([{ body: other }], ME, tableContext("activity_comments", "id,body"));
    expect(comments[0].body).toBe(other);
  });

  it("another schema's same-named table is not signed", async () => {
    const res = await photoFetch((async () => json([{ url: mine }])) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/car_images?select=url`, { method: "GET", headers: { "Accept-Profile": "private" } });
    expect((await res.json())[0].url).toBe(mine);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
});

// A whole hour well after the real clock: earlier tests in this file fill the
// process memo with real-time entries, and a fixed date that the real clock
// has passed made those look fresh (it broke on 10 Nov 2026 at 10:00 UTC).
const AHEAD = Math.ceil(Date.now() / 3_600_000) * 3_600_000 + 365 * 86_400_000;

describe("a failed offer is not remembered locally (N954, review of #196)", () => {
  it("the next response asks the shared memo again rather than keeping this instance's URL", async () => {
    vi.useFakeTimers({ now: AHEAD });
    try {
      const url = canonical("car-images", "offer-fails.webp");
      mocks.rpc.mockImplementation(async (fn: string) => (fn === "photo_signatures_offer" ? { data: null, error: { code: "40P01", message: "deadlock detected" } } : { data: [], error: null }));
      await signedPhotoUrls([url], Date.now());
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      // Past the short pause, the shared memo has the winner; this instance shows it, not its own.
      vi.advanceTimersByTime(31_000);
      const theirs = `${O}/storage/v1/object/sign/car-images/${ME}/offer-fails.webp?token=winner`;
      mocks.rpc.mockImplementation(async (fn: string) => ({ data: fn === "photo_signatures_read" ? [{ bucket: "car-images", path: `${ME}/offer-fails.webp`, signed_url: theirs }] : [], error: null }));
      expect((await signedPhotoUrls([url], Date.now())).get(url)).toBe(theirs);
    } finally {
      vi.useRealTimers();
    }
  });
});


describe("each leak route stays closed (N940, #178 review)", () => {
  const STRANGER = "22222222-2222-4222-8222-222222222222";
  const theirs = `${O}/storage/v1/object/public/car-images/${STRANGER}/private-car.webp`;
  const read = async (value: unknown) => {
    const res = await photoFetch((async () => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/x`, { method: "GET" });
    return JSON.stringify(await res.json());
  };

  it.each([
    ["a comment", { body: `nice ${theirs}` }],
    ["a comment that is only the link", { body: theirs }],
    ["a bio", { bio: theirs }],
    ["a listing description", { description: theirs }],
    ["a profile link", { links: [{ label: "website", url: theirs }] }],
    ["a mod's product link", { product_url: theirs }],
  ])("%s naming another member's private photo comes back canonical, which Storage refuses", async (_route, value) => {
    const out = await read(value);
    expect(out).toContain(theirs);
    expect(out).not.toContain("/object/sign/");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("the export links only the member's own objects, even in a photo field", async () => {
    const out = await signPhotosForExport([{ url: canonical("car-images", "mine.webp") }, { url: theirs }], ME, tableContext("car_images", "id,url"));
    expect(out[0].url).toContain("/object/sign/");
    expect(out[1].url).toBe(theirs);
  });
});

describe("only database-guarded places are signed (N940, #196 review)", () => {
  const STRANGER = "22222222-2222-4222-8222-222222222222";
  const theirs = `${O}/storage/v1/object/public/car-images/${STRANGER}/private-car.webp`;
  const read = async (request: string, value: unknown) => {
    const res = await photoFetch((async () => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/${request}`, { method: "GET" });
    return res.json();
  };

  it.each([
    ["an embed block's url in a post body", "activity_posts?select=body", [{ body: [{ type: "embed", videoId: "x", url: theirs }] }]],
    ["an images block nested in another block", "activity_posts?select=body", [{ body: [{ type: "text", x: { type: "images", urls: [theirs] } }] }]],
    ["a label-less profile link", "profiles?select=links", [{ links: [{ url: theirs }] }]],
    ["an import's image entry", "listing_imports?select=imported_images", [{ imported_images: [{ sourceUrl: "https://shop.example/a.jpg", url: theirs, path: "x" }] }]],
    ["a condition snapshot that names its own owner", "order_items?select=condition_snapshot", [{ condition_snapshot: { owner_id: STRANGER, url: theirs } }]],
    ["dispute evidence's url", "dispute_evidence?select=url", [{ url: theirs }]],
    ["an agent event's result", "agent_events?select=result", [{ result: { image: theirs, url: theirs } }]],
    ["a Json RPC that isn't listed", "rpc/agent_chat_turn_status", { member: { cards: [{ image_url: theirs }] } }],
  ])("%s stays canonical", async (_route, request, value) => {
    expect(JSON.stringify(await read(request, value))).not.toContain("/object/sign/");
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it("a buyer's order read signs the seller's frozen gallery without the seller's id in the select", async () => {
    const seller = canonical("listing-images", "sold.webp");
    const out = await read(`orders?select=${encodeURIComponent("id,order_items(order_item_snapshot_images(url))")}`, [{ id: "o", order_items: [{ order_item_snapshot_images: [{ url: seller }] }] }]);
    expect(out[0].order_items[0].order_item_snapshot_images[0].url).toBe(signedFor("listing-images", `${ME}/sold.webp`));
  });
});

describe("while the shared memo is down, the process memo still works (N954, #196 review)", () => {
  it("reuses this process's link until the shared memo is tried again", async () => {
    vi.useFakeTimers({ now: AHEAD + 86_400_000 });
    try {
      mocks.rpc.mockImplementation(async () => ({ data: null, error: { message: "down" } }));
      const url = canonical("listing-images", "outage.webp");
      const first = (await signedPhotoUrls([url], Date.now())).get(url);
      vi.advanceTimersByTime(5_000);
      expect((await signedPhotoUrls([url], Date.now())).get(url)).toBe(first);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
