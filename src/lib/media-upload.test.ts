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
    expect(result.failed).toEqual([expect.objectContaining({ reason: "huge.png is too large to upload.", retryable: false })]);
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

  it("explains a HEIC the browser can't convert rather than uploading what the server can't decode", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    // No createImageBitmap here (as in a browser without HEIC support).
    const result = await uploadImages({ files: [new File(["x"], "IMG_3.HEIC", { type: "image/heic" })], bucket: "activity-images", pathPrefix: "u1" });
    expect(fetch).not.toHaveBeenCalled();
    expect(result.failed).toEqual([expect.objectContaining({ reason: expect.stringMatching(/IMG_3\.HEIC is a HEIC photo this browser can't convert/), retryable: false })]);
  });
});
