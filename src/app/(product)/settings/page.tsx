import { listSavedCards } from "@/lib/payments/customers";
import { getPaymentProvider, paymentsAreLive } from "@/lib/payments/provider";
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
    .select(
      "username, display_name, headline, bio, location, links, notification_prefs, stripe_account_id, payouts_enabled"
    )
    .eq("id", user!.id)
    .single();

  const links = (Array.isArray(profile?.links) ? profile!.links : []) as ProfileLink[];
  const savedCards = await listSavedCards(user!.id).catch(() => []);

  return (
    // `--gutter` is the variable `.wrap` publishes so a full-bleed child can
    // cancel exactly the page padding rather than guessing at it. This column
    // is a hand-rolled wrapper rather than a `.wrap`, so it has to declare its
    // own — without it the section register scrolls with no bleed and stops
    // dead at the column edge, saying nothing about the sections to its right.
    <div className="mx-auto w-full max-w-[900px] px-6 pb-10 [--gutter:24px]">
      <SettingsPanel
        paymentsLive={paymentsAreLive()}
        savedCards={savedCards}
        connect={{
          stripeConfigured: getPaymentProvider().name === "stripe",
          hasAccount: Boolean(profile?.stripe_account_id),
          payoutsEnabled: profile?.payouts_enabled ?? false,
        }}
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
