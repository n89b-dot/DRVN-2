import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar, EmbeddedVideo, Icon, NarrowColumn } from "@/components/ui";
import { ActivityBlocksView } from "@/features/activity/blocks-view";
import { ActivityEngagement, type CommentView, type ReactionState } from "@/features/activity/engagement";
import { ACTIVITY_EMOJIS } from "@/features/activity/constants";
import { createClient } from "@/lib/supabase/server";

import { ActivityGallery } from "./activity-gallery";
import { MarkRemovedOffer } from "./mark-removed-offer";

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

  // Mod blocks reference real build entries — resolve where each should link
  // (a live listing when the part is for sale, the build sheet otherwise).
  const modIds = blocks.flatMap((b) => (b.type === "mod" && b.modItemId ? [b.modItemId] : []));
  const modLinks: Record<string, { href: string; label: string }> = {};
  // Parts this update says came off, that the sheet still has fitted (A-3).
  const stillFitted: { id: string; label: string }[] = [];
  if (modIds.length) {
    // Unfiltered by status on purpose: an update that says "took the old
    // manifold off" has to keep naming and linking that part afterwards.
    const { data: mods } = await supabase
      .from("mod_items")
      .select("id, linked_listing_id, status, brand, product, raw_text")
      .in("id", modIds)
      .eq("car_id", car.id);
    const listingIds = (mods ?? []).flatMap((m) => (m.linked_listing_id ? [m.linked_listing_id] : []));
    const { data: listings } = listingIds.length
      ? await supabase.from("listings").select("id, status").in("id", listingIds)
      : { data: [] };
    for (const mod of mods ?? []) {
      const listing = (listings ?? []).find((l) => l.id === mod.linked_listing_id);
      modLinks[mod.id] =
        listing?.status === "active"
          ? { href: `/listings/${listing.id}`, label: "For sale →" }
          : { href: `/cars/${slug}?view=build`, label: "View build entry →" };
      const saysItCameOff = blocks.some(
        (b) =>
          b.type === "mod" &&
          b.modItemId === mod.id &&
          (b.action === "removed" || b.action === "replaced")
      );
      if (saysItCameOff && mod.status === "installed") {
        stillFitted.push({
          id: mod.id,
          label:
            [mod.brand, mod.product].filter(Boolean).join(" ") || mod.raw_text || "That part",
        });
      }
    }
  }

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
        className="jumplink inline-flex items-center gap-1.5"
      >
        <Icon name="back" className="h-4 w-4" /> {car.name}
      </Link>

      <header className="pagehead !pt-6">
        <span className="microlabel">
          Build update
          {/* Owner controls: the public post page previously offered none, so a
              published update could not be edited from where you were reading it. */}
          {user?.id === car.owner_id && (
            <>
              {" · "}
              <Link
                href={`/garage/${car.id}/update/${post.id}/edit`}
                className="hover:text-live"
              >
                edit this update →
              </Link>
            </>
          )}
        </span>
        <div className="mt-2 flex items-center gap-3">
          <Avatar size="sm" initials={initials} />
          <h1 className="!mt-0 !text-[clamp(22px,3vw,32px)]">{post.title}</h1>
        </div>
      </header>
      {post.intro && <p className="max-w-[62ch] text-body leading-7">{post.intro}</p>}

      {gallery.length > 0 && (
        <ActivityGallery
          images={gallery.map((img) => ({ url: img.url, alt: img.alt }))}
          title={post.title}
        />
      )}

      {blocks.length > 0 && (
        <ActivityBlocksView
          blocks={blocks}
          title={post.title}
          modLinks={modLinks}
          className="mt-8 grid gap-6"
        />
      )}

      {post.video_url && (
        <div className="mt-8">
          <EmbeddedVideo url={post.video_url} />
        </div>
      )}

      {user?.id === car.owner_id && stillFitted.length > 0 && (
        <MarkRemovedOffer carId={car.id} mods={stillFitted} />
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
