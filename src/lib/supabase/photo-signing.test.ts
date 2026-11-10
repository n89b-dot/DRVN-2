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

const { EXPORT_PHOTO_LINK_SECONDS, SIGN_BUDGET_MS, SIGN_RETRY_MS, createPhotoSigner } = await import("./photo-signing");
const { tableContext } = await import("@/lib/photo-urls");
type Signer = ReturnType<typeof createPhotoSigner>;

/**
 * Every test gets a signer of its own on a clock the test moves (work review
 * #135): none of them reads the real clock or what a test before it left
 * behind, so they pass in any order and on any date. START is the top of an
 * hour (a signing window), taken from today only so no calendar date is
 * written here.
 */
const START = Math.ceil(Date.now() / 3_600_000) * 3_600_000;
const clock = { now: START };
let signer: Signer;
/** The signer's functions under their old names; a time, where a test gives one, sets the clock. */
const signedPhotoUrls = (urls: readonly string[], at?: number) => { if (at !== undefined) clock.now = at; return signer.signedPhotoUrls(urls); };
const signPhotosForExport = <T,>(value: T, ownerId: string, context: Parameters<Signer["signPhotosForExport"]>[2], at?: number) => { if (at !== undefined) clock.now = at; return signer.signPhotosForExport(value, ownerId, context); };
const photoFetch: Signer["photoFetch"] = (base, options) => signer.photoFetch(base, options);
const signedOwnPhotoUrl: Signer["signedOwnPhotoUrl"] = (url, ownerId) => signer.signedOwnPhotoUrl(url, ownerId);

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const canonical = (bucket: string, file: string) => `${O}/storage/v1/object/public/${bucket}/${ME}/${file}`;
const signedFor = (bucket: string, path: string) => `${O}/storage/v1/object/sign/${bucket}/${path}?token=t-${bucket}-${path.split("/").pop()}`;

beforeEach(() => {
  vi.clearAllMocks();
  clock.now = START;
  signer = createPhotoSigner({ now: () => clock.now });
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
    const now = START + 5 * 60_000;
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
  const at = (minute: number) => START + minute * 60_000;

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
    // Whether the readiness question is asked here depends on what ran before; the shared memo's calls must not be.
    expect(mocks.rpc.mock.calls.filter(([fn]) => String(fn).startsWith("photo_signatures_"))).toEqual([]);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
  });

  it("N940: an export page does not empty this process's memo of the hour's links", async () => {
    // Over the memo's cap, most of it from the hour before: only that part is dropped.
    const now = AHEAD + 30 * 86_400_000;
    const lastHour = Array.from({ length: 15_000 }, (_, i) => canonical("car-images", `memo-old-${i}.webp`));
    const thisHour = Array.from({ length: 6_000 }, (_, i) => canonical("car-images", `memo-${i}.webp`));
    await signedPhotoUrls(lastHour, now - 3_600_000);
    await signedPhotoUrls(thisHour, now);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    await signPhotosForExport({ url: canonical("car-images", "memo-export.webp") }, ME, tableContext("car_images", "url"), now);
    expect(mocks.sign).toHaveBeenCalledTimes(3);
    await signedPhotoUrls([thisHour[0], thisHour[5_999]], now);
    expect(mocks.sign).toHaveBeenCalledTimes(3);
  });

  it("N940: the own-photo signer signs an object in the member's folder and nothing else", async () => {
    const mine = canonical("listing-images", "part-links/own.webp");
    const theirs = mine.replace(ME, "22222222-2222-4222-8222-222222222222");
    expect(await signedOwnPhotoUrl(mine, ME)).toBe(signedFor("listing-images", `${ME}/part-links/own.webp`));
    expect(await signedOwnPhotoUrl(theirs, ME)).toBe(theirs);
    expect(await signedOwnPhotoUrl("https://example.com/a.webp", ME)).toBe("https://example.com/a.webp");
    expect(await signedOwnPhotoUrl(null, ME)).toBeNull();
    expect(mocks.sign).toHaveBeenCalledTimes(1);
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

const AHEAD = START + 365 * 86_400_000;

describe("a failed offer is not remembered locally (N954, review of #196)", () => {
  it("the next response asks the shared memo again rather than keeping this instance's URL", async () => {
    clock.now = AHEAD;
    {
      const url = canonical("car-images", "offer-fails.webp");
      mocks.rpc.mockImplementation(async (fn: string) => (fn === "photo_signatures_offer" ? { data: null, error: { code: "40P01", message: "deadlock detected" } } : { data: [], error: null }));
      await signedPhotoUrls([url]);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
      // Past the short pause, the shared memo has the winner; this instance shows it, not its own.
      clock.now += 31_000;
      const theirs = `${O}/storage/v1/object/sign/car-images/${ME}/offer-fails.webp?token=winner`;
      mocks.rpc.mockImplementation(async (fn: string) => ({ data: fn === "photo_signatures_read" ? [{ bucket: "car-images", path: `${ME}/offer-fails.webp`, signed_url: theirs }] : [], error: null }));
      expect((await signedPhotoUrls([url])).get(url)).toBe(theirs);
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
    clock.now = AHEAD + 86_400_000;
    {
      mocks.rpc.mockImplementation(async () => ({ data: null, error: { message: "down" } }));
      const url = canonical("listing-images", "outage.webp");
      const first = (await signedPhotoUrls([url])).get(url);
      clock.now += 5_000;
      expect((await signedPhotoUrls([url])).get(url)).toBe(first);
      expect(mocks.sign).toHaveBeenCalledTimes(1);
    }
  });
});

describe("N1052: a slow or failing photo store does not hold every page (work review #136)", () => {
  it("N1052: after a signing call fails, none is made for thirty seconds; the photo shows as missing at once, then signs", async () => {
    const url = canonical("car-images", "store-down.webp");
    mocks.sign.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });
    expect((await signedPhotoUrls([url])).has(url)).toBe(false);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    // Twenty-nine seconds of pages: no call each, no wait each.
    for (const later of [1, 10_000, SIGN_RETRY_MS - 1]) {
      clock.now = START + later;
      expect((await signedPhotoUrls([url, canonical("listing-images", `other-${later}.webp`)])).size).toBe(0);
    }
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    // Then it is tried again, and works.
    mocks.sign.mockImplementation(async (bucket: string, paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: signedFor(bucket, path), error: null })), error: null }));
    clock.now = START + SIGN_RETRY_MS;
    expect((await signedPhotoUrls([url])).get(url)).toBe(signedFor("car-images", `${ME}/store-down.webp`));
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    // Said once, not once per page.
    expect(mocks.reportError.mock.calls.filter(([message]) => String(message).includes("signing failed"))).toHaveLength(1);
  });

  it("N1052: a signing call with no answer is given up after its budget, not after ten seconds", async () => {
    vi.useFakeTimers();
    try {
      const url = canonical("car-images", "store-hangs.webp");
      mocks.sign.mockReturnValue(new Promise(() => {}));
      let done = false;
      const pending = signedPhotoUrls([url]).then((out) => { done = true; return out; });
      await vi.advanceTimersByTimeAsync(SIGN_BUDGET_MS - 1);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(done).toBe(true);
      expect((await pending).has(url)).toBe(false);
      expect(SIGN_BUDGET_MS).toBeLessThanOrEqual(3_000);
      // And the pause follows, as after any failure.
      mocks.sign.mockClear();
      await signedPhotoUrls([canonical("car-images", "next.webp")]);
      expect(mocks.sign).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("N1052: links already signed this hour are still handed out while the store is down", async () => {
    const known = canonical("car-images", "known.webp");
    const first = (await signedPhotoUrls([known])).get(known);
    mocks.sign.mockRejectedValue(new Error("ECONNRESET"));
    const fresh = canonical("car-images", "fresh.webp");
    const out = await signedPhotoUrls([known, fresh]);
    expect(out.get(known)).toBe(first);
    expect(out.has(fresh)).toBe(false);
    clock.now = START + 5_000;
    expect((await signedPhotoUrls([known, fresh])).get(known)).toBe(first);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });
});

describe("N1051: a signer is given its clock and its client, and keeps its own memory (work review #135)", () => {
  it("N1051: two signers share nothing: each signs for itself and asks the database for itself", async () => {
    const url = canonical("car-images", "two-signers.webp");
    const read = (target: Signer) => target.photoFetch((async () => new Response(JSON.stringify([{ url }]), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/car_images?select=url`, { method: "GET" });
    await read(signer);
    await read(signer);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    const asked = () => mocks.rpc.mock.calls.filter(([fn]) => fn === "photo_signing_ready").length;
    expect(asked()).toBe(1);
    const other = createPhotoSigner({ now: () => clock.now });
    await read(other);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
    expect(asked()).toBe(2);
  });

  it("N1051: it reads only the clock it is given: a link is reused within its hour by that clock, whatever the real time", async () => {
    const url = canonical("car-images", "own-clock.webp");
    const mine = { now: 0 };
    const own = createPhotoSigner({ now: () => mine.now });
    // An hour that ended decades before this test ran.
    mine.now = 12 * 3_600_000 + 60_000;
    await own.signedPhotoUrls([url]);
    mine.now += 50 * 60_000;
    await own.signedPhotoUrls([url]);
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    mine.now += 15 * 60_000;
    await own.signedPhotoUrls([url]);
    expect(mocks.sign).toHaveBeenCalledTimes(2);
  });

  it("N1051: it uses the client it is given, and reports where it is told", async () => {
    const calls: string[] = [];
    const report = vi.fn();
    const given = {
      storage: { from: (bucket: string) => ({ createSignedUrls: async (paths: string[]) => { calls.push(`sign ${bucket} ${paths.length}`); return { data: null, error: { message: "refused" } }; } }) },
      rpc: (fn: string) => ({ abortSignal: async () => { calls.push(fn); return { data: fn === "photo_signing_ready" ? true : [], error: null }; } }),
    };
    const own = createPhotoSigner({ now: () => clock.now, client: () => given as never, report });
    await own.signedPhotoUrls([canonical("car-images", "given.webp")]);
    expect(calls).toEqual(["photo_signatures_read", "sign car-images 1"]);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith(expect.stringContaining("signing failed"), expect.objectContaining({ reason: "signing-failed", bucket: "car-images" }));
    expect(mocks.reportError).not.toHaveBeenCalled();
  });
});

