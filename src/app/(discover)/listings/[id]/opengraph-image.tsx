import { ImageResponse } from "next/og";

import { formatPrice } from "@/lib/marketplace/taxonomy";
import { OG_COLORS, OG_SIZE, OgBrandCard, OgFrame, OgMicrolabel, ogClamp, ogWeight } from "@/lib/og/card";
import { createPublicClient } from "@/lib/supabase/public";
import { PUBLIC_MAX_AGE } from "@/lib/supabase/public-cache";

export const alt = "A part for sale on DRVN";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * The share card for a part: cover photo, title, price, seller. Only a live
 * listing gets one — anything else (draft, paused, sold, archived, missing)
 * is the plain brand card, so a pasted link never leaks what the seller
 * took down. The anonymous client sees only what row security shows a
 * signed-out visitor, the same as the page's own metadata.
 */
export default async function ListingCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createPublicClient({ maxAge: PUBLIC_MAX_AGE.commerce, kinds: ["listings", "profiles"] });

  const { data: listing } = await supabase
    .from("listings")
    .select("id, title, price_cents, status, seller_id")
    .eq("id", id)
    .eq("status", "active")
    .maybeSingle();

  if (!listing) return new ImageResponse(<OgBrandCard />, size);

  const [{ data: image }, { data: seller }] = await Promise.all([
    supabase
      .from("listing_images")
      .select("url")
      .eq("listing_id", listing.id)
      .order("position")
      .limit(1)
      .maybeSingle(),
    supabase.from("profiles").select("display_name, username").eq("id", listing.seller_id).maybeSingle(),
  ]);

  const sellerLine = seller?.username
    ? `@${seller.username}`
    : (seller?.display_name ?? "");

  return new ImageResponse(
    (
      <OgFrame photo={image?.url} foot="Parts off real builds, on DRVN.">
        <OgMicrolabel>For sale</OgMicrolabel>
        <div
          style={{
            display: "flex",
            fontSize: image?.url ? 44 : 56,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: -1,
            ...ogWeight(image?.url ? 44 : 56, OG_COLORS.onInk),
          }}
        >
          {ogClamp(listing.title, image?.url ? 64 : 90)}
        </div>
        <div style={{ display: "flex", fontSize: 36, fontWeight: 700, letterSpacing: -1, ...ogWeight(36, OG_COLORS.onInk) }}>
          {formatPrice(listing.price_cents)}
        </div>
        {sellerLine && (
          <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.dim }}>Sold by {sellerLine}</div>
        )}
      </OgFrame>
    ),
    size,
  );
}
