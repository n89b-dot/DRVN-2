import { ImageResponse } from "next/og";

import { ogImageSource } from "@/lib/media-url";
import { postHeadline } from "@/lib/activity/headline";
import { createPublicClient } from "@/lib/supabase/public";

export const alt = "An update on DRVN";
export const size = { width: 1200, height: 630 };
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

  // Only our own public storage is a fetch destination for the card (N55).
  const imageSrc = ogImageSource(image?.url);

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
        {imageSrc && (
          <img src={imageSrc} alt="" style={{ width: 660, height: 630, objectFit: "cover" }} />
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
              Update
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
              {headline}
            </div>
            {byline && <div style={{ display: "flex", fontSize: 22, color: "#a3a6ae" }}>{byline}</div>}
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
