import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { NarrowColumn, ObjectRow, PageHead } from "@/components/ui";
import { ActivityBlocksView } from "@/features/activity/blocks-view";
import { ListingCartButton } from "@/features/commerce/quick-commerce";
import { normalizeBlocks } from "@/lib/activity-blocks";
import { postHeadline } from "@/lib/activity/headline";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

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

  const [{ data: author }, { data: images }, { data: taggedRows }] = await Promise.all([
    supabase.from("profiles").select("display_name, username, avatar_url").eq("id", post.author_id).maybeSingle(),
    supabase.from("activity_images").select("url, alt, position").eq("post_id", post.id).order("position"),
    supabase.from("activity_post_listings").select("listing_id, position").eq("post_id", post.id).order("position"),
  ]);

  const taggedIds = (taggedRows ?? []).map((r) => r.listing_id);
  const { data: tagged } = taggedIds.length
    ? await supabase
        .from("listings")
        .select("id, title, price_cents, status, seller_id")
        .in("id", taggedIds)
    : { data: [] };

  const headline = postHeadline(post);
  const blocks = normalizeBlocks(post.body);

  return (
    <NarrowColumn>
      <PageHead
        className="!pt-6"
        eyebrow="Update"
        title={headline}
        sub={author?.username ? `@${author.username}` : undefined}
        reveal={false}
      />

      {(images ?? []).length > 0 && (
        <div className="mt-6 grid gap-3">
          {(images ?? []).map((img) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={img.url} src={img.url} alt={img.alt ?? ""} className="w-full rounded-[var(--r)]" />
          ))}
        </div>
      )}

      {blocks.length > 0 && (
        <ActivityBlocksView blocks={blocks} title={headline} className="mt-8 grid gap-6" />
      )}

      {(tagged ?? []).length > 0 && (
        <section className="deck mt-8" aria-label="Parts in this update">
          <div className="rowlist">
            {(tagged ?? []).map((part) => (
              <ObjectRow
                key={part.id}
                href={`/listings/${part.id}`}
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
    </NarrowColumn>
  );
}
