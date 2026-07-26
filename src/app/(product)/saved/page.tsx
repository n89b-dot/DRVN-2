import Link from "next/link";

import { Avatar, ListingCard, Media, NarrowColumn, SectionLabel } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Saved - DRVN" };

export default async function SavedPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: saves } = await supabase
    .from("saves")
    .select("target_type, target_id, created_at")
    .eq("user_id", user!.id)
    .order("created_at", { ascending: false });

  const listingIds = (saves ?? []).filter((s) => s.target_type === "listing").map((s) => s.target_id);
  const carIds = (saves ?? []).filter((s) => s.target_type === "car").map((s) => s.target_id);
  const profileIds = (saves ?? []).filter((s) => s.target_type === "profile").map((s) => s.target_id);

  const [{ data: listings }, { data: cars }, { data: profiles }, { data: listingImages }] =
    await Promise.all([
      listingIds.length
        ? supabase
            .from("listings")
            .select("id, title, price_cents, condition, location, status")
            .in("id", listingIds)
        : Promise.resolve({ data: [] }),
      carIds.length
        ? supabase.from("cars").select("id, slug, name, make, model, year, cover_image_url").in("id", carIds)
        : Promise.resolve({ data: [] }),
      profileIds.length
        ? supabase.from("profiles").select("id, username, display_name").in("id", profileIds)
        : Promise.resolve({ data: [] }),
      listingIds.length
        ? supabase
            .from("listing_images")
            .select("listing_id, url, position")
            .in("listing_id", listingIds)
            .order("position")
        : Promise.resolve({ data: [] }),
    ]);

  const cover = new Map<string, string>();
  for (const img of listingImages ?? []) {
    if (!cover.has(img.listing_id)) cover.set(img.listing_id, img.url);
  }

  const isEmpty = !listingIds.length && !carIds.length && !profileIds.length;

  return (
    <NarrowColumn>
      <SectionLabel>Saved</SectionLabel>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Saved</h1>

      {isEmpty && (
        <p className="mt-6 text-sm text-text-muted">
          Nothing saved yet. Save parts, cars, and sellers as you browse.
        </p>
      )}

      {(listings ?? []).length > 0 && (
        <div className="mt-8">
          <SectionLabel>Parts</SectionLabel>
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {(listings ?? []).map((l) => (
              <ListingCard
                key={l.id}
                listing={{
                  id: l.id,
                  title: l.title,
                  price_cents: l.price_cents,
                  condition: l.condition,
                  location: l.status === "active" ? l.location : `${l.status}`,
                  cover_url: cover.get(l.id) ?? null,
                }}
              />
            ))}
          </div>
        </div>
      )}

      {(cars ?? []).length > 0 && (
        <div className="mt-8">
          <SectionLabel>Cars</SectionLabel>
          <div className="mt-3 flex flex-col gap-3">
            {(cars ?? []).map((car) => (
              <Link
                key={car.id}
                href={`/cars/${car.slug}`}
                className="flex items-center gap-4 rounded-card border border-border bg-surface p-4 transition hover:border-text-muted"
              >
                <Media
                  src={car.cover_image_url ?? undefined}
                  alt={car.name}
                  className="h-14 w-20 shrink-0 rounded-tile"
                />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text-primary">{car.name}</p>
                  <p className="mt-0.5 text-sm text-text-muted">
                    {[car.year, car.make, car.model].filter(Boolean).join(" ")}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {(profiles ?? []).length > 0 && (
        <div className="mt-8">
          <SectionLabel>Sellers</SectionLabel>
          <div className="mt-3 flex flex-col gap-2">
            {(profiles ?? []).map((p) => (
              <Link
                key={p.id}
                href={`/u/${p.username}`}
                className="flex items-center gap-3 rounded-card border border-border bg-surface px-4 py-3 transition hover:border-text-muted"
              >
                <Avatar
                  size="h-9 w-9"
                  initials={(p.display_name ?? p.username ?? "?")
                    .split(" ")
                    .map((w: string) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                />
                <span className="text-sm text-text-primary">{p.display_name ?? `@${p.username}`}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </NarrowColumn>
  );
}
