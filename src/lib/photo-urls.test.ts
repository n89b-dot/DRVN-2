import { describe, expect, it } from "vitest";

import {
  canonicalizePhotoUrlsInText,
  canonicalPhotoUrl,
  canonicalPhotoUrlsInText,
  replacePhotoUrlsInText,
  signedPhotoObject,
  signingWindow,
  SIGNING_WINDOW_SECONDS,
} from "./photo-urls";

const O = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const canonical = (bucket: string, file = "a.webp") => `${O}/storage/v1/object/public/${bucket}/${ME}/${file}`;
const signed = (bucket: string, file = "a.webp") => `${O}/storage/v1/object/sign/${bucket}/${ME}/${file}?token=not-a-real-token_1.2`;

describe("member photo spellings (N455)", () => {
  it("N455: a signed photo URL in a signed bucket turns back into its canonical URL; nothing else changes", () => {
    for (const bucket of ["car-images", "listing-images", "activity-images"]) {
      expect(canonicalPhotoUrl(signed(bucket), O)).toBe(canonical(bucket));
    }
    expect(canonicalPhotoUrl(signed("avatars"), O)).toBe(signed("avatars"));
    expect(canonicalPhotoUrl(signed("message-photos"), O)).toBe(signed("message-photos"));
    expect(canonicalPhotoUrl(canonical("car-images"), O)).toBe(canonical("car-images"));
    expect(canonicalPhotoUrl(`${signed("car-images")}&download=1`, O)).toBe(`${signed("car-images")}&download=1`);
    expect(canonicalPhotoUrl(signed("car-images").replace(O, "https://evil.example"), O)).toBe(signed("car-images").replace(O, "https://evil.example"));
    expect(canonicalPhotoUrl(`${O}/storage/v1/object/sign/car-images/${ME}/../x.webp?token=a`, O)).toBe(`${O}/storage/v1/object/sign/car-images/${ME}/../x.webp?token=a`);
    expect(canonicalPhotoUrl(null, O)).toBeNull();
  });

  it("N455: a request body's signed photo URLs are all canonical before the database sees them", () => {
    const body = JSON.stringify({ p_image_urls: [signed("activity-images"), signed("activity-images", "b.webp")], cover: signed("car-images"), avatar: signed("avatars") });
    const out = JSON.parse(canonicalizePhotoUrlsInText(body, O));
    expect(out).toEqual({ p_image_urls: [canonical("activity-images"), canonical("activity-images", "b.webp")], cover: canonical("car-images"), avatar: signed("avatars") });
  });

  it("N455: a response's canonical photo URLs are found once each and replaced with their signed spelling", () => {
    const rows = JSON.stringify([{ url: canonical("car-images") }, { url: canonical("car-images") }, { body: [{ urls: [canonical("listing-images")] }] }, { avatar: canonical("avatars") }]);
    expect(canonicalPhotoUrlsInText(rows, O)).toEqual([canonical("car-images"), canonical("listing-images")]);
    const map = new Map([[canonical("car-images"), signed("car-images")]]);
    const out = JSON.parse(replacePhotoUrlsInText(rows, map, O));
    expect(out[0].url).toBe(signed("car-images"));
    expect(out[1].url).toBe(signed("car-images"));
    expect(out[2].body[0].urls[0]).toBe(canonical("listing-images"));
    expect(out[3].avatar).toBe(canonical("avatars"));
  });

  it("N455: names the object a canonical photo URL points at", () => {
    expect(signedPhotoObject(canonical("car-images", "car-1/p%20q.webp"), O)).toEqual({ bucket: "car-images", path: `${ME}/car-1/p q.webp` });
    expect(signedPhotoObject(canonical("avatars"), O)).toBeNull();
    expect(signedPhotoObject(`${canonical("car-images")}?x=1`, O)).toBeNull();
  });

  it("N455: URLs minted in one window are reused for it and last to the end of the next", () => {
    const start = 1_800_000_000 - (1_800_000_000 % SIGNING_WINDOW_SECONDS);
    const early = signingWindow(start * 1000);
    const late = signingWindow((start + SIGNING_WINDOW_SECONDS - 1) * 1000);
    expect(early.window).toBe(late.window);
    expect(early.expiresIn).toBe(2 * SIGNING_WINDOW_SECONDS);
    expect(late.expiresIn).toBe(SIGNING_WINDOW_SECONDS + 1);
    expect(signingWindow((start + SIGNING_WINDOW_SECONDS) * 1000).window).toBe(early.window + 1);
  });
});

describe("photo fields and expired links (N940, #178 review)", () => {
  it("names the photo-shaped keys and refuses member-written ones", async () => {
    const { isPhotoFieldKey } = await import("./photo-urls");
    for (const key of ["url", "urls", "image", "images", "image_url", "cover_image_url", "cover_url", "imported_images", "removed_image_urls", "beforeUrl", "afterUrl", "thumbnail"]) {
      expect(isPhotoFieldKey(key, {}), key).toBe(true);
    }
    for (const key of ["body", "text", "description", "bio", "title", "product_url", "source_url", "video_url", "href", "links", "content_urls"]) {
      expect(isPhotoFieldKey(key, {}), key).toBe(false);
    }
    expect(isPhotoFieldKey("url", { label: "website", url: "x" })).toBe(false);
  });

  it("an expired or malformed signed link reads as expired; a live one and anything else does not", async () => {
    const { signedPhotoLinkExpired } = await import("./photo-urls");
    const at = Date.UTC(2026, 10, 10, 12);
    const link = (payload: object | null) =>
      `https://p.supabase.co/storage/v1/object/sign/listing-images/u/a.webp?token=e30.${payload ? Buffer.from(JSON.stringify(payload)).toString("base64url") : ""}.s`;
    expect(signedPhotoLinkExpired(link({ exp: at / 1000 - 1 }), at)).toBe(true);
    expect(signedPhotoLinkExpired(link({ exp: at / 1000 + 600 }), at)).toBe(false);
    expect(signedPhotoLinkExpired(link({}), at)).toBe(true);
    expect(signedPhotoLinkExpired(link(null), at)).toBe(true);
    expect(signedPhotoLinkExpired("https://p.supabase.co/storage/v1/object/public/listing-images/u/a.webp", at)).toBe(false);
    expect(signedPhotoLinkExpired("/hero.png", at)).toBe(false);
    expect(signedPhotoLinkExpired(null, at)).toBe(false);
  });
});

describe("the signer's photo keys match the schema (N940, #178 review)", () => {
  // Every column in the public schema whose name looks like it holds a URL or
  // an image, classified by hand. A new one fails this test until someone
  // decides whether it holds member photos (sign it) or member-written text
  // (never sign it), so a photo column can't ship unsigned and a prose
  // column can't ship signed.
  const CLASSIFIED: Record<string, "photo" | "not photo"> = {
    url: "photo", // car_images, listing_images, activity_images, order snapshots; dispute evidence and staged uploads aren't signed buckets
    image_url: "photo", // car_hotspots, mod_items: owner-checked on write
    cover_image_url: "photo", // cars
    imported_images: "photo", // listing_imports
    images: "photo", // agent_messages (message-photos, not a signed bucket)
    avatar_url: "not photo", // public avatars bucket, never signed
    video_url: "not photo", // member-written
    product_url: "not photo", // member-written
    source_url: "not photo", // the import's source page
    canonical_url: "not photo", // the import's source page
    content_urls: "not photo", // a claimant's list of links
    links: "not photo", // member-written profile links
  };

  it("classifies every url, image and photo column in the generated schema, and the signer agrees", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { isPhotoFieldKey } = await import("./photo-urls");
    const types = fs.readFileSync(path.resolve(__dirname, "database.generated.ts"), "utf8");
    const columns = new Set<string>();
    for (const table of types.matchAll(/\n {6}[a-z_]+: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
      for (const column of table[1].matchAll(/\n {10}([a-z_]+):/g)) {
        if (/(url|urls|image|images|photo|photos|cover|thumb|thumbnail|banner|src|links)$/.test(column[1])) columns.add(column[1]);
      }
    }
    expect(columns.size).toBeGreaterThan(5);
    const unclassified = [...columns].filter((c) => !(c in CLASSIFIED));
    expect(unclassified, "classify these columns in this test and, if they hold photos, in isPhotoFieldKey").toEqual([]);
    for (const [column, kind] of Object.entries(CLASSIFIED)) {
      if (column === "avatar_url") continue; // a photo key in shape, but its bucket is public and never matches
      expect(isPhotoFieldKey(column, {}), column).toBe(kind === "photo");
    }
  });
});
