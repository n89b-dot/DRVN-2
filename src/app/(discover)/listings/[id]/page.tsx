import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";

import { LiveDim, Rv } from "@/components/livesheet";
import {
  Badge,
  ButtonLink,
  EmptyState,
  Foot,
  Gallery,
  ListingCard,
  Media,
  Mosaic,
  ObjectRow,
  ratingLine,
  TileHead,
  VehicleCard,
} from "@/components/ui";
import { DISPUTE_WINDOW_DAYS, SELLER_RESPONSE_DAYS } from "@/features/commerce/disputes";
import { MarketplaceViewEvent } from "@/features/marketplace/view-events";
import { SaveButton } from "@/features/social/buttons";
import { parseAuthIntent } from "@/lib/auth-intent";
import { fetchGarageFitment, explainMatch } from "@/lib/marketplace/fitment";
import { checklistRows, gradeLabel, gradeMeaning } from "@/lib/marketplace/grading";
import { fetchWatchCounts, hydrateListingCards } from "@/lib/marketplace/query";
import { conditionLabel, formatPrice, getCategory } from "@/lib/marketplace/taxonomy";
import { paymentsAreLive } from "@/lib/payments/provider";
import { getPublicPageClient as createClient, getViewer } from "@/lib/supabase/page-context";
import { deliveryLabel } from "@/lib/marketplace/delivery";
import { listingHref, normalizeMarketplaceState, shoppingReturn } from "@/lib/marketplace/state";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";
import { getBetaAccess } from "@/lib/beta-access";

import { ReportButton } from "@/features/moderation/report-button";
import { PurchaseActions } from "./purchase-actions";
import { AskAgentButton } from "@/features/agent/ask-agent-button";
import { agentStepOpen, agentTabOpen } from "@/lib/agent/beta";
import { QASection, type QAItem } from "./qa-section";
import { postHeadline } from "@/lib/activity/headline";
import { postHref } from "@/lib/activity/href";
import { profileHref } from "@/lib/profile-href";

/** What a listing that can't be bought says about itself — the same words
 *  the cart uses, never the raw status value. */
const UNAVAILABLE_STATUS: Record<string, string> = {
  sold: "Sold",
  paused: "Paused by the seller",
  archived: "No longer listed",
  removed: "Taken down",
  draft: "Not published yet",
};

/** The listing row and its photos, read once per request and shared by the
 *  metadata and the page (each used to fetch its own). React's cache is per
 *  render, never shared between users. */
const loadListing = cache(async (id: string) => {
  const supabase = await createClient();
  return supabase.from("listings").select("*").eq("id", id).maybeSingle();
});
const loadListingImages = cache(async (id: string) => {
  const supabase = await createClient();
  return supabase.from("listing_images").select("*").eq("listing_id", id).order("position");
});

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
  const [{ data: listing }, { data: images }] = await Promise.all([loadListing(id), loadListingImages(id)]);

  if (!listing) return { title: "Listing not found - DRVN" };

  const image = images?.[0] ?? null;

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

export default async function ListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  /** `?action=offer` — an intent carried back through sign-in/signup/OAuth. */
  searchParams: Promise<{ action?: string; from?: string }>;
}) {
  const { id } = await params;
  const { action, from } = await searchParams;
  const returnTo = shoppingReturn(from);
  const shoppingState = returnTo ? normalizeMarketplaceState(Object.fromEntries(new URL(returnTo, "https://drvn.invalid").searchParams)) : {};
  const detailPath = listingHref(id, returnTo ?? undefined);
  const resumeAction = parseAuthIntent(action);
  const supabase = await createClient();
  // The viewer is a local token check (no network), so it can be known
  // before the first round and let viewer-only reads join it.
  const user = await getViewer();

  // Round 1: everything that needs only the listing id or the viewer.
  const [{ data: listing }, { data: images }, selectedVehicle, betaBuyerAccess, { data: taggedPostRows }] =
    await Promise.all([
      loadListing(id),
      loadListingImages(id),
      shoppingState.vehicle ? resolveVehicleFilter(shoppingState.vehicle) : Promise.resolve(null),
      getBetaAccess(user?.id, "buyer"),
      // W-4: updates that tagged this part, with their photos, in one read.
      // Only ever posts on public builds — see the filter below. A LEFT join
      // to cars: a post about this part may have no car at all (W-5), and an
      // inner join dropped exactly those — the posts for which the part is
      // the whole subject. Which posts may be seen is the post policy's
      // business (a private build's posts never arrive here).
      //
      // Read from the tag rows (indexed by part), not from posts: asked the
      // other way round, the database gathered every post's photos before
      // it looked for this part's tags, and timed out at volume.
      supabase
        .from("activity_post_listings")
        .select(
          "activity_posts!inner(id, title, intro, body, car_id, published_at, cars(slug, name, is_public), activity_images(url, position))"
        )
        .eq("listing_id", id)
        .not("activity_posts.published_at", "is", null)
        .order("position", { referencedTable: "activity_posts.activity_images" })
        .limit(50)
        .then(({ data, error }) => ({
          error,
          data: data
            ? data
                .map((row) => row.activity_posts)
                .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? ""))
                .slice(0, 6)
            : null,
        })),
    ]);
  if (!listing) notFound();
  const isOwn = user?.id === listing.seller_id;

  // Round 2: everything that needs listing.seller_id / listing.source_car_id
  // (known the moment the listing row lands) or the viewer. No dependency on
  // each other, so they fire together.
  const [
    { data: myOfferRow },
    { data: seller },
    { data: sourceCar },
    moreFromSellerCards,
    { data: sourceModLine },
    watchCounts,
    { data: sellerRating },
    { data: fitments },
    { data: questions },
    { data: save },
    garageFitment,
    { count: soldCount },
    { count: openOfferCount },
    { data: publicOfferFloor },
  ] = await Promise.all([
    // The viewer's own live offer, so the page points at it instead of
    // inviting a second one the server would refuse.
    user && !isOwn
      ? supabase
          .from("offers")
          .select("id, amount_cents, counter_amount_cents")
          .eq("listing_id", listing.id)
          .eq("buyer_id", user.id)
          .in("status", ["open", "countered"])
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("profiles")
      .select("username, display_name, location, avatar_url")
      .eq("id", listing.seller_id)
      .single(),
    listing.source_car_id
      ? supabase
          .from("cars")
          .select("id, slug, name, make, model, year, is_public, cover_image_url")
          .eq("id", listing.source_car_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("listings")
      .select("id, title, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, part_number, brand, part_miles, part_miles_unit, seller_id, source_car_id, status")
      .eq("seller_id", listing.seller_id)
      .eq("status", "active")
      .neq("id", id)
      .limit(4)
      // The seller rail's cards need these rows; hydrating them as soon as
      // they land overlaps the rest of this round instead of following it.
      // Same card shape as the search grid — the rails previously selected a
      // thinner row and rendered a visibly different card on the same page.
      .then(({ data }) => hydrateListingCards(supabase, data ?? [])),
    // Provenance: the build line this listing was released off, if any —
    // names the line rather than just linking to the whole car sheet.
    // Deliberately unfiltered by status: the part being sold here is usually
    // one that came OFF the car, so filtering to installed would blank the
    // provenance line on exactly the listings that have the best provenance.
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
    // Every review, averaged by the database (N30: the rows stopped at 1,000).
    supabase.rpc("seller_review_summaries", { p_sellers: [listing.seller_id] }).maybeSingle(),
    supabase
      .from("listing_fitments")
      .select("make, model, year_start, year_end")
      .eq("listing_id", id)
      .order("created_at"),
    supabase
      .from("listing_questions")
      .select("id, parent_id, body, created_at, author_id, author:profiles!listing_questions_author_id_fkey(display_name, username)")
      .eq("listing_id", id)
      .order("created_at"),
    user
      ? supabase
          .from("saves")
          .select("target_id")
          .eq("user_id", user.id)
          .eq("target_type", "listing")
          .eq("target_id", id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Fitment against the viewer's garage. Asked whenever someone is signed
    // in (rather than after the fitment rows arrive) so it rides this round.
    user
      ? fetchGarageFitment(supabase, user.id)
      : Promise.resolve({ cars: [], index: new Map<string, string>() }),
    // Track record for the seller line: parts they've actually sold here.
    supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", listing.seller_id)
      .eq("status", "sold"),
    // The owner panel's one open question: offers waiting on them.
    isOwn
      ? supabase
          .from("offers")
          .select("id", { count: "exact", head: true })
          .eq("listing_id", id)
          .in("status", ["open", "countered"])
      : Promise.resolve({ count: 0 }),
    // The minimum shows only when the seller chose to show it (O-3,
    // migration 20261018100000); the amount otherwise stays private.
    listing.show_offer_floor && listing.status === "active" && !isOwn
      ? supabase.rpc("listing_public_offer_floor", { p_listing: listing.id })
      : Promise.resolve({ data: null }),
  ]);

  const modLineName = sourceModLine
    ? [sourceModLine.brand, sourceModLine.product].filter(Boolean).join(" ") ||
      sourceModLine.raw_text ||
      null
    : null;
  // R2-09: a public count from listing_watch_counts. null = couldn't read it.
  const watchCount = watchCounts?.get(id) ?? null;

  const avgRating = sellerRating?.review_count ? Number(sellerRating.rating_avg).toFixed(1) : null;

  // Count the look, but never the seller's own — a seller refreshing their
  // listing must not inflate the number they price against. Fire-and-forget:
  // a failed counter bump must never break the page.
  // Members only: the function counts one look per member per hour and is
  // closed to signed-out callers, so asking for a visitor is a wasted request.
  if (user && user.id !== listing.seller_id) {
    // `.then` is what sends it: a Supabase query does nothing until it is
    // awaited, so the bare `void supabase.rpc(…)` here never counted a look.
    void supabase.rpc("bump_listing_view", { p_listing: id }).then(() => undefined, () => undefined);
  }

  const isSaved = Boolean(save);

  const fitmentClaims = fitments ?? [];
  const selectedEvidence = selectedVehicle ? explainMatch({ make: selectedVehicle.make, model: selectedVehicle.model, year: shoppingState.vyear ? Number(shoppingState.vyear) : null }, fitmentClaims, sourceCar) : null;
  const garageEvidence = garageFitment.cars.map(car => ({ car, evidence: explainMatch(car, fitmentClaims, sourceCar) }));
  const bestGarage = garageEvidence.find(entry => ["seller_stated", "source_model"].includes(entry.evidence.kind)) ?? garageEvidence.find(entry => entry.evidence.kind === "year_needed");
  const evidence = selectedEvidence ?? bestGarage?.evidence ?? explainMatch(null, fitmentClaims, sourceCar);

  const checklist = checklistRows(listing.category, listing.subcategory, listing.condition_checklist);
  const yearsLabel = (f: { year_start: number | null; year_end: number | null }) =>
    f.year_start || f.year_end
      ? ` ${f.year_start ?? "…"}–${f.year_end ?? "…"}`
      : "";

  const qaName = (a: { display_name: string | null; username: string | null } | null) =>
    a?.display_name ?? (a?.username ? `@${a.username}` : "User");
  const qaItems: QAItem[] = (questions ?? []).map((q) => ({
    id: q.id,
    parent_id: q.parent_id,
    body: q.body,
    created_at: q.created_at,
    authorName: qaName(q.author),
    isSeller: q.author_id === listing.seller_id,
  }));

  const category = getCategory(listing.category);
  const sellerName = seller?.display_name ?? (seller?.username ? `@${seller.username}` : "Seller on DRVN");
  const sellerInitials = (seller?.display_name ?? seller?.username ?? "?")
    .split(" ")
    .map((w: string) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const sold = soldCount ?? 0;
  const sellerRecord = [
    avgRating ? ratingLine(avgRating, sellerRating?.review_count ?? 0) : null,
    sold > 0 ? `${sold} sold on DRVN` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const gallery = images ?? [];

  const taggedPosts = taggedPostRows ?? [];
  const postCover = new Map<string, string>();
  for (const post of taggedPosts) {
    const first = post.activity_images?.[0];
    if (first) postCover.set(post.id, first.url);
  }
  const postsAboutPart = taggedPosts
    // Belt and braces beside the policy: a car that is there but not public
    // is never named or linked from a public part page.
    .filter((post) => {
      const car = post.cars as unknown as { is_public: boolean } | null;
      return !post.car_id || Boolean(car?.is_public);
    })
    .map((post) => {
    // A post that tags a part need not be about a car at all (W-5).
    const car = post.cars as unknown as { slug: string; name: string } | null;
    return {
      id: post.id,
      headline: postHeadline(post),
      carName: car?.name ?? null,
      href: postHref({ id: post.id, carSlug: car?.slug ?? null }),
      cover: postCover.get(post.id) ?? null,
    };
  });

  return (
    <div className="wrap">
      <MarketplaceViewEvent viewKey={`listing:${listing.id}`} entry={{ kind: "listing" }} />
      {returnTo && <nav aria-label="Return to results" className="marketplace-breadcrumb"><Link href={returnTo}>← Back to results</Link></nav>}
      {/* An item title, not a display head: ~28–32px, so the gallery starts
          right under it instead of under two lines of 52px type. */}
      <Rv as="header" className="pagehead pagehead--item">
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

      {/* DOM order is the mobile reading order — media, then price/purchase,
          then the long-form facts, then secondary tiles. Desktop re-places the
          same four blocks into the familiar two-column sheet via `.pdp` grid
          areas, so no block is duplicated and tab order stays sensible. */}
      <div className="pdp">
        {/* Media */}
        <div className="pdp__media min-w-0">
          {gallery.length > 0 ? (
            <Rv>
              <Gallery
                images={gallery.map((image) => ({ url: image.url, alt: image.alt }))}
                label={listing.title}
              />
            </Rv>
          ) : (
            <EmptyState mark="✎" title="No photos yet" className="undrawn--hero">
              The seller hasn&apos;t photographed this part yet. Ask them below.
            </EmptyState>
          )}
        </div>

        {/* Purchase rail: asking plate + fitment-vs-garage. On mobile this sits
            directly under the gallery so price and actions come before the
            long description; on desktop it is the right column. */}
        <div className="pdp__rail flex min-w-0 flex-col gap-4 self-start">
          <Rv className="tile" stagger={1}>
            {listing.status === "reserved" ? (
              <div className="mb-3">
                <Badge tone="spent">Reserved</Badge>
                <p className="mt-1 text-micro text-dim">
                  {isOwn
                    ? "A buyer is paying for this. It goes back on sale if the payment doesn't complete."
                    : "Someone is buying this right now. If the sale doesn't go through, it goes back on sale."}
                </p>
              </div>
            ) : listing.status !== "active" ? (
              <p className="mb-3">
                <Badge tone="spent">
                  {UNAVAILABLE_STATUS[listing.status] ?? "No longer available"}
                </Badge>
              </p>
            ) : null}
            {isOwn && listing.status === "active" && (
              <p className="mb-3">
                <Badge tone="live">Your listing · Live</Badge>
              </p>
            )}
            <div className="pdp__ask">
              <span className="microlabel">Asking</span>
              {/* Save is a bookmark beside the price, not a fourth full-width
                  button under Buy / Cart / Offer. */}
              {!isOwn && (
                <SaveButton
                  variant="icon"
                  itemLabel={listing.title}
                  targetType="listing"
                  targetId={listing.id}
                  path={detailPath}
                  resumeSave={resumeAction === "save"}
                  initialSaved={isSaved}
                  isLoggedIn={Boolean(user)}
                />
              )}
            </div>
            <p className="num-giant mt-1">{formatPrice(listing.price_cents)}</p>
            {/* Shipping was charged at checkout but never shown here, so a
                buyer met the real total only after committing. */}
            <p className="kv mt-1">
              {deliveryLabel(listing)}
              {listing.shipping_mode === "flat" && listing.shipping_cents > 0 && <> · <b>{formatPrice(listing.price_cents + listing.shipping_cents)} item + shipping</b></>}
            </p>
            <p className="mt-1 text-micro text-dim">Any applicable tax and your selected delivery are confirmed at checkout.</p>
            {/* The condition here; the place is on the seller line below. */}
            {listing.condition && <p className="kv mt-2 text-dim">{conditionLabel(listing.condition)}</p>}
            {publicOfferFloor != null && (
              <p className="spec-note mt-2">Offers accepted from {formatPrice(publicOfferFloor)}.</p>
            )}
            {isOwn ? (
              /* The owner's panel: what they came to their own listing to do.
                 Status changes (pause, archive) stay in My Listings, which
                 owns that workflow and its payout checks. */
              <div className="mt-5 grid gap-2">
                <ButtonLink href={`/listings/${listing.id}/edit`} className="w-full">
                  Edit listing
                </ButtonLink>
                <ButtonLink href={`/offers?listing=${listing.id}`} variant="ghost" className="w-full">
                  {(openOfferCount ?? 0) > 0 ? `Offers (${openOfferCount})` : "Offers"}
                </ButtonLink>
                <Link href="/listings" className="jumplink mt-1 justify-self-start">
                  Pause or archive in My Listings
                </Link>
              </div>
            ) : (
              <PurchaseActions
                listingId={listing.id}
                isLoggedIn={Boolean(user)}
                betaEnforced={betaBuyerAccess.enforced}
                buyerEligible={betaBuyerAccess.eligible}
                accessUnavailable={Boolean(betaBuyerAccess.unavailable)}
                isOwn={false}
                isActive={listing.status === "active"}
                paymentsLive={paymentsAreLive()}
                priceCents={listing.price_cents}
                shippingCents={listing.shipping_cents}
                offerFloorCents={publicOfferFloor ?? null}
                myOffer={
                  myOfferRow
                    ? { id: myOfferRow.id, amountCents: myOfferRow.amount_cents, counterCents: myOfferRow.counter_amount_cents }
                    : null
                }
                resumeAction={resumeAction}
                returnPath={detailPath}
                agentOffers={Boolean(user) && listing.shipping_mode !== "drvn" && (await agentStepOpen("buyer"))}
              />
            )}
            {/* Ask about this listing (A3c): beside the page on desktop, /agent on a phone. */}
            {user && (await agentTabOpen()) && (await agentStepOpen("chat")) && (
              <div className="mt-2 grid">
                <AskAgentButton about={{ kind: "listing", id: listing.id }} className="w-full" />
              </div>
            )}

            {/* Who is selling, and the car it came off — the reason to buy
                here rather than anywhere else, so it sits with the price, not
                at the foot of the page. */}
            {seller && !isOwn && (
              <Link
                href={seller.username ? profileHref(seller.username, "parts") : "#"}
                className="pdp__seller"
              >
                <span className="monogram monogram--sm pdp__seller-face" aria-hidden="true">
                  {seller.avatar_url ? (
                    <Media src={seller.avatar_url} alt="" className="h-full w-full" role="avatar" />
                  ) : (
                    sellerInitials
                  )}
                </span>
                <span className="min-w-0">
                  <span className="pdp__seller-name">{sellerName}</span>
                  <span className="pdp__seller-meta">
                    {[listing.location ?? seller.location, sellerRecord || "Seller on DRVN"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </Link>
            )}
            {sourceCar?.is_public && (
              <div className="pdp__source">
                <span className="microlabel microlabel--ink">
                  {modLineName ? `Came off this car — ${modLineName}` : "Came off this car"}
                </span>
                <VehicleCard
                  vehicle={{
                    id: sourceCar.id,
                    slug: sourceCar.slug,
                    name: sourceCar.name,
                    year: sourceCar.year,
                    make: sourceCar.make,
                    model: sourceCar.model,
                    cover_image_url: sourceCar.cover_image_url,
                  }}
                  // The build page offers "Back to the part" (and, through
                  // it, back to the results) only when told where it came from.
                  href={`/cars/${sourceCar.slug}?fromListing=${encodeURIComponent(id)}${returnTo ? `&from=${encodeURIComponent(returnTo)}` : ""}`}
                />
              </div>
            )}

            {/* The record, after the decision: watchers, part number, dispatch
                policy and the report path are evidence and process — on a
                short phone viewport none of them belongs between the price
                and Buy/Offer (SYS-09). */}
            <div className="mt-4 border-t border-[color:var(--rule-soft)] pt-3">
              {/* Watchers only when there are some: an empty metric with a
                  dash read as a value that failed to load. The owner sees
                  their numbers, zeros included — that is the answer. */}
              {((watchCount ?? 0) > 0 || isOwn) && (
                <LiveDim
                  label="Watching"
                  value={watchCount === null ? "Unavailable" : `${watchCount} watching`}
                  live={(watchCount ?? 0) > 0}
                  blank={!watchCount}
                />
              )}
              {isOwn && (
                <LiveDim label="Views" value={String(listing.view_count ?? 0)} blank={!listing.view_count} />
              )}
              {/* M-8's two named exceptions to "the item page is unchanged":
                  brand and miles join the record block, because they are what
                  a buyer checks a used part against. */}
              {listing.brand && <LiveDim label="Brand" value={listing.brand} />}
              {listing.part_miles !== null && listing.part_miles_unit && (
                <LiveDim
                  label="Miles on this part"
                  value={`${new Intl.NumberFormat("en").format(listing.part_miles)} ${listing.part_miles_unit}`}
                />
              )}
              {listing.part_number && (
                <LiveDim label="Part number" value={listing.part_number} />
              )}
              {listing.status === "active" && (
                <p className="spec-note mt-2">
                  {isOwn
                    ? "Dispatch within 3 working days of a sale."
                    : "Sellers are expected to dispatch within 3 working days of a sale."}
                </p>
              )}
              {!isOwn && (
                <div className="mt-3">
                  <ReportButton
                    subjectType="listing"
                    subjectId={listing.id}
                    subjectLabel={listing.title}
                    isLoggedIn={Boolean(user)}
                  />
                </div>
              )}
            </div>
          </Rv>

          {/* Compatibility is a buyer's question — the seller's own garage
              matching their own part says nothing. */}
          {!isOwn && (
            <Rv className="tile" stagger={3}>
              <TileHead label="Compatibility" />
              {selectedVehicle && <p className="kv mt-2">Selected: {[shoppingState.vyear, selectedVehicle.label].filter(Boolean).join(" ")}</p>}
              {!selectedVehicle && bestGarage && <p className="kv mt-2">Your garage: {bestGarage.car.name}</p>}
              <p className="mt-2"><strong>{evidence.label}</strong></p>
              <p className="spec-note mt-1">{evidence.detail}</p>
              {!selectedVehicle && <Link href={returnTo ?? `/marketplace/${listing.category}`} className="jumplink mt-3 inline-block">Choose a vehicle in the marketplace</Link>}
            </Rv>
          )}
        </div>

        {/* Content: long-form facts + Q&A */}
        <div className="pdp__content min-w-0">
          {listing.description && (
            <div className="mt-8">
              <span className="microlabel microlabel--ink">Description</span>
              <p className="mt-2 whitespace-pre-line text-body leading-relaxed">
                {listing.description}
              </p>
            </div>
          )}

          {/* The contract half of the listing (0024): grade + checklist,
              exactly what freezes onto the order at purchase. */}
          {(listing.grade || checklist.length > 0) && (
            <div className="mt-8">
              <span className="microlabel microlabel--ink">Condition — seller-declared</span>
              {listing.grade && (
                <p className="mt-2 text-body">
                  <Badge>{gradeLabel(listing.grade)}</Badge>{" "}
                  <span className="text-dim">{gradeMeaning(listing.grade)}</span>
                </p>
              )}
              {/* One accent maximum in this block: rows use monochrome marks
                  (✓ / — / ?) instead of a stack of tinted chips; the grade
                  chip above is the block's single color. */}
              {checklist.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {checklist.map((row) => (
                    <li key={row.key} className="flex items-baseline justify-between gap-3 text-micro">
                      <span>{row.label}</span>
                      <span className="font-mono text-dim">
                        {row.answer === "yes" ? (
                          <>
                            <span aria-hidden="true">✓ </span>yes
                          </>
                        ) : row.answer === "no" ? (
                          <>
                            <span aria-hidden="true">— </span>no
                          </>
                        ) : (
                          "not sure"
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="spec-note mt-2">
                Declared by the seller at listing time and recorded on the order if you buy.
              </p>
            </div>
          )}

          {(fitmentClaims.length > 0 || listing.compatibility_notes) && (
            <div className="alert mt-8">
              <span className="alert__ico" aria-hidden="true">
                ⚠
              </span>
              <h4>Fitment — seller-stated</h4>
              {fitmentClaims.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {fitmentClaims.map((f, i) => (
                    <li key={i} className="chip">
                      {f.make} {f.model}
                      {yearsLabel(f)}
                    </li>
                  ))}
                </ul>
              )}
              {listing.compatibility_notes && (
                <p className="whitespace-pre-line">{listing.compatibility_notes}</p>
              )}
              <p className="spec-note col-span-full mt-2">
                <b>Seller-stated.</b> Not verified by DRVN — always confirm fitment for your car.{" "}
                <Link href="/protection" className="jumplink">
                  How protection works
                </Link>
              </p>
            </div>
          )}

          <QASection
            listingId={listing.id}
            items={qaItems}
            isLoggedIn={Boolean(user)}
            isSeller={isOwn}
          />
        </div>

        {/* Secondary: protection — trust context that shouldn't outrank the
            description on a phone. Buyers only: the seller's side of a
            dispute is explained where they list. */}
        {!isOwn && (
          <div className="pdp__more flex min-w-0 flex-col gap-4 self-start">
            {/* Buyer protection summary — the dispute rules live on /protection;
                this is the short version so a buyer sees the guarantee before
                they need it, not only after something goes wrong. */}
            <Rv className="tile" stagger={2}>
              <TileHead label="Buyer protection" />
              <p className="text-body mt-2">
                Covered: the item never arrives, arrives damaged, is significantly not as described,
                or is the wrong item.
              </p>
              <p className="spec-note mt-2">
                Report a problem within {DISPUTE_WINDOW_DAYS} days of delivery and the seller has{" "}
                {SELLER_RESPONSE_DAYS} days to respond before DRVN can step in.
              </p>
              <Link href="/protection" className="jumplink mt-2 inline-flex">
                How protection &amp; disputes work
              </Link>
            </Rv>
          </div>
        )}
      </div>

      {postsAboutPart.length > 0 && (
        /* W-4's other half. A part that somebody wrote about — fitted it,
           took it off, photographed it on the car — is a better-understood
           part than one with only a listing, and those updates are already
           public. This is the link between the two halves of the product,
           pointing the way the marketplace rarely does. */
        <section className="deck" aria-labelledby="posts-about-part">
          <TileHead label="Posts about this part" />
          <div className="rowlist">
            {postsAboutPart.map((post) => (
              <ObjectRow
                key={post.id}
                href={post.href}
                media={{ src: post.cover ?? undefined, alt: "" }}
                title={post.headline}
                meta={post.carName}
              />
            ))}
          </div>
        </section>
      )}

      {/* Streams in after the page — two more reads that nothing above waits on. */}
      <Suspense fallback={null}>
        <SimilarInCategory category={listing.category} excludeId={listing.id} excludeSeller={listing.seller_id} supabase={supabase} />
      </Suspense>

      {moreFromSellerCards.length > 0 && (
        <section className="deck">
          <div className="marketplace-grid">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">{isOwn ? "Your other listings" : "More from this seller"}</span>
            </div>
            <Mosaic label={isOwn ? "Your other listings" : "More from this seller"}>
              {moreFromSellerCards.map((card) => (
                <ListingCard key={card.id} listing={card} variant="shopping" />
              ))}
            </Mosaic>
          </div>
        </section>
      )}

      <Foot
        left="DRVN — used parts from modified cars"
        right={<Link href={returnTo ?? "/marketplace"}>{returnTo ? "← Back to results" : "← Back to the marketplace"}</Link>}
      />
    </div>
  );
}

async function SimilarInCategory({
  category,
  excludeId,
  excludeSeller,
  supabase,
}: {
  category: string;
  excludeId: string;
  excludeSeller: string;
  supabase: Awaited<ReturnType<typeof createClient>>;
}) {
  const { data: similar } = await supabase
    .from("listings")
    .select("id, title, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, part_number, brand, part_miles, part_miles_unit, seller_id, source_car_id, status")
    .eq("status", "active")
    .eq("category", category)
    .neq("id", excludeId)
    .neq("seller_id", excludeSeller)
    .order("created_at", { ascending: false })
    .limit(4);

  if (!similar?.length) return null;

  // Same card shape as the search grid (covers, watch, seller trust).
  const cards = await hydrateListingCards(supabase, similar);

  return (
    <section className="deck">
      <div className="marketplace-grid">
        <div className="tile__head">
          <span className="microlabel microlabel--ink">Similar in this category</span>
        </div>
        <Mosaic label="Similar in this category">
          {cards.map((card) => (
            <ListingCard key={card.id} listing={card} variant="shopping" />
          ))}
        </Mosaic>
      </div>
    </section>
  );
}
