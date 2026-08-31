import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NarrowColumn, ProfileHeader, ratingLine } from "@/components/ui";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { FollowButton } from "@/features/social/buttons";
import { ReportButton } from "@/features/moderation/report-button";
import { loadProfileView } from "@/lib/profile-data";
import { createClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/monitoring";

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

const TAB_KEYS = ["about", "forsale", "reviews", "activity"];

export default async function PublicProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ username: string }>;
  searchParams: Promise<{ view?: string; listingsPage?: string; reviewsPage?: string }>;
}) {
  const { username } = await params;
  const { view: viewParam, listingsPage: listingsPageParam, reviewsPage: reviewsPageParam } =
    await searchParams;
  const listingsPage = Math.max(1, Number(listingsPageParam) || 1);
  const reviewsPage = Math.max(1, Number(reviewsPageParam) || 1);
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, headline, bio, location, links, avatar_url, profile_type, notification_prefs, payouts_enabled, created_at, updated_at")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    reportError("[profile] failed to load", { username, error });
    throw new Error("Could not load this profile");
  }
  if (!profile) notFound();

  const {
    data: { user },
  } = await supabase.auth.getUser();

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
          {isShop ? "Shop" : "Seller profile"}
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
          {view.followerCount > 0 && <> · {view.followerCount} follower{view.followerCount === 1 ? "" : "s"}</>}
        </span>
      </div>
      <ProfileHeader
        initials={initialsFrom(name)}
        name={name}
        handle={`@${profile.username}`}
        tagline={
          profile.headline && profile.location
            ? `${profile.headline} in ${profile.location}`
            : profile.headline ?? profile.location
        }
        avatarUrl={profile.avatar_url}
        website={website ? { label: website.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: website.url } : undefined}
        action={
          user?.id !== profile.id ? (
            <FollowButton
              targetType="profile"
              targetId={profile.id}
              path={`/u/${profile.username}`}
              initialFollowing={isFollowing}
              isLoggedIn={Boolean(user)}
            />
          ) : undefined
        }
      />
      <ProfileBody
        bio={profile.bio}
        view={view}
        contactLinks={rest}
        initialTab={
          viewParam && TAB_KEYS.includes(viewParam)
            ? viewParam
            : // §36: a shop is storefront-first — it opens on For Sale.
              isShop
              ? "forsale"
              : undefined
        }
        basePath={`/u/${profile.username}`}
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
