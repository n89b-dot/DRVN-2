import Link from "next/link";

import { NarrowColumn, ProfileHeader } from "@/components/ui";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { StorePanel, forSaleCount } from "@/features/store/store-panel";
import { loadProfileView } from "@/lib/profile-data";
import { createClient } from "@/lib/supabase/server";

import { ProfileEditor } from "./profile-editor";

export const metadata = { title: "Profile - DRVN" };

type ProfileLink = { label: string; url: string };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ listingsPage?: string; reviewsPage?: string; status?: string; view?: string }>;
}) {
  const {
    listingsPage: listingsPageParam,
    reviewsPage: reviewsPageParam,
    status: storeTab,
    view: viewParam,
  } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase.from("profiles").select("id, username, display_name, headline, bio, location, links, avatar_url, profile_type, notification_prefs, payouts_enabled, store_note, created_at, updated_at").eq("id", user!.id).single();

  const view = await loadProfileView(supabase, user!.id, {
    publicOnly: false,
    listingsPage: Math.max(1, Number(listingsPageParam) || 1),
    reviewsPage: Math.max(1, Number(reviewsPageParam) || 1),
  });
  const { website, rest } = splitLinks(profile?.links);
  const name = profile?.display_name ?? "Your profile";
  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];

  return (
    <NarrowColumn>
      <div className="pagehead pagehead--task !pb-4">
        <span className="microlabel">
          Your profile ·{" "}
          <Link href={`/u/${profile?.username}`} className="hover:text-live">
            view public →
          </Link>
        </span>
      </div>
      <ProfileHeader
        initials={initialsFrom(name)}
        name={name}
        handle={`@${profile?.username}`}
        tagline={profile?.headline ?? undefined}
        location={profile?.location}
        avatarUrl={profile?.avatar_url}
        website={website ? { label: website.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: website.url } : undefined}
        action={
          <ProfileEditor
            userId={user!.id}
            profile={{
              display_name: profile?.display_name ?? "",
              headline: profile?.headline ?? "",
              bio: profile?.bio ?? "",
              location: profile?.location ?? "",
              avatar_url: profile?.avatar_url ?? null,
              links,
            }}
          />
        }
      />
      <ProfileBody
        bio={profile?.bio ?? null}
        view={view}
        contactLinks={rest}
        basePath="/profile"
        initialTab={viewParam}
        storeNote={profile?.store_note}
        partsCount={await forSaleCount(supabase, user!.id)}
        partsPanel={
          /* P-6: your store here is your store there — the same panel the
             public profile mounts, with the owner's extra "Not live" tab. */
          <StorePanel
            supabase={supabase}
            sellerId={user!.id}
            isOwner
            viewerId={user!.id}
            basePath="/profile"
            tab={storeTab}
            page={Math.max(1, Number(listingsPageParam) || 1)}
          />
        }
      />

      <p className="mt-10">
        <span className="microlabel">Your public profile — </span>
        <Link href={`/u/${profile?.username}`} className="jumplink">
          drvn.app/u/{profile?.username}
        </Link>
      </p>
    </NarrowColumn>
  );
}
