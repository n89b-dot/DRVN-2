import Link from "next/link";

import { NarrowColumn, ProfileHeader } from "@/components/ui";
import { ProfileBody } from "@/components/profile/profile-body";
import { initialsFrom, splitLinks } from "@/components/profile/helpers";
import { loadProfileView } from "@/lib/profile-data";
import { createClient } from "@/lib/supabase/server";

import { ProfileEditor } from "./profile-editor";

export const metadata = { title: "Profile - DRVN" };

type ProfileLink = { label: string; url: string };

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user!.id).single();

  const view = await loadProfileView(supabase, user!.id, { publicOnly: false });
  const { website, rest } = splitLinks(profile?.links);
  const name = profile?.display_name ?? "Your profile";
  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];

  return (
    <NarrowColumn>
      <ProfileHeader
        initials={initialsFrom(name)}
        name={name}
        handle={`@${profile?.username}`}
        tagline={
          profile?.headline && profile?.location
            ? `${profile.headline} in ${profile.location}`
            : profile?.headline ?? profile?.location
        }
        avatarUrl={profile?.avatar_url}
        website={website ? { label: website.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), href: website.url } : undefined}
        action={
          <ProfileEditor
            profile={{
              display_name: profile?.display_name ?? "",
              headline: profile?.headline ?? "",
              bio: profile?.bio ?? "",
              location: profile?.location ?? "",
              links,
            }}
          />
        }
      />
      <ProfileBody bio={profile?.bio ?? null} view={view} contactLinks={rest} />

      <p className="mt-10 text-sm text-text-muted">
        Your public page:{" "}
        <Link href={`/u/${profile?.username}`} className="text-accent hover:underline">
          drvn.app/u/{profile?.username}
        </Link>
      </p>
    </NarrowColumn>
  );
}
