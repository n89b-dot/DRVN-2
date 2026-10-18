import { ImageResponse } from "next/og";

import { OG_COLORS, OG_SIZE, OgFrame, OgMicrolabel } from "@/lib/og/card";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "Build on DRVN";
export const size = OG_SIZE;
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
  const showPhoto = Boolean(car?.is_public && car?.cover_image_url);

  return new ImageResponse(
    (
      <OgFrame photo={showPhoto ? car!.cover_image_url : null} foot="The build, and the parts off it.">
        {identity && <OgMicrolabel size={20}>{identity}</OgMicrolabel>}
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
        <div style={{ display: "flex", gap: 28, fontSize: 22, color: OG_COLORS.dim }}>
          {(modCount ?? 0) > 0 && <span>{modCount} mod{modCount === 1 ? "" : "s"}</span>}
          {(updateCount ?? 0) > 0 && <span>{updateCount} update{updateCount === 1 ? "" : "s"}</span>}
        </div>
      </OgFrame>
    ),
    size,
  );
}
