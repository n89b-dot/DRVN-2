import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense, cache } from "react";

import {
  ButtonLink,
  ProfileHeader,
  ShareButton,
  SkeletonCardGrid,
  ratingLine,
} from "@/components/ui";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { FollowButton } from "@/features/social/buttons";
import { ReportButton } from "@/features/moderation/report-button";
import { loadProfileView, PROFILE_UPDATES_MAX_PAGE } from "@/lib/profile-data";
import { parsePageParam } from "@/lib/page-param";
import { getPublicPageClient as createClient, getViewer } from "@/lib/supabase/page-context";
import { reportError } from "@/lib/monitoring";
import { StorePanel, forSaleCount } from "@/features/store/store-panel";
import { profileBannerUrl } from "@/lib/cars/banner";
import { profileHref, resolveProfileView } from "@/lib/profile-href";

/** One profile read per request, shared by the metadata and the page (they
 *  each used to fetch it). React's cache is per render, never cross-user. */
const loadProfileByUsername = cache(async (username: string) => {
  const supabase = await createClient();
  return supabase
    .from("profiles")
    .select("id, username, display_name, headline, bio, location, links, avatar_url, profile_type, notification_prefs, payouts_enabled, main_car_id, store_note, created_at, updated_at")
    .eq("username", username)
    .maybeSingle();
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const { data: profile } = await loadProfileByUsername(username);

  if (!profile) return { title: "Profile not found - DRVN" };

  const name = profile.display_name ?? `@${profile.username}`;
  const description =
    profile.headline ??
    profile.bio?.slice(0, 155) ??
    `${name} on DRVN — their cars, their builds, and the parts they have for sale.`;

  return {
    title: `${name} (@${profile.username}) - DRVN`,
    description,
    alternates: { canonical: `/u/${profile.username}` },
    openGraph: {
      title: `${name} on DRVN`,
      description,
      url: `/u/${profile.username}`,
      type: "profile",
      images: profile.avatar_url ? [{ url: profile.avatar_url }] : undefined,
    },
    twitter: { card: "summary", title: `${name} on DRVN`, description },
  };
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ view?: string; tab?: string; listingsPage?: string; reviewsPage?: string; updatesPage?: string; status?: string }>;
}) {
  const { username } = await params;
  const {
    view: viewParam,
    tab: legacyTabParam,
    listingsPage: listingsPageParam,
    reviewsPage: reviewsPageParam,
    updatesPage: updatesPageParam,
    status: storeTab,
  } = await searchParams;
  const listingsPage = parsePageParam(listingsPageParam);
  const reviewsPage = parsePageParam(reviewsPageParam);
  const updatesPage = parsePageParam(updatesPageParam, PROFILE_UPDATES_MAX_PAGE);
  // `view` is the key; `?tab=` is a legacy alias read only without it — the
  // listing page's seller link used it, and those links are out there.
  // Old tab names (?view=forsale) still resolve too — see profile-href.
  const requestedTab = resolveProfileView(viewParam, legacyTabParam);
  const supabase = await createClient();

  const [{ data: profile, error }, user] = await Promise.all([loadProfileByUsername(username), getViewer()]);

  if (error) {
    reportError("[profile] failed to load", { username, error });
    throw new Error("Could not load this profile");
  }
  if (!profile) notFound();

  // Everything else needs only the profile id, so it goes out together —
  // these were five more steps in a row after the profile view.
  const isShop = profile.profile_type === "shop";
  const [followRes, view, partsForSale, { data: bannerCars }, { data: shopProfile }] = await Promise.all([
    user
      ? supabase
          .from("follows")
          .select("target_id")
          .eq("follower_id", user.id)
          .eq("target_type", "profile")
          .eq("target_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    loadProfileView(supabase, profile.id, {
      publicOnly: true,
      listingsPage,
      reviewsPage,
      updatesPage,
    }),
    // The number on the Parts tab is what is FOR SALE — not the page's
    // total, which on "All" counts sold parts and, for the owner, drafts.
    forSaleCount(supabase, profile.id),
    // P-1: the banner is a car's cover, borrowed — never a separate upload.
    supabase
      .from("cars")
      .select("id, created_at, is_public, cover_image_url")
      .eq("owner_id", profile.id)
      .eq("is_public", true),
    // Shop context (0056): same account, storefront emphasis — a shop opens
    // on For Sale, and the verified badge is admin-granted state, never
    // self-declaration.
    isShop
      ? supabase
          .from("shop_profiles")
          .select("verification_status, returns_accepted, return_window_days")
          .eq("profile_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const isFollowing = Boolean(followRes.data);
  // P-6. The store runs its own query: it shows SOLD parts, which the
  // marketplace never does, and the allowed statuses come from who is
  // looking rather than from the URL.
  const isOwner = user?.id === profile.id;
  const bannerUrl = profileBannerUrl(bannerCars ?? [], profile.main_car_id);

  const { website, rest } = splitLinks(profile.links);
  const name = profile.display_name ?? `@${profile.username}`;
  const trustLine = ratingLine(view.rating, view.reviewCount);
  const verifiedShop = shopProfile?.verification_status === "verified";

  return (
    /* The profile is a hub, not a form: full page width, a banner band, and
       a rail beside the tabs. The narrow column it used to sit in made the
       store two cards wide and the banner a thumbnail. */
    <div className="wrap pb-6">
      <div className="pagehead !pb-4">
        <span className="microlabel">
          {isShop ? "Shop" : "Profile"}
          {verifiedShop && (
            <>
              {" "}
              <span className="chip chip--ok">Verified shop</span>
            </>
          )}
          {isShop && shopProfile?.returns_accepted && (
            <> · {shopProfile.return_window_days}-day returns</>
          )}
          {trustLine && (
            <>
              {" · "}
              {trustLine}
            </>
          )}
          {view.salesCount > 0 && <> · {view.salesCount} sold</>}
          {/* P-7: rating · sold · member since. Followers are in the header. */}
          {profile.created_at && (
            <> · Member since {new Date(profile.created_at).getFullYear()}</>
          )}
        </span>
      </div>
      <ProfileHeader
        initials={initialsFrom(name)}
        name={name}
        handle={`@${profile.username}`}
        /* The location has its own line below; folding it into the
           tagline as well said it twice. */
        tagline={profile.headline ?? undefined}
        avatarUrl={profile.avatar_url}
        bannerUrl={bannerUrl}
        location={profile.location}
        stats={[
          { label: view.followerCount === 1 ? "Follower" : "Followers", value: String(view.followerCount) },
          { label: "Following", value: String(view.followingCount) },
          { label: view.vehicles.length === 1 ? "Car" : "Cars", value: String(view.vehicles.length) },
        ]}
        website={website ? { label: website.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: website.url } : undefined}
        action={
          /* P-2: Follow · Store · share. No Message button — a ruling. */
          <div className="flex flex-wrap items-center gap-2">
            {!isOwner && (
              <FollowButton
                targetType="profile"
                targetId={profile.id}
                path={`/u/${profile.username}`}
                initialFollowing={isFollowing}
                isLoggedIn={Boolean(user)}
              />
            )}
            {/* Not while you are already standing in it. */}
            {(partsForSale ?? 0) > 0 && requestedTab !== "parts" && (
              <ButtonLink href={profileHref(profile.username ?? username, "parts")} variant="live">
                Store
              </ButtonLink>
            )}
            <ShareButton url={`/u/${profile.username}`} title={name} />
          </div>
        }
      />
      <ProfileBody
        /* Remount on a server-side tab change (the Store button links to
           ?view=parts): the tabs hold their own state, and without a new key
           the URL changed but the Overview stayed on screen. */
        key={requestedTab ?? "overview"}
        bio={profile.bio}
        view={view}
        contactLinks={rest}
        initialTab={
          requestedTab ??
          // §36: a shop is storefront-first — it opens on its parts.
          (isShop ? "parts" : undefined)
        }
        basePath={`/u/${profile.username}`}
        storeNote={profile.store_note}
        partsCount={partsForSale}
        partsPanel={
          // Streams in after the page: the store runs its own two queries.
          <Suspense fallback={<SkeletonCardGrid label="Loading parts" cards={4} />}>
            <StorePanel
              supabase={supabase}
              sellerId={profile.id}
              isOwner={isOwner}
              viewerId={user?.id ?? null}
              basePath={`/u/${profile.username}`}
              tab={storeTab}
              page={listingsPage}
            />
          </Suspense>
        }
      />
      {user?.id !== profile.id && (
        <div className="mt-8 border-t border-[color:var(--rule-soft)] pt-4">
          <ReportButton
            subjectType="user"
            subjectId={profile.id}
            subjectLabel={`@${profile.username}`}
            isLoggedIn={Boolean(user)}
          />
        </div>
      )}
    </div>
  );
}
