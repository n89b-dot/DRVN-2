import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { NarrowColumn, ProfileHeader } from "@/components/ui";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { FollowButton } from "@/features/social/buttons";
import { loadProfileView } from "@/lib/profile-data";
import { createClient } from "@/lib/supabase/server";

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

  if (!profile) return { title: "Keeper not found - DRVN" };

  const name = profile.display_name ?? `@${profile.username}`;
  const description =
    profile.headline ??
    profile.bio?.slice(0, 155) ??
    `${name} on DRVN — their cars, their build sheets, and the parts they have for sale.`;

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
  searchParams: Promise<{ view?: string }>;
}) {
  const { username } = await params;
  const { view: viewParam } = await searchParams;
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  if (error) {
    console.error("[profile] failed to load", { username, error });
    throw new Error("Could not load this keeper sheet");
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

  const view = await loadProfileView(supabase, profile.id, { publicOnly: true });
  const { website, rest } = splitLinks(profile.links);
  const name = profile.display_name ?? `@${profile.username}`;

  return (
    <NarrowColumn>
      <div className="pagehead !pb-4">
        <span className="microlabel">
          Keeper sheet — public
          {view.rating !== null && (
            <>
              {" · "}
              {view.rating}★ from {view.reviewCount} review{view.reviewCount === 1 ? "" : "s"}
            </>
          )}
          {view.salesCount > 0 && <> · {view.salesCount} sold</>}
          {view.followerCount > 0 && <> · {view.followerCount} watching</>}
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
        initialTab={viewParam && TAB_KEYS.includes(viewParam) ? viewParam : undefined}
      />
    </NarrowColumn>
  );
}
