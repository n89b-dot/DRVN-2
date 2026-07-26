import Link from "next/link";

import { NarrowColumn, SectionLabel } from "@/components/ui";
import { formatPrice } from "@/lib/marketplace/taxonomy";
import { prefEnabled } from "@/lib/notification-prefs";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Notifications - DRVN" };

type Entry = { id: string; text: string; href: string; when: string };

function relative(date: string) {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function Section({ label, entries, empty }: { label: string; entries: Entry[]; empty: string }) {
  return (
    <div className="mt-8">
      <SectionLabel>{label}</SectionLabel>
      {entries.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <Link
                href={entry.href}
                className="flex items-baseline justify-between gap-3 rounded-card border border-border bg-surface px-4 py-3 text-sm transition hover:border-text-muted"
              >
                <span className="text-text-secondary">{entry.text}</span>
                <span className="shrink-0 text-xs text-text-muted">{relative(entry.when)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-text-muted">{empty}</p>
      )}
    </div>
  );
}

export default async function NotificationsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: myCars }, { data: myListings }, { data: me }] = await Promise.all([
    supabase.from("cars").select("id, name, slug").eq("owner_id", user!.id),
    supabase.from("listings").select("id, title, price_cents").eq("seller_id", user!.id),
    supabase.from("profiles").select("notification_prefs").eq("id", user!.id).single(),
  ]);
  const prefs = me?.notification_prefs;

  const carIds = (myCars ?? []).map((c) => c.id);
  const listingIds = (myListings ?? []).map((l) => l.id);
  const carById = new Map((myCars ?? []).map((c) => [c.id, c]));
  const listingById = new Map((myListings ?? []).map((l) => [l.id, l]));

  // Engagement on you and your cars (Profile section, always first).
  const [{ data: profileFollows }, { data: carFollows }, { data: carSaves }, { data: listingSaves }] =
    await Promise.all([
      supabase
        .from("follows")
        .select("follower_id, created_at")
        .eq("target_type", "profile")
        .eq("target_id", user!.id)
        .order("created_at", { ascending: false })
        .limit(20),
      carIds.length
        ? supabase
            .from("follows")
            .select("follower_id, target_id, created_at")
            .eq("target_type", "car")
            .in("target_id", carIds)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      carIds.length
        ? supabase
            .from("saves")
            .select("user_id, target_id, created_at")
            .eq("target_type", "car")
            .in("target_id", carIds)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
      listingIds.length
        ? supabase
            .from("saves")
            .select("user_id, target_id, created_at")
            .eq("target_type", "listing")
            .in("target_id", listingIds)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [] }),
    ]);

  // Resolve actor names (exclude yourself).
  const actorIds = [
    ...new Set(
      [
        ...(profileFollows ?? []).map((f) => f.follower_id),
        ...(carFollows ?? []).map((f) => f.follower_id),
        ...(carSaves ?? []).map((s) => s.user_id),
        ...(listingSaves ?? []).map((s) => s.user_id),
      ].filter((id) => id !== user!.id)
    ),
  ];
  const { data: actors } = actorIds.length
    ? await supabase.from("profiles").select("id, display_name, username").in("id", actorIds)
    : { data: [] };
  const actorName = (id: string) => {
    const a = (actors ?? []).find((x) => x.id === id);
    return a?.display_name ?? (a?.username ? `@${a.username}` : "Someone");
  };

  const profileEntries: Entry[] = [
    ...(prefEnabled(prefs, "profile_follows") ? profileFollows ?? [] : [])
      .filter((f) => f.follower_id !== user!.id)
      .map((f) => ({
        id: `pf-${f.follower_id}-${f.created_at}`,
        text: `${actorName(f.follower_id)} followed you`,
        href: "/profile",
        when: f.created_at,
      })),
    ...(prefEnabled(prefs, "car_engagement") ? carFollows ?? [] : [])
      .filter((f) => f.follower_id !== user!.id)
      .map((f) => ({
        id: `cf-${f.follower_id}-${f.created_at}`,
        text: `${actorName(f.follower_id)} followed ${carById.get(f.target_id)?.name ?? "your car"}`,
        href: `/cars/${carById.get(f.target_id)?.slug ?? ""}`,
        when: f.created_at,
      })),
    ...(prefEnabled(prefs, "car_engagement") ? carSaves ?? [] : [])
      .filter((s) => s.user_id !== user!.id)
      .map((s) => ({
        id: `cs-${s.user_id}-${s.created_at}`,
        text: `${actorName(s.user_id)} saved ${carById.get(s.target_id)?.name ?? "your car"}`,
        href: `/cars/${carById.get(s.target_id)?.slug ?? ""}`,
        when: s.created_at,
      })),
  ].sort((a, b) => (a.when < b.when ? 1 : -1));

  const marketplaceEntries: Entry[] = (prefEnabled(prefs, "listing_saves") ? listingSaves ?? [] : [])
    .filter((s) => s.user_id !== user!.id)
    .map((s) => {
      const listing = listingById.get(s.target_id);
      return {
        id: `ls-${s.user_id}-${s.created_at}`,
        text: `${actorName(s.user_id)} saved "${listing?.title ?? "your listing"}" (${listing ? formatPrice(listing.price_cents) : ""})`,
        href: `/listings/${s.target_id}`,
        when: s.created_at,
      };
    })
    .sort((a, b) => (a.when < b.when ? 1 : -1));

  return (
    <NarrowColumn>
      <SectionLabel>Notifications</SectionLabel>
      <h1 className="mt-3 text-2xl font-bold text-text-primary">Notifications</h1>

      <Section
        label="Profile"
        entries={profileEntries}
        empty="No engagement yet — share your car page to get things moving."
      />
      <Section
        label="Marketplace"
        entries={marketplaceEntries}
        empty="No marketplace activity yet. Offers and sales will land here too."
      />
    </NarrowColumn>
  );
}
