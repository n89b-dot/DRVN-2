import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Avatar, ButtonLink, Foot, Media, MetadataTags, TileHead } from "@/components/ui";
import { FollowButton, SaveButton } from "@/features/social/buttons";
import { formatPrice } from "@/lib/payments/fee";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";

import { CarTabs, type ForSaleItem, type ModLine } from "./car-tabs";
import { reportError } from "@/lib/monitoring";
import { listingHref, shoppingReturn } from "@/lib/marketplace/state";
import { vehicleSubline } from "@/lib/vehicles/label";
import { fetchModProvenance } from "@/lib/mods/provenance";
import { postHeadline } from "@/lib/activity/headline";
import { CAR_COLUMNS } from "@/lib/cars/columns";

const TAB_KEYS = ["build", "forsale", "activity", "gallery"];

/** The build panel absorbed the old About and The-build sections. */
const TAB_ALIASES: Record<string, string> = { about: "build", mods: "build", parts: "forsale" };

function resolveView(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const resolved = TAB_ALIASES[value] ?? value;
  return TAB_KEYS.includes(resolved) ? resolved : undefined;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * Per-car metadata. Build pages are the most-shared surface in the product and
 * previously inherited the site-wide title, so every link unfurled identically.
 * The canonical drops `?view=`, so tab variants don't split the SEO signal.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: car } = await supabase
    .from("cars")
    .select("name, make, model, year, about, cover_image_url, is_public")
    .eq("slug", slug)
    .maybeSingle();

  if (!car) return { title: "Car not found - DRVN" };

  // Null when the car is named by its label — "2015 Ferrari 458 Speciale —
  // 2015 Ferrari 458 Speciale" is not a title.
  const spec = vehicleSubline(car.name, car);
  const description =
    car.about?.slice(0, 155) ??
    `${spec || car.name} on DRVN — the full build, and the parts for sale off it.`;

  return {
    title: `${car.name}${spec ? ` — ${spec}` : ""} - DRVN`,
    description,
    alternates: { canonical: `/cars/${slug}` },
    robots: car.is_public ? undefined : { index: false, follow: false },
    // No `images` here: the designed share card (§AB) comes from the
    // opengraph-image.tsx file convention in this segment, which an explicit
    // images array would override with the bare cover photo.
    openGraph: {
      title: `${car.name} on DRVN`,
      description,
      url: `/cars/${slug}`,
      type: "article",
    },
    twitter: {
      card: "summary_large_image",
      title: `${car.name} on DRVN`,
      description,
    },
  };
}

export default async function CarPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; fromListing?: string; from?: string }>;
}) {
  const { slug } = await params;
  const { view, fromListing, from } = await searchParams;
  const returnTo = shoppingReturn(from);
  const returnListing = typeof fromListing === "string" && /^[\da-f-]{36}$/i.test(fromListing) ? listingHref(fromListing, returnTo ?? undefined) : null;
  const supabase = await createClient();

  const { data: car, error: carError } = await supabase
    .from("cars")
    .select(CAR_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (carError) {
    reportError("[cars] failed to load car", { slug, carError });
    throw new Error("Could not load this build");
  }
  if (!car) notFound();

  const user = await getViewer();
  const [{ data: owner }, { data: images }, { data: mods }, { data: posts }, { data: released }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("id", car.owner_id)
        .maybeSingle(),
      supabase
        .from("car_images")
        .select("id, url, alt, position")
        .eq("car_id", car.id)
        .order("position"),
      supabase.from("mod_items").select("*").eq("car_id", car.id).order("position"),
      supabase
        .from("activity_posts")
        .select("id, title, body, intro, published_at")
        .eq("car_id", car.id)
        // Published only — RLS lets the author read their own drafts, which
        // then counted and listed here with no date (the garage filters too).
        .not("published_at", "is", null)
        .order("published_at", { ascending: false })
        .limit(50),
      // The marketplace payload of this page. The build page never queried
      // listings at all, so "what came off this car" — the product's own thesis
      // — was missing from the one page that should carry it.
      supabase
        .from("listings")
        .select("id, title, price_cents, status, created_at")
        .eq("source_car_id", car.id)
        // Reserved is still for sale here, as it is in the garage's count —
        // a part with a buyer part-way through didn't vanish from both lists.
        .in("status", ["active", "reserved", "sold"])
        .order("created_at", { ascending: false })
        .limit(50),
    ]);


  const postIds = (posts ?? []).map(p => p.id);
  const linkedListingIds = (mods ?? []).map(m => m.linked_listing_id).filter((id): id is string => Boolean(id));
  const releasedIds = (released ?? []).map(l => l.id);
  const [{ data: save }, { data: follow }, { data: postImages }, { data: linkedListings }, { data: listingImages }, { data: hotspots }, provenance] = await Promise.all([
    user ? supabase.from("saves").select("target_id").eq("user_id", user.id).eq("target_type", "car").eq("target_id", car.id).maybeSingle() : Promise.resolve({ data: null }),
    user ? supabase.from("follows").select("target_id").eq("follower_id", user.id).eq("target_type", "car").eq("target_id", car.id).maybeSingle() : Promise.resolve({ data: null }),
    postIds.length ? supabase.from("activity_images").select("post_id, url, alt, position").in("post_id", postIds).order("position") : Promise.resolve({ data: [] }),
    linkedListingIds.length ? supabase.from("listings").select("id, price_cents, status").in("id", linkedListingIds) : Promise.resolve({ data: [] }),
    releasedIds.length ? supabase.from("listing_images").select("listing_id, url, position").in("listing_id", releasedIds).order("position") : Promise.resolve({ data: [] }),
    supabase.from("car_hotspots").select("id, image_url, x, y, mod_item_id, label").eq("car_id", car.id).order("created_at"),
    // C-1: "Bought on DRVN · off {car}", read back from the frozen purchase
    // record so a source build that has since gone private stops being
    // named. Needs only the mod rows, so it rides this round.
    fetchModProvenance(
      supabase,
      (mods ?? []).flatMap((m) => (m.source_order_item_id ? [m.source_order_item_id] : []))
    ),
  ]);
  const isSaved = Boolean(save);
  const isFollowing = Boolean(follow);

  const galleryByPost = new Map<string, { url: string; alt: string | null }[]>();
  for (const img of postImages ?? []) {
    const list = galleryByPost.get(img.post_id) ?? [];
    list.push({ url: img.url, alt: img.alt });
    galleryByPost.set(img.post_id, list);
  }

  // A-2. Removal is a state, so the sheet arrives holding both: what is on
  // the car, and what came off it. The build reads as the car's current spec;
  // the parts that left get their own section rather than vanishing, because
  // they are the provenance behind every listing released off this build.
  const fittedMods = (mods ?? []).filter((m) => m.status === "installed");
  const removedMods = (mods ?? []).filter((m) => m.status === "removed");

  // Every group, Wheels & Tires included, renders through the same build
  // row — it used to become a key/value table with the product right-aligned
  // in mono, which read as a price.
  const groupOrder = ["Performance", "Suspension", "Brakes", "Wheels & Tires", "Exterior", "Interior", "Other"];
  const grouped = new Map<string, typeof fittedMods>();
  for (const mod of fittedMods) {
    const list = grouped.get(mod.group_label) ?? [];
    list.push(mod);
    grouped.set(mod.group_label, list);
  }
  const listingForMod = (modListingId: string | null) => {
    if (!modListingId) return null;
    const found = (linkedListings ?? []).find((l) => l.id === modListingId);
    if (!found) return null;
    return { id: found.id, price: formatPrice(found.price_cents), status: found.status };
  };

  const boughtLine = (m: { source_order_item_id: string | null }) => {
    const found = m.source_order_item_id ? provenance.get(m.source_order_item_id) : undefined;
    return found ?? null;
  };

  const modGroups = [...grouped.entries()]
    .sort((a, b) => {
      const ai = groupOrder.indexOf(a[0]);
      const bi = groupOrder.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([label, items]) => ({
      label,
      items: items.map(
        (m): ModLine => ({
          id: m.id,
          brand: m.brand,
          product: m.product,
          raw: m.raw_text,
          listing: listingForMod(m.linked_listing_id),
          bought: boughtLine(m),
          productUrl: m.product_url,
          imageUrl: m.image_url,
          sourceDomain: m.source_domain,
        })
      ),
    }));
  const cameOff: ModLine[] = removedMods.map((m) => ({
    id: m.id,
    brand: m.brand,
    product: m.product,
    raw: m.raw_text,
    listing: listingForMod(m.linked_listing_id),
    bought: boughtLine(m),
    productUrl: m.product_url,
    imageUrl: m.image_url,
    sourceDomain: m.source_domain,
  }));

  const listingCover = new Map<string, string>();
  for (const img of listingImages ?? []) {
    if (!listingCover.has(img.listing_id)) listingCover.set(img.listing_id, img.url);
  }

  const forSale: ForSaleItem[] = (released ?? []).map((l) => ({
    id: l.id,
    title: l.title,
    price: formatPrice(l.price_cents),
    status: l.status,
    cover: listingCover.get(l.id) ?? null,
  }));
  const soldFrom = forSale.filter((i) => i.status === "sold").length;

  // The annotated showcase (§U): one pinned photo, revealed on request. Each
  // pin leads to its live listing when the part is for sale, otherwise it just
  // names the part where it sits.
  const showcase =
    hotspots && hotspots.length
      ? {
          imageUrl: hotspots[0].image_url,
          pins: hotspots.map((pin) => {
            const mod = (mods ?? []).find((m) => m.id === pin.mod_item_id);
            const listing = mod ? listingForMod(mod.linked_listing_id) : null;
            return {
              id: pin.id,
              x: Number(pin.x),
              y: Number(pin.y),
              label: pin.label,
              href: listing && listing.status === "active" ? `/listings/${listing.id}` : null,
              hrefLabel:
                listing && listing.status === "active" ? `For sale · ${listing.price} →` : null,
            };
          }),
        }
      : null;

  const gallery = (images ?? []).map((i) => ({ url: i.url, alt: i.alt }));
  // Build Evolution (§V): a milestone is any dated published update with a
  // photo — derived, never entered.
  const evolution = (posts ?? [])
    .filter((p) => p.published_at && (galleryByPost.get(p.id) ?? []).length > 0)
    .map((p) => ({
      id: p.id,
      publishedAt: p.published_at as string,
      title: postHeadline(p),
      imageUrl: (galleryByPost.get(p.id) ?? [])[0].url,
      href: `/cars/${car.slug}/activity/${p.id}`,
    }));

  const activity = (posts ?? []).map((p) => ({
    id: p.id,
    date: formatDate(p.published_at),
    title: postHeadline(p),
    intro: p.intro,
    gallery: galleryByPost.get(p.id) ?? [],
  }));

  const ownerName = owner?.display_name ?? (owner?.username ? `@${owner.username}` : "");
  // The line under the name: the vehicle when it adds information, then the
  // colour. A nameless car's label already leads, so only the colour remains.
  const carMeta = [vehicleSubline(car.name, car), car.color].filter(Boolean).join(" · ");
  const isOwner = user?.id === car.owner_id;
  const liveCount = forSale.filter((i) => i.status !== "sold").length;
  // The at-a-glance line the garage has: what's on it, what's been posted,
  // what you could buy off it. Zeroes are left out rather than shouted.
  const glance = [
    fittedMods.length ? `${fittedMods.length} mod${fittedMods.length === 1 ? "" : "s"}` : null,
    activity.length ? `${activity.length} update${activity.length === 1 ? "" : "s"}` : null,
    liveCount ? `${liveCount} part${liveCount === 1 ? "" : "s"} for sale` : null,
    gallery.length ? `${gallery.length} photo${gallery.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return (
    <div className="wrap">
      {returnListing && <nav aria-label="Return to part" className="marketplace-breadcrumb"><Link href={returnListing}>← Back to the part</Link></nav>}
      {/* The head holds who and what in one block — name, vehicle, owner,
          Follow and Save, and the at-a-glance line — so the capped cover
          below it and the tabs under that both reach the first screen. */}
      <Rv as="header" className="pagehead carhead">
        <span className="microlabel">{isOwner ? "Your build" : "Build"}</span>
        <div className="carhead__row">
          <div className="min-w-0">
            <h1>{car.name}</h1>
            {carMeta && <p className="kv mt-2 text-dim">{carMeta}</p>}
          </div>
          {/* The owner gets their tools where a visitor gets Follow · Save —
              not just a link in the kicker. */}
          {isOwner && (
            <span className="carhead__actions">
              <ButtonLink href={`/garage/${car.id}/update/new`} variant="ghost">
                Post an update
              </ButtonLink>
              <ButtonLink href={`/garage/${car.id}/edit`} variant="ghost">
                Manage
              </ButtonLink>
            </span>
          )}
          {!isOwner && (
            <span className="carhead__actions">
              <FollowButton
                targetType="car"
                targetId={car.id}
                path={`/cars/${car.slug}`}
                initialFollowing={isFollowing}
                isLoggedIn={Boolean(user)}
              />
              <SaveButton
                targetType="car"
                targetId={car.id}
                path={`/cars/${car.slug}`}
                initialSaved={isSaved}
                isLoggedIn={Boolean(user)}
              />
            </span>
          )}
        </div>
        <div className="byrow">
          {owner && (
            <Link href={`/u/${owner.username}`} className="byline">
              <span className="byline__avatar">
                {owner.avatar_url ? (
                  <Media src={owner.avatar_url} alt="" className="h-full w-full" role="avatar" />
                ) : (
                  <Avatar size="sm" initials={ownerName.replace(/^@/, "").slice(0, 2).toUpperCase()} />
                )}
              </span>
              <span>
                <span className="text-dim">Built by </span>
                {ownerName}
              </span>
            </Link>
          )}
          {glance.length > 0 && <span className="microlabel">{glance.join(" · ")}</span>}
        </div>
        {car.tags.length > 0 && (
          <div className="mt-4">
            <MetadataTags tags={car.tags} />
          </div>
        )}
      </Rv>

      {car.cover_image_url && (
        <Rv className="hero-media carhero mb-6" immediate>
          <Media
            src={car.cover_image_url}
            alt={car.name}
            className="h-full w-full"
            role="hero"
            focal={{ x: car.cover_focal_x, y: car.cover_focal_y }}
          />
        </Rv>
      )}

      <CarTabs
        about={car.about}
        gallery={gallery}
        modGroups={modGroups}
        cameOff={cameOff}
        activity={activity}
        forSale={forSale}
        soldFrom={soldFrom}
        carName={car.name}
        carId={car.id}
        slug={car.slug}
        isOwner={isOwner}
        initialTab={resolveView(view)}
        showcase={showcase}
        evolution={evolution}
      />

      {/* The page people land on from a shared link — the moment to say the
          visitor's own car could have one. Signed-out viewers only. */}
      {!user && (
        <section className="tile mt-10">
          <TileHead label="Your car deserves a page like this" />
          <p className="max-w-[56ch] text-body text-dim">
            Put your car on DRVN: the build, the updates, and every part you sell off it — with the
            car attached.
          </p>
          <div className="mt-4">
            <ButtonLink href="/signup?next=%2Fgarage" variant="live">
              Add your car
            </ButtonLink>
          </div>
        </section>
      )}

      <Foot
        left="DRVN — build page"
        right={<Link href="/marketplace">Browse parts →</Link>}
      />
    </div>
  );
}
