import { describe, expect, it } from "vitest";

import { chatPhotoPath, chatPhotoRef } from "./chat-photo-ref";
import { parsePhotoJob, photoToolAllowed } from "./photo-job";

const ME = "11111111-1111-4111-8111-111111111111";
const THEM = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";

describe("R81 a private chat photo's name", () => {
  it("round-trips the object path through the stored address", () => {
    const ref = chatPhotoRef("https://proj.supabase.co/", `${ME}/${FILE}.webp`);
    expect(ref).toBe(`https://proj.supabase.co/storage/v1/object/authenticated/agent-chat-photos/${ME}/${FILE}.webp`);
    expect(chatPhotoPath(ref, ME)).toBe(`${ME}/${FILE}.webp`);
  });

  it("refuses someone else's photo, a public photo, and anything with extra path", () => {
    const ref = chatPhotoRef("https://proj.supabase.co", `${THEM}/${FILE}.webp`);
    expect(chatPhotoPath(ref, ME)).toBeNull();
    expect(chatPhotoPath(`https://proj.supabase.co/storage/v1/object/public/listing-images/${ME}/${FILE}.webp`, ME)).toBeNull();
    expect(chatPhotoPath(`https://proj.supabase.co/storage/v1/object/authenticated/agent-chat-photos/${ME}/../${FILE}.webp`, ME)).toBeNull();
    expect(chatPhotoPath(`https://proj.supabase.co/storage/v1/object/authenticated/agent-chat-photos/${ME}/${FILE}.webp?x=1`, ME)).toBeNull();
  });
});

describe("R-photos the photo-job mode", () => {
  it("accepts only the two photo jobs", () => {
    expect(parsePhotoJob("listing")).toBe("listing");
    expect(parsePhotoJob("update")).toBe("update");
    expect(parsePhotoJob("chat")).toBeNull();
    expect(parsePhotoJob(undefined)).toBeNull();
  });

  it("offers a photo tool only in its own job, and other tools always", () => {
    expect(photoToolAllowed("draft_listing_from_photos", null)).toBe(false);
    expect(photoToolAllowed("draft_listing_from_photos", "listing")).toBe(true);
    expect(photoToolAllowed("draft_car_update", "listing")).toBe(false);
    expect(photoToolAllowed("draft_car_update", "update")).toBe(true);
    expect(photoToolAllowed("search_parts", null)).toBe(true);
  });
});
