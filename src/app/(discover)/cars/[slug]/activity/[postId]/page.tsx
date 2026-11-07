import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";

import { Avatar, EmbeddedVideo, Icon, Media, NarrowColumn, ObjectRow, ShareButton } from "@/components/ui";
import { SaveButton } from "@/features/social/buttons";
import { ReportButton } from "@/features/moderation/report-button";
import { ActivityBlocksView } from "@/features/activity/blocks-view";
import { ActivityEngagement } from "@/features/activity/engagement";
import { loadPostEngagement, REPLIES_PARAM, replyPageLinks } from "@/features/activity/load-engagement";
import { decodePageCursor } from "@/lib/page-cursor";
import { getPublicPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

import { ActivityGallery } from "@/features/activity/activity-gallery";
import { MarkRemovedOffer } from "./mark-removed-offer";

import { normalizeBlocks, postLead } from "@/lib/activity-blocks";
import { pageHeadline, postHeadline } from "@/lib/activity/headline";
import { ListingCartButton } from "@/features/commerce/quick-commerce";
import { formatPrice } from "@/lib/marketplace/taxonomy";

/** The car and the post, read once per request and shared by the metadata
 *  and the page. React's cache is per render, never shared between users —
 *  RLS decides what this viewer may read (a private build's posts only
 *  reach its owner). */
const loadCar = cache(async (slug: string) => {
  const supabase = await createClient();
  return supabase
    .from("cars")
    .select("id, name, slug, owner_id, year, make, model, is_public")
    .eq("slug", slug)
    .single();
});
const loadPost = cache(async (carId: string, postId: string) => {
  const supabase = await createClient();
  return supabase.from("activity_posts").select("*").eq("id", postId).eq("car_id", carId).single();
});

/**
 * Per-post metadata, as /posts/[postId] and listings have. The share card
 * itself is opengraph-image.tsx next door (the cover photo with the title),
 * so no `images` here — an explicit array would override it. A post on a
 * private build, or an unpublished one, is noindexed and says nothing
 * beyond a generic title.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}): Promise<Metadata> {
  const { slug, postId } = await params;
  const { data: car } = await loadCar(slug);
  const { data: post } = car ? await loadPost(car.id, postId) : { data: null };
  if (!car || !post) return { title: "Update not found - DRVN" };

  if (!car.is_public || !post.published_at) {
    return { title: "Build update - DRVN", robots: { index: false, follow: false } };
  }

  const headline = postHeadline(post);
  const path = `/cars/${slug}/activity/${post.id}`;
  const description = post.intro?.trim().slice(0, 155) || `${headline} — a build update on ${car.name}, on DRVN.`;
  return {
    title: `${headline} · ${car.name} - DRVN`,
    description,
    alternates: { canonical: path },
    openGraph: { title: headline, description, url: path, type: "article" },
    twitter: { card: "summary_large_image", title: headline, description },
  };
}

export default async function ActivityDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; postId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug, postId } = await params;
  const repliesBefore = decodePageCursor((await searchParams)[REPLIES_PARAM]);
  const supabase = await createClient();

  const { data: car } = await loadCar(slug);
  if (!car) notFound();

  const { data: post } = await loadPost(car.id, postId);
  if (!post) notFound();

  const user = await getViewer();

  const [{ data: owner }, { data: images }, engagement, { data: saveRow }] = await Promise.all([
    supabase.from("profiles").select("display_name, username, avatar_url").eq("id", car.owner_id).single(),
    supabase.from("activity_images").select("url, alt, position").eq("post_id", postId).order("position"),
    loadPostEngagement(supabase, postId, user?.id ?? null, { before: repliesBefore }),
    user
      ? supabase
          .from("saves")
          .select("target_id")
          .eq("user_id", user.id)
          .eq("target_type", "post")
          .eq("target_id", postId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const path = `/cars/${slug}/activity/${post.id}`;

  // W-1: a quick post has no title; the heading falls back to the
  // author's own first line — and then that line isn't said again below it.
  const { headline, blocks } = pageHeadline(post, normalizeBlocks(post.body));

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

  // W-4: the parts this update tagged, read from the mirror table so the
  // post keeps its own record of what it was about.
  const { data: taggedRows } = await supabase
    .from("activity_post_listings")
    .select("listing_id, position")
    .eq("post_id", postId)
    .order("position");
  const taggedIds = (taggedRows ?? []).map((r) => r.listing_id);
  const { data: taggedListings } = taggedIds.length
    ? await supabase
        .from("listings")
        .select("id, title, price_cents, status, seller_id")
        .in("id", taggedIds)
    : { data: [] };
  const { data: taggedCovers } = taggedIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", taggedIds)
        .order("position")
    : { data: [] };
  const coverFor = new Map<string, string>();
  for (const img of taggedCovers ?? []) {
    if (!coverFor.has(img.listing_id)) coverFor.set(img.listing_id, img.url);
  }
  const taggedParts = taggedIds
    .flatMap((id) => {
      const listing = (taggedListings ?? []).find((l) => l.id === id);
      return listing ? [{ ...listing, cover: coverFor.get(id) ?? null }] : [];
    })
    .filter((l) => l.status !== "draft");

  // Only what the blocks below don't already say (the editor writes both).
  const lead = postLead(post.intro, images ?? [], blocks);
  const gallery = lead.images;
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
        className="jumplink inline-flex items-center gap-2"
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
        <h1 className="!text-[clamp(22px,3vw,32px)]">{headline}</h1>
        {/* Whose update, when, and on which car — the car-centred model
            leads with the car and its owner, not an initials tile. */}
        <div className="byrow">
          {owner?.username ? (
            <Link href={`/u/${owner.username}`} className="byline">
              <span className="byline__avatar">
                {owner.avatar_url ? (
                  <Media src={owner.avatar_url} alt="" className="h-full w-full" role="avatar" />
                ) : (
                  <Avatar size="sm" initials={initials} />
                )}
              </span>
              {ownerName}
            </Link>
          ) : null}
          {post.published_at && (
            <time dateTime={post.published_at} className="kv text-dim">
              {new Date(post.published_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </time>
          )}
          <Link href={`/cars/${slug}`} className="chip">
            {[car.name, [car.year, car.make, car.model].filter(Boolean).join(" ")]
              .filter(Boolean)
              .join(" · ")}
          </Link>
        </div>
        {/* Save and Share live on the feed card too; someone who opened the
            post from a link can keep it or pass it on from here. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <SaveButton
            targetType="post"
            targetId={post.id}
            path={path}
            initialSaved={Boolean(saveRow)}
            isLoggedIn={Boolean(user)}
            itemLabel="this update"
          />
          <ShareButton url={path} title={headline} />
        </div>
      </header>
      {lead.intro && <p className="max-w-[62ch] text-body leading-7">{lead.intro}</p>}

      {gallery.length > 0 && (
        <ActivityGallery
          images={gallery.map((img) => ({ url: img.url, alt: img.alt }))}
          title={headline}
        />
      )}

      {blocks.length > 0 && (
        <ActivityBlocksView
          blocks={blocks}
          title={headline}
          modLinks={modLinks}
          className="mt-8 grid gap-6"
        />
      )}

      {taggedParts.length > 0 && (
        /* W-4. A compact row per part under the photos — price and
           add-to-cart, or "Sold" once it has gone. A post that sold its
           part keeps saying so; that is the honest end of the story, and
           quietly dropping the row would make the update read oddly. */
        <section className="deck mt-8" aria-label="Parts in this update">
          <div className="rowlist">
            {taggedParts.map((part) => (
              <ObjectRow
                key={part.id}
                href={`/listings/${part.id}`}
                media={{ src: part.cover ?? undefined, alt: "" }}
                title={part.title}
                meta={part.status === "sold" ? "Sold" : formatPrice(part.price_cents)}
                state={part.status === "sold" ? "gone" : undefined}
                actions={
                  part.status === "active" && part.seller_id !== user?.id ? (
                    <ListingCartButton listingId={part.id} title={part.title} />
                  ) : undefined
                }
              />
            ))}
          </div>
        </section>
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
        reactions={engagement.reactions}
        comments={engagement.comments}
        replyCount={engagement.replyCount}
        {...replyPageLinks(path, engagement, Boolean(repliesBefore))}
      />

      {/* Anyone but the author can flag a post for review — the same quiet
          report link a listing and a profile carry. */}
      {user?.id !== post.author_id && (
        <div className="mt-8 border-t border-[color:var(--rule-soft)] pt-4">
          <ReportButton subjectType="post" subjectId={post.id} subjectLabel="this post" isLoggedIn={Boolean(user)} />
        </div>
      )}
    </NarrowColumn>
  );
}
