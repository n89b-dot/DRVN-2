import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R2-10: a throw on the private-bucket path is that file's retryable
 * failure — it never rejects the batch, so the files around it still land.
 */

const upload = vi.fn();
vi.mock("@/lib/media-staging", () => ({ recordStagedUpload: vi.fn(async () => {}) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    storage: {
      from: () => ({
        upload,
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      }),
    },
  }),
}));

const { isHeicFile, publicPhotoFailureReason, uploadFailureMessage, uploadImages } = await import("./media-upload");

const file = (name: string) => new File(["x"], name, { type: "image/png" });

beforeEach(() => upload.mockReset());

describe("uploadImages — private bucket", () => {
  it("reports a thrown upload as a retryable failure and carries on", async () => {
    upload.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce({ error: null });
    const result = await uploadImages({ files: [file("a.png"), file("b.png")], bucket: "dispute-evidence", pathPrefix: "u1" });
    expect(result.failed).toEqual([expect.objectContaining({ reason: "a.png failed to upload — check your connection and retry.", retryable: true })]);
    expect(result.failed[0].file.name).toBe("a.png");
    expect(result.uploaded.map((u) => u.file.name)).toEqual(["b.png"]);
    expect(result.uploaded[0].path).toMatch(/^u1\//);
  });

  it("keeps a storage error as a retryable failure", async () => {
    upload.mockResolvedValueOnce({ error: { message: "Bucket full" } });
    const result = await uploadImages({ files: [file("a.png")], bucket: "dispute-evidence", pathPrefix: "u1" });
    expect(result).toEqual({ uploaded: [], failed: [expect.objectContaining({ reason: "a.png failed to upload — try again.", retryable: true })] });
  });
});

describe("uploadImages — message photos", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("never uploads the original bytes from the browser; the server re-encodes them", async () => {
    const fetch = vi.fn(async () => Response.json({ url: "https://cdn.test/u1/u2/x.webp", path: "u1/u2/x.webp" }));
    vi.stubGlobal("fetch", fetch);
    const result = await uploadImages({ files: [file("a.png")], bucket: "message-photos", pathPrefix: "u1/u2" });

    expect(upload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "/api/media/public-photo",
      expect.objectContaining({ method: "POST", headers: { "x-upload-bucket": "message-photos" } })
    );
    const body = (fetch.mock.calls[0] as unknown as [string, { body: FormData }])[1].body;
    expect(body.get("bucket")).toBe("message-photos");
    expect(body.get("pathPrefix")).toBe("u1/u2");
    expect(result.uploaded).toEqual([expect.objectContaining({ path: "u1/u2/x.webp" })]);
  });

  it("reports a refused re-encode as a failure instead of falling back to the original", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "The photo could not be safely processed." }, { status: 422 })));
    const result = await uploadImages({ files: [file("a.png")], bucket: "message-photos", pathPrefix: "u1/u2" });
    expect(upload).not.toHaveBeenCalled();
    expect(result.uploaded).toEqual([]);
    expect(result.failed).toEqual([expect.objectContaining({ reason: "The photo could not be safely processed." })]);
  });
});

describe("upload failures stay per file and readable (N64)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("names an evidence refusal from Storage instead of echoing its error", async () => {
    upload.mockResolvedValueOnce({ error: { message: "new row violates row-level security policy" } });
    const result = await uploadImages({ files: [file("scratch.png")], bucket: "dispute-evidence", pathPrefix: "u1/o1" });
    expect(result.failed).toEqual([
      expect.objectContaining({ reason: expect.stringMatching(/^scratch\.png can't be added — evidence goes in only while the dispute is open/), retryable: false }),
    ]);
  });

  it("gives a bodiless 413 from the photo route words, not a JSON parse error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 413 })));
    const result = await uploadImages({ files: [file("huge.png")], bucket: "car-images", pathPrefix: "u1" });
    expect(result.failed).toEqual([expect.objectContaining({ reason: expect.stringMatching(/^huge\.png is too large to upload \(over 4 MB\)/), retryable: false })]);
  });

  it("maps every route status to clear copy", () => {
    expect(publicPhotoFailureReason("a.jpg", 401).reason).toMatch(/sign in/i);
    expect(publicPhotoFailureReason("a.jpg", 415, "This HEIC photo can't be processed.").reason).toBe("This HEIC photo can't be processed.");
    expect(publicPhotoFailureReason("a.jpg", 429)).toEqual({ reason: "Upload limit reached. Try again later.", retryable: true });
    expect(publicPhotoFailureReason("a.jpg", 503)).toEqual({ reason: "a.jpg failed to upload — check your connection and retry.", retryable: true });
  });

  it("keeps each failed photo's name and reason in the message shown", () => {
    const failed = [
      { file: file("a.png"), reason: "a.png is over 10MB.", retryable: false },
      { file: file("b.png"), reason: "The photo could not be safely processed.", retryable: false },
    ];
    expect(uploadFailureMessage(failed.slice(0, 1))).toBe("a.png is over 10MB.");
    expect(uploadFailureMessage(failed)).toBe("2 photos weren't added. a.png is over 10MB. b.png: The photo could not be safely processed.");
    expect(uploadFailureMessage([])).toBe("");
  });

  it("recognises iPhone photos by type, or by name when the browser gives no type", () => {
    expect(isHeicFile(new File(["x"], "IMG_1.HEIC", { type: "image/heic" }))).toBe(true);
    expect(isHeicFile(new File(["x"], "IMG_1.heif", { type: "" }))).toBe(true);
    expect(isHeicFile(new File(["x"], "IMG_1.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("refuses HEIC evidence up front: evidence keeps its bytes and the bucket can't show HEIC", async () => {
    const result = await uploadImages({ files: [new File(["x"], "IMG_2.HEIC", { type: "image/heic" })], bucket: "dispute-evidence", pathPrefix: "u1/o1" });
    expect(upload).not.toHaveBeenCalled();
    expect(result.failed).toEqual([expect.objectContaining({ reason: expect.stringMatching(/IMG_2\.HEIC is a HEIC photo.*JPEG/), retryable: false })]);
  });

  it("converts a HEIC to JPEG in a browser that can decode it, and uploads the JPEG", async () => {
    // A browser that decodes HEIC (Safari): createImageBitmap + canvas work.
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4032, height: 3024, close })));
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob(["jpeg bytes"], { type })),
      }),
    });
    const fetch = vi.fn(async () => Response.json({ url: "https://cdn.test/u1/x.webp", path: "u1/x.webp" }));
    vi.stubGlobal("fetch", fetch);
    // Small HEIC: the size/scale shortcut must not skip it.
    const heic = new File(["tiny heic"], "IMG_4.HEIC", { type: "image/heic" });
    const result = await uploadImages({ files: [heic], bucket: "car-images", pathPrefix: "u1" });
    expect(result.failed).toEqual([]);
    const sent = (fetch.mock.calls[0] as unknown as [string, { body: FormData }])[1].body.get("file") as File;
    expect(sent.name).toBe("IMG_4.jpg");
    expect(sent.type).toBe("image/jpeg");
    expect(close).toHaveBeenCalled();
  });

  it("explains a HEIC the browser can't convert rather than uploading what the server can't decode", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    // No createImageBitmap here (as in a browser without HEIC support).
    const result = await uploadImages({ files: [new File(["x"], "IMG_3.HEIC", { type: "image/heic" })], bucket: "activity-images", pathPrefix: "u1" });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.failed).toEqual([expect.objectContaining({ reason: expect.stringMatching(/IMG_3\.HEIC is a HEIC photo this browser can't convert/), retryable: false })]);
  });
});

describe("photos stay under what a serverless host accepts (N955, report five #118)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const big = (name: string, bytes: number, type = "image/jpeg") => new File([new Uint8Array(bytes)], name, { type });

  it("refuses a photo still over 4 MB before sending it, saying what to do", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    // No canvas (shrinking fails), so the original is what would be sent.
    const result = await uploadImages({ files: [big("IMG_9.jpg", 5 * 1024 * 1024)], bucket: "listing-images", pathPrefix: "u1", maxBytes: 10 * 1024 * 1024, normalize: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.failed).toEqual([expect.objectContaining({ reason: expect.stringMatching(/IMG_9\.jpg is too large to upload \(over 4 MB\)\. Save a smaller copy and try again/), retryable: false })]);
  });

  it("evidence uploads straight to Storage and keeps its own, larger limit", async () => {
    upload.mockResolvedValue({ error: null });
    const result = await uploadImages({ files: [big("receipt.png", 6 * 1024 * 1024, "image/png")], bucket: "dispute-evidence", pathPrefix: "u1/o1" });
    expect(result.failed).toEqual([]);
  });

  it("a bodiless 413 from the route says the same", () => {
    expect(publicPhotoFailureReason("a.jpg", 413)).toEqual({ reason: expect.stringMatching(/a\.jpg is too large to upload \(over 4 MB\)/), retryable: false });
    expect(publicPhotoFailureReason("me.jpg", 413, undefined, "avatars").reason).toMatch(/me\.jpg is too large to upload \(over 2 MB\)/);
  });

  /** A canvas that encodes whatever it is given to `bytes`, and records what was drawn on it. */
  const canvasDocument = (bytes: number, drawn: unknown[]) => ({
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (source: unknown) => drawn.push(source) }),
      toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob([new Uint8Array(bytes)], { type })),
    }),
  });
  /** The browser's `<img>`: decodes on `src`, as a 4032x3024 photo, or fails. */
  const imageElement = (works: boolean, made: Array<{ src: string }>) =>
    class {
      naturalWidth = 4032;
      naturalHeight = 3024;
      decoding = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      #src = "";
      constructor() {
        made.push(this);
      }
      get src() {
        return this.#src;
      }
      set src(value: string) {
        this.#src = value;
        queueMicrotask(() => (works ? this.onload?.() : this.onerror?.()));
      }
    };

  it("N955: where the browser's first way to decode a photo fails, shrinks it through an <img> so a 9 MB phone photo still uploads (work review #158)", async () => {
    const drawn: unknown[] = [];
    const made: Array<{ src: string }> = [];
    const revoked: string[] = [];
    // Older Safari and iOS web views: createImageBitmap rejects a File, or its options.
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new TypeError("createImageBitmap: options are not supported"); }));
    vi.stubGlobal("Image", imageElement(true, made));
    vi.stubGlobal("URL", { createObjectURL: () => "blob:photo-1", revokeObjectURL: (url: string) => revoked.push(url) });
    vi.stubGlobal("document", canvasDocument(1_800_000, drawn));
    const fetch = vi.fn(async () => Response.json({ url: "https://cdn.test/u1/x.webp", path: "u1/x.webp" }));
    vi.stubGlobal("fetch", fetch);

    const result = await uploadImages({ files: [big("IMG_0042.jpg", 9 * 1024 * 1024)], bucket: "listing-images", pathPrefix: "u1", normalize: true });

    expect(result.failed).toEqual([]);
    const sent = (fetch.mock.calls[0] as unknown as [string, { body: FormData }])[1].body.get("file") as File;
    expect(sent.name).toBe("IMG_0042.jpg");
    expect(sent.type).toBe("image/jpeg");
    expect(sent.size).toBe(1_800_000);
    // The <img> read the file from an object URL, was what the canvas drew, and the URL was let go.
    expect(made).toHaveLength(1);
    expect(made[0].src).toBe("blob:photo-1");
    expect(drawn).toEqual([made[0]]);
    expect(revoked).toEqual(["blob:photo-1"]);
  });

  it("N955: where neither way can decode the photo, it is still refused with what to do, and nothing leaks", async () => {
    const revoked: string[] = [];
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("unsupported"); }));
    vi.stubGlobal("Image", imageElement(false, []));
    vi.stubGlobal("URL", { createObjectURL: () => "blob:photo-2", revokeObjectURL: (url: string) => revoked.push(url) });
    vi.stubGlobal("document", canvasDocument(1_000_000, []));
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const result = await uploadImages({ files: [big("IMG_0043.jpg", 9 * 1024 * 1024)], bucket: "listing-images", pathPrefix: "u1", normalize: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.failed).toEqual([expect.objectContaining({ reason: expect.stringMatching(/IMG_0043\.jpg is too large to upload \(over 4 MB\)/), retryable: false })]);
    expect(revoked).toEqual(["blob:photo-2"]);
  });

  it("N955: the first way is still used where it works; no <img> is made", async () => {
    const drawn: unknown[] = [];
    const made: Array<{ src: string }> = [];
    const bitmap = { width: 4032, height: 3024, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", vi.fn(async () => bitmap));
    vi.stubGlobal("Image", imageElement(true, made));
    vi.stubGlobal("document", canvasDocument(1_800_000, drawn));
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ url: "https://cdn.test/u1/x.webp", path: "u1/x.webp" })));
    const result = await uploadImages({ files: [big("IMG_0044.jpg", 9 * 1024 * 1024)], bucket: "listing-images", pathPrefix: "u1", normalize: true });
    expect(result.failed).toEqual([]);
    expect(made).toEqual([]);
    expect(drawn).toEqual([bitmap]);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });

  it("steps the JPEG quality down until a detailed photo fits, leaving headroom", async () => {
    const qualities: number[] = [];
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4032, height: 3024, close: vi.fn() })));
    vi.stubGlobal("document", {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob: (done: (blob: Blob) => void, type: string, quality: number) => {
          qualities.push(quality);
          done(new Blob([new Uint8Array(quality > 0.7 ? 3_900_000 : 2_000_000)], { type }));
        },
      }),
    });
    const fetch = vi.fn(async () => Response.json({ url: "https://cdn.test/u1/x.webp", path: "u1/x.webp" }));
    vi.stubGlobal("fetch", fetch);
    const result = await uploadImages({ files: [big("detail.jpg", 9 * 1024 * 1024)], bucket: "car-images", pathPrefix: "u1", normalize: true });
    expect(result.failed).toEqual([]);
    expect(qualities).toEqual([0.85, 0.75, 0.65]);
    const sent = (fetch.mock.calls[0] as unknown as [string, { body: FormData }])[1].body.get("file") as File;
    expect(sent.size).toBeLessThanOrEqual(3_500_000);
  });
});
