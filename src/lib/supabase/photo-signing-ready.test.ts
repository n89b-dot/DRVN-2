import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// photoSigningReady() remembers the database's answer per process, so each
// test loads the module afresh: a new instance the database has never answered.
const mocks = vi.hoisted(() => ({ sign: vi.fn(), rpc: vi.fn(), reportError: vi.fn(), signals: [] as unknown[] }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/monitoring", () => ({ reportError: mocks.reportError }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: { from: (bucket: string) => ({ createSignedUrls: (paths: string[], expiresIn: number) => mocks.sign(bucket, paths, expiresIn) }) },
    rpc: (fn: string, args: unknown) => ({ abortSignal: (signal: unknown) => { mocks.signals.push(signal); return mocks.rpc(fn, args); } }),
  }),
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
process.env.SUPABASE_SECRET_KEY = "unit-test-key";

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const photo = `${O}/storage/v1/object/public/car-images/${ME}/cover.webp`;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });

type Answer = true | false | "down" | "no-function" | "never";
/** What photo_signing_ready says next; the shared memo's calls always answer with nothing. */
function database(answer: Answer) {
  mocks.rpc.mockImplementation((fn: string) => {
    if (fn !== "photo_signing_ready") return Promise.resolve({ data: [], error: null });
    if (answer === "never") return new Promise(() => {});
    if (answer === "down") return Promise.reject(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }));
    if (answer === "no-function") return Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function public.photo_signing_ready without parameters in the schema cache" } });
    return Promise.resolve({ data: answer, error: null });
  });
}
const asked = () => mocks.rpc.mock.calls.filter(([fn]) => fn === "photo_signing_ready").length;

async function instance() {
  vi.resetModules();
  const signing = await import("./photo-signing");
  const { tableContext } = await import("@/lib/photo-urls");
  const read = async (request = "cars?select=cover_image_url", value: unknown = [{ cover_image_url: photo }]) =>
    (await signing.photoFetch((async () => json(value)) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/${request}`, { method: "GET" })).json();
  const cover = async () => (await read())[0].cover_image_url as string;
  const exported = () => signing.signPhotosForExport([{ cover_image_url: photo }], ME, tableContext("cars", "cover_image_url"));
  return { ...signing, read, cover, exported };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signals.length = 0;
  vi.useFakeTimers({ now: Date.now() });
  mocks.sign.mockImplementation(async (bucket: string, paths: string[]) => ({ data: paths.map((path) => ({ path, signedUrl: `${O}/storage/v1/object/sign/${bucket}/${path}?token=t`, error: null })), error: null }));
});
afterEach(() => { vi.useRealTimers(); });

const SIGNED = "/object/sign/";

describe("the signer signs nothing until the database guards are there (N940, #196 review P2-2)", () => {
  it("N940: signs nothing, and says so once, while the database says no; signs once it says yes", async () => {
    const { cover } = await instance();
    database(false);
    expect(await cover()).toBe(photo);
    expect(await cover()).toBe(photo);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledTimes(1);
    expect(mocks.reportError).toHaveBeenCalledWith(expect.stringContaining("photo guards are missing"), expect.objectContaining({ reason: "not-ready" }));
    // Remembered for thirty seconds: no second question.
    expect(asked()).toBe(1);

    // Applied: signing starts on the next check.
    vi.advanceTimersByTime(30_001);
    database(true);
    expect(await cover()).toContain(SIGNED);
    expect(asked()).toBe(2);
  });

  it("N940: no such function is a no, on a new instance and after a yes (the migration is not there)", async () => {
    const fresh = await instance();
    database("no-function");
    expect(await fresh.cover()).toBe(photo);
    expect(mocks.reportError).toHaveBeenCalledWith(expect.stringContaining("photo guards are missing"), expect.objectContaining({ reason: "not-ready" }));

    const { cover } = await instance();
    database(true);
    expect(await cover()).toContain(SIGNED);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    database("no-function");
    await cover(); // the stale yes answers this one while the question is asked
    await vi.advanceTimersByTimeAsync(0);
    expect(await cover()).toBe(photo);
  });

  it("N940: a no after a yes stops the signing", async () => {
    const { cover } = await instance();
    database(true);
    expect(await cover()).toContain(SIGNED);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    database(false);
    await cover();
    await vi.advanceTimersByTimeAsync(0);
    expect(await cover()).toBe(photo);
  });

  it("N940: an instance the database has never answered signs nothing when the check cannot be made", async () => {
    const { cover } = await instance();
    database("down");
    expect(await cover()).toBe(photo);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.reportError).toHaveBeenCalledWith(expect.stringContaining("could not check"), expect.objectContaining({ reason: "ready-check-failed", lastAnswer: null, failures: 1 }));
  });
});

describe("a check that could not be made leaves the last answer standing (N1062, work review #146)", () => {
  it("N1062: photos stay signed through a timed-out check, and through an hour of them", async () => {
    const { cover } = await instance();
    database(true);
    expect(await cover()).toContain(SIGNED);

    database("down");
    for (let minutes = 6; minutes <= 66; minutes += 6) {
      vi.advanceTimersByTime(6 * 60_000);
      expect(await cover(), `${minutes} minutes in`).toContain(SIGNED);
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(asked()).toBeGreaterThan(5);
    expect(mocks.reportError).toHaveBeenCalledWith(expect.stringContaining("the last answer stands"), expect.objectContaining({ reason: "ready-check-failed", lastAnswer: true }));
  });

  it("N1062: a yes past its five minutes is used at once while the database is asked again", async () => {
    const { cover } = await instance();
    database(true);
    expect(await cover()).toContain(SIGNED);
    expect(asked()).toBe(1);

    // Inside five minutes: no question at all.
    vi.advanceTimersByTime(4 * 60_000);
    expect(await cover()).toContain(SIGNED);
    expect(asked()).toBe(1);

    // Past it: a question that never comes back does not hold the response.
    vi.advanceTimersByTime(60_001);
    database("never");
    expect(await cover()).toContain(SIGNED);
    expect(await cover()).toContain(SIGNED);
    // One question in flight, however many responses pass while it is out.
    expect(asked()).toBe(2);
  });

  it("N1062: every response waiting on a new instance's first check shares one question", async () => {
    const { cover } = await instance();
    let answer!: (value: { data: boolean; error: null }) => void;
    mocks.rpc.mockImplementation((fn: string) => (fn === "photo_signing_ready" ? new Promise((resolve) => { answer = resolve; }) : Promise.resolve({ data: [], error: null })));
    const waiting = [cover(), cover(), cover(), cover()];
    await vi.advanceTimersByTimeAsync(0);
    expect(asked()).toBe(1);
    answer({ data: true, error: null });
    for (const url of await Promise.all(waiting)) expect(url).toContain(SIGNED);
    expect(asked()).toBe(1);
  });

  it("N1062: a failed check is tried again after two seconds, then four, doubling to thirty", async () => {
    const { cover } = await instance();
    database("down");
    await cover();
    expect(asked()).toBe(1);
    const waits = [2_000, 4_000, 8_000, 16_000, 30_000, 30_000];
    for (const [i, wait] of waits.entries()) {
      vi.advanceTimersByTime(wait - 1);
      await cover();
      expect(asked(), `asked early, wait ${i}`).toBe(i + 1);
      vi.advanceTimersByTime(1);
      await cover();
      expect(asked(), `not asked after ${wait} ms`).toBe(i + 2);
    }
    // An answer ends the back-off: the next failure waits two seconds again.
    vi.advanceTimersByTime(30_000);
    database(true);
    expect(await cover()).toContain(SIGNED);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    database("down");
    await cover();
    await vi.advanceTimersByTimeAsync(0);
    const before = asked();
    vi.advanceTimersByTime(2_000);
    await cover();
    await vi.advanceTimersByTimeAsync(0);
    expect(asked()).toBe(before + 1);
  });

  it("N1062: the check carries the shared calls' time budget", async () => {
    const { cover } = await instance();
    database(true);
    await cover();
    expect(mocks.signals[0]).toBeInstanceOf(AbortSignal);
  });

  it("N1062: an export page read while signing is off fails the job; it is never written with links that cannot open", async () => {
    const { exported, EXPORT_NOT_READY } = await instance();
    database("down");
    await expect(exported()).rejects.toThrow(EXPORT_NOT_READY);
    vi.advanceTimersByTime(2_000);
    database(false);
    await expect(exported()).rejects.toThrow(EXPORT_NOT_READY);
    expect(mocks.sign).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_001);
    database(true);
    expect((await exported())[0].cover_image_url).toContain(SIGNED);
  });
});

describe("a read the signer can't place is said, not repeated (N940)", () => {
  it("N940: reports a read it can't place at most once per ten minutes per reason", async () => {
    const { read, photoFetch } = await instance();
    database(true);
    for (let i = 0; i < 3; i++) await read("car_images?select=url(", [{ url: photo }]);
    await read("car_images?select=url&select=id", [{ url: photo }]);
    const res = await photoFetch((async () => json([{ url: photo }])) as unknown as typeof fetch, { sign: true })(`${O}/rest/v1/car_images?select=url`, { headers: { "Accept-Profile": "private" } });
    expect((await res.json())[0].url).toBe(photo);
    expect(mocks.reportError.mock.calls.map((c) => (c[1] as { reason: string }).reason)).toEqual(["unparsable-select", "two-selects", "non-public-profile"]);
    vi.advanceTimersByTime(10 * 60_000 + 1);
    await read("car_images?select=url(", [{ url: photo }]);
    expect(mocks.reportError).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ reason: "unparsable-select", since: 2 }));
    // Storage and Auth answers are not "reads it can't place".
    mocks.reportError.mockClear();
    await photoFetch((async () => json({})) as unknown as typeof fetch, { sign: true })(`${O}/auth/v1/user`, {});
    expect(mocks.reportError).not.toHaveBeenCalled();
  });
});
