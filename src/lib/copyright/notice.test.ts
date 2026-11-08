import { describe, expect, it } from "vitest";

import { COPYRIGHT_URL_LIMIT, parseContentUrls, takedownTargets, validateCopyrightNotice } from "./notice";

const HOSTS = ["drvn.app", "proj.supabase.co"];
const LISTING = "8f6c2a52-3d1e-4b8a-9c3f-2b1d4e5f6a7b";
const PHOTO = `https://proj.supabase.co/storage/v1/object/public/listing-images/${LISTING}/rehosted.webp`;

function notice(overrides: Record<string, string | null> = {}) {
  const fields: Record<string, string | null> = {
    claimant_name: "Pat Photographer",
    claimant_email: "pat@example.test",
    claimant_address: "1 High Street, Leeds LS1 1AA",
    claimant_phone: "",
    rights_holder: "",
    work_description: "My photograph of a K03 turbo, first published on my blog.",
    content_urls: `https://drvn.app/listings/${LISTING}\n${PHOTO}`,
    good_faith: "yes",
    accurate_and_authorised: "yes",
    signature: "Pat Photographer",
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) if (value !== null) data.set(key, value);
  return data;
}

// R69-dmca: what a notice must carry before it is stored.
describe("copyright notice validation", () => {
  it("accepts a complete notice and keeps only what the table stores", () => {
    const { notice: parsed, errors } = validateCopyrightNotice(notice(), HOSTS);
    expect(errors).toEqual({});
    expect(parsed).toMatchObject({
      claimant_name: "Pat Photographer",
      claimant_phone: null,
      rights_holder: null,
      content_urls: [`https://drvn.app/listings/${LISTING}`, PHOTO],
      good_faith: true,
      accurate_and_authorised: true,
      signature: "Pat Photographer",
    });
  });

  it("refuses a notice without the good-faith or accuracy statement, or a signature", () => {
    for (const missing of ["good_faith", "accurate_and_authorised", "signature"]) {
      const { notice: parsed, errors } = validateCopyrightNotice(notice({ [missing]: null }), HOSTS);
      expect(parsed).toBeUndefined();
      expect(errors).toHaveProperty(missing);
    }
    expect(validateCopyrightNotice(notice({ good_faith: "on" }), HOSTS).errors).toHaveProperty("good_faith");
  });

  it("needs contact details a rights holder can be reached on", () => {
    const { errors } = validateCopyrightNotice(notice({ claimant_email: "not-an-email", claimant_address: "" }), HOSTS);
    expect(errors).toMatchObject({ claimant_email: expect.any(String), claimant_address: expect.any(String) });
  });

  it("takes only links on DRVN, and at most the limit", () => {
    expect(parseContentUrls("https://elsewhere.example/photo.jpg", HOSTS).error).toMatch(/isn't on DRVN/);
    expect(parseContentUrls("drvn.app/listings/x", HOSTS).error).toMatch(/full web address/);
    expect(parseContentUrls("", HOSTS).error).toMatch(/at least one/);
    const many = Array.from({ length: COPYRIGHT_URL_LIMIT + 1 }, (_, i) => `https://drvn.app/listings/${i}`).join("\n");
    expect(parseContentUrls(many, HOSTS).error).toMatch(/Up to 20/);
    expect(parseContentUrls(`${PHOTO}, ${PHOTO}`, HOSTS).urls).toEqual([PHOTO]);
  });
});

describe("takedown targets", () => {
  const hosts = { site: ["drvn.app"], storage: ["proj.supabase.co"] };

  it("reads listing pages as listings and storage links as photos", () => {
    expect(takedownTargets([`https://drvn.app/listings/${LISTING}?ref=x`, PHOTO], hosts)).toEqual({
      listingIds: [LISTING],
      mediaUrls: [PHOTO],
      other: [],
    });
  });

  it("takes the admin's bare listing ids, and leaves everything else for a person", () => {
    const post = "https://drvn.app/posts/abc";
    const result = takedownTargets([LISTING.toUpperCase(), `${post} https://elsewhere.example/x.jpg`], hosts);
    expect(result.listingIds).toEqual([LISTING]);
    expect(result.mediaUrls).toEqual([]);
    expect(result.other).toEqual([post, "https://elsewhere.example/x.jpg"]);
  });

  it("doesn't take a storage-shaped path on the site, or a listing path on storage", () => {
    const result = takedownTargets(
      [`https://drvn.app/storage/v1/object/public/listing-images/x/y.webp`, `https://proj.supabase.co/listings/${LISTING}`],
      hosts
    );
    expect(result.listingIds).toEqual([]);
    expect(result.mediaUrls).toEqual([]);
    expect(result.other).toHaveLength(2);
  });
});
