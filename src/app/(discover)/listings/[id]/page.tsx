import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, ListingCard, Media } from "@/components/ui";
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

  const gallery = images ?? [];

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          <Link href="/marketplace" className="hover:text-live">
            Market
          </Link>
          {category && (
            <>
              {" / "}
              <Link href={`/marketplace/${category.slug}`} className="hover:text-live">
                {category.label}
              </Link>
            </>
          )}
          {" · part sheet"}
        </span>
        <h1>{listing.title}</h1>
      </Rv>

      <div className="deck deck--two">
        {/* Left: media + measured facts + Q&A */}
        <div className="min-w-0">
          {gallery.length > 0 ? (
            <>
              <Rv className="hero-media">
                <Media src={gallery[0].url} alt={gallery[0].alt ?? listing.title} className="h-full w-full" />
              </Rv>
              {gallery.length > 1 && (
                <div className="thumbs">
                  {gallery.slice(1).map((image) => (
                    <span key={image.id} className="thumb">
                      <Media src={image.url} alt={image.alt ?? listing.title} className="h-full w-full" />
                    </span>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="undrawn undrawn--hero">
              <span className="undrawn__mark" aria-hidden="true">
                ✎
              </span>
              <h3>No photo on the sheet</h3>
              <p>The listing is real — the keeper hasn&apos;t photographed it yet. Ask below.</p>
            </div>
          )}

          {listing.status !== "active" && (
            <p className="mt-4">
              <span className="chip chip--spent">This listing is {listing.status}</span>
            </p>
          )}

          {listing.description && (
            <div className="mt-8">
              <span className="microlabel microlabel--ink">On the sheet</span>
              <p className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">
                {listing.description}
              </p>
            </div>
          )}

          {listing.compatibility_notes && (
            <div className="alert mt-8">
              <span className="alert__ico" aria-hidden="true">
                ⚠
              </span>
              <h4>Fitment — the keeper&apos;s words</h4>
              <p className="whitespace-pre-line">{listing.compatibility_notes}</p>
              <p className="spec-note col-span-full mt-2">
                <b>Seller-stated.</b> Not verified by DRVN — always confirm fitment for your car.
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

        {/* Right: asking plate + off-this-car */}
        <div className="flex flex-col gap-4 self-start">
          <Rv className="tile" stagger={1}>
            <span className="microlabel">Asking</span>
            <p className="num-giant mt-1">{formatPrice(listing.price_cents)}</p>
            <p className="kv mt-2 text-dim">
              {[conditionLabel(listing.condition), listing.location].filter(Boolean).join(" · ")}
            </p>

            <PurchaseActions
              listingId={listing.id}
              isLoggedIn={Boolean(user)}
              isOwn={user?.id === listing.seller_id}
              isActive={listing.status === "active"}
            />
            {user?.id !== listing.seller_id && (
              <div className="mt-3">
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
              <Link href={`/u/${seller.username}`} className="mt-5 flex items-center gap-3 border-t border-[color:var(--rule-soft)] pt-5">
                <span className="monogram monogram--sm">{sellerInitials}</span>
                <span className="min-w-0">
                  <span className="order__name block">{seller.display_name ?? `@${seller.username}`}</span>
                  <span className="order__meta block">
                    {avgRating
                      ? `${avgRating} ★ · ${(reviews ?? []).length} review${(reviews ?? []).length === 1 ? "" : "s"}`
                      : (seller.location ?? "Keeper on DRVN")}
                  </span>
                </span>
              </Link>
            )}
          </Rv>

          {sourceCar?.is_public && (
            <Rv className="tile tile--deep" stagger={2}>
              <div className="tile__head">
                <span className="microlabel microlabel--ink">Off this car</span>
                <span className="chip chip--live">Sheet is live</span>
              </div>
              <Link href={`/cars/${sourceCar.slug}`} className="order !bg-transparent !p-0">
                <span>
                  <span className="order__name block">{sourceCar.name}</span>
                  <span className="order__meta block">the part&apos;s whole history rides with it →</span>
                </span>
              </Link>
            </Rv>
          )}
        </div>
      </div>

      <SimilarInCategory category={listing.category} excludeId={listing.id} supabase={supabase} />

      {(moreFromSeller ?? []).length > 0 && (
        <section className="deck">
          <div>
            <div className="tile__head">
              <span className="microlabel microlabel--ink">More from this keeper</span>
            </div>
            <div className="mkt">
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
        </section>
      )}

      <Foot
        left="DRVN / Livesheet — part sheet"
        right={<Link href="/marketplace">← Back to the market</Link>}
      />
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
    <section className="deck">
      <div>
        <div className="tile__head">
          <span className="microlabel microlabel--ink">Similar in this category</span>
        </div>
        <div className="mkt">
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
    </section>
  );
}
