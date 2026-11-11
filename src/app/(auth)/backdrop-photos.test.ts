import { describe, expect, it } from "vitest";

import { backdropKeepable } from "./backdrop-photos";

const O = "https://proj.supabase.co/storage/v1/object";
const unsigned = `${O}/public/listing-images/11111111-1111-4111-8111-111111111111/part.webp`;
const signed = `${O}/sign/listing-images/11111111-1111-4111-8111-111111111111/part.webp?token=abc`;

describe("N1062: the sign-in backdrop is kept only when every photo it draws is signed (review of #244)", () => {
  it("N1062: one unsigned photo, on either kind of card, means the set is not kept", () => {
    expect(backdropKeepable([{ kind: "listing", listing: { cover_url: signed } }, { kind: "build", build: { cover_image_url: signed } }])).toBe(true);
    expect(backdropKeepable([{ kind: "listing", listing: { cover_url: unsigned } }, { kind: "build", build: { cover_image_url: signed } }])).toBe(false);
    expect(backdropKeepable([{ kind: "listing", listing: { cover_url: signed } }, { kind: "build", build: { cover_image_url: unsigned.replace("listing-images", "car-images") } }])).toBe(false);
    // A card with no photo is a card with nothing unsigned.
    expect(backdropKeepable([{ kind: "listing", listing: { cover_url: null } }])).toBe(true);
    expect(backdropKeepable([])).toBe(true);
  });

  it("N1062: a stored address a seller wrote into a title is not a photo: the set is still kept", () => {
    const card = { kind: "listing" as const, listing: { cover_url: signed, title: `Turbo, photos at ${unsigned}`, seller: { bio: unsigned } } };
    expect(backdropKeepable([card])).toBe(true);
  });
});
