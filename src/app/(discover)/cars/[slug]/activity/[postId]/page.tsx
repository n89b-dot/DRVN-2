import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar, EmbeddedVideo, Icon, NarrowColumn, ObjectRow } from "@/components/ui";
import { ActivityBlocksView } from "@/features/activity/blocks-view";
import { ActivityEngagement } from "@/features/activity/engagement";
import { loadPostEngagement } from "@/features/activity/load-engagement";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

import { ActivityGallery } from "@/features/activity/activity-gallery";
import { MarkRemovedOffer } from "./mark-removed-offer";

import { normalizeBlocks } from "@/lib/activity-blocks";
import { pageHeadline, postHeadline } from "@/lib/activity/headline";
import { ListingCartButton } from "@/features/commerce/quick-commerce";
import { formatPrice } from "@/lib/marketplace/taxonomy";

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

  const user = await getViewer();

  const [{ data: owner }, { data: images }, { reactions, comments }] = await Promise.all([
    supabase.from("profiles").select("display_name, username").eq("id", car.owner_id).single(),
    supabase.from("activity_images").select("url, alt, position").eq("post_id", postId).order("position"),
    loadPostEngagement(supabase, postId, user?.id ?? null),
  ]);

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
          <h1 className="!mt-0 !text-[clamp(22px,3vw,32px)]">{headline}</h1>
        </div>
      </header>
      {post.intro && <p className="max-w-[62ch] text-body leading-7">{post.intro}</p>}

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
        reactions={reactions}
        comments={comments}
      />
    </NarrowColumn>
  );
}
