import { ImageResponse } from "next/og";

import { ogImageSource } from "@/lib/media-url";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "Build on DRVN";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The shareable build card (brief §AB) — generated from data the car already
 * has: cover photo, identity line, build/update counts. No manual card
 * workflow; every share link gets this automatically.
 */
export default async function BuildCard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = createPublicClient({ maxAge: 300, kinds: ["cars", "posts", "profiles"] });
  const { data: car } = await supabase
    .from("cars")
    .select("id, name, make, model, year, cover_image_url, is_public")
    .eq("slug", slug)
    .maybeSingle();

  const [{ count: modCount }, { count: updateCount }] = car
    ? await Promise.all([
        // Installed only: the share card's mod count is what the car has now,
        // not a tally of everything ever bolted to it.
        supabase
          .from("mod_items")
          .select("id", { count: "exact", head: true })
          .eq("car_id", car.id)
          .eq("status", "installed"),
        supabase
          .from("activity_posts")
          .select("id", { count: "exact", head: true })
          .eq("car_id", car.id)
          .not("published_at", "is", null),
      ])
    : [{ count: 0 }, { count: 0 }];

  const identity = car
    ? [car.year, car.make, car.model].filter(Boolean).join(" ")
    : "";
  // The card renderer fetches the photo from our server, so only our own
  // public storage is ever a destination (N55): a cover URL written straight
  // into the database can't aim that fetch anywhere else.
  const coverSrc = car?.is_public ? ogImageSource(car.cover_image_url) : null;

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
        {coverSrc && (
          <img
            src={coverSrc}
            alt=""
            style={{ width: 660, height: 630, objectFit: "cover" }}
          />
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
            {identity && (
              <div
                style={{
                  display: "flex",
                  fontSize: 20,
                  letterSpacing: 3,
                  textTransform: "uppercase",
                  color: "#a3a6ae",
                }}
              >
                {identity}
              </div>
            )}
            <div
              style={{
                display: "flex",
                fontSize: 52,
                fontWeight: 700,
                lineHeight: 1.1,
                letterSpacing: -1,
              }}
            >
              {car?.name ?? "A build on DRVN"}
            </div>
            <div style={{ display: "flex", gap: 28, fontSize: 22, color: "#a3a6ae" }}>
              {(modCount ?? 0) > 0 && <span>{modCount} mod{modCount === 1 ? "" : "s"}</span>}
              {(updateCount ?? 0) > 0 && <span>{updateCount} update{updateCount === 1 ? "" : "s"}</span>}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 20, color: "#a3a6ae" }}>
            The build, and the parts off it.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
