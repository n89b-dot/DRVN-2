import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { NarrowColumn, ObjectRow, PageHead, ShareButton } from "@/components/ui";
import { SaveButton } from "@/features/social/buttons";
import { ReportButton } from "@/features/moderation/report-button";
import { ActivityGallery } from "@/features/activity/activity-gallery";
import { ActivityBlocksView } from "@/features/activity/blocks-view";
import { DeletePostButton } from "@/features/activity/delete-post-button";
import { ActivityEngagement } from "@/features/activity/engagement";
import { loadPostEngagement } from "@/features/activity/load-engagement";
import { ListingCartButton } from "@/features/commerce/quick-commerce";
import { normalizeBlocks, postLead } from "@/lib/activity-blocks";
import { pageHeadline, postHeadline } from "@/lib/activity/headline";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { getPublicPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ postId: string }>;
}): Promise<Metadata> {
  const { postId } = await params;
  const supabase = await createClient();
  const { data: post } = await supabase
    .from("activity_posts")
    .select("id, title, intro, body, published_at")
    .eq("id", postId)
    .not("published_at", "is", null)
    .maybeSingle();

  if (!post) return { title: "Update not found - DRVN" };

  const headline = postHeadline(post);
  return {
    title: `${headline} - DRVN`,
    description: post.intro?.slice(0, 155) ?? `${headline} — an update on DRVN.`,
    // The card itself is opengraph-image.tsx next door.
    openGraph: { title: headline, type: "article" },
  };
}

/**
 * A post that isn't about a car (W-5).
 *
 * Its own route rather than a second rendering of the car-sheet page,
 * because the two genuinely differ: there is no build to sit inside, no
 * breadcrumb back to a car, and the parts it tagged ARE the subject rather
 * than a footnote under the photos.
 *
 * A post that DOES have a car is redirected to its car URL. One canonical
 * address per post — two would split the share links and the analytics, and
 * every link already in the world points at the car one.
 */
export default async function PostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const supabase = await createClient();
  const user = await getViewer();

  const { data: post } = await supabase
    .from("activity_posts")
    .select("id, title, intro, body, car_id, author_id, published_at, cars(slug)")
    .eq("id", postId)
    .not("published_at", "is", null)
    .maybeSingle();
  if (!post) notFound();

  const car = post.cars as unknown as { slug: string } | null;
  if (car?.slug) redirect(`/cars/${car.slug}/activity/${post.id}`);

  const [{ data: author }, { data: images }, { data: taggedRows }, { reactions, comments }, { data: saveRow }] = await Promise.all([
    supabase.from("profiles").select("display_name, username, avatar_url").eq("id", post.author_id).maybeSingle(),
    supabase.from("activity_images").select("url, alt, position").eq("post_id", post.id).order("position"),
    supabase.from("activity_post_listings").select("listing_id, position").eq("post_id", post.id).order("position"),
    // A post without a car is still a post: people react to it and talk
    // under it. 200000 made that possible; this page had never asked.
    loadPostEngagement(supabase, post.id, user?.id ?? null),
    user
      ? supabase
          .from("saves")
          .select("target_id")
          .eq("user_id", user.id)
          .eq("target_type", "post")
          .eq("target_id", post.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const taggedIds = (taggedRows ?? []).map((r) => r.listing_id);
  const { data: tagged } = taggedIds.length
    ? await supabase
        .from("listings")
        .select("id, title, price_cents, status, seller_id")
        .in("id", taggedIds)
    : { data: [] };
  const { data: covers } = taggedIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", taggedIds)
        .order("position")
    : { data: [] };
  const coverFor = new Map<string, string>();
  for (const img of covers ?? []) if (!coverFor.has(img.listing_id)) coverFor.set(img.listing_id, img.url);
  // In the order the author tagged them, not the order the database felt like.
  const parts = taggedIds.flatMap((id) => (tagged ?? []).filter((l) => l.id === id && l.status !== "draft"));
  const authorName = author?.display_name ?? (author?.username ? `@${author.username}` : "the author");

  // The caption is the heading OR the first line of the body — not both.
  const { headline, blocks } = pageHeadline(post, normalizeBlocks(post.body));
  // The gallery shows only photos the blocks below don't already show.
  const gallery = postLead(post.intro, images ?? [], blocks).images;

  return (
    <NarrowColumn>
      <PageHead
        className="!pt-6"
        eyebrow="Update"
        title={headline}
        sub={author?.username ? `@${author.username}` : undefined}
        reveal={false}
      />
      {/* Save and Share live on the feed card too; someone who opened the
          post from a link can keep it or pass it on from here. */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SaveButton
          targetType="post"
          targetId={post.id}
          path={`/posts/${post.id}`}
          initialSaved={Boolean(saveRow)}
          isLoggedIn={Boolean(user)}
          itemLabel="this update"
        />
        <ShareButton url={`/posts/${post.id}`} title={headline} />
      </div>

      {gallery.length > 0 && (
        <ActivityGallery
          images={gallery.map((img) => ({ url: img.url, alt: img.alt }))}
          title={headline}
        />
      )}

      {blocks.length > 0 && (
        <ActivityBlocksView blocks={blocks} title={headline} className="mt-8 grid gap-6" />
      )}

      {parts.length > 0 && (
        <section className="deck mt-8" aria-label="Parts in this update">
          <div className="rowlist">
            {parts.map((part) => (
              <ObjectRow
                key={part.id}
                href={`/listings/${part.id}`}
                media={{ src: coverFor.get(part.id), alt: "" }}
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

      <ActivityEngagement
        postId={post.id}
        path={`/posts/${post.id}`}
        authorName={authorName}
        isLoggedIn={Boolean(user)}
        reactions={reactions}
        comments={comments}
      />

      {user?.id === post.author_id && (
        <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-[color:var(--rule-soft)] pt-4">
          <Link href={`/garage/no-car/update/${post.id}/edit`} className="jumplink">
            Edit this post →
          </Link>
          <DeletePostButton postId={post.id} />
        </div>
      )}

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
