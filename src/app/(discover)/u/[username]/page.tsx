import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  ButtonLink,
  NarrowColumn,
  ProfileHeader,
  ShareButton,
  ratingLine,
} from "@/components/ui";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { FollowButton } from "@/features/social/buttons";
import { ReportButton } from "@/features/moderation/report-button";
import { loadProfileView } from "@/lib/profile-data";
import { getPageClient as createClient, getViewer } from "@/lib/supabase/page-context";
import { reportError } from "@/lib/monitoring";
import { StorePanel, forSaleCount } from "@/features/store/store-panel";
import { profileBannerUrl } from "@/lib/cars/banner";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name, username, headline, bio, avatar_url")
    .eq("username", username)
    .maybeSingle();

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

const TAB_KEYS = ["overview", "garage", "updates", "parts", "reviews"];

/**
 * The old tab keys still work (P-3). Links to `?view=forsale` are out in the
 * world — in messages, in bookmarks — and renaming a tab is not a good
 * enough reason to break them. Nothing in SQL reads these; the only other
 * consumer is profile-body's own tab list.
 */
const TAB_ALIASES: Record<string, string> = {
  about: "overview",
  forsale: "parts",
  activity: "updates",
};

function resolveTab(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const key = TAB_ALIASES[raw] ?? raw;
  return TAB_KEYS.includes(key) ? key : undefined;
}

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ view?: string; listingsPage?: string; reviewsPage?: string; status?: string }>;
}) {
  const { username } = await params;
  const {
    view: viewParam,
    listingsPage: listingsPageParam,
    reviewsPage: reviewsPageParam,
    status: storeTab,
  } = await searchParams;
  const listingsPage = Math.max(1, Number(listingsPageParam) || 1);
  const reviewsPage = Math.max(1, Number(reviewsPageParam) || 1);
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, headline, bio, location, links, avatar_url, profile_type, notification_prefs, payouts_enabled, main_car_id, store_note, created_at, updated_at")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    reportError("[profile] failed to load", { username, error });
    throw new Error("Could not load this profile");
  }
  if (!profile) notFound();

  const user = await getViewer();

  let isFollowing = false;
  if (user) {
    const { data: follow } = await supabase
      .from("follows")
      .select("target_id")
      .eq("follower_id", user.id)
      .eq("target_type", "profile")
      .eq("target_id", profile.id)
      .maybeSingle();
    isFollowing = Boolean(follow);
  }

  const view = await loadProfileView(supabase, profile.id, {
    publicOnly: true,
    listingsPage,
    reviewsPage,
  });
  // P-6. The store runs its own query: it shows SOLD parts, which the
  // marketplace never does, and the allowed statuses come from who is
  // looking rather than from the URL.
  const isOwner = user?.id === profile.id;
  // The number on the Parts tab is what is FOR SALE — not the page's total,
  // which on "All" counts sold parts and, for the owner, drafts.
  const partsForSale = await forSaleCount(supabase, profile.id);

  // P-1: the banner is a car's cover, borrowed — never a separate upload.
  const { data: bannerCars } = await supabase
    .from("cars")
    .select("id, created_at, is_public, cover_image_url")
    .eq("owner_id", profile.id)
    .eq("is_public", true);
  const bannerUrl = profileBannerUrl(bannerCars ?? [], profile.main_car_id);

  const { website, rest } = splitLinks(profile.links);
  const name = profile.display_name ?? `@${profile.username}`;
  const trustLine = ratingLine(view.rating, view.reviewCount);

  // Shop context (0056): same account, storefront emphasis — a shop opens on
  // For Sale, and the verified badge is admin-granted state, never
  // self-declaration.
  const isShop = profile.profile_type === "shop";
  const { data: shopProfile } = isShop
    ? await supabase
        .from("shop_profiles")
        .select("verification_status, returns_accepted, return_window_days")
        .eq("profile_id", profile.id)
        .maybeSingle()
    : { data: null };
  const verifiedShop = shopProfile?.verification_status === "verified";

  return (
    <NarrowColumn>
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
          { label: `follower${view.followerCount === 1 ? "" : "s"}`, value: String(view.followerCount) },
          { label: `car${view.vehicles.length === 1 ? "" : "s"}`, value: String(view.vehicles.length) },
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
            {(partsForSale ?? 0) > 0 && resolveTab(viewParam) !== "parts" && (
              <ButtonLink href={`/u/${profile.username}?view=parts`} variant="ghost">
                Store
              </ButtonLink>
            )}
            <ShareButton url={`/u/${profile.username}`} title={name} />
          </div>
        }
      />
      <ProfileBody
        bio={profile.bio}
        view={view}
        contactLinks={rest}
        initialTab={
          resolveTab(viewParam) ??
          // §36: a shop is storefront-first — it opens on its parts.
          (isShop ? "parts" : undefined)
        }
        basePath={`/u/${profile.username}`}
        storeNote={profile.store_note}
        partsCount={partsForSale}
        partsPanel={
          <StorePanel
            supabase={supabase}
            sellerId={profile.id}
            isOwner={isOwner}
            viewerId={user?.id ?? null}
            basePath={`/u/${profile.username}`}
            tab={storeTab}
            page={listingsPage}
          />
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
    </NarrowColumn>
  );
}
