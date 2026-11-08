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
