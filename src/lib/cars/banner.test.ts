import { describe, expect, it } from "vitest";

import { profileBannerUrl } from "./banner";

const car = (
  id: string,
  created_at: string,
  is_public: boolean,
  cover_image_url: string | null
) => ({ id, created_at, is_public, cover_image_url });

describe("profile banner (P-1)", () => {
  it("uses the main car's cover", () => {
    const cars = [
      car("main", "2026-01-01T00:00:00Z", true, "/main.jpg"),
      car("other", "2026-09-01T00:00:00Z", true, "/other.jpg"),
    ];
    expect(profileBannerUrl(cars, "main")).toBe("/main.jpg");
  });

  it("falls back to another public cover when the main car has no photo", () => {
    const cars = [
      car("main", "2026-01-01T00:00:00Z", true, null),
      car("other", "2026-09-01T00:00:00Z", true, "/other.jpg"),
    ];
    expect(profileBannerUrl(cars, "main")).toBe("/other.jpg");
  });

  it("never borrows a private car's cover", () => {
    // The owner kept that car back. A public profile is not the place to
    // publish its photo, main car or not.
    const cars = [
      car("main", "2026-01-01T00:00:00Z", false, "/private.jpg"),
      car("other", "2026-09-01T00:00:00Z", false, "/also-private.jpg"),
    ];
    expect(profileBannerUrl(cars, "main")).toBeNull();
  });

  it("returns null rather than inventing a banner", () => {
    expect(profileBannerUrl([], null)).toBeNull();
    expect(profileBannerUrl([car("a", "2026-01-01T00:00:00Z", true, null)], null)).toBeNull();
  });

  it("picks the newest public cover when no main car is set", () => {
    const cars = [
      car("old", "2026-01-01T00:00:00Z", true, "/old.jpg"),
      car("new", "2026-09-01T00:00:00Z", true, "/new.jpg"),
    ];
    expect(profileBannerUrl(cars, null)).toBe("/new.jpg");
  });
});
