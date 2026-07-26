import Link from "next/link";
import { notFound } from "next/navigation";

import { Avatar, ListingCard, Media, SectionLabel } from "@/components/ui";
import { SaveButton } from "@/features/social/buttons";
import { conditionLabel, formatPrice, getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { PurchaseActions } from "./purchase-actions";
import { QASection, type QAItem } from "./qa-section";

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: listing } = await supabase.from("listings").select("*").eq("id", id).single();
  if (!listing) notFound();

  const [{ data: seller }, { data: images }, { data: sourceCar }, { data: moreFromSeller }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("username, display_name, location")
        .eq("id", listing.seller_id)
        .single(),
      supabase.from("listing_images").select("*").eq("listing_id", id).order("position"),
      listing.source_car_id
        ? supabase
            .from("cars")
            .select("slug, name, is_public")
            .eq("id", listing.source_car_id)
            .single()
        : Promise.resolve({ data: null }),
      supabase
        .from("listings")
        .select("id, title, price_cents, condition, location")
        .eq("seller_id", listing.seller_id)
        .eq("status", "active")
        .neq("id", id)
        .limit(4),
    ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isSaved = false;
  if (user) {
    const { data: save } = await supabase
      .from("saves")
      .select("target_id")
      .eq("user_id", user.id)
      .eq("target_type", "listing")
      .eq("target_id", id)
      .maybeSingle();
    isSaved = Boolean(save);
  }

  // Seller rating + Q&A
  const [{ data: reviews }, { data: questions }] = await Promise.all([
    supabase.from("reviews").select("rating").eq("reviewee_id", listing.seller_id),
    supabase
      .from("listing_questions")
      .select("id, parent_id, body, created_at, author_id")
      .eq("listing_id", id)
      .order("created_at"),
  ]);
  const avgRating = (reviews ?? []).length
    ? (reviews!.reduce((s, r) => s + r.rating, 0) / reviews!.length).toFixed(1)
    : null;

  const qaAuthorIds = [...new Set((questions ?? []).map((q) => q.author_id))];
  const { data: qaAuthors } = qaAuthorIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", qaAuthorIds)
    : { data: [] };
  const qaName = (aid: string) => {
    const a = (qaAuthors ?? []).find((x) => x.id === aid);
    return a?.display_name ?? (a?.username ? `@${a.username}` : "User");
  };
  const qaItems: QAItem[] = (questions ?? []).map((q) => ({
    id: q.id,
    parent_id: q.parent_id,
    body: q.body,
    created_at: q.created_at,
    authorName: qaName(q.author_id),
    isSeller: q.author_id === listing.seller_id,
  }));

  const category = getCategory(listing.category);
  const sellerInitials = (seller?.display_name ?? seller?.username ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  // Covers for "more from seller"
  const moreIds = (moreFromSeller ?? []).map((l) => l.id);
  const { data: moreImages } = moreIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", moreIds)
        .order("position")
    : { data: [] };
  const moreCover = new Map<string, string>();
  for (const img of moreImages ?? []) {
    if (!moreCover.has(img.listing_id)) moreCover.set(img.listing_id, img.url);
  }

  return (
    <div className="mx-auto w-full max-w-[1100px] px-5 py-10 md:py-14">
      <Link
        href={category ? `/marketplace/${category.slug}` : "/marketplace"}
        className="text-sm text-text-muted transition hover:text-text-secondary"
      >
        ← {category?.label ?? "Marketplace"}
      </Link>

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_360px]">
        {/* Left: gallery + description */}
        <div>
          {(images ?? []).length > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {(images ?? []).map((image, index) => (
                <Media
                  key={image.id}
                  src={image.url}
                  alt={image.alt ?? listing.title}
                  className={`${index === 0 ? "col-span-2 h-80" : "h-40"} w-full rounded-card`}
                />
              ))}
            </div>
          ) : (
            <Media alt={listing.title} className="h-80 w-full rounded-card" />
          )}

          {listing.status !== "active" && (
            <p className="mt-4 inline-block rounded-pill bg-raised px-4 py-1.5 text-sm font-semibold text-text-muted">
              This listing is {listing.status}.
            </p>
          )}

          {listing.description && (
            <div className="mt-8">
              <SectionLabel>Description</SectionLabel>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                {listing.description}
              </p>
            </div>
          )}

          {listing.compatibility_notes && (
            <div className="mt-8 rounded-card border border-border bg-surface p-5">
              <SectionLabel>Compatibility — notes from the seller</SectionLabel>
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-text-secondary">
                {listing.compatibility_notes}
              </p>
              <p className="mt-3 text-xs text-text-muted">
                Seller-provided notes, not verified by DRVN. Always confirm fitment for your car.
              </p>
            </div>
          )}

          <QASection
            listingId={listing.id}
            items={qaItems}
            isLoggedIn={Boolean(user)}
            isSeller={user?.id === listing.seller_id}
          />
        </div>

        {/* Right: purchase card */}
        <div className="flex flex-col gap-4 self-start">
          <div className="rounded-card border border-border bg-surface p-6">
            <h1 className="text-lg font-bold text-text-primary">{listing.title}</h1>
            <p className="mt-3 text-3xl font-bold text-text-primary">
              {formatPrice(listing.price_cents)}
            </p>
            <p className="mt-1 text-sm text-text-muted">
              {[conditionLabel(listing.condition), listing.location].filter(Boolean).join(" · ")}
            </p>

            <PurchaseActions
              listingId={listing.id}
              isLoggedIn={Boolean(user)}
              isOwn={user?.id === listing.seller_id}
              isActive={listing.status === "active"}
            />
            {user?.id !== listing.seller_id && (
              <div className="mt-3 flex justify-center">
                <SaveButton
                  targetType="listing"
                  targetId={listing.id}
                  path={`/listings/${listing.id}`}
                  initialSaved={isSaved}
                  isLoggedIn={Boolean(user)}
                />
              </div>
            )}

            {seller && (
              <Link
                href={`/u/${seller.username}`}
                className="mt-5 flex items-center gap-3 border-t border-border pt-5 transition hover:opacity-80"
              >
                <Avatar size="h-10 w-10" initials={sellerInitials} />
                <span>
                  <span className="block text-sm font-semibold text-text-primary">
                    {seller.display_name ?? `@${seller.username}`}
                  </span>
                  <span className="block text-xs text-text-muted">
                    {avgRating
                      ? `★ ${avgRating} · ${(reviews ?? []).length} review${(reviews ?? []).length === 1 ? "" : "s"}`
                      : seller.location ?? "Seller on DRVN"}
                  </span>
                </span>
              </Link>
            )}
          </div>

          {sourceCar?.is_public && (
            <Link
              href={`/cars/${sourceCar.slug}`}
              className="flex items-center justify-between rounded-card border border-border bg-surface px-5 py-4 transition hover:border-text-muted"
            >
              <span className="text-sm text-text-secondary">
                Came off <span className="font-semibold text-text-primary">{sourceCar.name}</span>
              </span>
              <span className="text-text-muted">→</span>
            </Link>
          )}
        </div>
      </div>

      <SimilarInCategory
        category={listing.category}
        excludeId={listing.id}
        supabase={supabase}
      />

      {(moreFromSeller ?? []).length > 0 && (
        <div className="mt-14">
          <SectionLabel>More from this seller</SectionLabel>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(moreFromSeller ?? []).map((item) => (
              <ListingCard
                key={item.id}
                listing={{
                  id: item.id,
                  title: item.title,
                  price_cents: item.price_cents,
                  condition: item.condition,
                  location: item.location,
                  cover_url: moreCover.get(item.id) ?? null,
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function SimilarInCategory({
  category,
  excludeId,
  supabase,
}: {
  category: string;
  excludeId: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data: similar } = await supabase
    .from("listings")
    .select("id, title, price_cents, condition, location")
    .eq("status", "active")
    .eq("category", category)
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(4);

  if (!similar?.length) return null;

  const ids = similar.map((l) => l.id);
  const { data: images } = await supabase
    .from("listing_images")
    .select("listing_id, url, position")
    .in("listing_id", ids)
    .order("position");
  const cover = new Map<string, string>();
  for (const img of images ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  return (
    <div className="mt-14">
      <SectionLabel>Similar in this category</SectionLabel>
      <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {similar.map((item) => (
          <ListingCard
            key={item.id}
            listing={{
              id: item.id,
              title: item.title,
              price_cents: item.price_cents,
              condition: item.condition,
              location: item.location,
              cover_url: cover.get(item.id) ?? null,
            }}
          />
        ))}
      </div>
    </div>
  );
}
