import { ImageResponse } from "next/og";

import { postHeadline } from "@/lib/activity/headline";
import { OG_COLORS, OG_SIZE, OgFrame, OgMicrolabel } from "@/lib/og/card";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "An update on DRVN";
export const size = OG_SIZE;
export const contentType = "image/png";

/**
 * The share card for a post with no car (W-5).
 *
 * The car version of this card leads on the build's identity. This one has
 * none, so it leads on the photo and the person — which is the whole of what
 * a carless post is — and falls back to the author's handle where the other
 * puts "2015 Ferrari 458".
 */
export default async function PostCard({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const supabase = createPublicClient({ maxAge: 300, kinds: ["cars", "posts", "profiles"] });

  const { data: post } = await supabase
    .from("activity_posts")
    .select("id, title, intro, body, car_id, author_id, published_at")
    .eq("id", postId)
    .not("published_at", "is", null)
    .is("car_id", null)
    .maybeSingle();

  const [{ data: image }, { data: author }] = post
    ? await Promise.all([
        supabase
          .from("activity_images")
          .select("url")
          .eq("post_id", post.id)
          .order("position")
          .limit(1)
          .maybeSingle(),
        supabase.from("profiles").select("display_name, username").eq("id", post.author_id).maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  const headline = post ? postHeadline(post) : "An update on DRVN";
  const byline = author?.username ? `@${author.username}` : (author?.display_name ?? "");

  return new ImageResponse(
    (
      <OgFrame photo={image?.url} foot="Follow the build on DRVN.">
        <OgMicrolabel>Update</OgMicrolabel>
        <div
          style={{
            display: "flex",
            fontSize: 48,
            fontWeight: 700,
            lineHeight: 1.15,
            letterSpacing: -1,
          }}
        >
          {headline}
        </div>
        {byline && <div style={{ display: "flex", fontSize: 22, color: OG_COLORS.dim }}>{byline}</div>}
      </OgFrame>
    ),
    size,
  );
}
