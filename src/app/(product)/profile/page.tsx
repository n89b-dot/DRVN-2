import Link from "next/link";
import { Suspense } from "react";

import { ProfileHeader, ShareButton, SkeletonCardGrid } from "@/components/ui";
import { profileBannerUrl } from "@/lib/cars/banner";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { StorePanel, forSaleCount } from "@/features/store/store-panel";
import { loadProfileView, PROFILE_UPDATES_MAX_PAGE } from "@/lib/profile-data";
import { parsePageParam } from "@/lib/page-param";
import { siteUrl } from "@/lib/site";
import { getPageClient, getViewer } from "@/lib/supabase/page-context";

import { ProfileEditor } from "./profile-editor";

export const metadata = { title: "Profile - DRVN" };

type ProfileLink = { label: string; url: string };

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ listingsPage?: string; reviewsPage?: string; updatesPage?: string; status?: string; view?: string }>;
}) {
  const {
    listingsPage: listingsPageParam,
    reviewsPage: reviewsPageParam,
    updatesPage: updatesPageParam,
    status: storeTab,
    view: viewParam,
  } = await searchParams;
  const supabase = await getPageClient();
  const user = await getViewer();

  // One parallel round: these were four steps in a row (profile → view →
  // banner cars → for-sale count), with the view itself seven deep.
  const [{ data: profile }, view, { data: bannerCars }, partsForSale] = await Promise.all([
    supabase.from("profiles").select("id, username, display_name, headline, bio, location, links, avatar_url, profile_type, payouts_enabled, main_car_id, store_note, created_at, updated_at").eq("id", user!.id).single(),
    loadProfileView(supabase, user!.id, {
      publicOnly: false,
      listingsPage: parsePageParam(listingsPageParam),
      reviewsPage: parsePageParam(reviewsPageParam),
      updatesPage: parsePageParam(updatesPageParam, PROFILE_UPDATES_MAX_PAGE),
    }),
    // Same banner the public page shows (P-1) — public cars only, so what you
    // see here is what a visitor sees.
    supabase
      .from("cars")
      .select("id, created_at, is_public, cover_image_url")
      .eq("owner_id", user!.id)
      .eq("is_public", true),
    forSaleCount(supabase, user!.id),
  ]);
  const bannerUrl = profileBannerUrl(bannerCars ?? [], profile?.main_car_id ?? null);
  const { website, rest } = splitLinks(profile?.links);
  const name = profile?.display_name ?? "Your profile";
  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];

  return (
    <div className="wrap pb-6">
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
        bannerUrl={bannerUrl}
        stats={[
          { label: view.followerCount === 1 ? "Follower" : "Followers", value: String(view.followerCount) },
          { label: "Following", value: String(view.followingCount) },
          { label: view.vehicles.length === 1 ? "Car" : "Cars", value: String(view.vehicles.length) },
        ]}
        website={website ? { label: website.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: website.url } : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
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
          {/* Saved is a personal library, not a profile action — it lives
              behind the bar's bookmark icon, so the head keeps two buttons. */}
          <ShareButton url={`/u/${profile?.username}`} title={name} />
          </div>
        }
      />
      <ProfileBody
        /* A new tab from a link (?view=parts) remounts the tabs — see /u. */
        key={viewParam ?? "overview"}
        bio={profile?.bio ?? null}
        view={view}
        contactLinks={rest}
        basePath="/profile"
        savedHref="/saved"
        initialTab={viewParam}
        storeNote={profile?.store_note}
        partsCount={partsForSale}
        partsPanel={
          /* P-6: your store here is your store there — the same panel the
             public profile mounts, with the owner's extra "Not live" tab. */
          <Suspense fallback={<SkeletonCardGrid label="Loading parts" cards={4} />}>
            <StorePanel
              supabase={supabase}
              sellerId={user!.id}
              isOwner
              viewerId={user!.id}
              basePath="/profile"
              tab={storeTab}
              page={parsePageParam(listingsPageParam)}
            />
          </Suspense>
        }
      />

      <p className="mt-10">
        <span className="microlabel">Your public profile — </span>
        <Link href={`/u/${profile?.username}`} className="jumplink">
          {new URL(siteUrl()).host}/u/{profile?.username}
        </Link>
      </p>
    </div>
  );
}
