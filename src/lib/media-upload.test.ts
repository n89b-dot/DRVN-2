import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { uploadImages } = await import("./media-upload");

const file = (name: string) => new File(["x"], name, { type: "image/png" });

beforeEach(() => upload.mockReset());

describe("uploadImages — private bucket", () => {
  it("reports a thrown upload as a retryable failure and carries on", async () => {
    upload.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce({ error: null });
    const result = await uploadImages({ files: [file("a.png"), file("b.png")], bucket: "message-photos", pathPrefix: "u1" });
    expect(result.failed).toEqual([expect.objectContaining({ reason: "Failed to fetch", retryable: true })]);
    expect(result.failed[0].file.name).toBe("a.png");
    expect(result.uploaded.map((u) => u.file.name)).toEqual(["b.png"]);
    expect(result.uploaded[0].path).toMatch(/^u1\//);
  });

  it("keeps a storage error as a retryable failure", async () => {
    upload.mockResolvedValueOnce({ error: { message: "Bucket full" } });
    const result = await uploadImages({ files: [file("a.png")], bucket: "message-photos", pathPrefix: "u1" });
    expect(result).toEqual({ uploaded: [], failed: [expect.objectContaining({ reason: "Bucket full", retryable: true })] });
  });
});
