import { describe, expect, it } from "vitest";

import { deriveEvidenceStoragePath } from "./evidence-urls";

/**
 * dispute-evidence went private in 0027; rows written before that carry a
 * full public URL, rows written after carry `storage_path` too, and some
 * in between shapes (signed URL, bare path) can show up depending on how
 * far a partial migration got. This is the one function all of those
 * shapes have to funnel through correctly, or signing silently no-ops and
 * a thumbnail 400s.
 */
describe("deriveEvidenceStoragePath", () => {
  it("prefers an explicit storage_path over url", () => {
    expect(
      deriveEvidenceStoragePath({
        url: "https://proj.supabase.co/storage/v1/object/public/dispute-evidence/uid/a.jpg",
        storage_path: "uid/b.jpg",
      })
    ).toBe("uid/b.jpg");
  });

  it("derives the path from a legacy public URL", () => {
    expect(
      deriveEvidenceStoragePath({
        url: "https://proj.supabase.co/storage/v1/object/public/dispute-evidence/uid-123/photo.jpg",
      })
    ).toBe("uid-123/photo.jpg");
  });

  it("derives the path from an already-signed URL", () => {
    expect(
      deriveEvidenceStoragePath({
        url:
          "https://proj.supabase.co/storage/v1/object/sign/dispute-evidence/uid-123/photo.jpg?token=abc.def",
      })
    ).toBe("uid-123/photo.jpg");
  });

  it("derives the path from an authenticated-form URL", () => {
    expect(
      deriveEvidenceStoragePath({
        url: "https://proj.supabase.co/storage/v1/object/authenticated/dispute-evidence/uid-123/photo.jpg",
      })
    ).toBe("uid-123/photo.jpg");
  });

  it("accepts a bare path with no scheme", () => {
    expect(deriveEvidenceStoragePath({ url: "uid-123/photo.jpg" })).toBe("uid-123/photo.jpg");
    expect(deriveEvidenceStoragePath("uid-123/photo.jpg")).toBe("uid-123/photo.jpg");
  });

  it("rejects a URL for a different bucket", () => {
    expect(
      deriveEvidenceStoragePath({
        url: "https://proj.supabase.co/storage/v1/object/public/listing-images/uid/a.jpg",
      })
    ).toBeNull();
  });

  it("derives the path regardless of host — rows already came from our own DB", () => {
    // Host/ownership validation happens once, at insert time
    // (isOwnedDisputeEvidenceRef in media-url.ts). By the time a row reaches
    // this function it was already read back through RLS, so re-deriving
    // the path shouldn't silently drop it over a host mismatch.
    expect(
      deriveEvidenceStoragePath({
        url: "https://other-project.supabase.co/storage/v1/object/public/dispute-evidence/uid/a.jpg",
      })
    ).toBe("uid/a.jpg");
  });

  it("returns null for garbage input", () => {
    expect(deriveEvidenceStoragePath({ url: "not a url at all" })).toBeNull();
    expect(deriveEvidenceStoragePath({ url: "" })).toBeNull();
    expect(deriveEvidenceStoragePath({})).toBeNull();
  });
});
