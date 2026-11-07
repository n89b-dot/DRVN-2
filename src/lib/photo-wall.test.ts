import { describe, expect, it } from "vitest";

import { photoWallItems } from "./photo-wall";

describe("photo wall (E-1)", () => {
  it("leaves off every kind of card without a photo, keeping the order of the rest", () => {
    const items = [
      { kind: "car", id: "with-cover", cover_url: "https://cdn.example/car.jpg" },
      { kind: "car", id: "never-photographed", cover_url: null },
      { kind: "update", id: "text-only", cover_url: null },
      { kind: "part", id: "blank", cover_url: "  " },
      { kind: "update", id: "with-photo", cover_url: "https://cdn.example/post.jpg" },
      { kind: "part", id: "with-photo", cover_url: "https://cdn.example/part.jpg" },
    ];
    expect(photoWallItems(items).map((i) => `${i.kind}:${i.id}`)).toEqual([
      "car:with-cover",
      "update:with-photo",
      "part:with-photo",
    ]);
  });
});
