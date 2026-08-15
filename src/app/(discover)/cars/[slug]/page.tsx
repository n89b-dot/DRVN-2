import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Rv } from "@/components/livesheet";
import { Foot, Media, MetadataTags } from "@/components/ui";
import { FollowButton, SaveButton } from "@/features/social/buttons";
import { formatPrice } from "@/lib/payments/fee";
import { createClient } from "@/lib/supabase/server";

import { CarTabs, type ForSaleItem, type ModLine } from "./car-tabs";
import { reportError } from "@/lib/monitoring";

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

  const spec = [car.year && String(car.year), [car.make, car.model].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" ");
  const description =
    car.about?.slice(0, 155) ??
    `${spec || car.name} on DRVN — the full build, and the parts for sale off it.`;

  return {
    title: `${car.name}${spec ? ` — ${spec}` : ""} - DRVN`,
    description,
    alternates: { canonical: `/cars/${slug}` },
    robots: car.is_public ? undefined : { index: false, follow: false },
    openGraph: {
      title: `${car.name} on DRVN`,
      description,
      url: `/cars/${slug}`,
      type: "article",
      images: car.cover_image_url ? [{ url: car.cover_image_url }] : undefined,
    },
    twitter: {
      card: car.cover_image_url ? "summary_large_image" : "summary",
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
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view } = await searchParams;
  const supabase = await createClient();

  const { data: car, error: carError } = await supabase
    .from("cars")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (carError) {
    reportError("[cars] failed to load car", { slug, carError });
    throw new Error("Could not load this build");
  }
  if (!car) notFound();

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
        .select("id, title, intro, published_at")
        .eq("car_id", car.id)
        .order("published_at", { ascending: false })
        .limit(50),
      // The marketplace payload of this page. The build page never queried
      // listings at all, so "what came off this car" — the product's own thesis
      // — was missing from the one page that should carry it.
      supabase
        .from("listings")
        .select("id, title, price_cents, status, created_at")
        .eq("source_car_id", car.id)
        .in("status", ["active", "sold"])
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let isSaved = false;
  let isFollowing = false;
  if (user) {
    const [{ data: save }, { data: follow }] = await Promise.all([
      supabase
        .from("saves")
        .select("target_id")
        .eq("user_id", user.id)
        .eq("target_type", "car")
        .eq("target_id", car.id)
        .maybeSingle(),
      supabase
        .from("follows")
        .select("target_id")
        .eq("follower_id", user.id)
        .eq("target_type", "car")
        .eq("target_id", car.id)
        .maybeSingle(),
    ]);
    isSaved = Boolean(save);
    isFollowing = Boolean(follow);
  }

  // Activity images for the timeline.
  const postIds = (posts ?? []).map((p) => p.id);
  const { data: postImages } = postIds.length
    ? await supabase
        .from("activity_images")
        .select("post_id, url, alt, position")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };
  const galleryByPost = new Map<string, { url: string; alt: string | null }[]>();
  for (const img of postImages ?? []) {
    const list = galleryByPost.get(img.post_id) ?? [];
    list.push({ url: img.url, alt: img.alt });
    galleryByPost.set(img.post_id, list);
  }

  // Split mods: "Wheels & Tires" group becomes the key/value table.
  const wheelMods = (mods ?? []).filter((m) => m.group_label === "Wheels & Tires");
  const otherMods = (mods ?? []).filter((m) => m.group_label !== "Wheels & Tires");
  const groupOrder = ["Performance", "Suspension", "Exterior", "Interior", "Other"];
  const grouped = new Map<string, typeof otherMods>();
  for (const mod of otherMods) {
    const list = grouped.get(mod.group_label) ?? [];
    list.push(mod);
    grouped.set(mod.group_label, list);
  }
  // Listings linked from a build line, so a mod row can show it as released.
  const linkedListingIds = (mods ?? [])
    .map((m) => m.linked_listing_id)
    .filter((id): id is string => Boolean(id));
  const { data: linkedListings } = linkedListingIds.length
    ? await supabase
        .from("listings")
        .select("id, price_cents, status")
        .in("id", linkedListingIds)
    : { data: [] };
  const listingForMod = (modListingId: string | null) => {
    if (!modListingId) return null;
    const found = (linkedListings ?? []).find((l) => l.id === modListingId);
    if (!found) return null;
    return { id: found.id, price: formatPrice(found.price_cents), status: found.status };
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
        })
      ),
    }));
  const wheelRows = wheelMods.map((m) => ({
    label: m.brand ?? "Spec",
    value: m.product ?? m.raw_text ?? "",
  }));

  // Covers for the released-parts list.
  const releasedIds = (released ?? []).map((l) => l.id);
  const { data: listingImages } = releasedIds.length
    ? await supabase
        .from("listing_images")
        .select("listing_id, url, position")
        .in("listing_id", releasedIds)
        .order("position")
    : { data: [] };
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

  const gallery = (images ?? []).map((i) => ({ url: i.url, alt: i.alt }));
  const activity = (posts ?? []).map((p) => ({
    id: p.id,
    date: formatDate(p.published_at),
    title: p.title,
    intro: p.intro,
    gallery: galleryByPost.get(p.id) ?? [],
  }));

  const ownerName = owner?.display_name ?? (owner?.username ? `@${owner.username}` : "");
  const carMeta = [car.year && String(car.year), [car.make, car.model].filter(Boolean).join(" "), car.color]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="wrap">
      <Rv as="header" className="pagehead">
        <span className="microlabel">
          Build page — public
          {user?.id === car.owner_id && (
            <>
              {" · "}
              <Link href={`/garage/${car.id}/edit`} className="hover:text-live">
                manage this car →
              </Link>
            </>
          )}
        </span>
        <h1>{car.name}</h1>
        {carMeta && <p className="kv mt-2 text-dim">{carMeta}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {owner && (
            <Link href={`/u/${owner.username}`} className="jumplink">
              Built by {ownerName}
            </Link>
          )}
          {user?.id !== car.owner_id && (
            <span className="flex gap-2">
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
      </Rv>

      {car.cover_image_url && (
        <Rv className="hero-media mb-6">
          <Media src={car.cover_image_url} alt={car.name} className="h-full w-full" role="hero" />
        </Rv>
      )}

      {car.tags.length > 0 && (
        <div className="mb-6">
          <MetadataTags tags={car.tags} />
        </div>
      )}

      <CarTabs
        about={car.about}
        gallery={gallery}
        modGroups={modGroups}
        wheelRows={wheelRows}
        activity={activity}
        forSale={forSale}
        soldFrom={soldFrom}
        carName={car.name}
        carId={car.id}
        slug={car.slug}
        isOwner={user?.id === car.owner_id}
        initialTab={resolveView(view)}
      />

      <Foot
        left="DRVN — build page"
        right={<Link href="/marketplace">Browse parts →</Link>}
      />
    </div>
  );
}
