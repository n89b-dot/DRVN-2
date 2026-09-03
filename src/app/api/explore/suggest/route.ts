import { NextResponse } from "next/server";

import { searchAccounts } from "@/lib/explore/search/query";
import { getExploreSearchProvider } from "@/lib/explore/search/provider";
import { getSearchProvider } from "@/lib/marketplace/search/provider";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";
import { vehicleSubline } from "@/lib/vehicles/label";

/**
 * Explore autocomplete (brief §11) — a compact orientation aid, not the
 * results page in a dropdown: at most 3 builds, 3 updates, 2 accounts and 3
 * parts per query, resolved through the same provider seams as the full
 * search so a suggestion always leads somewhere the results page agrees
 * with. Public data only; parts ride along only for signed-in viewers
 * (matching the feed taxonomy, PRD §8.2). Minimum query length lives here
 * AND in the client so a hand-crafted request can't turn one keystroke into
 * a fan-out.
 */

export type SuggestItem = { id: string; label: string; sub: string | null; href: string };
export type SuggestGroup = { kind: "builds" | "updates" | "accounts" | "parts"; label: string; items: SuggestItem[] };
export type SuggestResponse = { q: string; groups: SuggestGroup[] };

const MIN_QUERY = 2;
const MAX_QUERY = 120;

export async function GET(request: Request): Promise<NextResponse<SuggestResponse>> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").slice(0, MAX_QUERY).trim();
  const empty: SuggestResponse = { q, groups: [] };
  if (q.length < MIN_QUERY) return NextResponse.json(empty);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const provider = getExploreSearchProvider();

  const [carIds, updateIds, accounts, listingIds] = await Promise.all([
    provider.searchIds("car", q, { limit: 3 }).catch(() => []),
    provider.searchIds("update", q, { limit: 3 }).catch(() => []),
    searchAccounts(supabase, q, 2).catch(() => []),
    user
      ? getSearchProvider()
          .searchIds(q, { limit: 3 })
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  const [carsRes, updatesRes, listingsRes] = await Promise.all([
    carIds?.length
      ? supabase
          .from("cars")
          .select("id, name, slug, make, model, year")
          .eq("is_public", true)
          .in("id", carIds.slice(0, 3))
      : Promise.resolve({ data: [] }),
    updateIds?.length
      ? supabase
          .from("activity_posts")
          .select("id, title, car_id, published_at")
          .not("published_at", "is", null)
          .in("id", updateIds.slice(0, 3))
      : Promise.resolve({ data: [] }),
    listingIds?.length
      ? supabase
          .from("listings")
          .select("id, title, price_cents, status")
          .eq("status", "active")
          .in("id", listingIds.slice(0, 3))
      : Promise.resolve({ data: [] }),
  ]);

  const cars = carsRes.data ?? [];
  const updates = updatesRes.data ?? [];
  const listings = listingsRes.data ?? [];

  // The updates' owning cars, for the permalink and the "on <build>" line —
  // and the visibility gate: a post whose car isn't public never suggests.
  const updateCarIds = [...new Set(updates.map((p) => p.car_id))];
  const { data: updateCars } = updateCarIds.length
    ? await supabase
        .from("cars")
        .select("id, name, slug, is_public")
        .eq("is_public", true)
        .in("id", updateCarIds)
    : { data: [] };
  const carById = new Map((updateCars ?? []).map((c) => [c.id, c]));

  const orderOf = (ids: string[] | null) => new Map((ids ?? []).map((id, i) => [id, i]));
  const carOrder = orderOf(carIds);
  const updateOrder = orderOf(updateIds);
  const listingOrder = orderOf(listingIds);

  const groups: SuggestGroup[] = [];

  const buildItems: SuggestItem[] = cars
    .sort((a, b) => (carOrder.get(a.id) ?? 99) - (carOrder.get(b.id) ?? 99))
    .map((c) => ({
      id: c.id,
      label: c.name,
      sub: vehicleSubline(c.name, {
        year: c.year ?? undefined,
        make: c.make ?? undefined,
        model: c.model ?? undefined,
      }),
      href: `/cars/${c.slug}`,
    }));
  if (buildItems.length) groups.push({ kind: "builds", label: "Builds", items: buildItems });

  const updateItems: SuggestItem[] = updates
    .filter((p) => carById.has(p.car_id))
    .sort((a, b) => (updateOrder.get(a.id) ?? 99) - (updateOrder.get(b.id) ?? 99))
    .map((p) => {
      const car = carById.get(p.car_id)!;
      return {
        id: p.id,
        label: p.title,
        sub: car.name,
        href: `/cars/${car.slug}/activity/${p.id}`,
      };
    });
  if (updateItems.length) groups.push({ kind: "updates", label: "Updates", items: updateItems });

  const accountItems: SuggestItem[] = accounts
    .filter((a) => a.username)
    .map((a) => ({
      id: a.id,
      label: a.display_name ?? `@${a.username}`,
      sub: a.display_name && a.username ? `@${a.username}` : null,
      href: `/u/${a.username}`,
    }));
  if (accountItems.length)
    groups.push({ kind: "accounts", label: "Accounts", items: accountItems });

  const partItems: SuggestItem[] = listings
    .sort((a, b) => (listingOrder.get(a.id) ?? 99) - (listingOrder.get(b.id) ?? 99))
    .map((l) => ({
      id: l.id,
      label: l.title,
      sub: formatPrice(l.price_cents),
      href: `/listings/${l.id}`,
    }));
  if (partItems.length) groups.push({ kind: "parts", label: "Parts", items: partItems });

  return NextResponse.json({ q, groups });
}
