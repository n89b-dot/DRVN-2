import { ImageResponse } from "next/og";

import { profileBannerUrl } from "@/lib/cars/banner";
import { OG_COLORS, OG_SIZE, OgBrandCard, OgFoot, OgMicrolabel, OgWordmark, ogClamp, ogWeight } from "@/lib/og/card";
import { createPublicClient } from "@/lib/supabase/public";
import { PUBLIC_MAX_AGE } from "@/lib/supabase/public-cache";

export const alt = "A builder on DRVN";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * The share card for a profile: display name, handle, headline, over the
 * same borrowed banner the profile page shows (P-1: the main car's cover if
 * that car is public, else another public car's, else none). Private cars
 * never contribute. An unknown or hidden profile gets the plain brand card.
 */
export default async function ProfileCard({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const supabase = createPublicClient({ maxAge: PUBLIC_MAX_AGE.content, kinds: ["profiles", "cars"] });

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, username, display_name, headline, profile_type, main_car_id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) return new ImageResponse(<OgBrandCard />, size);

  const { data: cars } = await supabase
    .from("cars")
    .select("id, created_at, is_public, cover_image_url")
    .eq("owner_id", profile.id)
    .eq("is_public", true);
  const banner = profileBannerUrl(cars ?? [], profile.main_car_id);

  const name = profile.display_name ?? `@${profile.username}`;
  const handle = profile.display_name ? `@${profile.username}` : "";

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          background: OG_COLORS.ink,
          color: OG_COLORS.onInk,
          fontFamily: "sans-serif",
        }}
      >
        {banner && (
          <img
            src={banner}
            alt=""
            style={{ position: "absolute", top: 0, left: 0, width: OG_SIZE.width, height: OG_SIZE.height, objectFit: "cover" }}
          />
        )}
        {banner && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: OG_SIZE.width,
              height: OG_SIZE.height,
              background: OG_COLORS.photoScrim,
            }}
          />
        )}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 64,
          }}
        >
          <OgWordmark />
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <OgMicrolabel>{profile.profile_type === "shop" ? "Shop" : "Builder"}</OgMicrolabel>
            <div
              style={{
                display: "flex",
                fontSize: 64,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: -2,
                ...ogWeight(64, OG_COLORS.onInk),
              }}
            >
              {ogClamp(name, 40)}
            </div>
            {handle && <div style={{ display: "flex", fontSize: 28, color: OG_COLORS.dim }}>{handle}</div>}
            {profile.headline && (
              <div style={{ display: "flex", fontSize: 24, color: OG_COLORS.onInk, maxWidth: 900 }}>
                {ogClamp(profile.headline, 110)}
              </div>
            )}
          </div>
          <OgFoot>Their cars, their builds, and the parts off them.</OgFoot>
        </div>
      </div>
    ),
    size,
  );
}
