import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LiveDim, Rv } from "@/components/livesheet";
import { EmptyState, Foot, Gallery, ListingCard, Mosaic, ObjectRow, ratingLine, TileHead } from "@/components/ui";
import { DISPUTE_WINDOW_DAYS, SELLER_RESPONSE_DAYS } from "@/features/commerce/disputes";
import { MarketplaceViewEvent } from "@/features/marketplace/view-events";
import { SaveButton } from "@/features/social/buttons";
import { parseAuthIntent } from "@/lib/auth-intent";
import { fetchGarageFitment, explainMatch } from "@/lib/marketplace/fitment";
import { checklistRows, gradeLabel, gradeMeaning } from "@/lib/marketplace/grading";
import { fetchWatchCounts, hydrateListingCards } from "@/lib/marketplace/query";
import { conditionLabel, formatPrice, getCategory } from "@/lib/marketplace/taxonomy";
import { paymentsAreLive } from "@/lib/payments/provider";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";
import { deliveryLabel } from "@/lib/marketplace/delivery";
import { listingHref, normalizeMarketplaceState, shoppingReturn } from "@/lib/marketplace/state";
import { resolveVehicleFilter } from "@/lib/vehicles/catalog";
import { getBetaAccess } from "@/lib/beta-access";

import { ReportButton } from "@/features/moderation/report-button";
import { PurchaseActions } from "./purchase-actions";
import { QASection, type QAItem } from "./qa-section";
import { postHeadline } from "@/lib/activity/headline";
import { postHref } from "@/lib/activity/href";

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
  const selectedVehicle = shoppingState.vehicle ? await resolveVehicleFilter(shoppingState.vehicle) : null;
  const detailPath = listingHref(id, returnTo ?? undefined);
  const resumeAction = parseAuthIntent(action);
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
    user,
    { data: sourceModLine },
    watchCounts,
    { data: reviews },
    { data: fitments },
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
          .select("slug, name, make, model, year, is_public")
          .eq("id", listing.source_car_id)
          .single()
      : Promise.resolve({ data: null }),
    supabase
      .from("listings")
      .select("id, title, price_cents, shipping_cents, shipping_mode, allows_collection, condition, location, part_number, brand, part_miles, part_miles_unit, seller_id, source_car_id, status")
      .eq("seller_id", listing.seller_id)
      .eq("status", "active")
      .neq("id", id)
      .limit(4),
    getViewer(),
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
    supabase.from("reviews").select("rating").eq("reviewee_id", listing.seller_id),
    supabase
      .from("listing_fitments")
      .select("make, model, year_start, year_end")
      .eq("listing_id", id)
      .order("created_at"),
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
  const betaBuyerAccess = await getBetaAccess(user?.id, "buyer");

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

  // Second group: each of these depends only on results already in hand
  // above (user, or ids derived from listing/questions/moreFromSeller), not
  // on each other, so they can also run concurrently.
  const [{ data: save }, garageFitment, { data: qaAuthors }, moreFromSellerCards] =
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
      user && (listing.source_car_id || (fitments ?? []).length)
        ? fetchGarageFitment(supabase, user.id)
        : Promise.resolve({ cars: [], index: new Map<string, string>() }),
      qaAuthorIds.length
        ? supabase.from("profiles").select("id, display_name, username").in("id", qaAuthorIds)
        : Promise.resolve({ data: [] }),
      // Same card shape as the search grid — the rails previously selected a
      // thinner row and rendered a visibly different card on the same page.
      hydrateListingCards(supabase, moreFromSeller ?? []),
    ]);
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

  const gallery = images ?? [];

  // W-4: updates that tagged this part. Read from the mirror table, and
  // only ever posts on public builds — the join is what enforces that.
  const { data: taggedPostRows } = await supabase
    .from("activity_post_listings")
    .select("post_id")
    .eq("listing_id", id)
    .limit(12);
  const taggedPostIds = (taggedPostRows ?? []).map((r) => r.post_id);
  const { data: taggedPosts } = taggedPostIds.length
    ? await supabase
        .from("activity_posts")
        // A LEFT join: a post about this part may have no car at all (W-5),
        // and an inner join dropped exactly those — the posts for which the
        // part is the whole subject. Which posts may be seen is the post
        // policy's business (a private build's posts never arrive here).
        .select("id, title, intro, body, car_id, published_at, cars(slug, name, is_public)")
        .in("id", taggedPostIds)
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(6)
    : { data: [] };
  const { data: taggedPostImages } = taggedPosts?.length
    ? await supabase
        .from("activity_images")
        .select("post_id, url, position")
        .in("post_id", taggedPosts.map((p) => p.id))
        .order("position")
    : { data: [] };
  const postCover = new Map<string, string>();
  for (const img of taggedPostImages ?? []) {
    if (!postCover.has(img.post_id)) postCover.set(img.post_id, img.url);
  }
  const postsAboutPart = (taggedPosts ?? [])
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
            {listing.status !== "active" && (
              <p className="mb-3">
                <span className="chip chip--spent">This listing is {listing.status}</span>
              </p>
            )}
            <span className="microlabel">Asking</span>
            <p className="num-giant mt-1">{formatPrice(listing.price_cents)}</p>
            {/* Shipping was charged at checkout but never shown here, so a
                buyer met the real total only after committing. */}
            <p className="kv mt-1">
              {deliveryLabel(listing)}
              {listing.shipping_mode === "flat" && listing.shipping_cents > 0 && <> · <b>{formatPrice(listing.price_cents + listing.shipping_cents)} item + shipping</b></>}
              <span className="spec-note block">Any applicable tax and your selected delivery are confirmed at checkout.</span>
            </p>
            <p className="kv mt-2 text-dim">
              {[conditionLabel(listing.condition), listing.location].filter(Boolean).join(" · ")}
            </p>
            {listing.offer_floor_cents !== null && listing.status === "active" && (
              <p className="spec-note mt-2">
                Offers accepted from {formatPrice(listing.offer_floor_cents)}.
              </p>
            )}
            <PurchaseActions
              listingId={listing.id}
              isLoggedIn={Boolean(user)}
              betaEnforced={betaBuyerAccess.enforced}
              buyerEligible={betaBuyerAccess.eligible}
              isOwn={user?.id === listing.seller_id}
              isActive={listing.status === "active"}
              paymentsLive={paymentsAreLive()}
              priceCents={listing.price_cents}
              shippingCents={listing.shipping_cents}
              resumeAction={resumeAction}
              returnPath={detailPath}
            />
            {user?.id !== listing.seller_id && (
              <div className="mt-3">
                <SaveButton
                  itemLabel={listing.title}
                  targetType="listing"
                  targetId={listing.id}
                  path={detailPath}
                  resumeSave={resumeAction === "save"}
                  initialSaved={isSaved}
                  isLoggedIn={Boolean(user)}
                />
              </div>
            )}
            {seller && (
              <Link href={`/u/${seller.username}`} className="mt-5 flex items-center gap-3 border-t border-[color:var(--rule-soft)] pt-5">
                <span className="monogram monogram--sm">{sellerInitials}</span>
                <span className="min-w-0">
                  <span className="order__name block">{seller.display_name ?? (seller.username ? `@${seller.username}` : "Seller on DRVN")}</span>
                  <span className="order__meta block">
                    {avgRating
                      ? // avgRating is already a display string ("4.8") —
                        // ratingLine only interpolates it, so the cast is safe.
                        ratingLine(avgRating, (reviews ?? []).length)
                      : (seller.location ?? "Seller on DRVN")}
                  </span>
                </span>
              </Link>
            )}

            {/* The record, after the decision: watchers, part number, dispatch
                policy and the report path are evidence and process — on a
                short phone viewport none of them belongs between the price
                and Buy/Offer (SYS-09). */}
            <div className="mt-4 border-t border-[color:var(--rule-soft)] pt-3">
              {/* What the sheet has seen of this part — watchers are live,
                  views are cumulative, so only the watcher line carries the
                  live dot. */}
              <LiveDim
                label="Watching"
                value={watchCount > 0 ? `${watchCount} watching` : "—"}
                live={watchCount > 0}
                blank={watchCount === 0}
              />
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
                  Sellers are expected to dispatch within 3 working days of a sale.
                </p>
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
            </div>
          </Rv>

          <Rv className="tile" stagger={3}>
            <span className="microlabel microlabel--ink">Compatibility</span>
            {selectedVehicle && <p className="kv mt-2">Selected: {[shoppingState.vyear, selectedVehicle.label].filter(Boolean).join(" ")}</p>}
            {!selectedVehicle && bestGarage && <p className="kv mt-2">Your garage: {bestGarage.car.name}</p>}
            <p className="mt-2"><strong>{evidence.label}</strong></p>
            <p className="spec-note mt-1">{evidence.detail}</p>
            {!selectedVehicle && <Link href={returnTo ?? `/marketplace/${listing.category}`} className="jumplink mt-3 inline-block">Choose a vehicle in the marketplace</Link>}
          </Rv>
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
                  <span className="chip chip--ok">{gradeLabel(listing.grade)}</span>{" "}
                  <span className="text-dim">{gradeMeaning(listing.grade)}</span>
                </p>
              )}
              {/* One accent maximum in this block: rows use monochrome marks
                  (✓ / — / ?) instead of a stack of tinted chips; the grade
                  chip above is the block's single color. */}
              {checklist.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1.5">
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
                <ul className="flex flex-wrap gap-1.5">
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
            isSeller={user?.id === listing.seller_id}
          />
        </div>

        {/* Secondary: protection + provenance — trust context that shouldn't
            outrank the description on a phone. */}
        <div className="pdp__more flex min-w-0 flex-col gap-4 self-start">
          {/* Buyer protection summary — the dispute rules live on /protection;
              this is the short version so a buyer sees the guarantee before
              they need it, not only after something goes wrong. */}
          <Rv className="tile" stagger={2}>
            <span className="microlabel microlabel--ink">Buyer protection</span>
            <p className="kv mt-2 text-dim">
              Covered: item never arrives, arrives damaged, is significantly not as described, or
              is the wrong item.
            </p>
            <p className="spec-note mt-2">
              Report a problem within {DISPUTE_WINDOW_DAYS} days of delivery and the seller has{" "}
              {SELLER_RESPONSE_DAYS} days to respond before DRVN can step in.
            </p>
            <Link href="/protection" className="jumplink mt-2 inline-flex">
              How protection &amp; disputes work
            </Link>
          </Rv>

          {sourceCar?.is_public && (
            <Rv className="tile tile--deep" stagger={4}>
              <div className="tile__head">
                <span className="microlabel microlabel--ink">
                  {modLineName ? `Came off ${sourceCar.name}` : "Came off this car"}
                </span>
                <span className="chip chip--ok">Build page</span>
              </div>
              <Link href={`/cars/${sourceCar.slug}?fromListing=${encodeURIComponent(id)}${returnTo ? `&from=${encodeURIComponent(returnTo)}` : ""}`} className="order !bg-transparent !p-0">
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

      <SimilarInCategory category={listing.category} excludeId={listing.id} excludeSeller={listing.seller_id} supabase={supabase} />

      {moreFromSellerCards.length > 0 && (
        <section className="deck">
          <div className="marketplace-grid">
            <div className="tile__head">
              <span className="microlabel microlabel--ink">More from this seller</span>
            </div>
            <Mosaic label="More from this seller">
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
