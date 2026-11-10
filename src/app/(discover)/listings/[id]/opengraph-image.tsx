import { ImageResponse } from "next/og";

import { listingShareCard } from "@/lib/share-copy";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "A part for sale on DRVN";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The share card for a part (work review #132, N1048), as builds have
 * (cars/[slug]/opengraph-image.tsx): generated from what the listing already
 * has. Read as a signed-out visitor, so a draft, paused or removed listing
 * gives a card with no photo and no price. The photo is fetched here, on our
 * server, from a link signed for this render; what a chat or a search engine
 * keeps is this route's own address.
 */
export default async function ListingCard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = createPublicClient({ maxAge: 300, kinds: ["listings"] });
  const [{ data: listing }, { data: photos }] = await Promise.all([
    supabase.from("listings").select("id, title, price_cents, status").eq("id", id).maybeSingle(),
    supabase.from("listing_images").select("url, position").eq("listing_id", id).order("position").limit(1),
  ]);
  const card = listingShareCard(listing, photos?.[0]?.url);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          background: "#20232a",
          color: "#f8f6f0",
          fontFamily: "sans-serif",
        }}
      >
        {card.photo && (
          <img src={card.photo} alt="" style={{ width: 660, height: 630, objectFit: "cover" }} />
        )}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            padding: 48,
          }}
        >
          <div style={{ display: "flex", fontSize: 34, fontWeight: 700, letterSpacing: -1 }}>
            DRVN<span style={{ color: "#e8593d" }}>.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div
              style={{
                display: "flex",
                fontSize: 20,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: "#a3a6ae",
              }}
            >
              {card.sold ? "Sold" : "For sale"}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 48,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: -1,
              }}
            >
              {card.title}
            </div>
            {card.price && <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>{card.price}</div>}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: "#a3a6ae" }}>
            The parts marketplace for modified cars.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
