import { listSavedCards } from "@/lib/payments/customers";
import { createClient } from "@/lib/supabase/server";

import { logout } from "@/app/(auth)/actions";

import { SettingsPanel } from "./settings-panel";

export const metadata = { title: "Settings - DRVN" };

type ProfileLink = { label: string; url: string };

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, headline, bio, location, links, notification_prefs")
    .eq("id", user!.id)
    .single();

  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];
  const savedCards = await listSavedCards(user!.id).catch(() => []);

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 pb-10">
      <SettingsPanel
        savedCards={savedCards}
        profile={{
          email: user?.email ?? "",
          username: profile?.username ?? "",
          display_name: profile?.display_name ?? "",
          headline: profile?.headline ?? "",
          bio: profile?.bio ?? "",
          location: profile?.location ?? "",
          links,
          notification_prefs: profile?.notification_prefs ?? {},
        }}
        logout={logout}
      />
    </div>
  );
}
