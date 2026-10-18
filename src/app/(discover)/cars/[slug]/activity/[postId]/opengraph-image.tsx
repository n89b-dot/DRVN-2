import { ImageResponse } from "next/og";

import { postHeadline } from "@/lib/activity/headline";
import { OG_COLORS, OG_SIZE, OgFrame, OgMicrolabel } from "@/lib/og/card";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "Build update on DRVN";
export const size = OG_SIZE;
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
      <OgFrame photo={image?.url} foot="Follow the build on DRVN.">
        <OgMicrolabel>Build update{identity ? ` · ${identity}` : ""}</OgMicrolabel>
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
          <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.dim }}>{car.name}</div>
        )}
      </OgFrame>
    ),
    size,
  );
}
