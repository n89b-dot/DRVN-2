import Link from "next/link";

import { Rv } from "@/components/livesheet";
import { Foot, NarrowColumn } from "@/components/ui";
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
    <Rv className="tile">
      <div className="tile__head">
        <span className="microlabel microlabel--ink">{label}</span>
        {entries.length > 0 && <span className="chip">{entries.length}</span>}
      </div>
      {entries.length > 0 ? (
        <ul className="feed">
          {entries.map((entry) => (
            <li key={entry.id}>
              <time>{relative(entry.when)}</time>
              <Link href={entry.href} className="min-w-0 flex-1 transition-colors hover:text-live">
                {entry.text}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-2 font-mono text-[12.5px] uppercase tracking-[0.1em] text-dim">{empty}</p>
      )}
    </Rv>
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
      <Rv as="header" className="pagehead">
        <span className="microlabel">The bell — what the sheet saw</span>
        <h1>
          What the bell knows,
          <br />
          and what it <span className="live-word">sends.</span>
        </h1>
        <p className="sub">
          Engagement on you and your sheets. Tune what rings in{" "}
          <Link href="/settings#signals" className="jumplink">
            Settings → Signals
          </Link>
          .
        </p>
      </Rv>

      <div className="deck">
      <Section
        label="Profile"
        entries={profileEntries}
        empty="No engagement yet — share your car page to get things moving."
      />
      <Section
        label="Marketplace"
        entries={marketplaceEntries}
        empty="No marketplace activity yet — offers and sales land here too"
      />
      </div>

      <Foot left="DRVN / Livesheet — the bell rings for deadlines, not for attention" />
    </NarrowColumn>
  );
}
