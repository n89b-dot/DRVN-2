import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  canonicalStorageObject,
  isCanonicalObjectPath,
  isCanonicalPublicStorageUrl,
  isOwnedDisputeEvidenceRef,
  isOwnedStorageUrl,
  keepValidImageUrls,
  ogImageSource,
  parseStorageObject,
  storageObjectKey,
} from "./media-url";

const ORIGIN = "https://proj.supabase.co";
const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const photo = `${ORIGIN}/storage/v1/object/public/car-images/${ME}/car-1/photo.webp`;
const object = { bucket: "car-images", path: `${ME}/car-1/photo.webp` };

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGIN;
});
afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = saved;
});

/**
 * N99: the in-use check and the deletion target must name the same object.
 * Every spelling of one object resolves to one (bucket, decoded path), the
 * same identity `private.media_object_key` computes in SQL
 * (20261107203000), so encoding or a variant route can't split them.
 */
describe("canonicalStorageObject — one identity per object (N99)", () => {
  it.each([
    ["the plain public URL", photo],
    ["a percent-encoded letter", photo.replace("photo.webp", "%70hoto.webp")],
    ["an encoded dot", photo.replace("photo.webp", "photo%2Ewebp")],
    ["a lower-case escape", photo.replace("photo.webp", "%70hoto%2ewebp")],
    ["a query string", `${photo}?download=1`],
    ["a fragment", `${photo}#top`],
    ["the signed route", `${photo.replace("/object/public/", "/object/sign/")}?token=abc.def`],
    ["the authenticated route", photo.replace("/object/public/", "/object/authenticated/")],
    ["the image-render route", `${photo.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/")}?width=400`],
    ["an upper-case host", photo.replace("proj.supabase.co", "PROJ.supabase.co")],
  ])("resolves %s to the same object", (_label, value) => {
    expect(canonicalStorageObject(value)).toEqual(object);
    expect(storageObjectKey(canonicalStorageObject(value)!)).toBe(`car-images/${ME}/car-1/photo.webp`);
  });

  it.each([
    ["an encoded parent segment", photo.replace("/photo.webp", "/%2E%2E/photo.webp")],
    ["a literal parent segment", `${ORIGIN}/storage/v1/object/public/car-images/${ME}/../${THEM}/photo.webp`],
    ["an encoded slash making an empty segment", photo.replace("/photo.webp", "/%2Fphoto.webp")],
    ["an empty segment", photo.replace("/photo.webp", "//photo.webp")],
    ["a malformed escape", photo.replace("photo.webp", "ph%zzoto.webp")],
    ["invalid UTF-8", photo.replace("photo.webp", "ph%C3oto.webp")],
    ["an encoded query mark", photo.replace("photo.webp", "photo.webp%3Fx")],
    ["an encoded control character", photo.replace("photo.webp", "photo%00.webp")],
    ["a bucket-only URL", `${ORIGIN}/storage/v1/object/public/car-images`],
    ["a non-object route", `${ORIGIN}/storage/v1/object/list/car-images`],
    ["a non-string", 42],
  ])("names no object for %s", (_label, value) => {
    expect(canonicalStorageObject(value)).toBeNull();
  });

  it("checks decoded paths the way the database does", () => {
    expect(isCanonicalObjectPath(`${ME}/a.webp`)).toBe(true);
    for (const bad of ["a", "/a/b", "a/b/", "a//b", "a/./b", "a/../b", "a/b?c", "a/b#c", "a/b%c", "a\\b/c", "a/b\u0007"]) {
      expect(isCanonicalObjectPath(bad), bad).toBe(false);
    }
  });

  it("only parses deletion targets on our own storage host", () => {
    expect(parseStorageObject(photo)).toEqual(object);
    expect(parseStorageObject(photo.replace(ORIGIN, "https://evil.example"))).toBeNull();
    expect(parseStorageObject(photo.replace("photo.webp", "%70hoto.webp"))).toEqual(object);
  });
});

/** N55: what a member may store as a photo reference, and the one spelling. */
describe("isOwnedStorageUrl — canonical, ours, the member's own folder (N55)", () => {
  it("accepts the member's own canonical public URL", () => {
    expect(isCanonicalPublicStorageUrl(photo)).toBe(true);
    expect(isOwnedStorageUrl(photo, ME)).toBe(true);
  });

  it.each([
    ["another member's photo", photo.replace(ME, THEM)],
    ["another host", photo.replace(ORIGIN, "https://evil.example")],
    ["plain http", photo.replace("https://", "http://")],
    ["a query string", `${photo}?x=1`],
    ["a fragment", `${photo}#x`],
    ["an encoded spelling", photo.replace("photo.webp", "%70hoto.webp")],
    ["the signed route", photo.replace("/object/public/", "/object/sign/")],
    ["credentials in the URL", photo.replace("https://", "https://user:pw@")],
    ["a bucket members don't upload to", photo.replace("car-images", "account-exports")],
  ])("refuses %s", (_label, value) => {
    expect(isOwnedStorageUrl(value, ME)).toBe(false);
  });

  it("filters a client list down to canonical owned URLs", () => {
    expect(keepValidImageUrls([photo, `${photo}?x`, photo.replace(ME, THEM), 7], 12, ME)).toEqual([photo]);
  });
});

/** N55 (SSRF): the share-image renderer fetches only our public photos. */
describe("ogImageSource — the share card's fetch allow-list", () => {
  it("passes a canonical public photo on our storage", () => {
    expect(ogImageSource(photo)).toBe(photo);
    expect(ogImageSource(photo.replace("car-images", "activity-images"))).not.toBeNull();
    expect(ogImageSource(photo.replace("car-images", "listing-images"))).not.toBeNull();
    expect(ogImageSource(photo.replace("car-images", "avatars"))).not.toBeNull();
  });

  it.each([
    ["the cloud metadata address", "http://169.254.169.254/latest/meta-data/iam/security-credentials/"],
    ["a loopback service", "http://127.0.0.1:5432/"],
    ["an internal hostname", "https://localhost/storage/v1/object/public/car-images/a/b.webp"],
    ["another host shaped like storage", photo.replace(ORIGIN, "https://evil.example")],
    ["our host with credentials", photo.replace("https://", "https://user:pw@")],
    ["our host on another port", photo.replace(ORIGIN, `${ORIGIN}:8443`)],
    ["our host, another route", `${ORIGIN}/auth/v1/admin/users`],
    ["a private bucket", photo.replace("car-images", "dispute-evidence")],
    ["message photos", photo.replace("car-images", "message-photos")],
    ["a dressed-up spelling", `${photo}?redirect=https://evil.example`],
    ["a data URI", "data:image/png;base64,AAAA"],
    ["a file URL", "file:///etc/passwd"],
    ["nothing", null],
  ])("refuses %s", (_label, value) => {
    expect(ogImageSource(value)).toBeNull();
  });

  it("fails closed when the storage host isn't configured", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(ogImageSource(photo)).toBeNull();
  });
});

/** N100: an evidence path names its uploader and the disputed order. */
describe("isOwnedDisputeEvidenceRef", () => {
  const file = "44444444-4444-4444-8444-444444444444.jpg";

  it("accepts the uploader's own path for this order", () => {
    expect(isOwnedDisputeEvidenceRef(`${ME}/${ORDER}/${file}`, ME, ORDER)).toBe(true);
  });

  it.each([
    ["someone else's folder", `${THEM}/${ORDER}/${file}`],
    ["another order", `${ME}/${THEM}/${file}`],
    ["no order (the pre-dispute shape)", `${ME}/${file}`],
    ["a nested path", `${ME}/${ORDER}/x/${file}`],
    ["a dot segment", `${ME}/${ORDER}/..`],
    ["a full URL", `${ORIGIN}/storage/v1/object/public/dispute-evidence/${ME}/${ORDER}/${file}`],
  ])("refuses %s", (_label, value) => {
    expect(isOwnedDisputeEvidenceRef(value, ME, ORDER)).toBe(false);
  });
});
