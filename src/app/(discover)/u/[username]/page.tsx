import { notFound } from "next/navigation";

import { NarrowColumn, ProfileHeader } from "@/components/ui";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { FollowButton } from "@/features/social/buttons";
import { loadProfileView } from "@/lib/profile-data";
import { createClient } from "@/lib/supabase/server";

export default async function PublicProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const supabase = await createClient();

  const { data: profile } = await supabase
    .from("profiles")
    .select("*")
    .eq("username", username)
    .single();
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
        <span className="microlabel">Keeper sheet — public</span>
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
      <ProfileBody bio={profile.bio} view={view} contactLinks={rest} />
    </NarrowColumn>
  );
}
