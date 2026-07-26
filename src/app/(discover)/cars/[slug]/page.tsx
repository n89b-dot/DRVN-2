import Link from "next/link";
import { notFound } from "next/navigation";

import { MetadataTags, NarrowColumn, ProfileHeader } from "@/components/ui";
import { FollowButton, SaveButton } from "@/features/social/buttons";
import { createClient } from "@/lib/supabase/server";

import { CarTabs } from "./car-tabs";

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export default async function CarPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: car } = await supabase.from("cars").select("*").eq("slug", slug).single();
  if (!car) notFound();

  const [{ data: owner }, { data: images }, { data: mods }, { data: posts }] = await Promise.all([
    supabase.from("profiles").select("username, display_name, avatar_url").eq("id", car.owner_id).single(),
    supabase.from("car_images").select("id, url, alt, position").eq("car_id", car.id).order("position"),
    supabase.from("mod_items").select("*").eq("car_id", car.id).order("position"),
    supabase
      .from("activity_posts")
      .select("id, title, intro, published_at")
      .eq("car_id", car.id)
      .order("published_at", { ascending: false }),
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
  const modGroups = [...grouped.entries()]
    .sort((a, b) => {
      const ai = groupOrder.indexOf(a[0]);
      const bi = groupOrder.indexOf(b[0]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    })
    .map(([label, items]) => ({
      label,
      items: items.map((m) => ({ brand: m.brand, product: m.product, raw: m.raw_text })),
    }));
  const wheelRows = wheelMods.map((m) => ({
    label: m.brand ?? "Spec",
    value: m.product ?? m.raw_text ?? "",
  }));

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
    <NarrowColumn>
      <ProfileHeader
        avatarSquare
        avatarUrl={car.cover_image_url}
        initials={car.name.slice(0, 2).toUpperCase()}
        name={car.name}
        handle={carMeta}
        action={
          user?.id !== car.owner_id ? (
            <div className="flex gap-2">
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
            </div>
          ) : undefined
        }
      />

      {owner && (
        <Link
          href={`/u/${owner.username}`}
          className="mt-3 inline-block text-sm text-text-muted transition hover:text-text-secondary"
        >
          {ownerName} ↗
        </Link>
      )}

      {car.tags.length > 0 && (
        <div className="mt-5">
          <MetadataTags tags={car.tags} />
        </div>
      )}

      <div className="mt-8">
        <CarTabs
          about={car.about}
          gallery={gallery}
          modGroups={modGroups}
          wheelRows={wheelRows}
          activity={activity}
          carName={car.name}
          slug={car.slug}
        />
      </div>
    </NarrowColumn>
  );
}
