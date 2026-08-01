import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LiveDim, Rv } from "@/components/livesheet";
import { Foot, ListingCard, Media } from "@/components/ui";
import { SaveButton } from "@/features/social/buttons";
import { fetchGarageFitment, matchGarageFitment } from "@/lib/marketplace/fitment";
import { fetchWatchCounts } from "@/lib/marketplace/query";
import { conditionLabel, formatPrice, getCategory } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";

import { ReportButton } from "@/features/moderation/report-button";
import { PurchaseActions } from "./purchase-actions";
import { QASection, type QAItem } from "./qa-section";

/**
 * Per-listing metadata with the cover as the OG image. A part listing is the
 * unit people paste into group chats, and every one of them previously unfurled
 * as the site-wide tagline with no picture.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();

  const { data: listing } = await supabase
    .from("listings")
    .select("title, description, price_cents, condition, status, category")
    .eq("id", id)
    .maybeSingle();

  if (!listing) return { title: "Listing not found - DRVN" };

  const { data: image } = await supabase
    .from("listing_images")
    .select("url")
    .eq("listing_id", id)
    .order("position")
    .limit(1)
    .maybeSingle();

  const price = formatPrice(listing.price_cents);
  const sold = listing.status === "sold";
  const description =
    listing.description?.slice(0, 155) ??
    `${conditionLabel(listing.condition)} · ${price} · a used part off a real modified car, on DRVN.`;

  return {
    title: `${listing.title} — ${price}${sold ? " (sold)" : ""} - DRVN`,
    description,
    alternates: { canonical: `/listings/${id}` },
    // Drafts, paused and archived listings shouldn't be indexed.
    robots: ["active", "sold"].includes(listing.status)
      ? undefined
      : { index: false, follow: false },
    openGraph: {
      title: `${listing.title} — ${price}`,
      description,
      url: `/listings/${id}`,
      type: "website",
      images: image?.url ? [{ url: image.url }] : undefined,
    },
    twitter: {
      card: image?.url ? "summary_large_image" : "summary",
      title: `${listing.title} — ${price}`,
      description,
    },
  };
}

export default async function ListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: listing } = await supabase.from("listings").select("*").eq("id", id).single();
  if (!listing) notFound();

  // Everything in this group only needs listing.id / listing.seller_id /
  // listing.source_car_id — all known the moment the listing row lands — so
  // they have no data dependency on each other and can fire together.
  const [
    { data: seller },
    { data: images },
    { data: sourceCar },
    { data: moreFromSeller },
    {
      data: { user },
    },
    { data: sourceModLine },
    watchCounts,
    { data: reviews },
    { data: questions },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, display_name, location")
      .eq("id", listing.seller_id)
      .single(),
    supabase.from("listing_images").select("*").eq("listing_id", id).order("position"),
    listing.source_car_id
      ? supabase
          .from("cars")
          .select("slug, name, make, model, is_public")
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
    supabase.auth.getUser(),
    // Provenance: the build line this listing was released off, if any —
    // names the line rather than just linking to the whole car sheet.
    listing.source_car_id
      ? supabase
          .from("mod_items")
          .select("brand, product, raw_text")
          .eq("linked_listing_id", id)
          .eq("car_id", listing.source_car_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    fetchWatchCounts(supabase, [id]),
    // Seller rating + Q&A
    supabase.from("reviews").select("rating").eq("reviewee_id", listing.seller_id),
    supabase
      .from("listing_questions")
      .select("id, parent_id, body, created_at, author_id")
      .eq("listing_id", id)
      .order("created_at"),
  ]);

  const modLineName = sourceModLine
    ? [sourceModLine.brand, sourceModLine.product].filter(Boolean).join(" ") ||
      sourceModLine.raw_text ||
      null
    : null;

  const watchCount = watchCounts.get(id) ?? 0;

  const avgRating = (reviews ?? []).length
    ? (reviews!.reduce((s, r) => s + r.rating, 0) / reviews!.length).toFixed(1)
    : null;

  // Count the look, but never the seller's own — a seller refreshing their
  // listing must not inflate the number they price against. Fire-and-forget:
  // a failed counter bump must never break the page.
  if (user?.id !== listing.seller_id) {
    void supabase.rpc("bump_listing_view", { p_listing: id });
  }

  const qaAuthorIds = [...new Set((questions ?? []).map((q) => q.author_id))];
  const moreIds = (moreFromSeller ?? []).map((l) => l.id);

  // Second group: each of these depends only on results already in hand
  // above (user, or ids derived from listing/questions/moreFromSeller), not
  // on each other, so they can also run concurrently.
  const [{ data: save }, garageFitment, { data: qaAuthors }, { data: moreImages }] =
    await Promise.all([
      user
        ? supabase
            .from("saves")
            .select("target_id")
            .eq("user_id", user.id)
            .eq("target_type", "listing")
            .eq("target_id", id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      user && listing.source_car_id
        ? fetchGarageFitment(supabase, user.id)
        : Promise.resolve({ cars: [], index: new Map<string, string>() }),
      qaAuthorIds.length
        ? supabase.from("profiles").select("id, display_name, username").in("id", qaAuthorIds)
        : Promise.resolve({ data: [] }),
      moreIds.length
        ? supabase
            .from("listing_images")
            .select("listing_id, url, position")
            .in("listing_id", moreIds)
            .order("position")
        : Promise.resolve({ data: [] }),
    ]);
  const isSaved = Boolean(save);

  // "Fits your car" (PRD §7.1 — see src/lib/marketplace/fitment.ts for the
  // shared rule): only computable when the listing has a source car with
  // structured make+model, so this deliberately doesn't try to infer fitment
  // from title/description text.
  let fitMatch: string | null = null;
  let viewerHasGarage = false;
  if (user && listing.source_car_id) {
    viewerHasGarage = garageFitment.cars.length > 0;
    if (sourceCar) {
      fitMatch = matchGarageFitment(garageFitment.index, sourceCar.make, sourceCar.model);
    }
  }

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
            Marketplace
          </Link>
          {category && (
            <>
              {" / "}
              <Link href={`/marketplace/${category.slug}`} className="hover:text-live">
                {category.label}
              </Link>
            </>
          )}
          {listing.part_number && ` · part no. ${listing.part_number}`}
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
              <h3>No photos yet</h3>
              <p>The seller hasn&apos;t photographed this part yet. Ask them below.</p>
            </div>
          )}

          {listing.status !== "active" && (
            <p className="mt-4">
              <span className="chip chip--spent">This listing is {listing.status}</span>
            </p>
          )}

          {listing.description && (
            <div className="mt-8">
              <span className="microlabel microlabel--ink">Description</span>
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
              <h4>Fitment — the seller&apos;s notes</h4>
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
            {/* Shipping was charged at checkout but never shown here, so a
                buyer met the real total only after committing. */}
            <p className="kv mt-1">
              {listing.shipping_cents > 0 ? (
                <>
                  + {formatPrice(listing.shipping_cents)} shipping ·{" "}
                  <b>{formatPrice(listing.price_cents + listing.shipping_cents)} total</b>
                </>
              ) : (
                "Shipping included"
              )}
              {listing.allows_collection && " · collection available"}
            </p>
            <p className="kv mt-2 text-dim">
              {[conditionLabel(listing.condition), listing.location].filter(Boolean).join(" · ")}
            </p>
            {listing.offer_floor_cents !== null && listing.status === "active" && (
              <p className="spec-note mt-2">
                Offers accepted from {formatPrice(listing.offer_floor_cents)}.
              </p>
            )}
            {/* What the sheet has seen of this part — watchers are live, views
                are cumulative, so only the watcher line carries the live dot. */}
            <LiveDim
              label="Watching"
              value={watchCount > 0 ? `${watchCount} watching` : "—"}
              live={watchCount > 0}
              blank={watchCount === 0}
            />
            {listing.part_number && (
              <LiveDim label="Part number" value={listing.part_number} />
            )}

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
            {user?.id !== listing.seller_id && (
              <div className="mt-3">
                <ReportButton
                  subjectType="listing"
                  subjectId={listing.id}
                  subjectLabel={listing.title}
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
                      : (seller.location ?? "Seller on DRVN")}
                  </span>
                </span>
              </Link>
            )}
          </Rv>

          {/* Fitment: only computable against a structured source car —
              gated on make+model actually existing, so "doesn't match" can
              only ever mean a real comparison ran. A source car that is
              private (RLS returns null) or missing its make/model gets no
              tile rather than a false negative; the seller-notes block
              above stays the honest fallback. */}
          {listing.source_car_id && sourceCar?.make && sourceCar?.model && (
            <Rv className="tile" stagger={2}>
              <span className="microlabel microlabel--ink">Fitment</span>
              {!user ? (
                <p className="kv mt-2">
                  <Link href={`/login?next=${encodeURIComponent("/garage")}`} className="jumplink">
                    Add your car
                  </Link>{" "}
                  to check whether this fits.
                </p>
              ) : !viewerHasGarage ? (
                <p className="kv mt-2">
                  <Link href="/garage" className="jumplink">
                    Add a car to your garage
                  </Link>{" "}
                  to check whether this fits.
                </p>
              ) : fitMatch ? (
                <p className="mt-2">
                  <span className="chip chip--ok">Fits your {fitMatch}</span>
                </p>
              ) : (
                <p className="mt-2">
                  <span className="chip">Doesn&apos;t match your garage</span>
                </p>
              )}
            </Rv>
          )}

          {sourceCar?.is_public && (
            <Rv className="tile tile--deep" stagger={3}>
              <div className="tile__head">
                <span className="microlabel microlabel--ink">
                  {modLineName ? `Came off ${sourceCar.name}` : "Came off this car"}
                </span>
                <span className="chip chip--ok">Build page</span>
              </div>
              <Link href={`/cars/${sourceCar.slug}`} className="order !bg-transparent !p-0">
                <span>
                  <span className="order__name block">
                    {modLineName ? `${sourceCar.name} — ${modLineName}` : sourceCar.name}
                  </span>
                  <span className="order__meta block">See the full build — mods, photos, history →</span>
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
              <span className="microlabel microlabel--ink">More from this seller</span>
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
        left="DRVN — used parts from modified cars"
        right={<Link href="/marketplace">← Back to the marketplace</Link>}
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
