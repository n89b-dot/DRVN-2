import { ImageResponse } from "next/og";

import { postHeadline } from "@/lib/activity/headline";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "Build update on DRVN";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The shareable update card (§AB) — title, car identity, first photo. */
export default async function UpdateCard({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const supabase = createPublicClient({ maxAge: 300, kinds: ["cars", "posts", "profiles"] });
  const { data: car } = await supabase
    .from("cars")
    .select("id, name, make, model, year, is_public")
    .eq("slug", slug)
    .maybeSingle();
  const { data: post } = car
    ? await supabase
        .from("activity_posts")
        .select("id, title, intro, body, published_at")
        .eq("id", postId)
        .eq("car_id", car.id)
        .maybeSingle()
    : { data: null };
  const { data: image } =
    post && car?.is_public
      ? await supabase
          .from("activity_images")
          .select("url")
          .eq("post_id", post.id)
          .order("position")
          .limit(1)
          .maybeSingle()
      : { data: null };

  const identity = car ? [car.year, car.make, car.model].filter(Boolean).join(" ") : "";

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
        {image?.url && (
          <img src={image.url} alt="" style={{ width: 660, height: 630, objectFit: "cover" }} />
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
                fontSize: 18,
                letterSpacing: 3,
                textTransform: "uppercase",
                color: "#a3a6ae",
              }}
            >
              Build update{identity ? ` · ${identity}` : ""}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: 48,
                fontWeight: 700,
                lineHeight: 1.15,
                letterSpacing: -1,
              }}
            >
              {post ? postHeadline(post) : "A build update on DRVN"}
            </div>
            {car?.name && (
              <div style={{ display: "flex", fontSize: 22, color: "#a3a6ae" }}>{car.name}</div>
            )}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: "#a3a6ae" }}>
            Follow the build on DRVN.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
