import { NextResponse } from "next/server";

import { abuseIdentity, attributedNetworkIdentity } from "@/lib/abuse-identity";
import { allowAction, RATE_LIMITS } from "@/lib/rate-limit";
import { searchAccounts } from "@/lib/explore/search/query";
import { getExploreSearchProvider } from "@/lib/explore/search/provider";
import { getSearchProvider } from "@/lib/marketplace/search/provider";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { createClient } from "@/lib/supabase/server";
import { vehicleSubline } from "@/lib/vehicles/label";
import { postHeadline } from "@/lib/activity/headline";
import { postHref } from "@/lib/activity/href";

/**
 * Explore autocomplete (brief §11) — a compact orientation aid, not the
 * results page in a dropdown: at most 3 builds, 3 updates, 2 accounts and 3
 * parts per query, resolved through the same provider seams as the full
 * search so a suggestion always leads somewhere the results page agrees
 * with. Public data only — parts included, for signed-out visitors too
 * (matching the feed taxonomy, PRD 2026-09 E-5), so the endpoint never
 * reads the session. Minimum query length lives here AND in the client so a
 * hand-crafted request can't turn one keystroke into a fan-out.
 *
 * Throttled (N27) before any query runs: by the visitor's address, or — where
 * no address can be trusted — by one shared ceiling. A refused request gets a
 * 429 with no groups and a Retry-After; the client already treats any
 * non-OK answer as "no suggestions" and the search form still submits.
 * A query longer than an autocomplete query is answered with no groups
 * rather than searched: the results page takes long queries.
 */

export type SuggestItem = { id: string; label: string; sub: string | null; href: string };
export type SuggestGroup = { kind: "builds" | "updates" | "accounts" | "parts"; label: string; items: SuggestItem[] };
export type SuggestResponse = { q: string; groups: SuggestGroup[]; limited?: true };

const MIN_QUERY = 2;
const MAX_QUERY = 80;

export async function GET(request: Request): Promise<NextResponse<SuggestResponse>> {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) return NextResponse.json({ q: q.slice(0, MAX_QUERY), groups: [] });

  const visitor = attributedNetworkIdentity(request.headers);
  const rule = visitor ? RATE_LIMITS.searchSuggest : RATE_LIMITS.searchSuggestUnattributed;
  if (!(await allowAction(rule, visitor ?? abuseIdentity(request.headers)))) {
    return NextResponse.json(
      { q, groups: [], limited: true },
      { status: 429, headers: { "Retry-After": String(rule.windowSeconds), "Cache-Control": "no-store" } },
    );
  }

  const supabase = await createClient();
  const provider = getExploreSearchProvider();

  const [carIds, updateIds, accounts, listingIds] = await Promise.all([
    provider.searchIds("car", q, { limit: 3 }).catch(() => []),
    provider.searchIds("update", q, { limit: 3 }).catch(() => []),
    searchAccounts(supabase, q, 2).catch(() => []),
    getSearchProvider()
      .searchIds(q, { limit: 3 })
      .catch(() => []),
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
          .select("id, title, intro, body, car_id, published_at")
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
  // A post with no car at all (W-5) skips the gate: publishing it is the
  // whole of its visibility.
  const updateCarIds = [...new Set(updates.flatMap((p) => (p.car_id ? [p.car_id] : [])))];
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
    .filter((p) => !p.car_id || carById.has(p.car_id))
    .sort((a, b) => (updateOrder.get(a.id) ?? 99) - (updateOrder.get(b.id) ?? 99))
    .map((p) => {
      const car = p.car_id ? carById.get(p.car_id) : null;
      return {
        id: p.id,
        label: postHeadline(p),
        sub: car?.name ?? "Update",
        href: postHref({ id: p.id, carSlug: car?.slug ?? null }),
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
