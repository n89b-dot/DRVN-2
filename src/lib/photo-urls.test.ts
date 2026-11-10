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
  it("signs only guarded columns, and inside JSON only a post body's image blocks", async () => {
    const { isPhotoFieldKey } = await import("./photo-urls");
    for (const key of ["url", "image_url", "cover_image_url", "image", "cover", "cover_url"]) expect(isPhotoFieldKey(key, {}, null), key).toBe(true);
    for (const key of ["body", "bio", "description", "product_url", "source_url", "video_url", "imported_images", "links", "urls", "src", "thumbnail"]) {
      expect(isPhotoFieldKey(key, {}, null), key).toBe(false);
    }
    expect(isPhotoFieldKey("urls", { type: "images" }, "body")).toBe(true);
    expect(isPhotoFieldKey("beforeUrl", { type: "before_after" }, "body")).toBe(true);
    expect(isPhotoFieldKey("url", { type: "embed" }, "body")).toBe(false);
    expect(isPhotoFieldKey("url", {}, "links")).toBe(false);
    expect(isPhotoFieldKey("url", {}, "imported_images")).toBe(false);
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

describe("the signer's photo keys match the database guards (N940, #196 review)", () => {
  it("every signed column is one member_media_ref_ok guards, and the body paths are the ones its body guard checks", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { GUARDED_PHOTO_COLUMNS } = await import("./photo-urls");
    const integrity = fs.readFileSync(path.resolve(__dirname, "../../supabase/migrations/20261107203000_media_integrity.sql"), "utf8");
    const guarded = new Set([...integrity.matchAll(/before insert or update of ([a-z_]+)[, ]/g)].map((m) => m[1]));
    // The RPC aliases read guarded columns: image (a listing's first
    // listing_images.url), cover and cover_url (a car's cover_image_url).
    for (const column of GUARDED_PHOTO_COLUMNS) {
      if (["image", "cover", "cover_url"].includes(column)) continue;
      expect(guarded.has(column), `${column} has no member_media_ref_ok guard`).toBe(true);
    }
    expect(integrity).toContain("b -> 'urls'");
    expect(integrity).toContain("b ->> 'type' = 'images'");
    expect(integrity).toContain("b ->> 'beforeUrl'");
    expect(integrity).toContain("b ->> 'afterUrl'");
  });

  it("classifies every JSON column in the generated schema as member-writable or server-only", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { MEMBER_JSON_COLUMNS, SERVER_JSON_COLUMNS } = await import("./json-columns");
    const types = fs.readFileSync(path.resolve(__dirname, "database.generated.ts"), "utf8");
    const tables = types.slice(types.indexOf("    Tables: {"), types.indexOf("    Views: {"));
    const json = new Set<string>();
    for (const table of tables.matchAll(/\n {6}[a-z_]+: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/g)) {
      for (const column of `\n${table[1]}\n`.matchAll(/\n {10}([a-z_]+): Json( \| null)?\n/g)) json.add(column[1]);
    }
    expect(json.size).toBeGreaterThan(10);
    const known = new Set([...MEMBER_JSON_COLUMNS, ...SERVER_JSON_COLUMNS]);
    expect([...json].filter((c) => !known.has(c)), "classify these JSON columns in src/lib/json-columns.ts").toEqual([]);
  });
});
