import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/database.types";
import type { GalleryImage } from "@/components/ui";

export type ProfileVehicle = {
  id: string;
  slug: string;
  name: string;
  year: string;
  colorLabel: string;
  tags: string[];
  gallery: GalleryImage[];
};

export type ProfileActivity = {
  id: string;
  carSlug: string;
  date: string;
  title: string;
  intro: string | null;
  gallery: GalleryImage[];
};

export type ProfileView = {
  vehicles: ProfileVehicle[];
  activity: ProfileActivity[];
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/**
 * Loads a profile's vehicles + recent activity with their galleries, shaped for
 * the timeline view (mockup ProfileScreen). `publicOnly` restricts to public
 * cars for the public /u/[username] page.
 */
export async function loadProfileView(
  supabase: SupabaseClient<Database>,
  profileId: string,
  { publicOnly }: { publicOnly: boolean }
): Promise<ProfileView> {
  let carsQuery = supabase
    .from("cars")
    .select("id, slug, name, year, make, model, color, tags")
    .eq("owner_id", profileId)
    .order("year", { ascending: false, nullsFirst: false });
  if (publicOnly) carsQuery = carsQuery.eq("is_public", true);

  const { data: cars } = await carsQuery;
  const carList = cars ?? [];
  const carIds = carList.map((c) => c.id);

  const [{ data: carImages }, { data: posts }] = await Promise.all([
    carIds.length
      ? supabase
          .from("car_images")
          .select("car_id, url, alt, position")
          .in("car_id", carIds)
          .order("position")
      : Promise.resolve({ data: [] }),
    carIds.length
      ? supabase
          .from("activity_posts")
          .select("id, car_id, title, intro, published_at")
          .in("car_id", carIds)
          .not("published_at", "is", null)
          .order("published_at", { ascending: false })
          .limit(6)
      : Promise.resolve({ data: [] }),
  ]);

  const galleryByCar = new Map<string, GalleryImage[]>();
  for (const img of carImages ?? []) {
    const list = galleryByCar.get(img.car_id) ?? [];
    list.push({ url: img.url, alt: img.alt });
    galleryByCar.set(img.car_id, list);
  }

  const postIds = (posts ?? []).map((p) => p.id);
  const { data: postImages } = postIds.length
    ? await supabase
        .from("activity_images")
        .select("post_id, url, alt, position")
        .in("post_id", postIds)
        .order("position")
    : { data: [] };
  const galleryByPost = new Map<string, GalleryImage[]>();
  for (const img of postImages ?? []) {
    const list = galleryByPost.get(img.post_id) ?? [];
    list.push({ url: img.url, alt: img.alt });
    galleryByPost.set(img.post_id, list);
  }

  const slugByCar = new Map(carList.map((c) => [c.id, c.slug]));

  const vehicles: ProfileVehicle[] = carList.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    year: c.year ? String(c.year) : "—",
    colorLabel: c.color ?? [c.make, c.model].filter(Boolean).join(" "),
    tags: c.tags ?? [],
    gallery: galleryByCar.get(c.id) ?? [],
  }));

  const activity: ProfileActivity[] = (posts ?? []).map((p) => ({
    id: p.id,
    carSlug: slugByCar.get(p.car_id) ?? "",
    date: formatDate(p.published_at),
    title: p.title,
    intro: p.intro,
    gallery: galleryByPost.get(p.id) ?? [],
  }));

  return { vehicles, activity };
}
