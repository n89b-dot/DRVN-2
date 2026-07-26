import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar, EmbeddedVideo, Icon, Media, NarrowColumn } from "@/components/ui";
import { ActivityEngagement, type CommentView, type ReactionState } from "@/features/activity/engagement";
import { ACTIVITY_EMOJIS } from "@/features/activity/constants";
import { createClient } from "@/lib/supabase/server";

function initialsFor(name: string) {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function relative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

import { normalizeBlocks } from "@/lib/activity-blocks";

export default async function ActivityDetailPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const supabase = await createClient();

  const { data: car } = await supabase
    .from("cars")
    .select("id, name, slug, owner_id")
    .eq("slug", slug)
    .single();
  if (!car) notFound();

  const { data: post } = await supabase
    .from("activity_posts")
    .select("*")
    .eq("id", postId)
    .eq("car_id", car.id)
    .single();
  if (!post) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: owner }, { data: images }, { data: reactionRows }, { data: commentRows }] =
    await Promise.all([
      supabase.from("profiles").select("display_name, username").eq("id", car.owner_id).single(),
      supabase.from("activity_images").select("url, alt, position").eq("post_id", postId).order("position"),
      supabase.from("activity_reactions").select("emoji, user_id").eq("post_id", postId),
      supabase
        .from("activity_comments")
        .select("id, author_id, body, created_at")
        .eq("post_id", postId)
        .order("created_at"),
    ]);

  const reactions: ReactionState = Object.fromEntries(
    ACTIVITY_EMOJIS.map((emoji) => {
      const rows = (reactionRows ?? []).filter((r) => r.emoji === emoji);
      return [emoji, { count: rows.length, reacted: user ? rows.some((r) => r.user_id === user.id) : false }];
    })
  );

  const commentAuthorIds = [...new Set((commentRows ?? []).map((c) => c.author_id))];
  const { data: commenters } = commentAuthorIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", commentAuthorIds)
    : { data: [] };
  const commenterName = (id: string) => {
    const p = (commenters ?? []).find((x) => x.id === id);
    return p?.display_name ?? (p?.username ? `@${p.username}` : "User");
  };
  const comments: CommentView[] = (commentRows ?? []).map((c) => ({
    id: c.id,
    authorName: commenterName(c.author_id),
    initials: initialsFor(commenterName(c.author_id)),
    body: c.body,
    date: relative(c.created_at),
  }));

  const blocks = normalizeBlocks(post.body);
  const gallery = images ?? [];
  const ownerName = owner?.display_name ?? (owner?.username ? `@${owner.username}` : "");
  const initials = (owner?.display_name ?? owner?.username ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <NarrowColumn>
      <Link
        href={`/cars/${slug}`}
        className="flex items-center gap-1.5 text-sm font-medium text-text-muted transition hover:text-text-secondary"
      >
        <Icon name="back" className="h-4 w-4" /> {car.name}
      </Link>

      <header className="mt-6 flex items-center gap-3">
        <Avatar size="h-10 w-10" initials={initials} />
        <h1 className="text-xl font-semibold tracking-[-0.01em] text-text-primary">{post.title}</h1>
      </header>
      {post.intro && <p className="mt-4 text-sm leading-7 text-text-secondary">{post.intro}</p>}

      {gallery.length > 0 && (
        <div className="mt-6 grid grid-cols-[1fr_0.7fr] gap-3">
          <Media
            src={gallery[0].url}
            alt={gallery[0].alt ?? post.title}
            className="h-56 rounded-2xl border border-white/10"
          />
          {gallery.length > 1 && (
            <div className="grid gap-3">
              {gallery.slice(1, 3).map((img, i) => (
                <Media
                  key={i}
                  src={img.url}
                  alt={img.alt ?? post.title}
                  className="h-[106px] rounded-2xl border border-white/10"
                />
              ))}
            </div>
          )}
        </div>
      )}

      {blocks.length > 0 && (
        <div className="mt-8 grid gap-6">
          {blocks.map((block, index) => {
            if (block.type === "text") {
              return block.style === "heading" ? (
                <h2 key={index} className="text-base font-semibold text-text-primary">
                  {block.text}
                </h2>
              ) : (
                <p key={index} className="whitespace-pre-line text-sm leading-7 text-text-secondary">
                  {block.text}
                </p>
              );
            }
            if (block.type === "images") {
              return (
                <div key={index} className={`grid gap-3 ${block.urls.length > 1 ? "grid-cols-2" : ""}`}>
                  {block.urls.map((url, i) => (
                    <Media
                      key={i}
                      src={url}
                      alt={`${post.title} photo ${i + 1}`}
                      className={`${block.urls.length > 1 ? "h-44" : "h-64"} w-full rounded-2xl border border-white/10`}
                    />
                  ))}
                </div>
              );
            }
            return (
              <iframe
                key={index}
                src={`https://www.youtube-nocookie.com/embed/${block.videoId}`}
                title="Embedded video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="aspect-video w-full rounded-2xl border border-white/10"
              />
            );
          })}
        </div>
      )}

      {post.video_url && (
        <div className="mt-8">
          <EmbeddedVideo url={post.video_url} />
        </div>
      )}

      <ActivityEngagement
        postId={post.id}
        path={`/cars/${slug}/activity/${post.id}`}
        authorName={ownerName || "the owner"}
        isLoggedIn={Boolean(user)}
        reactions={reactions}
        comments={comments}
      />
    </NarrowColumn>
  );
}
